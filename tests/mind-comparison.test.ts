import test from 'node:test';
import assert from 'node:assert/strict';
import { compareResidentMinds } from '../src/evaluation/mind-comparison';
import { runResidentMindTrials } from '../src/evaluation/mind-trials';
import { createAxResidentMind } from '../src/mind/ax';
import { createDirectResidentMind } from '../src/mind/direct';
import { directOpenRouterRequestBody } from '../src/mind/direct-wire';
import { ResidentMindCallError } from '../src/mind/evidence';
import type { ResidentMind } from '../src/mind/interface';
import { assertOpenRouterRouteRequest } from '../src/mind/openrouter-route';
import {
  createResidentMindRequestArtifact,
  parseResidentMindRequestArtifact,
  residentMindRequestSha256,
} from '../src/mind/request-artifact';

test('one immutable mind request can drive matched direct and Ax proposals', async () => {
  const artifact = createResidentMindRequestArtifact(request());
  const directBodies: any[] = [];
  const axBodies: any[] = [];
  const direct = createDirectResidentMind({
    apiKey: 'test-key',
    model: 'test/model',
    recordModelIO: true,
    endpoint: 'https://models.example.test/v1/chat/completions',
    fetch: async (_url, init) => {
      directBodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          id: 'direct-generation',
          model: 'test/model',
          provider: 'fixture',
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                content: 'I will take one step.',
                tool_calls: [
                  {
                    id: 'direct-tool',
                    type: 'function',
                    function: {
                      name: 'move_direction',
                      arguments: '{"direction":"forward","distance":2}',
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 40, completion_tokens: 8, total_tokens: 48 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    },
  });
  const ax = createAxResidentMind({
    apiKey: 'test-key',
    model: 'test/model',
    recordModelIO: true,
    maxRetries: 0,
    apiURL: 'https://models.example.test/v1',
    fetch: async (_url, init) => {
      axBodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          id: 'ax-generation',
          model: 'test/model',
          provider: 'fixture',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content: [
                  'Disposition: act',
                  'Action Name: move_direction',
                  'Action Input: {"direction":"forward","distance":2}',
                  'Utterance: I will take one step.',
                ].join('\n'),
              },
            },
          ],
          usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    },
  });

  const comparison = await compareResidentMinds(artifact, [
    { label: 'direct', mind: direct },
    { label: 'ax', mind: ax },
  ]);

  assert.equal(comparison.request.sha256, artifact.requestSha256);
  assert.equal(comparison.verdict.allCompleted, true, JSON.stringify(comparison.arms, null, 2));
  assert.deepEqual(comparison.verdict, {
    inputMatched: true,
    allCompleted: true,
    allValid: true,
    sameProposedAction: true,
  });
  assert.equal(comparison.safety.worldMutationEnabled, false);
  assert.equal(directBodies.length, 1);
  assert.equal(axBodies.length, 1);
  assert.equal(directBodies[0].tools[0].function.name, 'move_direction');
  assert.equal(Array.isArray(axBodies[0].tools), false);
  assert.ok(
    comparison.arms.every((arm) => arm.call?.request.mindRequestSha256 === artifact.requestSha256),
  );
  assert.ok(
    comparison.arms.every(
      (arm) => residentMindRequestSha256(arm.call?.request.mindRequest) === artifact.requestSha256,
    ),
  );
  assert.notEqual(
    comparison.arms[0].call?.request.bodySha256,
    comparison.arms[1].call?.request.bodySha256,
    'adapter wire projections differ even though the framework input is identical',
  );
});

test('a successful HTTP response with malformed JSON is not normalized into a direct decision', async () => {
  const mind = createDirectResidentMind({
    apiKey: 'test-key',
    model: 'test/model',
    endpoint: 'https://models.example.test/v1/chat/completions',
    fetch: async () =>
      new Response('not provider json', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  });

  await assert.rejects(
    mind.decide(request() as any, { signal: new AbortController().signal }),
    (error: any) => {
      assert.ok(error instanceof ResidentMindCallError);
      assert.equal(error.call.response.terminal, 'malformed_output');
      assert.equal(error.call.response.status, 200);
      assert.equal(error.call.response.bodyPreview, 'not provider json');
      return true;
    },
  );
});

test('a direct resident request emits its exact admitted OpenRouter route and output cap', async () => {
  const bodies: any[] = [];
  const routePolicy = {
    protocol: 'behold.openrouter-route-policy.v1',
    order: ['Fixture Primary', 'Fixture Secondary'],
    allowFallbacks: false,
    maxOutputTokens: 512,
  } as const;
  const mind = createDirectResidentMind({
    apiKey: 'test-key',
    model: 'test/model',
    routePolicy,
    recordModelIO: true,
    endpoint: 'https://models.example.test/v1/chat/completions',
    fetch: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          id: 'route-bound-generation',
          model: 'test/model',
          provider: 'Fixture Primary',
          choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: null } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    },
  } as any);

  const decision = await mind.decide(request() as any, {
    signal: new AbortController().signal,
  });
  assert.deepEqual(bodies, [
    {
      model: 'test/model',
      messages: request().conversation,
      tools: bodies[0].tools,
      parallel_tool_calls: false,
      temperature: 0.2,
      max_tokens: 512,
      provider: {
        order: ['Fixture Primary', 'Fixture Secondary'],
        allow_fallbacks: false,
        require_parameters: true,
      },
    },
  ]);
  assert.equal(decision.call.response.model, 'test/model');
  assert.equal(decision.call.response.provider, 'Fixture Primary');
});

