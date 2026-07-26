import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FIXED_DECISION_PILOT_SCHEDULE_PROTOCOL,
  assertFixedDecisionPilotPopulation,
  fixedDecisionPilotSchedule,
  runFixedDecisionPilotSchedule,
  type FixedDecisionPilotSchedule,
} from '../src/policy/fixed-decision-pilot';
import { startLLMPolicy } from '../src/policy/llm';
import type { ResidentMind } from '../src/mind/interface';

function schedule(entity: string, orders: readonly number[], offsets: readonly number[]) {
  return fixedDecisionPilotSchedule({
    protocol: FIXED_DECISION_PILOT_SCHEDULE_PROTOCOL,
    slots: orders.map((order, index) => ({
      slotId: `${entity}-${index + 1}`,
      order,
      offsetMs: offsets[index],
    })),
  });
}

test('fixed pilot population requires exactly four staggered slots and one global order', () => {
  const left = schedule('left', [1, 3, 5, 7], [10, 30, 50, 70]);
  const right = schedule('right', [2, 4, 6, 8], [20, 40, 60, 80]);
  assert.doesNotThrow(() =>
    assertFixedDecisionPilotPopulation([
      { entityId: 'left', decisionSchedule: left },
      { entityId: 'right', decisionSchedule: right },
    ]),
  );
  assert.throws(
    () => assertFixedDecisionPilotPopulation([{ entityId: 'left', decisionSchedule: left }]),
    /complete global sequence/,
  );
  assert.throws(
    () =>
      assertFixedDecisionPilotPopulation([
        { entityId: 'left', decisionSchedule: left },
        { entityId: 'right' },
      ]),
    /exact resident population/,
  );
  assert.throws(
    () =>
      fixedDecisionPilotSchedule({
        protocol: FIXED_DECISION_PILOT_SCHEDULE_PROTOCOL,
        slots: left.slots.slice(0, 3),
      }),
    /exactly 4 slots/,
  );
});

test('fixed pilot runner consumes wait and failure terminals without catch-up', async () => {
  const residentSchedule = schedule('resident', [1, 2, 3, 4], [10, 20, 30, 40]);
  let clock = 1_000;
  const opened: string[] = [];
  const events: string[] = [];
  const terminals = ['wait', 'provider_error', 'malformed_output', 'success'];
  const result = await runFixedDecisionPilotSchedule({
    schedule: residentSchedule,
    releasedAt: clock,
    now: () => clock,
    wait: async (milliseconds) => {
      clock += milliseconds;
    },
    openOpportunity: async (slot) => {
      opened.push(slot.slotId);
      return terminals[opened.length - 1];
    },
    onEvent: (event) => events.push(event.type),
  });

  assert.deepEqual(opened, ['resident-1', 'resident-2', 'resident-3', 'resident-4']);
  assert.deepEqual(result, { status: 'completed', completedSlots: 4 });
  assert.equal(events.filter((event) => event === 'slot_opened').length, 4);
  assert.equal(events.filter((event) => event === 'slot_terminal').length, 4);
  assert.equal(events.at(-1), 'completed');
});

test('fixed pilot runner cancels cleanly without opening a later slot', async () => {
  const controller = new AbortController();
  const residentSchedule = schedule('resident', [1, 2, 3, 4], [10, 20, 30, 40]);
  let clock = 1_000;
  const opened: string[] = [];
  const result = await runFixedDecisionPilotSchedule({
    schedule: residentSchedule,
    releasedAt: clock,
    signal: controller.signal,
    now: () => clock,
    wait: async (milliseconds) => {
      clock += milliseconds;
    },
    openOpportunity: async (slot) => {
      opened.push(slot.slotId);
      controller.abort(new Error('fixture cancellation'));
      return 'wait';
    },
  });

  assert.deepEqual(opened, ['resident-1']);
  assert.deepEqual(result, { status: 'cancelled', completedSlots: 1 });
});

test('fixed pilot policy admits only explicit slots and continues after wait or model failure', async () => {
  let calls = 0;
  const opportunities: any[] = [];
  const mind: ResidentMind = {
    id: 'fixed-pilot-fixture',
    decide: async () => {
      calls += 1;
      if (calls === 2) throw new Error('fixture provider failure');
      return {
        protocol: 'behold.mind-decision.v1',
        disposition: 'wait',
        utterance: `wait ${calls}`,
        action: null,
        call: modelCallEvidence(`call-${calls}`),
      };
    },
  };
  const policy = startLLMPolicy(
    {
      entityId: 'FixedResident',
      actions: [],
      attempt: () => assert.fail('wait-only fixture cannot attempt a physical action'),
      observe: (sinceSequence = 0) => observation(sinceSequence),
    },
    {
      apiKey: 'unused',
      model: 'fixture/model',
      mind,
      policyProfile: 'neutral-benchmark-v1',
      bodyProfile: 'minecraft-human-semantic-v1',
      actionProfile: 'minecraft-human-semantic-v1',
      safetyProfile: 'vanilla-player-v1',
      tickMs: 500,
      maxTurnSteps: 1,
      resumeAfterBudget: false,
      decisionScheduling: 'fixed-pilot-slots',
      acceptEngineEvent: () => true,
      onDecisionOpportunity: (event) => opportunities.push(event),
    },
  );

  try {
    policy.start();
    policy.wake();
    await new Promise((resolve) => setTimeout(resolve, 550));
    assert.equal(calls, 0, 'timer and event wakes must not admit cognition between slots');

    for (let slot = 0; slot < 4; slot += 1) {
      await policy.tick();
      policy.wake();
    }
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(calls, 4);
    assert.equal(opportunities.filter((event) => event.phase === 'scheduled').length, 4);
    assert.equal(opportunities.filter((event) => event.phase === 'terminal').length, 4);
    assert.equal(
      opportunities.filter((event) => event.phase === 'terminal' && event.terminal === 'success')
        .length,
      3,
    );
    assert.equal(policy.state().turnActive, false);
  } finally {
    await policy.stop();
  }
});

function observation(sinceSequence: number) {
  return {
    protocol: 'behold.inhabitant.v2',
    sequence: 1,
    observedAt: 1,
    self: { currentAction: null },
    scene: { entities: [], terrain: { materials: [] } },
    events: [
      {
        sequence: 1,
        type: 'spawned',
        isNew: sinceSequence < 1,
        source: 'fixture',
        salience: 'normal',
        data: {},
      },
    ],
  };
}

function modelCallEvidence(requestId: string) {
  return {
    protocol: 'behold.model-call.v1' as const,
    requestId,
    endpoint: 'test://fixed-pilot',
    startedAt: 1,
    completedAt: 2,
    latencyMs: 1,
    adapter: { name: 'fixed-pilot-fixture' },
    request: {
      model: 'fixture/model',
      messageCount: 1,
      toolCount: 1,
      toolChoice: null,
      bodySha256: '0'.repeat(64),
      messagesSha256: '1'.repeat(64),
      toolsSha256: '2'.repeat(64),
      kind: 'mind_input' as const,
    },
    response: {
      id: null,
      model: 'fixture/model',
      provider: 'fixture',
      finishReason: 'wait',
      nativeFinishReason: null,
      usage: null,
    },
  };
}
