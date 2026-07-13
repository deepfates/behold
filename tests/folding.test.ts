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
    { type: 'chat_received', isNew: true, data: { from: 'importdf', text: 'follow me' } },
  ];
  turn.outcome.result = { ok: true, changes: [{ verb: 'place', after: 'chest' }] };

  const evidence = projectTurnForFolding(turn);
  assert.deepEqual(evidence.observation.events, [
    { type: 'chat_received', isNew: true, data: { from: 'importdf', text: 'follow me' } },
  ]);
  assert.deepEqual((evidence.outcome as any).result.changes, [{ verb: 'place', after: 'chest' }]);
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