test('a legible provider resident uses the strict session schema and distinct route identities', async () => {
  const bodies: any[] = [];
  const mind = createDirectResidentMind({
    apiKey: 'test-key',
    model: 'test/model',
    routePolicy: {
      protocol: 'behold.openrouter-route-policy.v2',
      routes: [{ requestTag: 'fixture-primary', responseProvider: 'Fixture Primary' }],
      allowFallbacks: false,
      maxOutputTokens: 512,
    },
    recordModelIO: true,
    endpoint: 'https://models.example.test/v1/chat/completions',
    fetch: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          id: 'strict-route-bound-generation',
          model: 'test/model',
          provider: 'Fixture Primary',
          choices: [
            {
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  intention: 'Step forward once',
                  expectedObservableConsequence: 'My body position should change',
                  action: 'move_direction',
                  arguments: { direction: 'forward', distance: 2 },
                }),
              },
            },
          ],
          usage: { prompt_tokens: 80, completion_tokens: 20, total_tokens: 100 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    },
  });
  const legible = {
    ...request(),
    policyProfile: 'legible-resident-v1',
    bodyProfile: 'minecraft-human-semantic-v1',
    actionProfile: 'minecraft-human-semantic-v1',
  } as any;

  const decision = await mind.decide(legible, { signal: new AbortController().signal });

  assert.equal(bodies[0].tools, undefined);
  assert.equal(bodies[0].tool_choice, undefined);
  assert.equal(bodies[0].parallel_tool_calls, undefined);
  assert.deepEqual(bodies[0].reasoning, { effort: 'minimal', exclude: true });
  assert.deepEqual(bodies[0].provider, {
    order: ['fixture-primary'],
    allow_fallbacks: false,
    require_parameters: true,
  });
  assert.equal(bodies[0].response_format.type, 'json_schema');
  assert.equal(bodies[0].response_format.json_schema.strict, true);
  assert.equal(decision.action?.name, 'move_direction');
  assert.equal(decision.publicCommitment?.intention, 'Step forward once');
  assert.equal(
    (decision.call.request as any).providerResidentSession.protocol,
    'behold.openrouter-resident-session.v1',
  );
});

test('the provider resident-session transport refuses another resident identity', () => {
  const routePolicy = {
    protocol: 'behold.openrouter-route-policy.v2',
    routes: [{ requestTag: 'fixture-primary', responseProvider: 'Fixture Primary' }],
    allowFallbacks: false,
    maxOutputTokens: 512,
  } as const;
  const residentRequest = {
    ...request(),
    policyProfile: 'legible-resident-v1',
    bodyProfile: 'minecraft-human-semantic-v1',
    actionProfile: 'minecraft-human-semantic-v1',
    observation: {
      ...request().observation,
      protocol: 'behold.minecraft-human-semantic-observation.v1',
      self: {
        ...request().observation.self,
        identity: 'Scout',
      },
    },
  } as any;
  residentRequest.conversation = [
    residentRequest.conversation[0],
    {
      role: 'user',
      content: JSON.stringify(residentRequest.observation),
    },
  ];
  const body = directOpenRouterRequestBody(residentRequest, routePolicy);

  assert.doesNotThrow(() => assertOpenRouterRouteRequest(body, 'test/model', routePolicy, 'Scout'));
  assert.throws(
    () => assertOpenRouterRouteRequest(body, 'test/model', routePolicy, 'AnotherResident'),
    /belongs to another resident/,
  );
});

