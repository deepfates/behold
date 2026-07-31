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
});
