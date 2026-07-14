import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ComeSeeDoReportPermissions,
  ComeSeeDoReportVerifier,
} from '../src/tasks/come-see-do-report';
import { buildInterpreter } from '../src/agent/interpreter';
import { createWorldChangeAuthority, type WorldChangeExecutor } from '../src/safety/world-change';
import type { InhabitantObservation } from '../src/agent/experience';

function observation(): InhabitantObservation {
  return {
    protocol: 'behold.inhabitant.v1',
    circle: { id: 'test-world', substrate: 'minecraft' },
    sequence: 4,
    observedAt: 100,
    eventWindow: {
      requestedAfterSequence: 0,
      oldestAvailableSequence: null,
      newestAvailableSequence: null,
      missingBeforeOldest: 0,
      complete: true,
    },
    task: null,
    self: {
      identity: 'Scout',
      pose: {
        position: { x: 0, y: 64, z: 0 },
        yaw: 0,
        pitch: 0,
        velocity: { x: 0, y: 0, z: 0 },
        onGround: true,
      },
      condition: { health: 20, food: 20, oxygen: 20, dimension: 'overworld', isDay: true },
      heldItem: 'lantern',
      inventory: [{ name: 'lantern', count: 1 }],
      projects: [],
      places: [],
      placeConflicts: [],
      currentAction: null,
    },
    scene: {
      social: {
        source: 'server_roster',
        playersOnline: ['importdf'],
        note: 'test',
      },
      focus: null,
      entities: [
        {
          id: 'player:importdf',
          kind: 'player',
          name: 'importdf',
          source: 'proximity',
          position: { x: 2, y: 64, z: 0 },
          distance: 2,
          proximity: 'interaction',
          relativeBearingRadians: 0,
          relativeDirection: 'ahead',
          visibility: 'unknown',
        },
      ],
      terrain: {
        source: 'local_volume',
        radius: 3,
        verticalRadius: 1,
        materials: [{ name: 'gray_concrete', count: 12 }],
        note: 'test',
      },
    },
    events: [],
  };
}

function completed(
  tool: string,
  input: any,
  result: any,
  at: number,
  source: 'llm' | 'human' = 'llm',
) {
  return {
    type: 'action_completed',
    at,
    data: {
      intent: {
        id: `${tool}-1`,
        source,
        tool,
        input,
        observationSequence: observation().sequence,
      },
      authorization: {
        ok: true,
        authority: source === 'llm' ? 'come-see-do-report-task' : 'operator-console',
      },
      result,
    },
  } as any;
}

function recordModelCompletion(
  verifier: ComeSeeDoReportVerifier,
  event: ReturnType<typeof completed>,
  observed: InhabitantObservation,
) {
  verifier.recordControllerDecision(event.data.intent, observed);
  verifier.recordEngineEvent(event, observed);
}

function recordWorldChange(executor: WorldChangeExecutor, change: any) {
  const reservation = executor.reserve({
    verb: change.verb,
    position: change.position,
    before: change.before,
  });
  assert.equal(reservation.ok, true);
  return executor.settle(reservation.reservationId, {
    after: change.after,
    verified: change.verified ?? change.evidence != null,
    evidence: change.evidence,
    error: change.error,
  });
}

