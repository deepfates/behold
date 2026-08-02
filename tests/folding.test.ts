import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createLoomContextView,
  foldMessage,
  projectTurnForFolding,
  type BoundedLoomContextState,
} from '../src/entity/folding';
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
  assert.equal(requests.length, 0, 'a large backlog uses one local canonical index');
  assert.equal(materialized.fold?.generation.kind, 'canonical_index');
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
  assert.equal(summaries, 1, 'only the later bounded increment needs model summarization');
});

test('cancelling one bounded fold increment preserves the last completed cache without synthetic progress', async () => {
  const turns = Array.from({ length: 4 }, (_, index) => entityTurn(index + 1, 'Scout'));
  const controller = new AbortController();
  let calls = 0;
  const view = createLoomContextView(turns, {
    entityId: 'Scout',
    model: 'test/model',
    recentTurns: 2,
    foldBatchTurns: 2,
    foldTriggerTurns: 1,
    summarize: async ({ toSequence }, signal) => {
      calls += 1;
      if (calls === 1) return `continuity through t${toSequence}`;
      controller.abort(new DOMException('foreground life resumed', 'AbortError'));
      throw signal?.reason ?? new Error('fold signal was not cancelled');
    },
  });

  assert.equal(await view.prepare(), true);
  view.append(entityTurn(5, 'Scout'));
  view.append(entityTurn(6, 'Scout'));
  await assert.rejects(view.prepare(controller.signal), /foreground life resumed/);
  assert.equal(calls, 2, 'each maintenance opportunity admits at most one provider batch');
  assert.equal(view.state().foldedThrough, 2, 'the completed first batch remains valid');
  assert.equal(view.state().needsFold, true);
  assert.doesNotMatch(view.view().fold!.summary, /automatic fold summary unavailable/);
});

