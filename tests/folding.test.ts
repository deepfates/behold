import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLoomContextView, foldMessage, projectTurnForFolding } from '../src/entity/folding';
import type { EntityTurn } from '../src/entity/loom';

test('loom folding is a bounded view and never mutates source turns', async () => {
  const turns = Array.from({ length: 20 }, (_, index) => entityTurn(index + 1, 'Scout'));
  const original = JSON.stringify(turns);
  const requests: any[] = [];
  const view = createLoomContextView(turns, {
    entityId: 'Scout',
    model: 'test/model',
    recentTurns: 4,
    foldBatchTurns: 4,
    summarize: async (request) => {
      requests.push(request);
      return [request.previousSummary, `[t${request.fromSequence}-t${request.toSequence}]`]
        .filter(Boolean)
        .join(' ');
    },
  });

  assert.equal(await view.prepare(), true);
  const materialized = view.view();
  assert.equal(materialized.fold?.source.toSequence, 16);
  assert.deepEqual(
    materialized.turns.map((turn) => turn.sequence),
    [17, 18, 19, 20],
  );
  assert.equal(requests.length, 4);
  assert.equal(JSON.stringify(turns), original);
  assert.match(foldMessage(materialized.fold!).content, /non-authoritative projection/);
});

test('loom folding advances in batches and keeps a bounded verbatim frontier', async () => {
  const turns = Array.from({ length: 12 }, (_, index) => entityTurn(index + 1, 'Scout'));
  let summaries = 0;
  const view = createLoomContextView(turns, {
    entityId: 'Scout',
    model: 'test/model',
    recentTurns: 4,
    foldBatchTurns: 4,
    summarize: async ({ previousSummary, fromSequence, toSequence }) => {
      summaries += 1;
      return `${previousSummary || ''} [t${fromSequence}-t${toSequence}]`.trim();
    },
  });
  await view.prepare();
  assert.equal(view.state().foldedThrough, 8);

  for (let sequence = 13; sequence <= 15; sequence += 1) {
    view.append(entityTurn(sequence, 'Scout'));
  }
  assert.equal(view.state().needsFold, false);
  assert.equal(view.state().visibleTurns, 7);

  view.append(entityTurn(16, 'Scout'));
  assert.equal(view.state().needsFold, true);
  await view.prepare();
  assert.equal(view.state().foldedThrough, 12);
  assert.equal(view.state().visibleTurns, 4);
  assert.equal(summaries, 3);
});

test('a read-only loom view never fabricates or writes a fold needed for replay', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-fold-read-only-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cacheFile = path.join(root, 'fold.json');
  let summarizerCalls = 0;
  const view = createLoomContextView(
    [entityTurn(1, 'Scout'), entityTurn(2, 'Scout'), entityTurn(3, 'Scout')],
    {
      entityId: 'Scout',
      model: 'test/model',
      cacheFile,
      readOnly: true,
      recentTurns: 1,
      foldTriggerTurns: 1,
      summarize: async () => {
        summarizerCalls += 1;
        return 'must not be called';
      },
    },
  );

  await assert.rejects(
    view.prepare(),
    /read-only loom context requires a current fold.*"foldTarget":2/,
  );
  assert.equal(summarizerCalls, 0);
  assert.equal(fs.existsSync(cacheFile), false);
});

test('a validated fold cache is disposable acceleration, not another source of truth', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-fold-'));
  const cacheFile = path.join(root, 'fold.json');
  const turns = Array.from({ length: 12 }, (_, index) => entityTurn(index + 1, 'Scout'));
  let firstCalls = 0;
  const first = createLoomContextView(turns, {
    entityId: 'Scout',
    model: 'test/model',
    recentTurns: 4,
    foldBatchTurns: 4,
    cacheFile,
    summarize: async ({ toSequence }) => {
      firstCalls += 1;
      return `continuity through t${toSequence}`;
    },
  });
  await first.prepare();
  assert.equal(firstCalls, 2);

  let resumedCalls = 0;
  const resumed = createLoomContextView(turns, {
    entityId: 'Scout',
    model: 'another/model',
    recentTurns: 4,
    foldBatchTurns: 4,
    cacheFile,
    summarize: async () => {
      resumedCalls += 1;
      return 'should not run';
    },
  });
  assert.equal(await resumed.prepare(), false);
  assert.equal(resumedCalls, 0);
  assert.equal(resumed.state().foldedThrough, 8);

  const diverged = [...turns];
  diverged[7] = { ...diverged[7], id: 'Scout:turn:8-diverged' };
  diverged[8] = { ...diverged[8], parentId: diverged[7].id };
  const rebuilt = createLoomContextView(diverged, {
    entityId: 'Scout',
    model: 'test/model',
    recentTurns: 4,
    foldBatchTurns: 4,
    cacheFile,
    summarize: async ({ toSequence }) => `rebuilt through t${toSequence}`,
  });
  assert.equal(rebuilt.state().foldedThrough, 0);
  await rebuilt.prepare();
  assert.equal(rebuilt.state().foldedThrough, 8);
});