test("task permissions enforce human activation without choosing the resident's next action", () => {
  let heldItem = 'lantern';
  const permissions = new ComeSeeDoReportPermissions(
    'importdf',
    (position) => {
      if (position.x === 1 && position.y === 63 && position.z === 0) return 'gray_concrete';
      if ((position.x === 2 || position.x === -2) && position.y === 64 && position.z === 0) {
        return 'stone';
      }
      return 'dirt';
    },
    () => heldItem,
  );
  const authorize = (tool: string, input?: any) =>
    permissions.authorizeAction(
      tool,
      input,
      tool === 'dig_block'
        ? { blockMutation: 'dig' }
        : ['place_against', 'place_block'].includes(tool)
          ? { blockMutation: 'place' }
          : ['descend_step'].includes(tool)
            ? { blockMutation: 'multiple' }
            : ['toggle_block', 'sleep_in_bed', 'wake_up'].includes(tool)
              ? { blockMutation: 'state' }
              : {},
    );
  const missingEffects = permissions.authorizeAction('chat', {}, undefined);
  assert.equal(missingEffects.ok, false);
  if (!missingEffects.ok) assert.equal(missingEffects.error, 'command_effects_required');
  assert.equal(authorize('approach_entity').ok, false);
  assert.equal(authorize('place_against').ok, false);
  assert.equal(authorize('survey_area').ok, false);

  permissions.recordIncomingChat('someone-else', 'Scout, come here');
  assert.equal(authorize('approach_entity').ok, false);
  permissions.recordIncomingChat('importdf', "Don't break or place anything");
  assert.equal(authorize('approach_entity').ok, true);
  assert.equal(authorize('place_against').ok, false);
  for (const tool of ['place_block', 'descend_step', 'toggle_block']) {
    assert.equal(authorize(tool).ok, false);
  }
  const interpreter = buildInterpreter({} as any);
  for (const tool of ['sleep_in_bed', 'wake_up']) {
    const effects = interpreter.describe(tool)?.effects;
    assert.equal(effects?.blockMutation, 'state');
    assert.equal(permissions.authorizeAction(tool, {}, effects).ok, false);
  }

  permissions.recordIncomingChat('importdf', 'Place a lantern here');
  const ambiguous = authorize('place_against');
  assert.equal(ambiguous.ok, false);
  if (!ambiguous.ok) assert.equal(ambiguous.error, 'ambiguous_change_request');

  permissions.recordIncomingChat('importdf', 'Place a lantern on this block');
  assert.equal(authorize('place_against').ok, false);
  permissions.recordIncomingChat('importdf', 'Place a lantern on this gray concrete block');
  assert.equal(
    authorize('place_against', {
      on: { x: 1, y: 63, z: 0 },
      face: 'top',
    }).ok,
    true,
  );
  const wrongTarget = authorize('place_against', {
    on: { x: 3, y: 63, z: 0 },
    face: 'top',
  });
  assert.equal(wrongTarget.ok, false);
  if (!wrongTarget.ok) assert.equal(wrongTarget.error, 'requested_target_mismatch');
  heldItem = 'dirt';
  const wrongItem = authorize('place_against', {
    on: { x: 1, y: 63, z: 0 },
    face: 'top',
  });
  assert.equal(wrongItem.ok, false);
  if (!wrongItem.ok) assert.equal(wrongItem.error, 'requested_target_mismatch');
  heldItem = 'lantern';
  assert.equal(authorize('dig_block').ok, false);

  permissions.recordIncomingChat('importdf', 'Place a lantern at 1 64 0');
  assert.equal(authorize('place_block', { x: 1, y: 64, z: 0, name: 'lantern' }).ok, true);
  assert.equal(authorize('descend_step', { direction: 'north' }).ok, false);

  permissions.recordIncomingChat('importdf', "Never mind, don't place anything");
  assert.equal(
    authorize('place_against', {
      on: { x: 1, y: 63, z: 0 },
      face: 'top',
    }).ok,
    false,
  );
  permissions.recordIncomingChat('importdf', 'Dig the stone at 2 64 0');
  assert.equal(authorize('dig_block', { x: 2, y: 64, z: 0 }).ok, true);
  assert.equal(authorize('dig_block', { x: 3, y: 64, z: 0 }).ok, false);
  permissions.recordIncomingChat('importdf', 'Dig the stone at -2 64 0');
  assert.equal(authorize('dig_block', { x: -2, y: 64, z: 0 }).ok, true);
  assert.equal(authorize('dig_block', { x: 2, y: 64, z: 0 }).ok, false);
  assert.equal(authorize('survey_area').ok, false);
  permissions.recordIncomingChat('importdf', 'Please scan the area');
  assert.equal(authorize('survey_area').ok, true);
});