test('a fold fallback identifies its failed generation and exact deterministic source', async () => {
  const turns = Array.from({ length: 4 }, (_, index) => entityTurn(index + 1, 'Scout'));
  const interventions: any[] = [];
  const view = createLoomContextView(turns, {
    entityId: 'Scout',
    model: 'test/model',
    recentTurns: 2,
    foldBatchTurns: 2,
    foldTriggerTurns: 1,
    summarize: async () => {
      throw new Error('fixture fold provider unavailable');
    },
    onContextIntervention: (intervention) => interventions.push(intervention),
  });

  assert.equal(await view.prepare(), true);
  const fold = view.view().fold as any;
  assert.equal(fold.generation.kind, 'fallback');
  assert.equal(fold.generation.source, 'deterministic-canonical-anchors-v1');
  assert.equal(fold.generation.failure.name, 'Error');
  assert.equal(fold.generation.failure.message, 'fixture fold provider unavailable');
  assert.match(fold.generation.sourceSha256, /^[a-f0-9]{64}$/);
  assert.match(fold.generation.summarySha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(interventions, [
    {
      protocol: 'behold.context-intervention.v1',
      kind: 'loom_fold_fallback',
      entityId: 'Scout',
      model: 'test/model',
      at: fold.generatedAt,
      projectionProfile: null,
      source: fold.source,
      generation: fold.generation,
    },
  ]);
});

test('a later bounded increment builds model continuity from a canonical fallback', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-fold-heal-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cacheFile = path.join(root, 'fold.json');
  const turns = Array.from({ length: 4 }, (_, index) => entityTurn(index + 1, 'Scout'));
  const failed = createLoomContextView(turns, {
    entityId: 'Scout',
    model: 'test/model',
    cacheFile,
    recentTurns: 2,
    foldBatchTurns: 2,
    foldTriggerTurns: 1,
    summarizerProtocol: 'test-summarizer.v1',
    summarize: async () => {
      throw new Error('temporary summarizer outage');
    },
  });
  await failed.prepare();
  assert.equal(failed.view().fold?.generation.kind, 'fallback');
  assert.equal(failed.state().foldedThrough, 2);

  const requests: any[] = [];
  const continuedTurns = [...turns, entityTurn(5, 'Scout'), entityTurn(6, 'Scout')];
  const healed = createLoomContextView(continuedTurns, {
    entityId: 'Scout',
    model: 'test/model',
    cacheFile,
    recentTurns: 2,
    foldBatchTurns: 2,
    foldTriggerTurns: 1,
    summarizerProtocol: 'test-summarizer.v1',
    summarize: async (request) => {
      requests.push(request);
      return 'Scout retains grounded continuity from turns one and two.';
    },
  });
  assert.equal(healed.state().needsFold, true);
  assert.equal(await healed.prepare(), true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].fromSequence, 3);
  assert.match(requests[0].previousSummary, /Canonical own-life index through t2/);
  assert.equal(healed.view().fold?.generation.kind, 'model');
  assert.equal(healed.state().foldedThrough, 4);
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
  assert.equal(firstCalls, 0);

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

test('a large backlog retains literal old dialogue and material consequences without provider work', async () => {
  const turns = Array.from({ length: 100 }, (_, index) => entityTurn(index + 1, 'Scout'));
  turns[12].observation.events = [
    {
      sequence: 90,
      type: 'chat_received',
      isNew: true,
      data: { from: 'importdf', text: 'remember the old bridge when we come back' },
    },
  ];
  turns[41].action = {
    ...turns[41].action,
    name: 'dig_focused_block',
    input: {},
  };
  turns[41].outcome = {
    ok: true,
    eventType: 'action_completed',
    result: { ok: true, block: 'stone_bricks', position: { x: 1, y: 2, z: 3 } },
  };
  let calls = 0;
  const view = createLoomContextView(turns, {
    entityId: 'Scout',
    model: 'test/model',
    recentTurns: 4,
    foldBatchTurns: 6,
    summarize: async () => {
      calls += 1;
      return 'provider summary';
    },
  });

  assert.equal(await view.prepare(), true);
  assert.equal(calls, 0);
  assert.equal(view.state().foldedThrough, 96);
  assert.equal(view.view().fold?.generation.kind, 'canonical_index');
  assert.match(view.view().fold!.summary, /remember the old bridge when we come back/);
  assert.match(view.view().fold!.summary, /dig_focused_block/);
});

test('a fold cache cannot cross an embodied observation profile', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-fold-profile-'));
  const cacheFile = path.join(root, 'fold.json');
  const turns = Array.from({ length: 6 }, (_, index) => entityTurn(index + 1, 'Scout'));
  const resident = createLoomContextView(turns, {
    entityId: 'Scout',
    model: 'test/model',
    cacheFile,
    recentTurns: 2,
    foldBatchTurns: 4,
    projectionProfile: 'minecraft-resident-v1',
    summarize: async () => 'resident projection summary',
  });
  await resident.prepare();
  assert.equal(resident.state().foldedThrough, 4);

  let humanCalls = 0;
  const human = createLoomContextView(turns, {
    entityId: 'Scout',
    model: 'test/model',
    cacheFile,
    recentTurns: 2,
    foldBatchTurns: 4,
    projectionProfile: 'minecraft-human-semantic-v1',
    summarize: async () => {
      humanCalls += 1;
      return 'human projection summary';
    },
  });

  assert.equal(human.state().foldedThrough, 0);
  await human.prepare();
  assert.equal(humanCalls, 1);
  assert.equal(human.view().fold?.projectionProfile, 'minecraft-human-semantic-v1');
});