test('a direct resident rejects returned provider or model identity drift', async () => {
  const routePolicy = {
    protocol: 'behold.openrouter-route-policy.v1',
    order: ['Fixture Primary'],
    allowFallbacks: false,
    maxOutputTokens: 512,
  } as const;
  for (const response of [
    { model: 'test/model', provider: 'Unadmitted Provider' },
    { model: 'test/other-model', provider: 'Fixture Primary' },
    { model: 'test/model', provider: null },
  ]) {
    const mind = createDirectResidentMind({
      apiKey: 'test-key',
      model: 'test/model',
      routePolicy,
      endpoint: 'https://models.example.test/v1/chat/completions',
      fetch: async () =>
        new Response(
          JSON.stringify({
            id: 'drifted-generation',
            ...response,
            choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: null } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    } as any);

    await assert.rejects(
      mind.decide(request() as any, { signal: new AbortController().signal }),
      (error: any) => {
        assert.ok(error instanceof ResidentMindCallError);
        assert.equal(error.call.response.terminal, 'route_identity_mismatch');
        assert.equal(error.call.response.status, 200);
        return true;
      },
    );
  }
});

test('mind request artifacts reject drift, ignored fields, and non-JSON world state', () => {
  const artifact = createResidentMindRequestArtifact(request());
  const roundTrip = parseResidentMindRequestArtifact(JSON.parse(JSON.stringify(artifact)));
  assert.deepEqual(roundTrip, artifact);
  assert.ok(Object.isFrozen(roundTrip.request.observation));
  assert.throws(
    () => parseResidentMindRequestArtifact({ ...artifact, requestSha256: '0'.repeat(64) }),
    /digest does not match/,
  );
  assert.throws(
    () =>
      createResidentMindRequestArtifact({
        ...request(),
        hiddenWorldScan: { players: ['someone'] },
      }),
    /unknown field hiddenWorldScan/,
  );
  assert.throws(
    () =>
      createResidentMindRequestArtifact({
        ...request(),
        observation: { measuredAt: new Date() },
      }),
    /plain object/,
  );
  assert.throws(
    () =>
      createResidentMindRequestArtifact({
        ...request(),
        requiredAction: 'teleport',
      }),
    /is not admitted/,
  );
});

test('mind request artifacts retain the authenticated release reference exactly', () => {
  const experimentRelease = {
    protocol: 'behold.experiment-release-reference.v1' as const,
    releaseId: 'a'.repeat(64),
    releaseDigest: 'b'.repeat(64),
    lifecycleSequence: 8,
    lifecycleDigest: 'c'.repeat(64),
    residentObservedOrder: 2,
    residentObservedAt: '2026-07-25T12:00:03.000Z',
  };
  const artifact = createResidentMindRequestArtifact({ ...request(), experimentRelease });
  assert.deepEqual(artifact.request.experimentRelease, experimentRelease);
  assert.deepEqual(
    parseResidentMindRequestArtifact(JSON.parse(JSON.stringify(artifact))).request
      .experimentRelease,
    experimentRelease,
  );
  assert.throws(
    () =>
      createResidentMindRequestArtifact({
        ...request(),
        experimentRelease: { ...experimentRelease, releaseDigest: 'not-a-digest' },
      }),
    /must be a SHA-256 digest/,
  );
});

test('comparison rejects an adapter that attributes its call to another request', async () => {
  const artifact = createResidentMindRequestArtifact(request());
  const honest = scriptedMind('honest', artifact.requestSha256);
  const lying = scriptedMind('lying', 'f'.repeat(64));
  const comparison = await compareResidentMinds(artifact, [
    { label: 'honest', mind: honest },
    { label: 'lying', mind: lying },
  ]);
  assert.equal(comparison.verdict.inputMatched, false);
  assert.equal(comparison.verdict.allValid, false);
  assert.equal(comparison.arms[1].status, 'invalid');
  assert.match(comparison.arms[1].error || '', /does not identify/);
});

test('repeated immutable-request trials expose action and resource distributions', async () => {
  const artifact = createResidentMindRequestArtifact(request());
  const alternating = trialMind('alternating', artifact.requestSha256, [
    { name: 'move_direction', input: { direction: 'forward', distance: 2 } },
    { name: 'move_direction', input: { direction: 'back', distance: 1 } },
  ]);
  const steady = trialMind(
    'steady',
    artifact.requestSha256,
    [{ name: 'move_direction', input: { direction: 'forward', distance: 2 } }],
    true,
  );
  const trials = await runResidentMindTrials(
    artifact,
    [
      { label: 'alternating', mind: alternating },
      { label: 'steady', mind: steady },
    ],
    { trials: 3 },
  );

  assert.equal(trials.protocol, 'behold.mind-trials.v1');
  assert.equal(trials.trials.length, 3);
  assert.deepEqual(trials.verdict, {
    inputMatched: true,
    allCompleted: true,
    allValid: true,
  });
  assert.deepEqual(
    trials.minds.map((mind) => ({
      label: mind.label,
      actions: mind.actions.map((action) => action.count),
      attempts: mind.usage.providerAttempts,
      tokens: mind.usage.totalTokens,
      latency: mind.latencyMs,
    })),
    [
      {
        label: 'alternating',
        actions: [2, 1],
        attempts: 3,
        tokens: 180,
        latency: { samples: 3, min: 10, p50: 20, p95: 30, max: 30, mean: 20 },
      },
      {
        label: 'steady',
        actions: [3],
        attempts: 3,
        tokens: 180,
        latency: { samples: 3, min: 10, p50: 20, p95: 30, max: 30, mean: 20 },
      },
    ],
  );
  assert.equal(trials.minds[0].usage.cost, 0.006);
  assert.deepEqual(trials.minds[1].actions, [
    {
      disposition: 'act',
      action: { name: 'move_direction', input: { direction: 'forward', distance: 2 } },
      count: 3,
    },
  ]);
  await assert.rejects(
    runResidentMindTrials(artifact, [], { trials: 21 }),
    /integer from 1 through 20/,
  );
});

function request() {
  return {
    protocol: 'behold.mind-request.v1',
    entityId: 'Scout',
    model: 'test/model',
    policyProfile: 'neutral-benchmark-v1',
    actionProfile: 'minecraft-player-v1',
    safetyProfile: 'vanilla-player-v1',
    observation: {
      protocol: 'behold.inhabitant.v2',
      sequence: 7,
      self: { health: 20, position: { x: 0, y: 64, z: 0 } },
      scene: { terrain: [{ offset: { forward: 1 }, block: 'grass_block' }] },
      events: [],
    },
    conversation: [
      { role: 'system', content: 'Choose through the admitted world interface.' },
      { role: 'user', content: 'Current world experience: one grassy step is ahead.' },
    ],
    actions: [
      {
        name: 'move_direction',
        description: 'Move relative to the current first-person orientation.',
        inputSchema: {
          type: 'object',
          properties: {
            direction: { type: 'string', enum: ['forward', 'back', 'left', 'right'] },
            distance: { type: 'integer', minimum: 1, maximum: 4 },
          },
          required: ['direction', 'distance'],
        },
      },
      {
        name: 'wait_for_event',
        inputSchema: {
          type: 'object',
          properties: { reason: { type: 'string' } },
          required: ['reason'],
        },
      },
    ],
    requiredAction: null,
    attention: {
      mode: 'deliberative',
      context: 'bounded_loom',
      triggers: [],
    },
  };
}

function scriptedMind(id: string, mindRequestSha256: string): ResidentMind {
  return {
    id,
    decide: async (request) => ({
      protocol: 'behold.mind-decision.v1',
      disposition: 'act',
      utterance: 'I will take one step.',
      action: { name: 'move_direction', input: { direction: 'forward', distance: 2 } },
      call: {
        protocol: 'behold.model-call.v1',
        requestId: `${id}-call`,
        endpoint: 'test://mind',
        startedAt: 1,
        completedAt: 2,
        latencyMs: 1,
        adapter: { name: id },
        request: {
          model: request.model,
          mindRequestSha256,
          messageCount: request.conversation.length,
          toolCount: request.actions.length,
          toolChoice: request.requiredAction,
          bodySha256: '0'.repeat(64),
          messagesSha256: '1'.repeat(64),
          toolsSha256: '2'.repeat(64),
          kind: 'mind_input',
        },
        response: {
          id: null,
          model: request.model,
          provider: 'fixture',
          finishReason: 'fixture',
          nativeFinishReason: null,
          usage: null,
        },
      },
    }),
  };
}

function trialMind(
  id: string,
  mindRequestSha256: string,
  actions: readonly { name: string; input: unknown }[],
  varyCallId = false,
): ResidentMind {
  let index = 0;
  return {
    id,
    decide: async (request) => {
      const action = actions[index % actions.length];
      index += 1;
      return {
        protocol: 'behold.mind-decision.v1',
        disposition: 'act',
        utterance: null,
        action: varyCallId ? { ...action, callId: `provider-call-${index}` } : action,
        call: {
          protocol: 'behold.model-call.v1',
          requestId: `${id}-${index}`,
          endpoint: 'test://mind',
          startedAt: index * 100,
          completedAt: index * 100 + index * 10,
          latencyMs: index * 10,
          adapter: { name: id },
          request: {
            model: request.model,
            mindRequestSha256,
            messageCount: request.conversation.length,
            toolCount: request.actions.length,
            toolChoice: null,
            bodySha256: '0'.repeat(64),
            messagesSha256: '1'.repeat(64),
            toolsSha256: '2'.repeat(64),
            kind: 'mind_input',
          },
          response: {
            id: `${id}-response-${index}`,
            model: request.model,
            provider: 'fixture',
            finishReason: 'stop',
            nativeFinishReason: 'stop',
            usage: {
              prompt_tokens: 50,
              completion_tokens: 10,
              total_tokens: 60,
              cost: 0.002,
            },
          },
        },
      };
    },
  };
}