test('Come–See–Do–Report verifier requires an ordered, evidenced trajectory', () => {
  const { guard, executor } = createWorldChangeAuthority({ budget: 1 });
  const verifier = new ComeSeeDoReportVerifier('importdf', guard, null, () => true);
  const obs = observation();

  // Mere server proximity is not proof that the resident performed the approach.
  assert.equal(verifier.snapshot(obs).approachedTarget, false);
  verifier.recordIncomingChat('importdf', 'Come here first', 10);
  verifier.recordEngineEvent(
    completed(
      'approach_entity',
      { target: 'player:importdf' },
      { ok: true, status: 'arrived', target: 'player:importdf', finalDistance: 2, near: 2.5 },
      20,
    ),
    obs,
  );
  recordModelCompletion(
    verifier,
    completed(
      'chat',
      { text: 'I am beside you; the nearby terrain includes gray concrete.' },
      { ok: true },
      30,
    ),
    obs,
  );
  verifier.recordIncomingChat('importdf', 'Place the lantern on this gray concrete block', 40);
  const confirmation = {
    source: 'mineflayer:blockUpdate' as const,
    observedAt: 49,
    beforeStateId: 0,
    afterStateId: 12,
  };
  recordWorldChange(executor, {
    verb: 'place',
    position: { x: 1, y: 64, z: 0 },
    before: 'air',
    after: 'lantern',
    evidence: confirmation,
  });
  const placeCompleted = completed(
    'place_against',
    {},
    {
      ok: true,
      changes: [
        {
          verb: 'place',
          position: { x: 1, y: 64, z: 0 },
          before: 'air',
          after: 'lantern',
          verified: true,
          confirmation,
          context: {
            reference: {
              position: { x: 1, y: 63, z: 0 },
              name: 'gray_concrete',
            },
          },
        },
      ],
    },
    50,
  );
  verifier.recordEngineEvent(placeCompleted, obs);
  verifier.recordEngineEvent(placeCompleted, obs);
  recordModelCompletion(verifier, completed('chat', { text: 'Done.' }, { ok: true }, 60), obs);
  assert.equal(verifier.snapshot(obs).outcomeReported, false);
  recordModelCompletion(
    verifier,
    completed('chat', { text: 'I placed the lantern successfully.' }, { ok: true }, 70),
    obs,
  );

  const progress = verifier.snapshot(obs);
  assert.equal(progress.success, true);
  assert.deepEqual(progress.groundedReport?.evidence, ['gray_concrete']);
  assert.equal(progress.verifiedChanges.length, 1);
  assert.equal(progress.outcomeReported, true);
  assert.deepEqual(progress.outcomeReport?.evidence, ['lantern', 'place']);
  assert.equal('nextAction' in progress, false);
  assert.deepEqual(progress.missing, []);
});

test('verifier never credits operator reports or world changes to the resident', () => {
  const { guard, executor } = createWorldChangeAuthority({ budget: 1 });
  const verifier = new ComeSeeDoReportVerifier('importdf', guard, null, () => true);
  const obs = observation();
  verifier.recordIncomingChat('importdf', 'Come here first', 10);
  verifier.recordEngineEvent(
    completed(
      'approach_entity',
      { target: 'player:importdf' },
      { ok: true, status: 'arrived', target: 'player:importdf', finalDistance: 2 },
      20,
    ),
    obs,
  );
  verifier.recordEngineEvent(
    completed(
      'chat',
      { text: 'The nearby terrain includes gray concrete.' },
      { ok: true },
      30,
      'human',
    ),
    obs,
  );
  verifier.recordIncomingChat('importdf', 'Place the lantern on this gray concrete block', 40);
  const confirmation = {
    source: 'mineflayer:blockUpdate' as const,
    observedAt: 49,
    beforeStateId: 0,
    afterStateId: 12,
  };
  recordWorldChange(executor, {
    verb: 'place',
    position: { x: 1, y: 64, z: 0 },
    before: 'air',
    after: 'lantern',
    evidence: confirmation,
  });
  verifier.recordEngineEvent(
    completed(
      'place_against',
      {},
      {
        ok: true,
        changes: [
          {
            position: { x: 1, y: 64, z: 0 },
            before: 'air',
            after: 'lantern',
            verified: true,
            confirmation,
          },
        ],
      },
      50,
      'human',
    ),
    obs,
  );
  verifier.recordEngineEvent(
    completed('chat', { text: 'I placed the lantern successfully.' }, { ok: true }, 60, 'human'),
    obs,
  );

  const progress = verifier.snapshot(obs);
  assert.equal(progress.groundedReport, null);
  assert.equal(progress.verifiedChanges.length, 0);
  assert.equal(progress.outcomeReport, null);
  assert.equal(progress.success, false);
});