test('facts-only resident projection rejects a legacy fold and rebuilds without a model', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-fold-factual-'));
  const cacheFile = path.join(root, 'fold.json');
  const turns = Array.from({ length: 6 }, (_, index) => entityTurn(index + 1, 'Scout'));
  const canonicalBefore = JSON.stringify(turns);
  const legacy = createLoomContextView(turns, {
    entityId: 'Scout',
    model: 'test/model',
    cacheFile,
    recentTurns: 2,
    foldBatchTurns: 4,
    projectionProfile: 'minecraft-human-semantic-v1',
    summarize: async () => 'CANARY_LEGACY_FOLD',
  });
  await legacy.prepare();
  assert.match(legacy.view().fold!.summary, /CANARY_LEGACY_FOLD/);

  let calls = 0;
  const projectionProfile =
    'behold.resident-factual-continuity.v1:resident-v2:minecraft-human-semantic-v1:minecraft-human-semantic-v1';
  const factual = createLoomContextView(turns, {
    entityId: 'Scout',
    model: 'test/model',
    cacheFile,
    recentTurns: 2,
    foldBatchTurns: 4,
    projectionProfile,
    canonicalOnly: true,
    projectTurn: (turn, previous) =>
      projectTurnForFolding(turn, previous, {
        includePublicCommitment: false,
        factsOnly: true,
      }),
    summarize: async () => {
      calls += 1;
      return 'must not run';
    },
  });
  assert.equal(factual.state().foldedThrough, 0);
  await factual.prepare();
  assert.equal(calls, 0);
  assert.equal(factual.view().fold?.projectionProfile, projectionProfile);
  assert.equal(factual.view().fold?.generation.kind, 'canonical_index');
  assert.doesNotMatch(factual.view().fold!.summary, /CANARY_LEGACY_FOLD/);
  assert.equal(JSON.stringify(turns), canonicalBefore);
});

test('a fold cache cannot cross summarizer protocols', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-fold-summarizer-'));
  const cacheFile = path.join(root, 'fold.json');
  const turns = Array.from({ length: 6 }, (_, index) => entityTurn(index + 1, 'Scout'));
  const first = createLoomContextView(turns, {
    entityId: 'Scout',
    model: 'test/model',
    cacheFile,
    recentTurns: 2,
    foldBatchTurns: 4,
    summarizerProtocol: 'summarizer-a/v1',
    summarize: async () => 'summary from a',
  });
  await first.prepare();
  assert.equal(first.view().fold?.summarizerProtocol, 'summarizer-a/v1');

  let calls = 0;
  const second = createLoomContextView(turns, {
    entityId: 'Scout',
    model: 'test/model',
    cacheFile,
    recentTurns: 2,
    foldBatchTurns: 4,
    summarizerProtocol: 'summarizer-b/v1',
    summarize: async () => {
      calls += 1;
      return 'summary from b';
    },
  });
  assert.equal(second.state().foldedThrough, 0);
  await second.prepare();
  assert.equal(calls, 1);
  assert.equal(second.view().fold?.summarizerProtocol, 'summarizer-b/v1');
});

test('fold evidence carries only new events while retaining action consequences', () => {
  const turn = entityTurn(3, 'Scout');
  turn.action.name = 'place_block';
  turn.action.input = { x: 1, y: 64, z: 1, itemName: 'chest' };
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
  turn.utterance = {
    assistant: { role: 'assistant', content: 'private discarded reasoning' },
    publicCommitment: {
      intention: 'Place the chest where I can see it.',
      expectedObservableConsequence: 'A chest should occupy the selected visible block.',
    },
  } as any;

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
  assert.deepEqual(evidence.publicCommitment, {
    intention: 'Place the chest where I can see it.',
    expectedObservableConsequence: 'A chest should occupy the selected visible block.',
  });
  assert.doesNotMatch(JSON.stringify(evidence), /private discarded reasoning/);
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
  assert.equal(view.view().fold?.protocol, 'behold.loom-fold.v3');
});