test('fold evidence carries only new events while retaining action consequences', () => {
  const turn = entityTurn(3, 'Scout');
  turn.observation.events = [
    { type: 'old', isNew: false, data: { ignored: true } },
    {
      sequence: 17,
      type: 'chat_received',
      isNew: true,
      data: { from: 'importdf', text: 'follow me' },
    },
  ];
  turn.nextObservation.events = [
    {
      sequence: 17,
      type: 'chat_received',
      isNew: true,
      data: { from: 'importdf', text: 'follow me' },
    },
    { sequence: 18, type: 'inventory_changed', isNew: true, data: { item: 'chest' } },
  ];
  turn.outcome.result = { ok: true, changes: [{ verb: 'place', after: 'chest' }] };

  const evidence = projectTurnForFolding(turn);
  assert.deepEqual(evidence.observation.events, [
    {
      sequence: 17,
      type: 'chat_received',
      isNew: true,
      data: { from: 'importdf', text: 'follow me' },
    },
  ]);
  assert.deepEqual((evidence.nextObservation as any).events, [
    { sequence: 18, type: 'inventory_changed', isNew: true, data: { item: 'chest' } },
  ]);
  assert.equal((evidence.nextObservation as any).eventWindow.suppressedRepeatedEvents, 1);
  assert.deepEqual((evidence.outcome as any).result.changes, [{ verb: 'place', after: 'chest' }]);
  assert.equal((evidence.observation as any).scene, undefined);
  assert.deepEqual((evidence.nextObservation as any).self, { identity: 'Scout' });
  assert.equal(
    (evidence.nextObservation as any).historicalProjection.previous,
    'same_turn_observation',
  );
});

test('fold requests omit direct and nested non-resident evidence', async () => {
  const privileged = entityTurn(1, 'Scout');
  privileged.action.name = 'inspect_reachable_space';
  privileged.action.input = { secret: 'direct-private-input' };
  privileged.outcome.result = { secret: 'direct-private-result' };
  const nested = entityTurn(2, 'Scout');
  nested.action.name = 'manage_project';
  nested.outcome.result = {
    ok: true,
    evidence: {
      satisfied: true,
      expected: 'space_enclosed',
      witness: {
        action: 'inspect_reachable_space',
        input: { secret: 'nested-private-input' },
        result: { protectedCells: ['nested-private-result'] },
      },
    },
  };
  const frontier = entityTurn(3, 'Scout');
  let requestText = '';
  const view = createLoomContextView([privileged, nested, frontier], {
    entityId: 'Scout',
    model: 'test/model',
    recentTurns: 1,
    foldBatchTurns: 2,
    foldTriggerTurns: 1,
    summarize: async (request) => {
      requestText = JSON.stringify(request);
      return 'safe bounded summary';
    },
  });

  await view.prepare();
  assert.match(requestText, /not_resident_observable/);
  assert.doesNotMatch(requestText, /direct-private|nested-private/);
  assert.equal(view.view().fold?.protocol, 'behold.loom-fold.v2');
});

test('fold batches reuse causal observation deltas and expose bounded event loss', async () => {
  const turns = [entityTurn(1, 'Scout'), entityTurn(2, 'Scout'), entityTurn(3, 'Scout')];
  turns[1].observation.events = Array.from({ length: 30 }, (_, index) => ({
    sequence: index + 1,
    type: 'sound_heard',
    isNew: true,
    data: { direction: 'left' },
  }));
  let folded: any[] = [];
  const view = createLoomContextView(turns, {
    entityId: 'Scout',
    model: 'test/model',
    recentTurns: 1,
    foldBatchTurns: 2,
    foldTriggerTurns: 1,
    summarize: async ({ turns: evidence }) => {
      folded = evidence;
      return 'bounded evidence';
    },
  });

  await view.prepare();
  assert.equal(folded.length, 2);
  assert.deepEqual(folded[1].observation.self, { identity: 'Scout' });
  assert.equal(folded[1].observation.events.length, 24);
  assert.equal(folded[1].observation.eventWindow.omittedNewEvents, 6);
  assert.equal(folded[1].observation.eventWindow.complete, false);
  assert.equal(folded[1].observation.scene, undefined);
});

test('loom views reject foreign turns instead of sharing inhabitant state', () => {
  const scoutTurns = [entityTurn(1, 'Scout'), entityTurn(2, 'Scout')];
  const builderTurn = entityTurn(1, 'Builder');
  const options = {
    entityId: 'Scout',
    model: 'test/model',
    summarize: async () => 'summary',
  };

  assert.throws(
    () => createLoomContextView([...scoutTurns, builderTurn], options),
    /contains turn owned by Builder/,
  );

  const scout = createLoomContextView(scoutTurns, options);
  assert.throws(() => scout.append(builderTurn), /cannot append turn owned by Builder/);
  assert.deepEqual(
    scout.view().turns.map((turn) => turn.entityId),
    ['Scout', 'Scout'],
  );
});

function entityTurn(sequence: number, entityId: string): EntityTurn {
  return {
    protocol: 'behold.entity-turn.v1',
    id: `${entityId}:turn:${sequence}`,
    entityId,
    sequence,
    parentId: sequence === 1 ? null : `${entityId}:turn:${sequence - 1}`,
    model: 'test/model',
    startedAt: sequence * 10,
    completedAt: sequence * 10 + 5,
    observation: {
      protocol: 'behold.inhabitant.v1',
      sequence,
      self: { identity: entityId, condition: { health: 20, food: 20 } },
      scene: { entities: [], terrain: { materials: [] } },
      events: [{ type: 'time_passed', isNew: true, data: { elapsedMs: 30_000 } }],
    },
    utterance: { assistant: { role: 'assistant', content: null } },
    action: {
      id: `action-${sequence}`,
      name: 'status',
      input: {},
      source: 'llm',
      kind: 'parallel',
      toolCallId: `call-${sequence}`,
    },
    outcome: { ok: true, eventType: 'action_completed', result: { ok: true } },
    nextObservation: {
      protocol: 'behold.inhabitant.v1',
      sequence: sequence + 1,
      self: { identity: entityId, condition: { health: 20, food: 20 } },
      scene: { entities: [], terrain: { materials: [] } },
      events: [],
    },
  };
}