test('verifier rejects negated scene and outcome claims', () => {
  const { guard, executor } = createWorldChangeAuthority({ budget: 1 });
  const verifier = new ComeSeeDoReportVerifier('importdf', guard, null, () => true);
  const obs = observation();
  verifier.recordIncomingChat('importdf', 'Come here first', 10);
  verifier.recordEngineEvent(
    completed(
      'approach_entity',
      { target: 'player:importdf' },
      { ok: true, status: 'arrived', target: 'player:importdf', finalDistance: 2 },
      20,
    ),
    obs,
  );
  recordModelCompletion(
    verifier,
    completed('chat', { text: 'There is no gray concrete here.' }, { ok: true }, 30),
    obs,
  );
  assert.equal(verifier.snapshot(obs).groundedReport, null);
  recordModelCompletion(
    verifier,
    completed('chat', { text: 'Gray concrete appears absent here.' }, { ok: true }, 31),
    obs,
  );
  assert.equal(verifier.snapshot(obs).groundedReport, null);

  verifier.recordIncomingChat('importdf', 'Place the lantern on this gray concrete block', 40);
  const confirmation = {
    source: 'mineflayer:blockUpdate' as const,
    observedAt: 49,
    beforeStateId: 0,
    afterStateId: 12,
  };
  recordWorldChange(executor, {
    verb: 'place',
    position: { x: 1, y: 64, z: 0 },
    before: 'air',
    after: 'lantern',
    evidence: confirmation,
  });
  verifier.recordEngineEvent(
    completed(
      'place_against',
      {},
      {
        ok: true,
        changes: [
          {
            position: { x: 1, y: 64, z: 0 },
            before: 'air',
            after: 'lantern',
            verified: true,
            confirmation,
            context: {
              reference: {
                position: { x: 1, y: 63, z: 0 },
                name: 'gray_concrete',
              },
            },
          },
        ],
      },
      50,
    ),
    obs,
  );
  recordModelCompletion(
    verifier,
    completed('chat', { text: 'I did not place the lantern.' }, { ok: true }, 60),
    obs,
  );
  assert.equal(verifier.snapshot(obs).outcomeReport, null);
  recordModelCompletion(
    verifier,
    completed('chat', { text: 'I failed to place the lantern.' }, { ok: true }, 61),
    obs,
  );
  assert.equal(verifier.snapshot(obs).outcomeReport, null);
  assert.equal(verifier.snapshot(obs).success, false);
});

test('verifier requires approach after contact and agreement with embodied distance', () => {
  const { guard } = createWorldChangeAuthority({ budget: 1 });
  const verifier = new ComeSeeDoReportVerifier('importdf', guard, null, () => true);
  const far = observation();
  far.scene.entities[0].distance = 100;
  far.scene.entities[0].position = { x: 100, y: 64, z: 0 };

  verifier.recordEngineEvent(
    completed(
      'approach_entity',
      { target: 'player:importdf' },
      { ok: true, status: 'arrived', target: 'player:importdf', finalDistance: 2 },
      5,
    ),
    far,
  );
  verifier.recordIncomingChat('importdf', 'Come here', 10);
  verifier.recordEngineEvent(
    completed(
      'approach_entity',
      { target: 'player:importdf' },
      { ok: true, status: 'arrived', target: 'player:importdf', finalDistance: 2 },
      20,
    ),
    far,
  );
  assert.equal(verifier.snapshot(far).approachedTarget, false);
});

test('verifier uses event timestamps rather than processing order', () => {
  const { guard } = createWorldChangeAuthority({ budget: 1 });
  const verifier = new ComeSeeDoReportVerifier('importdf', guard, null, () => true);
  const obs = observation();
  verifier.recordIncomingChat('importdf', 'Come here', 10);
  verifier.recordEngineEvent(
    completed(
      'approach_entity',
      { target: 'player:importdf' },
      { ok: true, status: 'arrived', target: 'player:importdf', finalDistance: 2 },
      20,
    ),
    obs,
  );
  recordModelCompletion(
    verifier,
    completed('chat', { text: 'The nearby terrain includes gray concrete.' }, { ok: true }, 5),
    obs,
  );
  assert.equal(verifier.snapshot(obs).groundedReport, null);
});

