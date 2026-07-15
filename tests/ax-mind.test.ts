import test from 'node:test';
import assert from 'node:assert/strict';
import {
  axResidentProgramIdentity,
  axResidentProgramFromOptimization,
  createAxResidentMind,
  defaultAxResidentProgramArtifact,
  parseAxResidentProgramArtifact,
} from '../src/mind/ax';
import { startCognitionBroker } from '../src/mind/cognition-broker';
import { cognitionResidentKey } from '../src/mind/cognition';
import { ResidentMindCallError } from '../src/mind/evidence';
import { AX_RESIDENT_PROGRAM_ID, AX_RESIDENT_SIGNATURE } from '../src/mind/ax-program-artifact';

test('Ax proposes a typed decision without receiving executable world functions', async () => {
  const requests: any[] = [];
  const localBearer = `ax-local-${'x'.repeat(48)}`;
  const broker = await startCognitionBroker({
    upstreamEndpoint: 'https://models.example.test/v1/chat/completions',
    allowedUpstreamOrigins: ['https://models.example.test'],
    upstreamApiKey: 'upstream-test-key',
    clients: [
      {
        bearer: localBearer,
        residentKey: cognitionResidentKey('fixture-run', 'ax-scout'),
        model: 'test/model',
        models: ['test/urgent-model'],
      },
    ],
    maxConcurrent: 1,
    fetch: async (_url: any, init: any) => {
      requests.push(JSON.parse(String(init?.body || '{}')));
      const actionName =
        requests.length === 1
          ? 'use_crafting_table'
          : requests.length === 2
            ? 'craft_item'
            : 'wait_for_event';
      const actionInput =
        actionName === 'wait_for_event'
          ? '{"reason":"Let the world advance","events":["scene update"]}'
          : '{"item":"oak_planks"}';
      return new Response(
        JSON.stringify({
          id: 'ax-test-generation',
          object: 'chat.completion',
          created: 1,
          model: 'test/urgent-model',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content: [
                  'Disposition: act',
                  `Action Name: ${actionName}`,
                  `Action Input: ${actionInput}`,
                ].join('\n'),
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    },
  });

  const programArtifact = parseAxResidentProgramArtifact({
    ...defaultAxResidentProgramArtifact(),
    instruction: 'Candidate strategy marker: prefer concise public proposals.',
  });
  const mind = createAxResidentMind({
    apiKey: localBearer,
    model: 'test/model',
    allowedModels: ['test/urgent-model'],
    apiURL: broker.endpoint.replace(/\/chat\/completions$/, ''),
    maxRetries: 1,
    cognitionTransport: true,
    now: (() => {
      let value = 100;
      return () => (value += 5);
    })(),
    programArtifact,
  });

  try {
    const mindRequest: any = {
      protocol: 'behold.mind-request.v1',
      entityId: 'Scout',
      model: 'test/urgent-model',
      observation: { inventory: [{ name: 'oak_log', count: 1 }] },
      conversation: [
        { role: 'system', content: 'Live carefully.' },
        { role: 'system', content: 'Folded view of your own loom: the shelter is unfinished.' },
        { role: 'system', content: 'Urgent attention handoff: self_hurt@42.' },
        { role: 'user', content: 'Current world experience: body health is 6.' },
      ],
      actions: [
        {
          name: 'craft_item',
          description: 'Craft one recipe',
          inputSchema: { type: 'object', properties: { item: { type: 'string' } } },
        },
      ],
      requiredAction: null,
      attention: {
        mode: 'urgent',
        context: 'current_body_and_continuity',
        triggers: [{ sequence: 42, type: 'self_hurt', salience: 'urgent' }],
      },
    };
    const decision = await mind.decide(mindRequest, {
      signal: new AbortController().signal,
    });

    assert.equal(requests.length, 2, 'Ax should retry an action outside the admitted set');
    assert.equal(
      Array.isArray(requests[0].tools) && requests[0].tools.length > 0,
      false,
      'Ax may request structured output, but it must not receive executable Minecraft tools',
    );
    const firstRequest = JSON.stringify(requests[0]);
    assert.match(firstRequest, /Folded view of your own loom/);
    assert.match(firstRequest, /Urgent attention handoff/);
    assert.match(firstRequest, /current_body_and_continuity/);
    assert.match(firstRequest, /Candidate strategy marker/);
    assert.match(firstRequest, /Never execute an action/);
    assert.equal(decision.disposition, 'act');
    assert.equal(decision.utterance, null, 'an embodied action does not require public speech');
    assert.equal(decision.action?.name, 'craft_item');
    assert.deepEqual(decision.action?.input, { item: 'oak_planks' });
    assert.equal(decision.call.adapter?.name, 'ax');
    assert.deepEqual(decision.call.program, axResidentProgramIdentity(programArtifact));
    assert.match(decision.call.program?.artifactSha256 || '', /^[a-f0-9]{64}$/);
    assert.equal(decision.call.request.model, 'test/urgent-model');
    assert.ok(requests.every((request) => request.model === 'test/urgent-model'));
    assert.equal(decision.call.request.kind, 'mind_input');
    assert.equal((decision.call.response.usage as any).ax[0].tokens.totalTokens, 240);
    assert.equal((decision.call.response.usage as any).provider.total_tokens, 240);
    assert.equal((decision.call.response.usage as any).provider.attempts, 2);
    assert.equal(decision.call.admissions?.length, 2);
    assert.ok(
      decision.call.admissions?.every(
        (admission) => admission.priority === 'urgent' && admission.urgentTriggerSequence === 42,
      ),
    );
    assert.equal(broker.snapshot().completed, 2);

    const secondDecision = await mind.decide(
      {
        ...mindRequest,
        actions: [
          ...mindRequest.actions,
          {
            name: 'wait_for_event',
            description: 'Yield until the world changes',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
        conversation: [
          { role: 'system', content: 'Different policy guidance for the same candidate.' },
          ...mindRequest.conversation.slice(1),
        ],
      },
      { signal: new AbortController().signal },
    );
    assert.equal(requests.length, 3);
    assert.match(JSON.stringify(requests[2]), /Different policy guidance/);
    assert.equal(secondDecision.disposition, 'wait');
    assert.deepEqual(secondDecision.action, {
      name: 'wait_for_event',
      input: { reason: 'Let the world advance', events: ['scene update'] },
    });
    assert.deepEqual(secondDecision.call.program, decision.call.program);
    assert.equal(broker.snapshot().completed, 3);
  } finally {
    await broker.close();
  }
});

test('Ax program artifacts have stable content identities and reject another contract', () => {
  const baseline = defaultAxResidentProgramArtifact();
  const parsed = parseAxResidentProgramArtifact(JSON.parse(JSON.stringify(baseline)));
  assert.deepEqual(axResidentProgramIdentity(parsed), axResidentProgramIdentity(baseline));
  assert.ok(Object.isFrozen(parsed));

  const changed = parseAxResidentProgramArtifact({
    ...baseline,
    instruction: `${baseline.instruction}\nPrefer concise public utterances.`,
  });
  assert.notEqual(
    axResidentProgramIdentity(changed).artifactSha256,
    axResidentProgramIdentity(baseline).artifactSha256,
  );
  assert.throws(
    () => parseAxResidentProgramArtifact({ ...baseline, axVersion: 'future' }),
    /requires @ax-llm\/ax 23\.0\.0/,
  );
  assert.throws(
    () => parseAxResidentProgramArtifact({ ...baseline, signatureSha256: '0'.repeat(64) }),
    /signature does not match/,
  );
  assert.throws(
    () => parseAxResidentProgramArtifact({ ...baseline, ignored: 'not behavioral, supposedly' }),
    /unknown field ignored/,
  );
});

test('Ax optimizer output is narrowed to admitted inference behavior', () => {
  const baseline = defaultAxResidentProgramArtifact();
  const { ax } = require('@ax-llm/ax') as { ax: (signature: string) => any };
  const sourceProgram = ax(AX_RESIDENT_SIGNATURE);
  sourceProgram.setId(AX_RESIDENT_PROGRAM_ID);
  sourceProgram.setInstruction(baseline.instruction);
  const actualComponentMap = Object.fromEntries(
    sourceProgram
      .getOptimizableComponents()
      .map((component: any) => [component.key, component.current]),
  );
  const optimized = axResidentProgramFromOptimization({
    optimizerType: 'GEPA',
    bestScore: 0.8,
    scoreHistory: [0.2, 0.8],
    componentMap: {
      ...actualComponentMap,
      'behold.resident-decision.v1::instruction': 'Choose one admitted action carefully.',
    },
    demos: [
      {
        programId: 'behold.resident-decision.v1',
        traces: [
          {
            policyGuidance: 'Use only current evidence.',
            profiles: { policy: 'neutral-benchmark-v1' },
            livedContext: { messages: [] },
            currentObservation: { health: 20 },
            admittedActionNames: ['wait_for_event'],
            admittedActions: [{ name: 'wait_for_event' }],
            disposition: 'wait',
            utterance: 'I will wait.',
            waitReason: 'No change yet.',
          },
        ],
      },
    ],
  });
  assert.equal(optimized.instruction, 'Choose one admitted action carefully.');
  assert.equal(optimized.demos.length, 1);
  assert.ok(Object.isFrozen(optimized.demos[0].traces[0]));
  assert.doesNotThrow(() =>
    createAxResidentMind({ apiKey: 'offline', model: 'test/model', programArtifact: optimized }),
  );
  assert.notEqual(
    axResidentProgramIdentity(optimized).artifactSha256,
    axResidentProgramIdentity(baseline).artifactSha256,
  );
  assert.throws(
    () =>
      axResidentProgramFromOptimization({
        componentMap: { 'behold.resident-decision.v1::description': 'mutated contract' },
      }),
    /may not mutate component/,
  );
  assert.throws(
    () => axResidentProgramFromOptimization({ modelConfig: { temperature: 1 } }),
    /does not admit optimizer model configuration/,
  );
  assert.throws(
    () =>
      parseAxResidentProgramArtifact({
        ...baseline,
        demos: [
          {
            programId: 'behold.resident-decision.v1',
            traces: [{ disposition: 'wait', ignoredReasoning: 'private' }],
          },
        ],
      }),
    /unknown field ignoredReasoning/,
  );
  assert.throws(
    () =>
      parseAxResidentProgramArtifact({
        ...baseline,
        demos: [
          {
            programId: 'behold.resident-decision.v1',
            traces: [{ disposition: 'wait', utterance: undefined }],
          },
        ],
      }),
    /only JSON values/,
  );
  assert.throws(
    () =>
      parseAxResidentProgramArtifact({
        ...baseline,
        demos: [
          {
            programId: 'behold.resident-decision.v1',
            traces: [
              { policyGuidance: 'test', currentObservation: new Date(), disposition: 'wait' },
            ],
          },
        ],
      }),
    /plain object/,
  );
  assert.throws(
    () =>
      parseAxResidentProgramArtifact({
        ...baseline,
        demos: [
          {
            programId: 'behold.resident-decision.v1',
            traces: [{ policyGuidance: 'test', currentObservation: NaN, disposition: 'wait' }],
          },
        ],
      }),
    /only JSON values/,
  );
  assert.throws(
    () =>
      parseAxResidentProgramArtifact({
        ...baseline,
        demos: [
          {
            programId: 'behold.resident-decision.v1',
            traces: [{ utterance: 'output only' }],
          },
        ],
      }),
    /at least one program input/,
  );
});

test('a failed Ax call retains the exact candidate program identity', async () => {
  const artifact = defaultAxResidentProgramArtifact();
  let providerAttempts = 0;
  const mind = createAxResidentMind({
    apiKey: 'test-key',
    model: 'test/model',
    apiURL: 'https://models.example.test/v1',
    maxRetries: 0,
    recordModelIO: true,
    fetch: async () => {
      providerAttempts += 1;
      return new Response('{"error":"unauthorized"}', { status: 401 });
    },
  });
  await assert.rejects(
    mind.decide(
      {
        protocol: 'behold.mind-request.v1',
        entityId: 'Scout',
        model: 'test/model',
        observation: { health: 20 },
        conversation: [{ role: 'system', content: 'Use current world evidence.' }],
        actions: [
          {
            name: 'wait_for_event',
            description: 'Yield until the world changes',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
        requiredAction: null,
      },
      { signal: new AbortController().signal },
    ),
    (error: any) => {
      assert.ok(error instanceof ResidentMindCallError);
      assert.deepEqual(error.call.program, axResidentProgramIdentity(artifact));
      assert.ok((error.call.response.raw as any).providerResponses.length >= 1);
      assert.equal((error.call.response.raw as any).providerResponses[0].error, 'unauthorized');
      assert.equal(providerAttempts, 1, 'the cognition owner, not Ax HTTP, owns call retries');
      return true;
    },
  );
});

test('an aborted Ax call retains the exact candidate program identity', async () => {
  const artifact = defaultAxResidentProgramArtifact();
  const mind = createAxResidentMind({
    apiKey: 'test-key',
    model: 'test/model',
    apiURL: 'https://models.example.test/v1',
    maxRetries: 0,
    fetch: async () => assert.fail('a pre-aborted call must not reach the provider'),
  });
  const controller = new AbortController();
  controller.abort(new Error('evaluation cancelled'));
  await assert.rejects(
    mind.decide(
      {
        protocol: 'behold.mind-request.v1',
        entityId: 'Scout',
        model: 'test/model',
        observation: { health: 20 },
        conversation: [{ role: 'system', content: 'Use current world evidence.' }],
        actions: [
          {
            name: 'wait_for_event',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
        requiredAction: null,
      },
      { signal: controller.signal },
    ),
    (error: any) => {
      assert.ok(error instanceof ResidentMindCallError);
      assert.deepEqual(error.call.program, axResidentProgramIdentity(artifact));
      return true;
    },
  );
});
