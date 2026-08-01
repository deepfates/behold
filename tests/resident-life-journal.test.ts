import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { EntityTurn, EntityTurnCommitReceipt } from '../src/entity/loom';
import { createRunJournal } from '../src/observability/journal';
import {
  createResidentLifeCommit,
  projectOperationalModelTurn,
  RESIDENT_LIFE_COMMIT_EVENT,
} from '../src/observability/resident-life-commit';
import { foldResidentLens } from '../src/observability/resident-lens';

test('resident run journal retains only bounded public life and model projections', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-public-life-journal-'));
  try {
    const journal = createRunJournal('Scout', directory);
    const turn = entityTurn();
    const receipt = commitReceipt();
    journal.append('model_turn', projectOperationalModelTurn(modelTurn()));
    journal.append(RESIDENT_LIFE_COMMIT_EVENT, createResidentLifeCommit(turn, receipt));

    const text = fs.readFileSync(journal.file, 'utf8');
    const events = text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      events.map((event) => event.type),
      ['model_turn', 'resident_life_commit'],
    );
    assert.equal(text.includes('RAW_PRIVATE_OBSERVATION'), false);
    assert.equal(text.includes('RAW_PRIVATE_TERMINAL'), false);
    assert.equal(text.includes('CAMERA_PIXEL_BYTES'), false);
    assert.equal(text.includes('PRIVATE_MIND_REQUEST'), false);
    assert.equal(text.includes('PRIVATE_PROVIDER_BODY'), false);
    assert.equal(text.includes('PRIVATE_PROVIDER_RESPONSE'), false);
    assert.equal(text.includes('privateReasoning'), false);
    assert.equal(text.includes('HIDDEN_ASSISTANT_REASONING'), false);
    assert.equal(text.includes('behold.entity-turn.v1'), false);

    const modelBytes = JSON.stringify(events[0]);
    const commitBytes = JSON.stringify(events[1]);
    for (const projected of [modelBytes, commitBytes]) {
      assert.equal(projected.includes('privateReasoning'), false);
      assert.equal(projected.includes('HIDDEN_ASSISTANT_REASONING'), false);
      assert.equal(projected.includes('CAMERA_PIXEL_BYTES'), false);
      assert.equal(projected.includes('PRIVATE_CAUSAL_FRAME'), false);
    }

    const model = events[0].data;
    assert.equal(model.call.request.mindRequest, undefined);
    assert.equal(model.call.request.body, undefined);
    assert.equal(model.call.response.raw, undefined);
    assert.equal(model.call.request.mindRequestSha256, 'a'.repeat(64));
    assert.equal(model.call.request.bodySha256, 'b'.repeat(64));
    assert.equal(model.call.response.id, 'response-1');
    assert.equal(model.observation.scene.summary, 'stone ahead');

    const commit = events[1].data;
    assert.equal(commit.protocol, 'behold.resident-life-commit.v1');
    assert.equal(commit.observation, undefined);
    assert.equal(commit.nextObservation, undefined);
    assert.equal(commit.utterance, undefined);
    assert.equal(commit.action, undefined);
    assert.equal(commit.outcome, undefined);
    assert.equal(commit.entity.turnId, 'Scout:turn:7');
    assert.equal(commit.experience.before.scene.summary, 'stone ahead');
    assert.equal(commit.choice.action.name, 'dig_block');
    assert.equal(commit.consequence.result.changes[0].after, 'air');
    assert.equal(commit.lync.chainDigest, 'd'.repeat(64));
    assert.equal(commit.lync.canonical.source, 'Scout.lync');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('resident lens reads the public commit and retains legacy entity-turn compatibility', () => {
  const turn = entityTurn();
  const commit = createResidentLifeCommit(turn, commitReceipt());
  const current = foldResidentLens([
    envelope(1, 'model_turn', projectOperationalModelTurn(modelTurn())),
    envelope(2, RESIDENT_LIFE_COMMIT_EVENT, commit),
  ]);
  const legacy = foldResidentLens([envelope(1, 'entity_turn', turn)]);

  assert.equal(current.sees.scene.summary, 'stone ahead');
  assert.equal(current.nextExperience.scene.summary, 'air ahead');
  assert.equal(current.chooses?.name, 'dig_block');
  assert.equal(current.chooses?.utterance, 'I will test the stone.');
  assert.equal(current.consequence?.ok, true);
  assert.equal(current.consequence?.committedToLync, true);
  assert.equal(current.lync.committedTurns, 7);
  assert.equal(current.lync.tipId, 'lync-turn-7');
  assert.equal(current.lync.tipSequence, 7);
  assert.equal(current.ethogram.verifiedWorldChanges.total, 1);

  assert.equal(legacy.nextExperience.scene.summary, 'air ahead');
  assert.equal(legacy.chooses?.name, current.chooses?.name);
  assert.equal(legacy.consequence?.ok, current.consequence?.ok);
  assert.equal(legacy.lync.tipId, 'Scout:turn:7');
});

test('resident life projection refuses a receipt for another canonical turn', () => {
  assert.throws(
    () =>
      createResidentLifeCommit(entityTurn(), {
        ...commitReceipt(),
        legacyTurnId: 'Scout:turn:8',
      }),
    /does not match/,
  );
});

function entityTurn(): EntityTurn {
  return {
    protocol: 'behold.entity-turn.v1',
    id: 'Scout:turn:7',
    entityId: 'Scout',
    sequence: 7,
    parentId: 'Scout:turn:6',
    model: 'example/model',
    profiles: {
      policy: 'resident-session-v1',
      body: 'minecraft-human-semantic-v1',
      actions: 'minecraft-human-semantic-v1',
      safety: 'minecraft-survival-v1',
    },
    startedAt: 1_000,
    completedAt: 1_700,
    observation: {
      secret: 'RAW_PRIVATE_OBSERVATION',
      camera: { bytes: 'CAMERA_PIXEL_BYTES' },
    },
    observationPresentation: {
      protocol: 'behold.entity-turn-observation-presentation.v1',
      bodyProfile: 'minecraft-human-semantic-v1',
      requestSha256: 'a'.repeat(64),
      observation: {
        ...humanObservation(10, 'stone ahead'),
        malformedPrivateAddition: {
          camera: { bytes: 'CAMERA_PIXEL_BYTES' },
          privateCausalFrames: 'PRIVATE_CAUSAL_FRAME',
        },
      },
      nextObservation: {
        ...humanObservation(11, 'air ahead'),
        malformedPrivateAddition: { rawFrame: 'PRIVATE_CAUSAL_FRAME' },
      },
    },
    utterance: {
      assistant: {
        content: 'I will test the stone.',
        privateReasoning: 'HIDDEN_ASSISTANT_REASONING',
      },
    },
    action: {
      id: 'intent-7',
      name: 'dig_block',
      input: { target: 'stone ahead' },
      source: 'llm',
      kind: 'exclusive',
      toolCallId: 'call-7',
    },
    outcome: {
      ok: true,
      eventType: 'action_completed',
      result: {
        changes: [
          {
            verb: 'dig',
            before: 'stone',
            after: 'air',
            verified: true,
            observed: true,
            confirmation: { observedAt: 1_650 },
          },
        ],
      },
    },
    nextObservation: { secret: 'RAW_PRIVATE_TERMINAL' },
  };
}

function modelTurn() {
  return {
    at: 1_200,
    model: 'example/model',
    mind: 'example-mind',
    policyProfile: 'resident-session-v1',
    bodyProfile: 'minecraft-human-semantic-v1',
    actionProfile: 'minecraft-human-semantic-v1',
    safetyProfile: 'minecraft-survival-v1',
    perceptionProfile: 'semantic-plus-camera-v1',
    perception: { sha256: 'c'.repeat(64), width: 640, height: 360 },
    observation: {
      ...humanObservation(10, 'stone ahead'),
      malformedPrivateAddition: {
        camera: { bytes: 'CAMERA_PIXEL_BYTES' },
        observationBinding: 'PRIVATE_CAUSAL_FRAME',
      },
    },
    assistant: {
      content: 'I will test the stone.',
      privateReasoning: 'HIDDEN_ASSISTANT_REASONING',
    },
    intent: {
      id: 'intent-7',
      tool: 'dig_block',
      input: { target: 'stone ahead' },
      source: 'llm',
    },
    attention: { mode: 'deliberative', context: 'bounded_loom', triggers: [] },
    call: {
      protocol: 'behold.model-call.v1',
      requestId: 'request-1',
      endpoint: 'http://127.0.0.1/v1/chat/completions',
      startedAt: 1_000,
      completedAt: 1_200,
      latencyMs: 200,
      request: {
        model: 'example/model',
        mindRequestSha256: 'a'.repeat(64),
        mindRequest: {
          secret: 'PRIVATE_MIND_REQUEST',
          perception: { camera: 'CAMERA_PIXEL_BYTES' },
        },
        messageCount: 3,
        toolCount: 2,
        toolChoice: 'required',
        bodySha256: 'b'.repeat(64),
        messagesSha256: 'e'.repeat(64),
        toolsSha256: 'f'.repeat(64),
        body: { secret: 'PRIVATE_PROVIDER_BODY' },
      },
      response: {
        terminal: 'success',
        id: 'response-1',
        model: 'example/model',
        provider: 'local',
        finishReason: 'tool_calls',
        nativeFinishReason: 'tool_calls',
        usage: { prompt_tokens: 100, completion_tokens: 10 },
        raw: { secret: 'PRIVATE_PROVIDER_RESPONSE' },
      },
    },
  };
}

function commitReceipt(): EntityTurnCommitReceipt {
  return {
    protocol: 'behold.entity-turn-commit-receipt.v1',
    entityId: 'Scout',
    sequence: 7,
    legacyTurnId: 'Scout:turn:7',
    life: { v: 1, kind: 'loom', loomId: 'lync:life-1' },
    turn: { v: 1, kind: 'turn', loomId: 'lync:life-1', turnId: 'lync-turn-7' },
    parentTurnId: 'lync-turn-6',
    depth: 7,
    bodyDigest: 'c'.repeat(64),
    chainDigest: 'd'.repeat(64),
    canonical: {
      source: 'Scout.lync',
      line: 8,
      start: 4_000,
      end: 4_800,
      terminator: '\n',
      rawSha256: 'e'.repeat(64),
    },
    observationBindingDigest: 'f'.repeat(64),
  };
}

function humanObservation(sequence: number, summary: string) {
  return {
    protocol: 'behold.minecraft-human-semantic-observation.v1',
    bodyContract: { profile: 'minecraft-human-semantic-v1' },
    sequence,
    observedAt: sequence * 100,
    self: { condition: { health: 20, food: 20 } },
    scene: { summary },
    events: [],
  };
}

function envelope(sequence: number, type: string, data: unknown) {
  return {
    sequence,
    at: new Date(sequence * 1_000).toISOString(),
    agent: 'Scout',
    type,
    data,
  };
}