test('verifier grounds a report in the model decision observation, not later world state', () => {
  const { guard } = createWorldChangeAuthority({ budget: 1 });
  const verifier = new ComeSeeDoReportVerifier('importdf', guard, null, () => true);
  const decisionObservation = observation();
  decisionObservation.sequence = 3;
  decisionObservation.scene.terrain.materials = [{ name: 'dirt', count: 12 }];
  const completionObservation = observation();
  verifier.recordIncomingChat('importdf', 'Come here', 10);
  verifier.recordEngineEvent(
    completed(
      'approach_entity',
      { target: 'player:importdf' },
      { ok: true, status: 'arrived', target: 'player:importdf', finalDistance: 2 },
      20,
    ),
    completionObservation,
  );
  const report = completed(
    'chat',
    { text: 'The nearby terrain includes gray concrete.' },
    { ok: true },
    30,
  );
  report.data.intent.observationSequence = 3;
  verifier.recordControllerDecision(report.data.intent, decisionObservation);

  verifier.recordEngineEvent(report, completionObservation);

  assert.equal(verifier.snapshot(completionObservation).groundedReport, null);
});

test('verifier requires a recorded model decision even when completion sequence matches', () => {
  const { guard } = createWorldChangeAuthority({ budget: 1 });
  const verifier = new ComeSeeDoReportVerifier('importdf', guard, null, () => true);
  const obs = observation();
  verifier.recordIncomingChat('importdf', 'Come here', 10);
  verifier.recordEngineEvent(
    completed(
      'approach_entity',
      { target: 'player:importdf' },
      { ok: true, status: 'arrived', target: 'player:importdf', finalDistance: 2 },
      20,
    ),
    obs,
  );

  verifier.recordEngineEvent(
    completed('chat', { text: 'The nearby terrain includes gray concrete.' }, { ok: true }, 30),
    obs,
  );

  assert.equal(verifier.snapshot(obs).groundedReport, null);
});

test('verifier ignores lifecycle objects that were not minted by its bound engine', () => {
  const { guard } = createWorldChangeAuthority({ budget: 1 });
  const verifier = new ComeSeeDoReportVerifier('importdf', guard);
  const obs = observation();
  verifier.recordIncomingChat('importdf', 'Come here', 10);
  verifier.recordEngineEvent(
    completed(
      'approach_entity',
      { target: 'player:importdf' },
      { ok: true, status: 'arrived', target: 'player:importdf', finalDistance: 2 },
      20,
    ),
    obs,
  );

  assert.equal(verifier.snapshot(obs).approachedTarget, false);
  verifier.bindEngineEventSource(() => true);
  assert.throws(() => verifier.bindEngineEventSource(() => true), /already bound/);
});

test('verifier rejects a claimed change without matching Minecraft and safety evidence', () => {
  const { guard, executor } = createWorldChangeAuthority({ budget: 1 });
  const verifier = new ComeSeeDoReportVerifier('importdf', guard, null, () => true);
  const obs = observation();
  verifier.recordIncomingChat('importdf', 'Place the lantern on this block', 10);

  const fakeConfirmation = {
    source: 'mineflayer:blockUpdate' as const,
    observedAt: 19,
    beforeStateId: 0,
    afterStateId: 12,
  };
  verifier.recordEngineEvent(
    completed(
      'place_against',
      {},
      {
        ok: true,
        changes: [
          {
            position: { x: 1, y: 64, z: 0 },
            before: 'air',
            after: 'lantern',
            verified: true,
            confirmation: fakeConfirmation,
          },
        ],
      },
      20,
    ),
    obs,
  );
  assert.equal(verifier.snapshot(obs).verifiedChanges.length, 0);

  recordWorldChange(executor, {
    verb: 'place',
    position: { x: 1, y: 64, z: 0 },
    before: 'air',
    after: 'lantern',
    verified: false,
    error: 'world_change_unconfirmed',
  });
  verifier.recordEngineEvent(
    completed(
      'place_against',
      {},
      {
        ok: true,
        changes: [
          {
            position: { x: 1, y: 64, z: 0 },
            before: 'air',
            after: 'lantern',
            verified: true,
            confirmation: fakeConfirmation,
          },
        ],
      },
      30,
    ),
    obs,
  );
  const progress = verifier.snapshot(obs);
  assert.equal(progress.verifiedChanges.length, 0);
  assert.equal(progress.safety.changes[0].status, 'uncertain');
  assert.equal(progress.success, false);
});
