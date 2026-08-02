import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveResidentRuntimeConfig } from '../src/runtime/resident-config';

test('resident runtime resolves explicit launch inputs without mutating either environment', () => {
  const environment: Record<string, string | undefined> = {
    SERVER_HOST: 'environment-host',
    SERVER_PORT: '25565',
    MINECRAFT_USERNAME: 'EnvironmentBody',
    MINECRAFT_AUTH: 'offline',
    BEHOLD_WORLD_ID: 'environment-world',
    LLM_MODEL: 'environment-model',
    AGENT_TICK_MS: '9000',
    BEHOLD_POLICY_PROFILE: 'resident-v1',
    BEHOLD_BODY_PROFILE: 'minecraft-resident-v1',
    BEHOLD_ACTION_PROFILE: 'resident-v1',
    BEHOLD_SAFETY_PROFILE: 'resident-safe-v1',
    BEHOLD_RUN_ID: 'managed-run-7',
  };
  const environmentBefore = structuredClone(environment);
  const processBefore = {
    username: process.env.MINECRAFT_USERNAME,
    model: process.env.LLM_MODEL,
    tick: process.env.AGENT_TICK_MS,
  };

  const runtime = resolveResidentRuntimeConfig(
    {
      agentName: 'Iris',
      bodyUsername: 'IrisBody',
      serverHost: '127.0.0.1',
      serverPort: 25577,
      circleId: 'oxford-life',
      model: 'local/strong-model',
      tickMs: 4200,
      maxTurnSteps: 12,
      resumeAfterBudget: true,
      policyProfile: 'neutral-benchmark-v1',
      bodyProfile: 'minecraft-human-semantic-v1',
      actionProfile: 'minecraft-human-semantic-v1',
      safetyProfile: 'vanilla-player-v1',
      paused: true,
      allowTools: ['move_controls', 'dig_focused_block'],
    },
    environment,
  );

  assert.equal(runtime.entityId, 'Iris');
  assert.equal(runtime.bodyUsername, 'IrisBody');
  assert.deepEqual(runtime.minecraft.server, { host: '127.0.0.1', port: 25577 });
  assert.deepEqual(runtime.minecraft.circle, { id: 'oxford-life', source: 'explicit' });
  assert.equal(runtime.model, 'local/strong-model');
  assert.equal(runtime.tickMs, 4200);
  assert.equal(runtime.maxTurnSteps, 12);
  assert.equal(runtime.managed.runId, 'managed-run-7');
  assert.deepEqual(runtime.profiles, {
    policy: 'neutral-benchmark-v1',
    body: 'minecraft-human-semantic-v1',
    actions: 'minecraft-human-semantic-v1',
    safety: 'vanilla-player-v1',
    perception: 'semantic-only-v1',
  });
  assert.deepEqual(runtime.allowTools, ['move_controls', 'dig_focused_block']);
  assert.equal(runtime.paused, true);
  assert.ok(Object.isFrozen(runtime));
  assert.ok(Object.isFrozen(runtime.cognition));
  assert.ok(Object.isFrozen(runtime.allowTools));
  assert.deepEqual(environment, environmentBefore);
  assert.deepEqual(
    {
      username: process.env.MINECRAFT_USERNAME,
      model: process.env.LLM_MODEL,
      tick: process.env.AGENT_TICK_MS,
    },
    processBefore,
  );
});

test('resident runtime rejects mismatched semantic body and action surfaces', () => {
  assert.throws(
    () =>
      resolveResidentRuntimeConfig(
        {
          bodyProfile: 'minecraft-human-semantic-v1',
          actionProfile: 'resident-v1',
        },
        {
          SERVER_HOST: '127.0.0.1',
          SERVER_PORT: '25565',
          MINECRAFT_USERNAME: 'Body',
        },
      ),
    /must be paired/,
  );
});

test('resident runtime uses one cadence default throughout composition', () => {
  const runtime = resolveResidentRuntimeConfig(
    {},
    {
      SERVER_HOST: '127.0.0.1',
      SERVER_PORT: '25565',
      MINECRAFT_USERNAME: 'Body',
    },
  );

  assert.equal(runtime.minecraft.agent.tickMs, 4000);
  assert.equal(runtime.tickMs, 4000);
  assert.deepEqual(runtime.profiles, {
    policy: 'resident-v2',
    body: 'minecraft-human-semantic-v1',
    actions: 'minecraft-human-semantic-v1',
    safety: 'vanilla-player-v1',
    perception: 'semantic-only-v1',
  });
});

test('ordinary resident-v2 refuses a controller task and requires an explicit provider session', () => {
  const base = {
    SERVER_HOST: '127.0.0.1',
    SERVER_PORT: '25565',
    MINECRAFT_USERNAME: 'Body',
  };
  assert.throws(
    () => resolveResidentRuntimeConfig({ task: 'come-see-do-report' }, base),
    /does not accept a controller-supplied task/,
  );
  assert.throws(
    () =>
      resolveResidentRuntimeConfig(
        {},
        { ...base, OPENROUTER_API_KEY: 'provider-key', LLM_MODEL: 'test/model' },
      ),
    /requires a strict resident-session transport/,
  );
  const routeV3 = JSON.stringify({
    protocol: 'behold.openrouter-route-policy.v3',
    routes: [{ requestTag: 'fixture', responseProvider: 'Fixture' }],
    allowFallbacks: false,
    maxOutputTokens: 256,
    residentDecisionFormat: 'native_tools',
    reasoningEffort: 'none',
  });
  assert.throws(
    () =>
      resolveResidentRuntimeConfig(
        {},
        { ...base, LLM_MODEL: 'test/model', BEHOLD_OPENROUTER_ROUTE_POLICY: routeV3 },
      ),
    /resident-v2 requires OpenRouter resident-session route v2/,
  );
  const routeV2 = JSON.stringify({
    protocol: 'behold.openrouter-route-policy.v2',
    routes: [{ requestTag: 'fixture', responseProvider: 'Fixture' }],
    allowFallbacks: false,
    maxOutputTokens: 256,
  });
  assert.equal(
    resolveResidentRuntimeConfig(
      {},
      { ...base, LLM_MODEL: 'test/model', BEHOLD_OPENROUTER_ROUTE_POLICY: routeV2 },
    ).profiles.policy,
    'resident-v2',
  );
  const routeV4 = JSON.stringify({
    protocol: 'behold.openrouter-route-policy.v4',
    routes: [{ requestTag: 'deepinfra/fp4', responseProvider: 'DeepInfra' }],
    allowFallbacks: false,
    maxOutputTokens: 256,
    residentDecisionFormat: 'strict_json',
    reasoningEnabled: false,
    zdr: true,
    dataCollection: 'deny',
  });
  assert.equal(
    resolveResidentRuntimeConfig(
      {},
      { ...base, LLM_MODEL: 'test/model', BEHOLD_OPENROUTER_ROUTE_POLICY: routeV4 },
    ).profiles.policy,
    'resident-v2',
  );
});
