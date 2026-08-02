import assert from 'node:assert/strict';
import test from 'node:test';
import type { EntityTurn } from '../src/entity/loom';
import {
  projectResidentTranscript,
  projectResidentTranscriptTurn,
} from '../src/mind/resident-transcript';
import { directOpenRouterRequestBody } from '../src/mind/direct-wire';
import { assertStrictLocalResidentSessionEnvelope } from '../src/mind/ollama-json-action';
import { assertOpenRouterRouteRequest } from '../src/mind/openrouter-route';

function turn(sequence: number, entityId = 'Rowan'): EntityTurn {
  const observation = {
    protocol: 'behold.minecraft-human-semantic-observation.v1',
    sequence: sequence * 10,
    self: { identity: entityId },
    events:
      sequence === 2 ? [{ sequence: 11, type: 'chat_received', data: { text: 'hello' } }] : [],
  };
  return {
    protocol: 'behold.entity-turn.v1',
    id: `${entityId}:turn:${sequence}`,
    entityId,
    sequence,
    parentId: sequence === 1 ? null : `${entityId}:turn:${sequence - 1}`,
    model: 'fixture/model',
    profiles: {
      policy: 'resident-v3',
      body: 'minecraft-human-semantic-v1',
      actions: 'minecraft-human-semantic-v1',
      safety: 'vanilla-player-v1',
    },
    startedAt: sequence * 100,
    completedAt: sequence * 100 + 50,
    observation: { private: true, sequence: observation.sequence },
    observationPresentation: {
      protocol: 'behold.entity-turn-observation-presentation.v1',
      bodyProfile: 'minecraft-human-semantic-v1',
      requestSha256: 'a'.repeat(64),
      observation,
      nextObservation: { ...observation, sequence: observation.sequence + 1 },
    },
    utterance: { assistant: { role: 'assistant', content: null } },
    action: {
      id: `${entityId}:action:${sequence}`,
      name: sequence === 1 ? 'look_direction' : 'chat',
      input: sequence === 1 ? { horizontal: 'left', vertical: 'same' } : { text: 'I heard you.' },
      source: 'llm',
      kind: 'exclusive',
      toolCallId: null,
    },
    outcome: {
      ok: true,
      eventType: 'action_completed',
      result: { confirmation: 'minecraft', sequence },
    },
    nextObservation: { private: true, sequence: observation.sequence + 1 },
  };
}

test('continuous transcript preserves exact admitted experience, chosen action, and outcome in order', () => {
  const transcript = projectResidentTranscript('Rowan', [turn(1), turn(2)]);
  assert.equal(transcript.protocol, 'behold.resident-continuous-transcript.v1');
  assert.equal(transcript.throughTurn, 2);
  assert.deepEqual(
    transcript.messages.map((message) => message.role),
    ['user', 'assistant', 'user', 'user', 'assistant', 'user'],
  );
  assert.match(transcript.messages[0].content, /"identity":"Rowan"/);
  assert.doesNotMatch(transcript.messages[0].content, /private/);
  assert.equal(
    transcript.messages[1].content,
    '{"action":"look_direction","arguments":{"horizontal":"left","vertical":"same"}}',
  );
  assert.match(transcript.messages[2].content, /What Minecraft returned/);
  assert.match(transcript.messages[3].content, /chat_received/);
  assert.equal(
    transcript.messages[4].content,
    '{"action":"chat","arguments":{"text":"I heard you\."}}',
  );
});

test('continuous transcript is deterministic, append-only, and resident-isolated', () => {
  const first = projectResidentTranscript('Rowan', [turn(1)]);
  const second = projectResidentTranscript('Rowan', [turn(1), turn(2)]);
  assert.deepEqual(second.messages.slice(0, first.messages.length), first.messages);
  assert.deepEqual(projectResidentTranscript('Rowan', [turn(1), turn(2)]), second);
  assert.throws(
    () => projectResidentTranscript('Rowan', [turn(1), turn(2, 'Juniper')]),
    /expected Rowan, received Juniper/,
  );
});