test('fold batches reuse causal observation deltas and retain typed pressure compaction', async () => {
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
  assert.equal(folded[1].observation.events.length, 1);
  assert.equal(folded[1].observation.events[0].type, 'experience_pressure_sequence');
  assert.equal(
    folded[1].observation.events[0].data.compaction,
    'behold.experience-pressure-sequence.v1',
  );
  assert.equal(folded[1].observation.events[0].data.eventCount, 30);
  assert.equal(folded[1].observation.eventWindow.omittedNewEvents, 0);
  assert.equal(folded[1].observation.eventWindow.complete, true);
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

test('a bounded authenticated fold starts with contiguous exact recent continuity and no source scan', async () => {
  const turns = Array.from({ length: 20 }, (_, index) => entityTurn(index + 1, 'Scout'));
  turns[4].observation.events = [
    {
      sequence: 41,
      type: 'chat_received',
      isNew: true,
      data: { from: 'Wren', text: 'west ridge' },
    },
  ];
  const baseline = createLoomContextView(
    boundedState(turns, 4, null, async function* () {
      yield* turns;
    }),
    canonicalOptions(4),
  );
  await baseline.prepare();
  const fold = baseline.view().fold!;
  let rebuilds = 0;
  const bounded = createLoomContextView(
    boundedState(turns, 4, fold, async function* () {
      rebuilds += 1;
      yield* turns;
    }),
    canonicalOptions(4),
  );

  assert.equal(await bounded.prepare(), false);
  assert.equal(rebuilds, 0);
  assert.equal(bounded.state().totalTurns, 20);
  assert.equal(bounded.state().foldedThrough, 16);
  assert.deepEqual(
    bounded.view().turns.map((turn) => turn.sequence),
    [17, 18, 19, 20],
  );
  assert.match(bounded.view().fold!.summary, /west ridge/);

  bounded.append(entityTurn(21, 'Scout'), sourceBinding(21));
  assert.deepEqual(
    bounded.view().turns.map((turn) => turn.sequence),
    [18, 19, 20, 21],
  );
  assert.equal(bounded.state().foldedThrough, 17);
  assert.equal(bounded.view().turns[0].parentId, bounded.view().fold!.source.tipId);
});

test('a bounded fold with the wrong authenticated chain binding rebuilds from canonical turns', async () => {
  const turns = Array.from({ length: 18 }, (_, index) => entityTurn(index + 1, 'Scout'));
  const baseline = createLoomContextView(
    boundedState(turns, 4, null, async function* () {
      yield* turns;
    }),
    canonicalOptions(4),
  );
  await baseline.prepare();
  const fold = baseline.view().fold!;
  let rebuilds = 0;
  const state = boundedState(turns, 4, fold, async function* () {
    rebuilds += 1;
    yield* turns;
  });
  const bounded = createLoomContextView(
    {
      ...state,
      foldSource: {
        ...state.foldSource!,
        source: { ...state.foldSource!.source, digest: '0'.repeat(64) },
      },
    },
    canonicalOptions(4),
  );

  assert.equal(bounded.state().needsFold, true);
  assert.throws(() => bounded.view(), /must prepare/);
  assert.equal(await bounded.prepare(), true);
  assert.equal(rebuilds, 1);
  assert.equal(bounded.view().fold!.source.canonicalChainDigest, fold.source.canonicalChainDigest);
  assert.equal(bounded.view().fold!.summary, fold.summary);
});

test('incremental canonical indexing equals a one-pass rebuild', async () => {
  const turns = Array.from({ length: 120 }, (_, index) => entityTurn(index + 1, 'Scout'));
  for (const sequence of [7, 29, 88]) {
    turns[sequence - 1].observation.events = [
      {
        sequence: sequence * 10,
        type: 'chat_received',
        isNew: true,
        data: { from: 'Wren', text: `marker-${sequence}` },
      },
    ];
  }
  turns[63].action = { ...turns[63].action, name: 'dig_focused_block', input: {} };
  turns[63].outcome = { ok: true, eventType: 'action_completed', result: { block: 'stone' } };

  const incremental = createLoomContextView(
    boundedState(turns.slice(0, 4), 4, null, async function* () {
      yield* turns.slice(0, 4);
    }),
    canonicalOptions(4),
  );
  for (const turn of turns.slice(4)) incremental.append(turn, sourceBinding(turn.sequence));

  const onePass = createLoomContextView(
    boundedState(turns, 4, null, async function* () {
      yield* turns;
    }),
    canonicalOptions(4),
  );
  await onePass.prepare();
  assert.deepEqual(incremental.view().fold, onePass.view().fold);
  assert.deepEqual(incremental.view().turns, onePass.view().turns);
});

test('bounded canonical append projects only each newly folded turn', () => {
  let projected = 0;
  const options = {
    ...canonicalOptions(6),
    projectTurn: (turn: EntityTurn, previous?: EntityTurn) => {
      projected += 1;
      return projectTurnForFolding(turn, previous);
    },
  };
  const initial = Array.from({ length: 6 }, (_, index) => entityTurn(index + 1, 'Scout'));
  const bounded = createLoomContextView(
    boundedState(initial, 6, null, async function* () {
      yield* initial;
    }),
    options,
  );
  for (let sequence = 7; sequence <= 1_006; sequence += 1) {
    bounded.append(entityTurn(sequence, 'Scout'), sourceBinding(sequence));
  }

  assert.equal(projected, 1_000);
  assert.equal(bounded.state().foldedThrough, 1_000);
  assert.equal(bounded.state().visibleTurns, 6);
});

test('a streaming rebuild and later appends retain no payload-sized whole-history copy', async () => {
  const payload = `PRIVATE_IRRELEVANT_${'x'.repeat(256_000)}`;
  const turns = Array.from({ length: 80 }, (_, index) => {
    const turn = entityTurn(index + 1, 'Scout');
    (turn.observation as any).privateTransportPayload = `${index}:${payload}`;
    return turn;
  });
  let yielded = 0;
  const bounded = createLoomContextView(
    boundedState(turns, 6, null, async function* () {
      for (const turn of turns) {
        yielded += 1;
        yield turn;
      }
    }),
    canonicalOptions(6),
  );

  await bounded.prepare();
  assert.equal(yielded, 80);
  assert.equal(bounded.view().turns.length, 6);
  const disposable = JSON.stringify(bounded.view().fold);
  assert.ok(disposable.length < 100_000);
  assert.doesNotMatch(disposable, /PRIVATE_IRRELEVANT/);
  assert.equal(bounded.state().totalTurns, 80);
});

function canonicalOptions(recentTurns: number) {
  return {
    entityId: 'Scout',
    model: 'test/model',
    recentTurns,
    foldTriggerTurns: 1,
    canonicalOnly: true,
    now: () => 1234,
    summarize: async () => 'must not run',
  } as const;
}

function boundedState(
  turns: EntityTurn[],
  recentTurns: number,
  fold: ReturnType<ReturnType<typeof createLoomContextView>['view']>['fold'],
  rebuild: () => AsyncIterable<EntityTurn>,
): BoundedLoomContextState {
  const recent = turns.slice(-recentTurns);
  const through = turns.length - recent.length;
  return {
    protocol: 'behold.bounded-loom-context.v1',
    entityId: 'Scout',
    totalTurns: turns.length,
    recentTurns: recent,
    recentSources: recent.map((turn) => sourceBinding(turn.sequence)),
    fold,
    foldSource:
      fold && through > 0
        ? {
            tipTurn: turns[through - 1],
            source: {
              protocol: fold.source.canonicalChainProtocol!,
              digest: fold.source.canonicalChainDigest!,
            },
          }
        : null,
    rebuild: async function* () {
      for await (const turn of rebuild()) {
        yield { turn, source: sourceBinding(turn.sequence) };
      }
    },
  };
}

function sourceBinding(sequence: number) {
  return {
    protocol: 'lync.file-loom-chain.v1',
    digest: sequence.toString(16).padStart(64, '0'),
  } as const;
}

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
