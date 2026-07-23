import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openEntityLoom, type EntityLoom, type EntityTurn } from '../src/entity/loom';
import { startLLMPolicy } from '../src/policy/llm';

test('two inhabitants restart from their own looms and folded views without leakage', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-inhabitants-'));
  const scout = await openEntityLoom('Scout', root, 'minecraft://shared-world');
  const builder = await openEntityLoom('Builder', root, 'minecraft://shared-world');
  for (let sequence = 1; sequence <= 12; sequence += 1) {
    await scout.append(priorTurn('Scout', sequence, `SCOUT_ONLY_${sequence}`));
    await builder.append(priorTurn('Builder', sequence, `BUILDER_ONLY_${sequence}`));
  }

  const originalFetch = globalThis.fetch;
  const requests: any[] = [];
  globalThis.fetch = (async (_url: any, init: any) => {
    requests.push(JSON.parse(String(init?.body || '{}')));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: waitTool(`wait-${requests.length}`, 'continuity checked'),
          },
        ],
      }),
      text: async () => '',
    } as any;
  }) as typeof fetch;

  try {
    await runOneLife(scout, 'SCOUT_FOLDED_CONTINUITY');
    await runOneLife(builder, 'BUILDER_FOLDED_CONTINUITY');

    const scoutFold = readJson(path.join(path.dirname(scout.file), 'fold.json'));
    const builderFold = readJson(path.join(path.dirname(builder.file), 'fold.json'));
    assert.equal(scoutFold.entityId, 'Scout');
    assert.equal(builderFold.entityId, 'Builder');
    assert.match(scoutFold.summary, /SCOUT_FOLDED_CONTINUITY/);
    assert.doesNotMatch(scoutFold.summary, /BUILDER/);
    assert.match(builderFold.summary, /BUILDER_FOLDED_CONTINUITY/);
    assert.doesNotMatch(builderFold.summary, /SCOUT/);

    // Reopen both autobiographies as fresh controller instances, modeling a
    // process restart. Each restart must reuse only its adjacent validated
    // projection and append to its own linked trajectory.
    await scout.close();
    await builder.close();
    const reopenedScout = await openEntityLoom('Scout', root, 'minecraft://shared-world');
    const reopenedBuilder = await openEntityLoom('Builder', root, 'minecraft://shared-world');
    await runOneLife(reopenedScout, 'summarizer must not run on this restart', true);
    await runOneLife(reopenedBuilder, 'summarizer must not run on this restart', true);

    assert.equal(reopenedScout.turns().length, 14);
    assert.equal(reopenedBuilder.turns().length, 14);
    assert.ok(reopenedScout.turns().every((turn) => turn.entityId === 'Scout'));
    assert.ok(reopenedBuilder.turns().every((turn) => turn.entityId === 'Builder'));
    assert.equal(reopenedScout.turns().at(-1)?.parentId, 'Scout:turn:13');
    assert.equal(reopenedBuilder.turns().at(-1)?.parentId, 'Builder:turn:13');

    const scoutRestartRequest = requests[2];
    const builderRestartRequest = requests[3];
    const scoutContext = JSON.stringify(scoutRestartRequest.messages);
    const builderContext = JSON.stringify(builderRestartRequest.messages);
    assert.match(scoutContext, /SCOUT_FOLDED_CONTINUITY/);
    assert.doesNotMatch(scoutContext, /BUILDER_ONLY|BUILDER_FOLDED_CONTINUITY/);
    assert.match(builderContext, /BUILDER_FOLDED_CONTINUITY/);
    assert.doesNotMatch(builderContext, /SCOUT_ONLY|SCOUT_FOLDED_CONTINUITY/);
    await reopenedScout.close();
    await reopenedBuilder.close();
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

async function runOneLife(loom: EntityLoom, foldedContinuity: string, rejectSummarizer = false) {
  const entityId = loom.turns()[0]?.entityId;
  assert.ok(entityId);
  let summaryCalls = 0;
  const policy = startLLMPolicy(
    {
      entityId,
      actions: [],
      observe: () => observation(entityId),
      attempt: () => {
        throw new Error('wait_for_event should not enter the embodied action space');
      },
    },
    {
      apiKey: 'test-key',
      model: 'test/model',
      acceptEngineEvent: () => true,
      history: loom.turns(),
      foldCacheFile: path.join(path.dirname(loom.file), 'fold.json'),
      foldRecentTurns: 4,
      foldBatchTurns: 4,
      summarizeLoom: async (request) => {
        summaryCalls += 1;
        if (rejectSummarizer) throw new Error('valid cache should have been reused');
        assert.equal(request.entityId, entityId);
        assert.ok(
          request.turns.every((turn) =>
            JSON.stringify(turn).includes(`${entityId.toUpperCase()}_ONLY_`),
          ),
        );
        return [request.previousSummary, foldedContinuity].filter(Boolean).join(' ');
      },
      onEntityTurn: (turn) => loom.append(turn),
    },
  );
  try {
    await policy.tick();
    if (rejectSummarizer) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(summaryCalls, 0);
    } else {
      for (let attempt = 0; summaryCalls < 3 && attempt < 100; attempt += 1) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      assert.equal(summaryCalls, 3, 'idle maintenance folds only after foreground yield');
      assert.equal(policy.state().loomContext.foldedThrough, 9);
    }
  } finally {
    await policy.stop();
  }
}

function priorTurn(entityId: string, sequence: number, marker: string): EntityTurn {
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
      ...observation(entityId),
      sequence,
      events: [
        {
          type: 'chat_received',
          isNew: true,
          data: { from: entityId, text: marker },
        },
      ],
    },
    utterance: { assistant: waitTool(`old-${entityId}-${sequence}`, 'prior turn') },
    action: {
      id: `old-${entityId}-${sequence}`,
      name: 'wait_for_event',
      input: { reason: marker },
      source: 'llm',
      kind: 'yield',
      toolCallId: `old-${entityId}-${sequence}`,
    },
    outcome: {
      ok: true,
      eventType: 'wait_for_event',
      result: { ok: true, marker },
    },
    nextObservation: observation(entityId),
  };
}

function observation(entityId: string) {
  return {
    protocol: 'behold.inhabitant.v1',
    sequence: 1,
    self: { identity: entityId, currentAction: null },
    scene: { entities: [], terrain: { materials: [] } },
    events: [{ type: 'spawned', isNew: true }],
  };
}

function waitTool(id: string, reason: string) {
  return {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id,
        type: 'function',
        function: { name: 'wait_for_event', arguments: JSON.stringify({ reason }) },
      },
    ],
  };
}

function readJson(file: string) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