test('nonresident controls remain lived facts without replaying private input', () => {
  const controlled = {
    ...turn(1),
    action: { ...turn(1).action, source: 'human' as const },
  };
  const messages = projectResidentTranscriptTurn(controlled, { mayReplayTurn: () => false });
  assert.deepEqual(
    messages.map((message) => message.role),
    ['user', 'user'],
  );
  assert.match(messages[1].content, /"inputUnavailable":true/);
  assert.doesNotMatch(messages[1].content, /horizontal/);
});

test('resident-v3 uses the continuous strict-JSON wire layout', () => {
  const prior = projectResidentTranscript('Rowan', [turn(1)]).messages;
  const currentObservation = {
    protocol: 'behold.minecraft-human-semantic-observation.v1',
    self: { identity: 'Rowan' },
    scene: { detail: 'x'.repeat(5_000) },
  };
  const request = {
    protocol: 'behold.mind-request.v1',
    entityId: 'Rowan',
    model: 'deepseek/deepseek-v4',
    policyProfile: 'resident-v3',
    bodyProfile: 'minecraft-human-semantic-v1',
    actionProfile: 'minecraft-human-semantic-v1',
    safetyProfile: 'vanilla-player-v1',
    observation: currentObservation,
    conversation: [
      { role: 'system', content: 'You are Rowan.' },
      ...prior,
      {
        role: 'user',
        content: `What you experience:\n${JSON.stringify(currentObservation)}`,
      },
    ],
    actions: [
      {
        name: 'wait_for_event',
        inputSchema: {
          type: 'object',
          properties: { reason: { type: 'string' } },
          required: ['reason'],
          additionalProperties: false,
        },
      },
    ],
    requiredAction: null,
    attention: { mode: 'deliberative', context: 'bounded_loom', triggers: [] },
  } as any;
  const route = {
    protocol: 'behold.openrouter-route-policy.v5',
    routes: [{ requestTag: 'deepinfra/fp4', responseProvider: 'DeepInfra' }],
    allowFallbacks: false,
    maxOutputTokens: 256,
    contextWindowTokens: 1_048_576,
    residentDecisionFormat: 'strict_json',
    reasoningEnabled: false,
    zdr: true,
    dataCollection: 'deny',
  } as const;
  const body = directOpenRouterRequestBody(request, route) as any;
  const identity = assertStrictLocalResidentSessionEnvelope(
    body.messages,
    body.response_format.json_schema.schema,
  );

  assert.equal(body.response_format.json_schema.name, 'behold_resident_action_v1');
  assert.deepEqual(body.reasoning, { enabled: false, exclude: true });
  assert.equal(
    identity.messageLayoutProtocol,
    'behold.ollama-local-resident-session-message-layout.v2',
  );
  assert.equal(identity.workingContinuityProtocol, 'behold.resident-continuous-transcript.v1');
  assert.deepEqual(
    body.messages.slice(2, -1).map((message: any) => message.role),
    ['user', 'assistant', 'user'],
  );
  const continuedRequest = {
    ...request,
    observation: { ...currentObservation, sequence: 3 },
    conversation: [
      ...request.conversation,
      {
        role: 'assistant',
        content: '{"action":"wait_for_event","arguments":{"reason":"listen"}}',
      },
      {
        role: 'user',
        content: 'What Minecraft returned after your wait_for_event attempt:\n{"ok":true}',
      },
      {
        role: 'user',
        content: `What you experience:\n${JSON.stringify({ ...currentObservation, sequence: 3 })}`,
      },
    ],
  } as any;
  const continuedBody = directOpenRouterRequestBody(continuedRequest, route) as any;
  assert.deepEqual(
    continuedBody.messages.slice(0, body.messages.length),
    body.messages,
    'the complete previous provider conversation must remain an exact prefix',
  );
  assert.doesNotThrow(() =>
    assertOpenRouterRouteRequest(body, request.model, route, 'Rowan', 'resident-v3'),
  );
  assert.throws(
    () =>
      assertOpenRouterRouteRequest(
        body,
        request.model,
        { ...route, contextWindowTokens: 4_096 },
        'Rowan',
        'resident-v3',
      ),
    /exceeds the admitted context window/,
  );
});
