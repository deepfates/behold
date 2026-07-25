import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  COME_SEE_DO_REPORT_ALLOW_TOOLS,
  isControllerReleaseArmedLine,
  isControllerReadyLine,
  isMinecraftReadyLine,
  isMinecraftSaveAcknowledgement,
  isMinecraftTickFrozenAcknowledgement,
  isMinecraftTickRunningAcknowledgement,
  assertResidentConfigExclusive,
  loadManagedResidentSet,
  managedControllerProfile,
  managedSessionDurationMs,
  managedTotalModelCallLimit,
  resolveManagedDataRoot,
  recoverAbandonedManagedWorld,
  resetHeldManagedWorldFixture,
  startManagedWorld,
  WorldRunnerError,
} from '../scripts/world-runner';
import {
  acquireWorldControl,
  inspectWorldControl,
  verifyWorldLifecycleJournal,
} from '../src/runtime/world-control';
import {
  createFixtureExecutionCapability,
  digestTree,
  type OwnershipEvidence,
  type WorldLabDefinition,
} from '../scripts/world-lab';
import { verifyCognitionBrokerJournal } from '../src/mind/cognition-broker';
import { COGNITION_TRANSPORT_PROTOCOL, cognitionAccountId } from '../src/mind/cognition';
import { verifyCognitionTransportCapture } from '../src/mind/transport-capture';
import { openQuotaLedger, verifyQuotaLedger } from '../src/observability/quota-ledger';
import { readEntityLifeRange, resolveEntityLifeRange } from '../src/entity/loom';

const CLEAR: OwnershipEvidence = { state: 'clear', probe: 'fixture', owners: [] };
const ARTIFACTS_OK = { artifactIntegrityOk: true, artifacts: {} };

test('lifecycle markers require exact positive protocol lines', () => {
  assert.equal(
    isMinecraftReadyLine('[12:00:00] [Server thread/INFO]: Done (0.1s)! For help, type "help"'),
    true,
  );
  assert.equal(isMinecraftReadyLine('Not Done loading world'), false);
  assert.equal(isControllerReadyLine('[bot] Local world loaded.'), true);
  assert.equal(isControllerReadyLine('expected marker was: [bot] Local world loaded.'), false);
  assert.equal(
    isControllerReleaseArmedLine(
      `[bot] Experiment release armed: ${'a'.repeat(64)} Scout`,
      'a'.repeat(64),
      'Scout',
    ),
    true,
  );
  assert.equal(
    isControllerReleaseArmedLine('expected release armed', 'a'.repeat(64), 'Scout'),
    false,
  );
  assert.equal(
    isMinecraftTickFrozenAcknowledgement('[Server thread/INFO]: The game is frozen'),
    true,
  );
  assert.equal(
    isMinecraftTickRunningAcknowledgement('[Server thread/INFO]: The game is running normally'),
    true,
  );
  assert.equal(
    isMinecraftSaveAcknowledgement('[12:00:01] [Server thread/INFO]: Saved the game'),
    true,
  );
  assert.equal(isMinecraftSaveAcknowledgement('Saved the game failed'), false);
});

test('the direct proof resident accepts the canonical managed-runner arguments', () => {
  const result = spawnSync(
    process.execPath,
    [path.resolve('dist/scripts/owned-world-inhabitant.js'), '--tickMs', '4000'],
    { encoding: 'utf8', env: { ...process.env, VIEWER_ENABLED: '0' } },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /owned-world inhabitant requires an entity name/);
  assert.doesNotMatch(result.stderr, /Unknown option/);
});

test('the normal managed controller is an untasked resident with no benchmark allowlist', () => {
  assert.deepEqual(managedControllerProfile(), {});
  assert.deepEqual(managedControllerProfile('  ordinary-life  ', '  '), {
    task: 'ordinary-life',
  });
  assert.throws(
    () => managedControllerProfile(undefined, 'importdf'),
    (error: any) => error?.code === 'controller_target_without_task',
  );
});

test('Come-See-Do-Report is an explicit managed evaluation profile', () => {
  assert.deepEqual(managedControllerProfile('come-see-do-report'), {
    task: 'come-see-do-report',
    target: 'importdf',
    allowTools: COME_SEE_DO_REPORT_ALLOW_TOOLS,
  });
  assert.deepEqual(managedControllerProfile('come-see-do-report', 'Builder'), {
    task: 'come-see-do-report',
    target: 'Builder',
    allowTools: COME_SEE_DO_REPORT_ALLOW_TOOLS,
  });
});

test('managed session duration is an optional post-readiness live-time boundary', () => {
  assert.equal(managedSessionDurationMs(), null);
  assert.equal(managedSessionDurationMs('45'), 45_000);
  assert.throws(
    () => managedSessionDurationMs('0'),
    (error: any) => error?.code === 'session_duration_invalid',
  );
  assert.throws(
    () => managedSessionDurationMs('1.5'),
    (error: any) => error?.code === 'session_duration_invalid',
  );
  assert.throws(
    () => managedSessionDurationMs(String(7 * 24 * 60 * 60 + 1)),
    (error: any) => error?.code === 'session_duration_invalid',
  );
});

test('managed model-call admission is an optional exact population-wide boundary', () => {
  assert.equal(managedTotalModelCallLimit(), null);
  assert.equal(managedTotalModelCallLimit('24'), 24);
  assert.throws(
    () => managedTotalModelCallLimit('0'),
    (error: any) => error?.code === 'model_call_limit_invalid',
  );
  assert.throws(
    () => managedTotalModelCallLimit('2.5'),
    (error: any) => error?.code === 'model_call_limit_invalid',
  );
  assert.throws(
    () => managedTotalModelCallLimit('100000001'),
    (error: any) => error?.code === 'model_call_limit_invalid',
  );
});

test('a versioned resident set carries heterogeneous operator configuration without positional pairing', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-resident-set-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'residents.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      protocol: 'behold.managed-resident-set.v1',
      residents: [
        {
          entityId: 'ScoutLife',
          bodyUsername: 'ScoutBody',
          model: 'provider/scout',
          urgentModel: 'provider/scout-urgent',
          mind: 'direct',
          tickMs: 1200,
          providerQuotas: {
            residentDecisionAttempts: 20,
            auxiliaryContextAttempts: 4,
          },
          paused: false,
        },
        {
          entityId: 'BuilderLife',
          bodyUsername: 'BuilderBody',
          model: 'provider/builder',
          mind: 'ax',
          policyProfile: 'neutral-benchmark-v1',
          actionProfile: 'minecraft-player-v1',
          safetyProfile: 'vanilla-player-v1',
          tickMs: 5000,
          maxTurnSteps: 2,
          resumeAfterBudget: true,
          task: 'build shelter',
          allowTools: ['look', 'place_block'],
          providerQuotas: {
            residentDecisionAttempts: 20,
            auxiliaryContextAttempts: 4,
          },
          paused: true,
        },
      ],
    }),
  );

  assert.deepEqual(loadManagedResidentSet(file), [
    {
      entityId: 'ScoutLife',
      bodyUsername: 'ScoutBody',
      model: 'provider/scout',
      urgentModel: 'provider/scout-urgent',
      mind: 'direct',
      tickMs: 1200,
      providerQuotas: {
        residentDecisionAttempts: 20,
        auxiliaryContextAttempts: 4,
      },
      paused: false,
    },
    {
      entityId: 'BuilderLife',
      bodyUsername: 'BuilderBody',
      model: 'provider/builder',
      mind: 'ax',
      policyProfile: 'neutral-benchmark-v1',
      actionProfile: 'minecraft-player-v1',
      safetyProfile: 'vanilla-player-v1',
      tickMs: 5000,
      maxTurnSteps: 2,
      resumeAfterBudget: true,
      task: 'build shelter',
      allowTools: ['look', 'place_block'],
      providerQuotas: {
        residentDecisionAttempts: 20,
        auxiliaryContextAttempts: 4,
      },
      paused: true,
    },
  ]);
});

test('resident-set input fails closed on schema drift and mixed resident CLI flags', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-resident-set-invalid-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'residents.json');

  for (const [name, document] of [
    ['wrong protocol', { protocol: 'behold.managed-resident-set.v2', residents: [] }],
    [
      'unknown field',
      {
        protocol: 'behold.managed-resident-set.v1',
        residents: [{ entityId: 'Scout', model: 'provider/model', modle: 'typo' }],
      },
    ],
    [
      'missing model',
      { protocol: 'behold.managed-resident-set.v1', residents: [{ entityId: 'Scout' }] },
    ],
    [
      'wrong tick type',
      {
        protocol: 'behold.managed-resident-set.v1',
        residents: [{ entityId: 'Scout', model: 'provider/model', tickMs: '1000' }],
      },
    ],
    [
      'wrong provider quotas',
      {
        protocol: 'behold.managed-resident-set.v1',
        residents: [
          {
            entityId: 'Scout',
            model: 'provider/model',
            providerQuotas: { residentDecisionAttempts: 5, auxiliaryContextAttempts: 0 },
          },
        ],
      },
    ],
  ] as const) {
    fs.writeFileSync(file, JSON.stringify(document));
    assert.throws(
      () => loadManagedResidentSet(file),
      (error: any) =>
        error?.code === 'resident_config_invalid' &&
        String(error.message).toLowerCase().includes(name.split(' ')[0]),
    );
  }

  assert.doesNotThrow(() => assertResidentConfigExclusive({ residents: file }));
  assert.throws(
    () => assertResidentConfigExclusive({ residents: file, model: 'provider/global' }),
    (error: any) => error?.code === 'resident_config_cli_conflict',
  );
  assert.throws(
    () => assertResidentConfigExclusive({ residents: file, controller: ['Scout'] }),
    (error: any) => error?.code === 'resident_config_cli_conflict',
  );
});

test('operator data roots admit only the configured top-level symlink boundary', async (t) => {
  const fixture = makeFixture(t);
  const canonicalEntityRoot = fixture.options.entityRoot;
  const canonicalRunRoot = fixture.options.runRoot;
  fs.mkdirSync(canonicalEntityRoot, { recursive: true });
  fs.mkdirSync(canonicalRunRoot, { recursive: true });
  const entityLink = path.join(fixture.root, 'entity-root-link');
  const runLink = path.join(fixture.root, 'run-root-link');
  fs.symlinkSync(canonicalEntityRoot, entityLink, 'dir');
  fs.symlinkSync(canonicalRunRoot, runLink, 'dir');

  assert.equal(
    resolveManagedDataRoot(entityLink, 'entity root'),
    fs.realpathSync.native(canonicalEntityRoot),
  );
  assert.equal(
    resolveManagedDataRoot(runLink, 'run root'),
    fs.realpathSync.native(canonicalRunRoot),
  );

  const substituted = path.join(fixture.root, 'substituted-entity');
  fs.mkdirSync(substituted);
  fs.symlinkSync(substituted, path.join(canonicalEntityRoot, 'Substituted'), 'dir');
  await assert.rejects(
    () =>
      startManagedWorld(
        {
          ...fixture.options,
          entityRoot: resolveManagedDataRoot(entityLink, 'entity root'),
          runRoot: resolveManagedDataRoot(runLink, 'run root'),
        },
        {
          inspectRuntime: async () => runtimeEvidence(null),
          verifyArtifacts: async () => ARTIFACTS_OK,
        },
      ),
    (error: any) => error?.code === 'world_controller_lease_not_clear',
  );
  assert.equal(inspectWorldControl(fixture.controlRoot, 'fixture').state, 'clear');
});

test('resident configuration rejects canonical identity collisions and process-budget overflow before inspecting or mutating the world', async (t) => {
  const fixture = makeFixture(t);
  let inspections = 0;
  const dependencies = {
    inspectRuntime: async () => {
      inspections += 1;
      return runtimeEvidence(null);
    },
    verifyArtifacts: async () => ARTIFACTS_OK,
  };
  await assert.rejects(
    () =>
      startManagedWorld(
        {
          ...fixture.options,
          residents: [
            { entityId: 'Scout Life', bodyUsername: 'ScoutBodyOne', model: 'fixture/model' },
            { entityId: 'Scout-Life', bodyUsername: 'ScoutBodyTwo', model: 'fixture/model' },
          ],
        },
        dependencies,
      ),
    (error: any) => error?.code === 'resident_identity_collision',
  );
  await assert.rejects(
    () =>
      startManagedWorld(
        {
          ...fixture.options,
          residents: [
            { entityId: 'FirstLife', bodyUsername: 'SharedBody', model: 'fixture/model' },
            { entityId: 'SecondLife', bodyUsername: 'sharedbody', model: 'fixture/model' },
          ],
        },
        dependencies,
      ),
    (error: any) => error?.code === 'resident_body_identity_collision',
  );
  await assert.rejects(
    () =>
      startManagedWorld(
        {
          ...fixture.options,
          residents: [{ entityId: 'LongPrivateLifeIdentity', model: 'fixture/model' }],
        },
        dependencies,
      ),
    (error: any) => error?.code === 'resident_body_identity_invalid',
  );
  await assert.rejects(
    () =>
      startManagedWorld(
        {
          ...fixture.options,
          residents: [{ entityId: 'Scout', model: 'fixture/model', maxTurnSteps: 0 }],
        },
        dependencies,
      ),
    (error: any) => error?.code === 'resident_turn_step_budget_invalid',
  );
  await assert.rejects(
    () =>
      startManagedWorld(
        {
          ...fixture.options,
          maxResidents: 1,
          residents: [
            { entityId: 'Scout', model: 'fixture/model' },
            { entityId: 'Builder', model: 'fixture/model' },
          ],
        },
        dependencies,
      ),
    (error: any) => error?.code === 'resident_limit_exceeded',
  );
  assert.equal(inspections, 0);
  await assert.rejects(
    () =>
      startManagedWorld(
        {
          ...fixture.options,
          accountingScopeId: 'matched-1',
          residents: [
            {
              entityId: 'Scout',
              model: 'fixture/model-a',
              bodyProfile: 'minecraft-human-semantic-v1',
              actionProfile: 'minecraft-human-semantic-v1',
              safetyProfile: 'vanilla-player-v1',
              providerQuotas: { residentDecisionAttempts: 4, auxiliaryContextAttempts: 2 },
            },
            {
              entityId: 'Builder',
              model: 'fixture/model-b',
              bodyProfile: 'minecraft-resident-v1',
              actionProfile: 'resident-v1',
              safetyProfile: 'resident-safe-v1',
              providerQuotas: { residentDecisionAttempts: 4, auxiliaryContextAttempts: 2 },
            },
          ],
        },
        dependencies,
      ),
    (error: any) => error?.code === 'experiment_release_body_contract_mismatch',
  );
  assert.equal(inspections, 0);
  await assert.rejects(
    () =>
      startManagedWorld(
        {
          ...fixture.options,
          accountingScopeId: 'matched-1',
          residents: fixture.options.residents.map((resident) => ({
            ...resident,
            paused: true,
            providerQuotas: { residentDecisionAttempts: 4, auxiliaryContextAttempts: 2 },
          })),
        },
        dependencies,
      ),
    (error: any) => error?.code === 'provider_release_paused_resident',
  );
  assert.equal(inspections, 0);
  await assert.rejects(
    () =>
      startManagedWorld(
        {
          ...fixture.options,
          accountingScopeId: 'matched-1',
          maxTotalModelCalls: 9,
          residents: fixture.options.residents.map((resident) => ({
            ...resident,
            providerQuotas: { residentDecisionAttempts: 4, auxiliaryContextAttempts: 2 },
          })),
        },
        dependencies,
      ),
    (error: any) => error?.code === 'provider_accounting_aggregate_limit_conflict',
  );
  assert.equal(inspections, 0);
  assert.equal(inspectWorldControl(fixture.controlRoot, 'fixture').state, 'clear');

  await assert.rejects(
    () => startManagedWorld({ ...fixture.options, residentStartupDelayMs: -1 }, dependencies),
    (error: any) => error?.code === 'resident_start_delay_invalid',
  );
  assert.equal(inspections, 0);
  await assert.rejects(
    () => startManagedWorld({ ...fixture.options, maxConcurrentModelCalls: 2 }, dependencies),
    (error: any) => error?.code === 'model_concurrency_limit_invalid',
  );
  assert.equal(inspections, 0);
  await assert.rejects(
    () => startManagedWorld({ ...fixture.options, maxTotalModelCalls: 0 }, dependencies),
    (error: any) => error?.code === 'model_call_limit_invalid',
  );
  assert.equal(inspections, 0);
  await assert.rejects(
    () =>
      startManagedWorld(
        {
          ...fixture.options,
          residents: fixture.options.residents.map((resident) => ({
            ...resident,
            providerQuotas: { residentDecisionAttempts: 4, auxiliaryContextAttempts: 2 },
          })),
        },
        dependencies,
      ),
    (error: any) => error?.code === 'provider_accounting_scope_invalid',
  );
  assert.equal(inspections, 0);
  await assert.rejects(
    () =>
      startManagedWorld(
        {
          ...fixture.options,
          accountingScopeId: 'matched-1',
          residents: [
            {
              entityId: 'Scout',
              model: 'fixture/model',
              providerQuotas: { residentDecisionAttempts: 4, auxiliaryContextAttempts: 2 },
            },
            { entityId: 'Builder', model: 'fixture/model' },
          ],
        },
        dependencies,
      ),
    (error: any) => error?.code === 'provider_quota_population_incomplete',
  );
  assert.equal(inspections, 0);
  await assert.rejects(
    () =>
      startManagedWorld(
        {
          ...fixture.options,
          accountingScopeId: 'matched-1',
          residents: [
            {
              entityId: 'Scout',
              model: 'fixture/model',
              providerQuotas: { residentDecisionAttempts: 4, auxiliaryContextAttempts: 2 },
            },
            {
              entityId: 'Builder',
              model: 'fixture/model',
              providerQuotas: { residentDecisionAttempts: 5, auxiliaryContextAttempts: 2 },
            },
          ],
        },
        dependencies,
      ),
    (error: any) => error?.code === 'provider_quota_population_mismatch',
  );
  assert.equal(inspections, 0);
  await assert.rejects(
    () =>
      startManagedWorld(
        {
          ...fixture.options,
          residents: fixture.options.residents.map((resident) => ({
            ...resident,
            policyProfile: 'secret-coaching-v1' as any,
          })),
        },
        dependencies,
      ),
    (error: any) => error?.code === 'resident_profile_invalid',
  );
  assert.equal(inspections, 0);
  for (const environment of [
    { BEHOLD_RUN_ID: 'forged-run' },
    { NODE_OPTIONS: '--require=/tmp/foreign-code.js' },
  ]) {
    await assert.rejects(
      () =>
        startManagedWorld(
          {
            ...fixture.options,
            residents: fixture.options.residents.map((resident) => ({
              ...resident,
              environment,
            })),
          },
          dependencies,
        ),
      (error: any) => error?.code === 'resident_environment_invalid',
    );
  }
  assert.equal(inspections, 0);
});

test('managed cognition and fixture failure cleanup drain every owned resource before evidence removal', async (t) => {
  const fixture = makeFixture(t);
  let exercisedDiagnosticDirectory: string | null = null;
  t.after(() => {
    if (exercisedDiagnosticDirectory) {
      fs.rmSync(exercisedDiagnosticDirectory, { recursive: true, force: true });
    }
  });
  const captureFile = path.join(fixture.root, 'controller-environment.json');
  const controllerEntry = path.join(fixture.root, 'fixture-controller.js');
  fs.writeFileSync(
    controllerEntry,
    `
      const fs = require('node:fs');
      const os = require('node:os');
      const path = require('node:path');
      const crypto = require('node:crypto');
      const { experimentReleaseGateFromEnvironment } = require(path.resolve('dist/src/runtime/experiment-release.js'));
      const entityId = process.argv[2];
      const arg = (name) => {
        const index = process.argv.indexOf(name);
        return index < 0 ? null : process.argv[index + 1];
      };
      const lease = path.join(process.env.BEHOLD_ENTITY_DIR, entityId, 'runtime.lock');
      fs.mkdirSync(path.dirname(lease), { recursive: true });
      fs.writeFileSync(lease, JSON.stringify({
        protocol: 'behold.entity-runtime-lease.v1', entityId,
        pid: process.pid, hostname: os.hostname(), managedRunId: process.env.BEHOLD_RUN_ID
      }));
      const localKey = String(process.env.OPENROUTER_API_KEY || '');
      fs.writeFileSync(${JSON.stringify(captureFile)}, JSON.stringify({
        keySha256: crypto.createHash('sha256').update(localKey).digest('hex'),
        keyLength: localKey.length,
        endpoint: process.env.OPENROUTER_BASE_URL,
        transport: process.env.BEHOLD_COGNITION_TRANSPORT,
        refererPresent: process.env.OPENROUTER_REFERER != null,
        titlePresent: process.env.OPENROUTER_TITLE != null,
        ambientCloudCredentialPresent: process.env.AWS_SECRET_ACCESS_KEY != null,
        dotenvDisabled: process.env.BEHOLD_LOAD_DOTENV === '0',
        policyProfile: process.env.BEHOLD_POLICY_PROFILE,
        bodyProfile: process.env.BEHOLD_BODY_PROFILE,
        actionProfile: process.env.BEHOLD_ACTION_PROFILE,
        safetyProfile: process.env.BEHOLD_SAFETY_PROFILE
        ,fixtureProofPhase: process.env.BEHOLD_FIXTURE_PROOF_PHASE,
        quotaAccountId: process.env.BEHOLD_COGNITION_ACCOUNT_ID,
        releasePlan: process.env.BEHOLD_EXPERIMENT_RELEASE_PLAN
      }));
      const journalFile = path.join(process.env.BEHOLD_RUN_DIR, 'fixture-controller.jsonl');
      fs.mkdirSync(path.dirname(journalFile), { recursive: true });
      fs.writeFileSync(journalFile, JSON.stringify({ type: 'setup_local_world_ready' }) + '\\n');
      const gate = experimentReleaseGateFromEnvironment({
        entityId,
        bodyUsername: process.env.MINECRAFT_USERNAME,
        model: arg('--model'),
        urgentModel: arg('--urgentModel'),
        mind: process.env.BEHOLD_MIND,
        profiles: {
          policy: process.env.BEHOLD_POLICY_PROFILE,
          body: process.env.BEHOLD_BODY_PROFILE,
          actions: process.env.BEHOLD_ACTION_PROFILE,
          safety: process.env.BEHOLD_SAFETY_PROFILE,
        },
        quotaAccountId: process.env.BEHOLD_COGNITION_ACCOUNT_ID,
      });
      gate.arm({ journalFile, setupObservation: { fixture: true } });
      console.error('[bot] Experiment release armed: ' + gate.prepared.plan.releaseId + ' ' + entityId);
      gate.waitAndClaim().then((reference) => {
        fs.appendFileSync(journalFile, JSON.stringify({ type: 'experiment_release_observed', reference }) + '\\n');
      }).catch((error) => {
        console.error(error);
        process.exit(1);
      });
      process.stdin.resume();
      process.stdin.on('end', () => {
        if (fs.existsSync(lease)) fs.unlinkSync(lease);
        process.exit(0);
      });
    `,
  );
  const prior = {
    key: process.env.OPENROUTER_API_KEY,
    base: process.env.OPENROUTER_BASE_URL,
    referer: process.env.OPENROUTER_REFERER,
    title: process.env.OPENROUTER_TITLE,
    cloud: process.env.AWS_SECRET_ACCESS_KEY,
  };
  const providerSecret = 'provider-secret-never-in-child';
  process.env.OPENROUTER_API_KEY = providerSecret;
  process.env.OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';
  process.env.OPENROUTER_REFERER = 'https://private.example';
  process.env.OPENROUTER_TITLE = 'private title';
  process.env.AWS_SECRET_ACCESS_KEY = 'ambient-cloud-secret';
  t.after(() => {
    restoreTestEnvironment('OPENROUTER_API_KEY', prior.key);
    restoreTestEnvironment('OPENROUTER_BASE_URL', prior.base);
    restoreTestEnvironment('OPENROUTER_REFERER', prior.referer);
    restoreTestEnvironment('OPENROUTER_TITLE', prior.title);
    restoreTestEnvironment('AWS_SECRET_ACCESS_KEY', prior.cloud);
  });

  const accountingScopeId = 'matched-fixture-1';
  const accountId = cognitionAccountId(accountingScopeId, 'fixture', 'Scout');
  const quotaFile = path.join(
    fixture.controlRoot,
    'accounting',
    createHash('sha256').update(accountingScopeId).digest('hex'),
    'provider',
    `${accountId}.jsonl`,
  );
  const priorEpochQuota = openQuotaLedger({
    file: quotaFile,
    scopeId: accountingScopeId,
    worldId: 'fixture',
    accountId,
    layer: 'provider',
    limits: { resident_decision: 3, loom_fold: 2 },
  });
  priorEpochQuota.charge('resident_decision', 'prior-epoch-attempt');
  priorEpochQuota.settle('prior-epoch-attempt', {
    outcome: 'upstream_response',
    usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
  });
  priorEpochQuota.close();

  let serverPid: number | null = null;
  let serverAlive = false;
  const spawnServer = () => {
    const child = spawn(
      process.execPath,
      [
        '-e',
        `
          const readline = require('node:readline');
          console.log('[Server thread/INFO]: Done (0.1s)! For help, type "help"');
          const rl = readline.createInterface({ input: process.stdin });
          rl.on('line', (line) => {
            if (line === 'tick freeze') console.log('[Server thread/INFO]: The game is frozen');
            if (line === 'tick unfreeze') console.log('[Server thread/INFO]: The game is running normally');
            if (line === 'save-all flush') console.log('[Server thread/INFO]: Saved the game');
            if (line === 'stop') process.exit(0);
          });
        `,
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    ) as ChildProcessWithoutNullStreams;
    serverPid = child.pid!;
    serverAlive = true;
    child.once('exit', () => {
      serverAlive = false;
    });
    return child;
  };
  const run = fixture.trackRun(
    await startManagedWorld(
      {
        ...fixture.options,
        controllerEntry,
        maxConcurrentModelCalls: 1,
        accountingScopeId,
        residents: fixture.options.residents.map((resident) => ({
          ...resident,
          urgentModel: 'fixture/urgent-model',
          policyProfile: 'neutral-benchmark-v1' as const,
          maxTurnSteps: 1,
          resumeAfterBudget: false,
          providerQuotas: { residentDecisionAttempts: 3, auxiliaryContextAttempts: 2 },
          environment: { BEHOLD_FIXTURE_PROOF_PHASE: 'act' },
        })),
      },
      {
        spawnServer,
        verifyArtifacts: async () => ARTIFACTS_OK,
        inspectRuntime: async () => runtimeEvidence(serverAlive && serverPid ? serverPid : null),
        stdout: () => {},
        stderr: () => {},
      },
    ),
  );
  assert.ok(run.cognition);
  assert.equal(run.cognition.concurrencyLimit, 1);
  assert.equal(run.cognition.maxTotalModelCalls, null);
  assert.equal(run.cognition.accountingSnapshot()?.accounts[0]?.limits.resident_decision, 3);
  assert.equal(run.cognition.accountingSnapshot()?.accounts[0]?.limits.loom_fold, 2);
  assert.equal(run.cognition.accountingSnapshot()?.accounts[0]?.used.resident_decision, 1);
  assert.equal(run.cognition.accountingSnapshot()?.accounts[0]?.remaining.resident_decision, 2);
  assert.equal(run.residents[0].policyProfile, 'neutral-benchmark-v1');
  assert.equal(run.residents[0].bodyProfile, 'minecraft-human-semantic-v1');
  assert.equal(run.residents[0].actionProfile, 'minecraft-human-semantic-v1');
  assert.equal(run.residents[0].safetyProfile, 'vanilla-player-v1');
  assert.equal(run.residents[0].maxTurnSteps, 1);
  assert.equal(run.residents[0].resumeAfterBudget, false);
  const captured = JSON.parse(fs.readFileSync(captureFile, 'utf8'));
  assert.equal(captured.policyProfile, 'neutral-benchmark-v1');
  assert.equal(captured.bodyProfile, 'minecraft-human-semantic-v1');
  assert.equal(captured.actionProfile, 'minecraft-human-semantic-v1');
  assert.equal(captured.safetyProfile, 'vanilla-player-v1');
  assert.equal(captured.fixtureProofPhase, 'act');
  assert.equal(captured.quotaAccountId, accountId);
  assert.equal(captured.releasePlan, run.experimentRelease?.planFile);
  assert.notEqual(captured.keySha256, createHash('sha256').update(providerSecret).digest('hex'));
  assert.ok(captured.keyLength >= 32);
  assert.match(captured.endpoint, /^http:\/\/127\.0\.0\.1:\d+\/v1\/chat\/completions$/);
  assert.equal(captured.transport, COGNITION_TRANSPORT_PROTOCOL);
  assert.equal(captured.refererPresent, false);
  assert.equal(captured.titlePresent, false);
  assert.equal(captured.ambientCloudCredentialPresent, false);
  assert.equal(captured.dotenvDisabled, true);
  assert.ok(run.experimentRelease);
  assert.equal(fs.existsSync(run.experimentRelease.releaseFile), true);

  let deliberateAssertion: Error | null = null;
  try {
    assert.equal('synthetic assertion failure', 'unreachable expected value');
  } catch (error: any) {
    deliberateAssertion = error;
  }
  assert.ok(deliberateAssertion instanceof assert.AssertionError);
  const cleanup = await fixture.cleanupManagedRuns();
  assert.equal(cleanup.intervened, true);
  assert.deepEqual(cleanup.cleanupErrors, []);
  assert.ok(cleanup.before.some((entry) => entry.livePids.length === 2));
  assert.ok(cleanup.before.some((entry) => entry.control.state === 'held'));
  assert.ok(cleanup.listenersBefore.some((line) => /TCP .*\(LISTEN\)$/.test(line)));
  assert.ok(cleanup.after.every((entry) => entry.livePids.length === 0));
  assert.ok(cleanup.after.every((entry) => entry.control.state === 'clear'));
  assert.deepEqual(cleanup.openRootDescriptorsAfter, []);
  assert.ok(
    cleanup.listenersBefore.every((listener) => !cleanup.listenersAfter.includes(listener)),
  );
  assert.ok(cleanup.diagnosticDirectory);
  exercisedDiagnosticDirectory = cleanup.diagnosticDirectory;
  assert.equal(fs.existsSync(path.join(cleanup.diagnosticDirectory!, 'cleanup.json')), true);
  assert.equal(
    verifyWorldLifecycleJournal(
      path.join(cleanup.diagnosticDirectory!, 'lifecycle-0.jsonl'),
    ).events.at(-1)?.type,
    'control_released',
  );
  assert.equal(
    verifyCognitionBrokerJournal(
      path.join(cleanup.diagnosticDirectory!, 'cognition-0.jsonl'),
    ).events.at(-1)?.type,
    'drained',
  );
  assert.strictEqual(await fixture.cleanupManagedRuns(), cleanup, 'cleanup is idempotent');
  await run.finished;
  const verified = verifyCognitionBrokerJournal(run.cognition.journalFile);
  assert.equal(verified.peakActive, 0);
  assert.equal(verified.acceptedLimit, null);
  assert.equal(verified.acceptedRemaining, null);
  const lifecycle = verifyWorldLifecycleJournal(run.control.journalFile).events;
  const configured: any = lifecycle.find((event) => event.type === 'run_configured');
  const brokerReady: any = lifecycle.find((event) => event.type === 'cognition_broker_ready');
  const frozen = lifecycle.findIndex(
    (event) =>
      event.type === 'experiment_setup_operator_action' &&
      (event.data as any)?.action === 'minecraft_tick_freeze',
  );
  const armed = lifecycle.findIndex((event) => event.type === 'experiment_population_armed');
  const released = lifecycle.findIndex((event) => event.type === 'experiment_released');
  const observed = lifecycle.findIndex((event) => event.type === 'resident_release_observed');
  const ready = lifecycle.findIndex((event) => event.type === 'run_ready');
  assert.ok(
    frozen >= 0 && armed > frozen && released > armed && observed > released && ready > observed,
  );
  assert.equal((lifecycle[armed].data as any).cognition.accepted, 0);
  assert.equal((lifecycle[armed].data as any).cognition.admitted, 0);
  assert.equal((lifecycle[observed].data as any).observedOrder, 1);
  assert.equal(
    (lifecycle[released].data as any).postReleaseObservationOrdering,
    'resident_claim_ordinals_are_sequential',
  );
  assert.equal(configured?.data?.population?.maxTotalModelCalls, null);
  assert.equal(configured?.data?.population?.residents?.[0]?.urgentModel, 'fixture/urgent-model');
  assert.equal(configured?.data?.population?.residents?.[0]?.policyProfile, 'neutral-benchmark-v1');
  assert.equal(
    configured?.data?.population?.residents?.[0]?.bodyProfile,
    'minecraft-human-semantic-v1',
  );
  assert.equal(
    configured?.data?.population?.residents?.[0]?.actionProfile,
    'minecraft-human-semantic-v1',
  );
  assert.equal(configured?.data?.population?.residents?.[0]?.safetyProfile, 'vanilla-player-v1');
  assert.equal(configured?.data?.population?.residents?.[0]?.maxTurnSteps, 1);
  assert.equal(configured?.data?.population?.residents?.[0]?.resumeAfterBudget, false);
  assert.equal(
    configured?.data?.population?.residents?.[0]?.providerAccounting?.limits?.resident_decision,
    3,
  );
  assert.equal(configured?.data?.population?.providerAccounting?.scopeId, accountingScopeId);
  assert.equal(configured?.data?.population?.providerAccounting?.equalityEnforced, true);
  assert.equal(brokerReady?.data?.maxTotalModelCalls, null);
  assert.equal(brokerReady?.data?.accounting?.accounts?.[0]?.remaining?.resident_decision, 2);
  assert.equal(configured.data.population.residents[0].providerAccounting.ledgerFile, quotaFile);
  const quota = verifyQuotaLedger(quotaFile).snapshot;
  assert.equal(quota.scopeId, accountingScopeId);
  assert.deepEqual(quota.used, { loom_fold: 0, resident_decision: 1 });
  assert.equal(quota.usage.resident_decision.totalTokens, 10);
  const drained = lifecycle.findIndex((event) => event.type === 'cognition_broker_drained');
  const saved = lifecycle.findIndex((event) => event.type === 'server_save_acknowledged');
  assert.ok(drained >= 0 && saved > drained);
  assert.equal(lifecycle.at(-1)?.type, 'control_released');
});

test('provider-free multi-controller release keeps body, quotas, capture, interventions, and Lync distinct across restart', async (t) => {
  const fixture = makeFixture(t);
  const controllerEntry = path.join(fixture.root, 'provider-free-controller.js');
  const cancellationReadyFile = path.join(fixture.root, 'cancellation-ready');
  fs.writeFileSync(
    controllerEntry,
    `
      const fs = require('node:fs');
      const path = require('node:path');
      const { createRunJournal } = require(path.resolve('dist/src/observability/journal.js'));
      const { openEntityLoom } = require(path.resolve('dist/src/entity/loom.js'));
      const { createDirectResidentMind } = require(path.resolve('dist/src/mind/direct.js'));
      const { cognitionClientHeaders } = require(path.resolve('dist/src/mind/cognition.js'));
      const { createLoomContextView } = require(path.resolve('dist/src/entity/folding.js'));
      const { projectHumanSemanticObservation } = require(path.resolve('dist/src/mind/minecraft-body.js'));
      const { experimentReleaseGateFromEnvironment } = require(path.resolve('dist/src/runtime/experiment-release.js'));
      const entityId = process.argv[2];
      const arg = (name) => {
        const index = process.argv.indexOf(name);
        return index < 0 ? null : process.argv[index + 1];
      };
      const model = arg('--model');
      const phase = process.env.BEHOLD_FIXTURE_PHASE;
      const journal = createRunJournal(entityId, process.env.BEHOLD_RUN_DIR);
      let loom = null;
      let scenario = null;

      function rawObservation(sequence) {
        return {
          protocol: 'behold.inhabitant.v2',
          circle: { id: 'absolute-coordinate-secret', managedRunId: process.env.BEHOLD_RUN_ID },
          sequence,
          observedAt: 1700000000000 + sequence,
          task: { id: 'forbidden-injected-project', goal: 'shape resident behavior' },
          self: {
            identity: entityId,
            body: { username: process.env.MINECRAFT_USERNAME, uuid: 'hidden-stable-body-id' },
            pose: {
              position: { x: 123.5, y: 64, z: -77.25 },
              yaw: 1.5,
              pitch: -0.25,
              velocity: { x: 0, y: 0, z: 0 },
              onGround: true,
            },
            condition: {
              health: 20,
              food: 20,
              oxygen: 20,
              sleeping: false,
              dimension: 'overworld',
              isDay: true,
            },
            heldItem: null,
            inventory: [],
            projects: [{ id: 'hidden-project' }],
            places: [{ id: 'hidden-place', coordinates: { x: 1, y: 2, z: 3 } }],
          },
          scene: {
            social: { playersOnline: ['ScoutBody', 'BuilderBody'] },
            focus: null,
            entities: [],
            terrain: {
              maxDistance: 32,
              nearest: { water: { x: 120, y: 63, z: -75 } },
              visualField: {
                protocol: 'behold.semantic-visual-field.v1',
                available: true,
                dimensions: { rows: 1, columns: 1 },
                rowOrder: 'top-to-bottom',
                columnOrder: 'left-to-right',
                materialRows: ['G'],
                depthRows: ['1'],
                materialLegend: [{ symbol: 'G', name: 'grass_block' }],
                depthLegend: [{ symbol: '1', label: 'interaction' }],
                noHitSymbol: '.',
                unavailableSymbol: '?',
              },
            },
          },
          events: [],
        };
      }

      function projectedObservation(sequence) {
        const projected = projectHumanSemanticObservation(rawObservation(sequence));
        const text = JSON.stringify(projected);
        if (
          projected.bodyContract?.profile !== 'minecraft-human-semantic-v1' ||
          text.includes('absolute-coordinate-secret') ||
          text.includes('forbidden-injected-project') ||
          text.includes('hidden-stable-body-id') ||
          /\"(?:position|coordinates|x|y|z)\"/.test(text)
        ) {
          throw new Error('human-semantic fixture projection leaked oracle state');
        }
        return projected;
      }

      function request(marker, release, sequence) {
        const observation = projectedObservation(sequence);
        return {
          protocol: 'behold.mind-request.v1',
          entityId,
          model,
          policyProfile: 'neutral-benchmark-v1',
          bodyProfile: 'minecraft-human-semantic-v1',
          actionProfile: 'minecraft-human-semantic-v1',
          safetyProfile: 'vanilla-player-v1',
          experimentRelease: release,
          observation,
          conversation: [
            { role: 'system', content: 'Use only the current human-semantic body and admitted action.' },
            { role: 'user', content: 'marker:' + marker + '\\n' + JSON.stringify(observation) },
          ],
          actions: [{
            name: 'wait_for_event',
            description: 'Yield until the world changes.',
            inputSchema: {
              type: 'object',
              properties: { reason: { type: 'string' } },
              required: ['reason'],
              additionalProperties: false,
            },
          }],
          requiredAction: null,
          attention: { mode: 'deliberative', context: 'bounded_loom', triggers: [] },
        };
      }

      async function oneDecision(mind, marker, release, sequence, expected, signal) {
        const opportunityId = entityId + ':' + phase + ':' + marker;
        const candidate = request(marker, release, sequence);
        journal.append('resident_decision_opportunity', {
          protocol: 'behold.resident-decision-opportunity.v1',
          opportunityId,
          phase: 'scheduled',
          entityId,
          model,
          bodyProfile: candidate.bodyProfile,
        });
        try {
          const decision = await mind.decide(candidate, { signal: signal || new AbortController().signal });
          journal.append('resident_decision_opportunity', {
            protocol: 'behold.resident-decision-opportunity.v1',
            opportunityId,
            phase: 'terminal',
            terminal: 'success',
            call: decision.call,
          });
          if (expected !== 'success') throw new Error(marker + ' unexpectedly succeeded');
          journal.append('model_turn', {
            model,
            bodyProfile: candidate.bodyProfile,
            observation: candidate.observation,
            call: decision.call,
            disposition: decision.disposition,
          });
          return decision;
        } catch (error) {
          if (String(error?.message || '').includes('unexpectedly succeeded')) throw error;
          const terminal = error?.call?.response?.terminal || 'controller_error';
          journal.append('resident_decision_opportunity', {
            protocol: 'behold.resident-decision-opportunity.v1',
            opportunityId,
            phase: 'terminal',
            terminal,
            call: error?.call || null,
          });
          journal.append('model_call_failed', {
            marker,
            terminal,
            error: error?.stack || String(error),
            call: error?.call || null,
          });
          if (terminal !== expected) {
            throw new Error(marker + ' terminal ' + terminal + ' did not equal ' + expected);
          }
          return null;
        }
      }

      function lifeTurn(sequence, release, decision) {
        const observation = projectedObservation(sequence);
        return {
          protocol: 'behold.entity-turn.v1',
          circleId: process.env.BEHOLD_WORLD_ID,
          id: entityId + ':turn:' + sequence,
          entityId,
          sequence,
          parentId: sequence === 1 ? null : entityId + ':turn:' + (sequence - 1),
          model,
          profiles: {
            policy: 'neutral-benchmark-v1',
            body: 'minecraft-human-semantic-v1',
            actions: 'minecraft-human-semantic-v1',
            safety: 'vanilla-player-v1',
          },
          experimentRelease: release,
          startedAt: 1000 + sequence * 10,
          completedAt: 1005 + sequence * 10,
          observation,
          utterance: { assistant: { role: 'assistant', content: null } },
          action: {
            id: entityId + ':wait:' + sequence,
            name: 'wait_for_event',
            input: decision?.action?.input || { reason: 'scripted provider-free integration' },
            source: 'llm',
            kind: 'yield',
            toolCallId: decision?.action?.callId || null,
          },
          outcome: {
            ok: true,
            eventType: 'wait_for_event',
            result: { status: 'waiting_for_world_event' },
          },
          nextObservation: projectedObservation(sequence + 1),
        };
      }

      async function foldAttempt(release, marker, expectedKind) {
        const turns = Array.from({ length: 4 }, (_, index) =>
          lifeTurn(index + 1, release, null),
        );
        const context = createLoomContextView(turns, {
          entityId,
          model,
          recentTurns: 2,
          foldBatchTurns: 2,
          foldTriggerTurns: 1,
          projectionProfile: 'minecraft-human-semantic-v1',
          summarize: async () => {
            const response = await fetch(process.env.OPENROUTER_BASE_URL, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                authorization: 'Bearer ' + process.env.OPENROUTER_API_KEY,
                ...cognitionClientHeaders({
                  requestId: entityId + ':' + phase + ':fold_failure',
                  priority: 'auxiliary',
                  purpose: 'loom_fold',
                  urgentTriggerSequence: null,
                }),
              },
              body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: 'marker:' + marker }],
              }),
            });
            const text = await response.text();
            if (!response.ok) {
              journal.append('model_auxiliary_call_failed', {
                purpose: 'loom_fold',
                terminal: 'provider_error',
                status: response.status,
              });
              throw new Error('fixture fold provider ' + response.status + ': ' + text.slice(0, 80));
            }
            return text;
          },
          onContextIntervention: (event) => journal.append('context_intervention', event),
        });
        await context.prepare();
        const fold = context.view().fold;
        if (fold?.generation?.kind !== expectedKind) {
          throw new Error(marker + ' produced fold kind ' + fold?.generation?.kind);
        }
        journal.append('fixture_fold_result', fold);
      }

      async function runScenario() {
        loom = await openEntityLoom(entityId, undefined, process.env.BEHOLD_WORLD_ID);
        const gate = experimentReleaseGateFromEnvironment({
          entityId,
          bodyUsername: process.env.MINECRAFT_USERNAME,
          model,
          urgentModel: arg('--urgentModel'),
          mind: process.env.BEHOLD_MIND,
          profiles: {
            policy: process.env.BEHOLD_POLICY_PROFILE,
            body: process.env.BEHOLD_BODY_PROFILE,
            actions: process.env.BEHOLD_ACTION_PROFILE,
            safety: process.env.BEHOLD_SAFETY_PROFILE,
          },
          quotaAccountId: process.env.BEHOLD_COGNITION_ACCOUNT_ID,
        });
        const setupObservation = projectedObservation(loom.turns().length + 1);
        const arm = gate.arm({ journalFile: journal.file, setupObservation });
        journal.append('setup_experiment_release_armed', arm);
        console.error('[bot] Experiment release armed: ' + gate.prepared.plan.releaseId + ' ' + entityId);
        const release = await gate.waitAndClaim();
        journal.append('experiment_release_observed', release);
        const expectedPrior = phase === 'restart' ? 1 : 0;
        if (loom.turns().length !== expectedPrior) {
          throw new Error('expected ' + expectedPrior + ' prior Lync turns, found ' + loom.turns().length);
        }
        journal.append('fixture_prior_history', { phase, turns: loom.turns().length });
        const mind = createDirectResidentMind({
          apiKey: process.env.OPENROUTER_API_KEY,
          model,
          endpoint: process.env.OPENROUTER_BASE_URL,
          cognitionTransport: true,
        });
        const sequence = loom.turns().length + 1;
        const valid = await oneDecision(
          mind,
          phase === 'restart' ? 'valid_restart' : 'valid_initial',
          release,
          sequence,
          'success',
        );
        await loom.append(lifeTurn(sequence, release, valid));
        journal.append('entity_turn', loom.turns().at(-1));
        if (phase === 'initial' && entityId === 'Scout') {
          await oneDecision(mind, 'provider_failure', release, sequence + 1, 'provider_error');
          const cancellation = new AbortController();
          const pending = oneDecision(
            mind,
            'cancel_me',
            release,
            sequence + 1,
            'cancelled',
            cancellation.signal,
          );
          const ready = process.env.BEHOLD_FIXTURE_CANCEL_READY_FILE;
          const deadline = Date.now() + 2000;
          while (!fs.existsSync(ready) && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
          if (!fs.existsSync(ready)) throw new Error('cancellation upstream was never admitted');
          cancellation.abort(new Error('fixture resident cancelled its request'));
          await pending;
          await foldAttempt(release, 'fold_success', 'model');
        }
        if (phase === 'initial' && entityId === 'Builder') {
          await oneDecision(mind, 'malformed_output', release, sequence + 1, 'malformed_output');
          await oneDecision(mind, 'provider_failure', release, sequence + 1, 'provider_error');
          await foldAttempt(release, 'fold_failure', 'fallback');
        }
        journal.append('fixture_scenario_complete', {
          phase,
          entityId,
          bodyProfile: process.env.BEHOLD_BODY_PROFILE,
          lyncTurns: loom.turns().length,
        });
      }

      scenario = runScenario().catch((error) => {
        journal.append('fixture_scenario_failed', { error: error?.stack || String(error) });
        console.error(error?.stack || String(error));
        process.exitCode = 1;
      });
      process.stdin.resume();
      process.stdin.on('end', async () => {
        await scenario;
        if (loom) await loom.close();
        process.exit(process.exitCode || 0);
      });
    `,
  );

  let serverPid: number | null = null;
  let serverAlive = false;
  const spawnServer = () => {
    const child = spawn(
      process.execPath,
      [
        '-e',
        `
          const readline = require('node:readline');
          console.log('[Server thread/INFO]: Done (0.1s)! For help, type "help"');
          const rl = readline.createInterface({ input: process.stdin });
          rl.on('line', (line) => {
            if (line === 'tick freeze') console.log('[Server thread/INFO]: The game is frozen');
            if (line === 'tick unfreeze') console.log('[Server thread/INFO]: The game is running normally');
            if (line === 'save-all flush') console.log('[Server thread/INFO]: Saved the game');
            if (line === 'stop') process.exit(0);
          });
        `,
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    ) as ChildProcessWithoutNullStreams;
    serverPid = child.pid!;
    serverAlive = true;
    child.once('exit', () => {
      serverAlive = false;
    });
    return child;
  };

  const upstreamAttempts: Array<{ marker: string; model: string }> = [];
  const cognitionFetch: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body || '{}'));
    const text = JSON.stringify(body);
    const marker =
      [
        'provider_failure',
        'malformed_output',
        'cancel_me',
        'fold_failure',
        'fold_success',
        'valid_restart',
      ].find((candidate) => text.includes(`marker:${candidate}`)) ?? 'valid_initial';
    upstreamAttempts.push({ marker, model: String(body.model) });
    if (marker === 'provider_failure' || marker === 'fold_failure') {
      return new Response(JSON.stringify({ error: { code: marker } }), {
        status: marker === 'provider_failure' ? 503 : 502,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (marker === 'malformed_output') {
      return new Response('not-provider-json', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (marker === 'cancel_me') {
      fs.writeFileSync(cancellationReadyFile, 'ready');
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(init.signal?.reason ?? new Error('fixture upstream cancelled')),
          { once: true },
        );
      });
    }
    return new Response(
      JSON.stringify({
        id: `fixture-${marker}-${body.model}`,
        model: body.model,
        provider: 'provider-free-fixture',
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: `wait-${marker}`,
                  type: 'function',
                  function: {
                    name: 'wait_for_event',
                    arguments: '{"reason":"provider-free integration"}',
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16, cost: 0 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  const priorKey = process.env.OPENROUTER_API_KEY;
  const priorBase = process.env.OPENROUTER_BASE_URL;
  process.env.OPENROUTER_API_KEY = 'provider-free-fixture-key';
  process.env.OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';
  t.after(() => {
    restoreTestEnvironment('OPENROUTER_API_KEY', priorKey);
    restoreTestEnvironment('OPENROUTER_BASE_URL', priorBase);
  });

  const accountingScopeId = 'provider-free-integration-v1';
  const residents = (phase: 'initial' | 'restart') => [
    {
      entityId: 'Scout',
      bodyUsername: 'ScoutBody',
      model: 'fixture/free-alpha',
      mind: 'direct' as const,
      policyProfile: 'neutral-benchmark-v1' as const,
      bodyProfile: 'minecraft-human-semantic-v1' as const,
      actionProfile: 'minecraft-human-semantic-v1' as const,
      safetyProfile: 'vanilla-player-v1' as const,
      maxTurnSteps: 1,
      resumeAfterBudget: false,
      providerQuotas: { residentDecisionAttempts: 5, auxiliaryContextAttempts: 2 },
      environment: {
        BEHOLD_FIXTURE_PHASE: phase,
        BEHOLD_FIXTURE_CANCEL_READY_FILE: cancellationReadyFile,
      },
    },
    {
      entityId: 'Builder',
      bodyUsername: 'BuilderBody',
      model: 'fixture/free-beta',
      mind: 'direct' as const,
      policyProfile: 'neutral-benchmark-v1' as const,
      bodyProfile: 'minecraft-human-semantic-v1' as const,
      actionProfile: 'minecraft-human-semantic-v1' as const,
      safetyProfile: 'vanilla-player-v1' as const,
      maxTurnSteps: 1,
      resumeAfterBudget: false,
      providerQuotas: { residentDecisionAttempts: 5, auxiliaryContextAttempts: 2 },
      environment: {
        BEHOLD_FIXTURE_PHASE: phase,
        BEHOLD_FIXTURE_CANCEL_READY_FILE: cancellationReadyFile,
      },
    },
  ];
  const dependencies = {
    spawnServer,
    cognitionFetch,
    verifyArtifacts: async () => ARTIFACTS_OK,
    inspectRuntime: async () => runtimeEvidence(serverAlive && serverPid ? serverPid : null),
    stdout: () => {},
    stderr: () => {},
  };
  const optionsFor = (phase: 'initial' | 'restart') => ({
    ...fixture.options,
    controllerEntry,
    accountingScopeId,
    maxConcurrentModelCalls: 2,
    residents: residents(phase),
  });
  const startIntegrationRun = async (phase: 'initial' | 'restart') => {
    try {
      return fixture.trackRun(await startManagedWorld(optionsFor(phase), dependencies));
    } catch (error) {
      const diagnosticDirectory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'behold-provider-free-start-failure-'),
      );
      fs.cpSync(fixture.root, path.join(diagnosticDirectory, 'fixture'), { recursive: true });
      t.diagnostic(`provider-free startup evidence: ${diagnosticDirectory}`);
      throw error;
    }
  };
  const residentEvents = (directory: string) =>
    fs
      .readdirSync(directory)
      .filter((name) => name.endsWith('.jsonl'))
      .flatMap((name) =>
        fs
          .readFileSync(path.join(directory, name), 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line)),
      );
  const scenariosComplete = (run: Awaited<ReturnType<typeof startManagedWorld>>) =>
    run.residents.every(
      (resident) =>
        fs.existsSync(resident.journalDirectory) &&
        residentEvents(resident.journalDirectory).some(
          (event) => event.type === 'fixture_scenario_complete',
        ),
    );

  const first = await startIntegrationRun('initial');
  await waitFor(() => scenariosComplete(first), 5_000);
  const firstJournals = Object.fromEntries(
    first.residents.map((resident) => [
      resident.entityId,
      residentEvents(resident.journalDirectory),
    ]),
  ) as Record<string, any[]>;
  assert.deepEqual(
    firstJournals.Scout.filter(
      (event) => event.type === 'resident_decision_opportunity' && event.data.phase === 'terminal',
    ).map((event) => event.data.terminal),
    ['success', 'provider_error', 'cancelled'],
  );
  assert.deepEqual(
    firstJournals.Builder.filter(
      (event) => event.type === 'resident_decision_opportunity' && event.data.phase === 'terminal',
    ).map((event) => event.data.terminal),
    ['success', 'malformed_output', 'provider_error'],
  );
  assert.equal(
    firstJournals.Builder.filter((event) => event.type === 'context_intervention').length,
    1,
  );
  assert.equal(
    firstJournals.Scout.filter((event) => event.type === 'context_intervention').length,
    0,
  );
  assert.equal(
    firstJournals.Scout.find((event) => event.type === 'fixture_fold_result').data.generation.kind,
    'model',
  );
  assert.equal(
    firstJournals.Builder.find((event) => event.type === 'fixture_fold_result').data.generation
      .kind,
    'fallback',
  );
  assert.equal(firstJournals.Scout.filter((event) => event.type === 'model_turn').length, 1);
  assert.equal(firstJournals.Builder.filter((event) => event.type === 'model_turn').length, 1);
  const firstAccounts = first.cognition!.accountingSnapshot()!.accounts;
  const firstScout = firstAccounts.find(
    (account) => account.accountId === cognitionAccountId(accountingScopeId, 'fixture', 'Scout'),
  )!;
  const firstBuilder = firstAccounts.find(
    (account) => account.accountId === cognitionAccountId(accountingScopeId, 'fixture', 'Builder'),
  )!;
  assert.deepEqual(firstScout.used, { loom_fold: 1, resident_decision: 3 });
  assert.deepEqual(firstBuilder.used, { loom_fold: 1, resident_decision: 3 });
  await first.stop('provider_free_initial_complete');
  await first.finished;
  const firstBroker = verifyCognitionBrokerJournal(first.cognition!.journalFile);
  const firstCapture = verifyCognitionTransportCapture(
    first.cognition!.transportCaptureDirectory,
    firstBroker.events,
  );
  assert.equal(firstCapture.attempts, 8);
  assert.equal(firstCapture.successfulResponses, 4);
  assert.equal(firstCapture.providerFailures, 3);
  assert.equal(firstCapture.cancellations, 1);
  assert.equal(firstCapture.transportErrors, 0);
  assert.deepEqual(firstCapture.usage.cost, { value: 0, reports: 3 });
  const capturedRequests = firstCapture.starts.map((start) =>
    fs.readFileSync(start.request.file, 'utf8'),
  );
  assert.ok(capturedRequests.every((body) => !body.includes('absolute-coordinate-secret')));
  assert.ok(capturedRequests.every((body) => !body.includes('forbidden-injected-project')));
  assert.ok(capturedRequests.every((body) => !body.includes('hidden-stable-body-id')));
  assert.ok(
    firstCapture.starts
      .filter((start) => start.purpose === 'resident_decision')
      .every((start) =>
        fs
          .readFileSync(start.request.file, 'utf8')
          .includes('behold.minecraft-human-semantic-observation.v1'),
      ),
  );

  if (fs.existsSync(cancellationReadyFile)) fs.unlinkSync(cancellationReadyFile);
  const second = await startIntegrationRun('restart');
  await waitFor(() => scenariosComplete(second), 5_000);
  const secondJournals = Object.fromEntries(
    second.residents.map((resident) => [
      resident.entityId,
      residentEvents(resident.journalDirectory),
    ]),
  ) as Record<string, any[]>;
  assert.ok(
    Object.values(secondJournals).every(
      (events) => events.find((event) => event.type === 'fixture_prior_history')?.data.turns === 1,
    ),
  );
  const secondAccounts = second.cognition!.accountingSnapshot()!.accounts;
  const secondScout = secondAccounts.find(
    (account) => account.accountId === cognitionAccountId(accountingScopeId, 'fixture', 'Scout'),
  )!;
  const secondBuilder = secondAccounts.find(
    (account) => account.accountId === cognitionAccountId(accountingScopeId, 'fixture', 'Builder'),
  )!;
  assert.deepEqual(secondScout.used, { loom_fold: 1, resident_decision: 4 });
  assert.deepEqual(secondBuilder.used, { loom_fold: 1, resident_decision: 4 });
  await second.stop('provider_free_restart_complete');
  await second.finished;
  const secondBroker = verifyCognitionBrokerJournal(second.cognition!.journalFile);
  const secondCapture = verifyCognitionTransportCapture(
    second.cognition!.transportCaptureDirectory,
    secondBroker.events,
  );
  assert.equal(secondCapture.attempts, 2);
  assert.equal(secondCapture.successfulResponses, 2);
  assert.equal(secondCapture.providerFailures, 0);

  const readableHistories: Record<string, string[]> = {};
  for (const entityId of ['Scout', 'Builder']) {
    const range = await resolveEntityLifeRange(entityId, 1, 2, fixture.options.entityRoot);
    const life = await readEntityLifeRange(range, fixture.options.entityRoot);
    readableHistories[entityId] = life.turns.map(
      (turn) =>
        `${turn.entityId} t${turn.sequence}: ${turn.action.name} -> ${turn.outcome.eventType}`,
    );
    assert.deepEqual(readableHistories[entityId], [
      `${entityId} t1: wait_for_event -> wait_for_event`,
      `${entityId} t2: wait_for_event -> wait_for_event`,
    ]);
    assert.notEqual(
      life.turns[0].experimentRelease?.releaseId,
      life.turns[1].experimentRelease?.releaseId,
    );
  }
  assert.equal(upstreamAttempts.length, 10);
  assert.deepEqual(
    new Set(upstreamAttempts.map((attempt) => attempt.model)),
    new Set(['fixture/free-alpha', 'fixture/free-beta']),
  );
  assert.equal(
    upstreamAttempts.every((attempt) => attempt.model.startsWith('fixture/free-')),
    true,
  );
  const cleanup = await fixture.cleanupManagedRuns();
  assert.equal(cleanup.intervened, false);
  assert.deepEqual(cleanup.cleanupErrors, []);
  assert.deepEqual(cleanup.openRootDescriptorsAfter, []);
});

test('recovery preserves evidence before releasing an exact dead same-host epoch', async (t) => {
  const fixture = makeFixture(t);
  const entityRoot = path.dirname(path.dirname(fixture.lease));
  const builderLease = path.join(entityRoot, 'Builder', 'runtime.lock');
  fs.mkdirSync(path.dirname(builderLease), { recursive: true });
  fs.writeFileSync(
    path.join(path.dirname(fixture.lease), 'circle.json'),
    JSON.stringify({
      protocol: 'behold.entity-circle-binding.v1',
      entityId: 'Scout',
      circleId: 'fixture',
    }),
  );
  fs.writeFileSync(
    path.join(path.dirname(builderLease), 'circle.json'),
    JSON.stringify({
      protocol: 'behold.entity-circle-binding.v1',
      entityId: 'Builder',
      circleId: 'fixture',
    }),
  );
  const worldControlModule = path.resolve(__dirname, '../src/runtime/world-control.js');
  const abandoned = spawnSync(
    process.execPath,
    [
      '-e',
      `
        const fs = require('node:fs');
        const os = require('node:os');
        const { acquireWorldControl } = require(process.argv[1]);
        const controlRoot = process.argv[2];
        const runtime = process.argv[3];
        const scoutLease = process.argv[4];
        const builderLease = process.argv[5];
        const control = acquireWorldControl({
          controlRoot, world: 'fixture', runtimePath: runtime,
          pid: process.pid, hostname: os.hostname()
        });
        fs.writeFileSync(scoutLease, JSON.stringify({
          protocol: 'behold.entity-runtime-lease.v1', entityId: 'Scout',
          pid: process.pid, hostname: os.hostname(), managedRunId: 'fixture-1',
          startedAt: Date.now(), token: 'fixture-token'
        }));
        fs.writeFileSync(builderLease, JSON.stringify({
          protocol: 'behold.entity-runtime-lease.v1', entityId: 'Builder',
          pid: process.pid, hostname: os.hostname(), managedRunId: 'fixture-1',
          startedAt: Date.now(), token: 'builder-token'
        }));
        control.update('starting', {
          server: { pid: process.pid, jarSha256: 'abc' },
          controllers: [
            { entityId: 'Scout', pid: process.pid, leasePath: scoutLease },
            { entityId: 'Builder', pid: process.pid, leasePath: builderLease }
          ]
        });
        control.update('recovery_required');
      `,
      worldControlModule,
      fixture.controlRoot,
      fixture.options.world.runtime.worldPath,
      fixture.lease,
      builderLease,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(abandoned.status, 0, abandoned.stderr);
  const held = inspectWorldControl(fixture.controlRoot, 'fixture');
  assert.equal(held.state, 'held');
  assert.equal(held.state === 'held' ? held.record.state : null, 'recovery_required');
  const lifecycleFile = path.join(fixture.controlRoot, 'fixture', 'lifecycle-1.jsonl');
  const lifecycleTip = verifyWorldLifecycleJournal(lifecycleFile).tipDigest;

  let clock = 0;
  const recovered = await recoverAbandonedManagedWorld(
    {
      worldId: 'fixture',
      world: fixture.options.world,
      controlRoot: fixture.controlRoot,
      entityRoot,
    },
    {
      inspectRuntime: async () => runtimeEvidence(null),
      now: () => new Date(++clock * 1000),
    },
  );

  assert.equal(recovered.classification, 'abandoned_unclean_shutdown');
  assert.equal(inspectWorldControl(fixture.controlRoot, 'fixture').state, 'clear');
  assert.equal(fs.existsSync(fixture.lease), false);
  assert.equal(fs.existsSync(builderLease), false);
  assert.equal(fs.existsSync(recovered.preparedEvidence), true);
  assert.equal(fs.existsSync(recovered.completedEvidence), true);
  const prepared = JSON.parse(fs.readFileSync(recovered.preparedEvidence, 'utf8'));
  const completed = JSON.parse(fs.readFileSync(recovered.completedEvidence, 'utf8'));
  assert.equal(prepared.lifecycle.tipDigest, lifecycleTip);
  assert.equal(prepared.lifecycle.saveAcknowledged, false);
  assert.equal(prepared.controllerLeases.length, 2);
  assert.deepEqual(prepared.controllerLeases.map((lease: any) => lease.record.entityId).sort(), [
    'Builder',
    'Scout',
  ]);
  assert.ok(
    prepared.controllerLeases.every((lease: any) => lease.record.managedRunId === 'fixture-1'),
  );
  assert.equal(completed.preparedSha256.length, 64);
  assert.equal(verifyWorldLifecycleJournal(lifecycleFile).tipDigest, lifecycleTip);

  const next = acquireWorldControl({
    controlRoot: fixture.controlRoot,
    world: 'fixture',
    runtimePath: fixture.options.world.runtime.worldPath,
  });
  assert.equal(next.record().epoch, 2);
  next.release();
});

test('managed world runner owns conjunctive readiness, distinct leases, drain, save, and stop for two residents', async (t) => {
  const fixture = makeFixture(t);
  const builderLease = path.join(fixture.options.entityRoot, 'Builder', 'runtime.lock');
  const options = {
    ...fixture.options,
    residentStartupDelayMs: 1,
    residents: [
      ...fixture.options.residents,
      {
        entityId: 'Builder',
        model: 'fixture/alternate-model',
        mind: 'ax' as const,
        tickMs: 1500,
      },
    ],
  };
  const commandLog = path.join(fixture.root, 'server-commands.log');
  let serverPid: number | null = null;
  let serverAlive = false;

  const spawnServer = () => {
    const script = `
      const fs = require('node:fs');
      const readline = require('node:readline');
      const log = process.argv[1];
      console.log('[Server thread/INFO]: Done (0.1s)! For help, type "help"');
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', (line) => {
        fs.appendFileSync(log, line + '\\n');
        if (line === 'save-all flush') console.log('[Server thread/INFO]: Saved the game');
        if (line === 'stop') process.exit(0);
      });
    `;
    const child = spawn(process.execPath, ['-e', script, commandLog], {
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;
    serverPid = child.pid!;
    serverAlive = true;
    child.once('exit', () => {
      serverAlive = false;
    });
    return child;
  };
  const spawnController = ({ runId, resident, leasePath }: any) => {
    const script = `
      const fs = require('node:fs');
      const os = require('node:os');
      const lease = process.argv[1];
      const entityId = process.argv[2];
      const managedRunId = process.argv[3];
      fs.mkdirSync(require('node:path').dirname(lease), { recursive: true });
      fs.writeFileSync(lease, JSON.stringify({
        protocol: 'behold.entity-runtime-lease.v1',
        entityId,
        pid: process.pid,
        hostname: os.hostname(),
        managedRunId,
      }));
      console.log('[bot] Local world loaded.');
      process.stdin.resume();
      process.stdin.on('end', () => {
        fs.unlinkSync(lease);
        process.exit(0);
      });
    `;
    return spawn(process.execPath, ['-e', script, leasePath, resident.entityId, runId], {
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;
  };

  const run = fixture.trackRun(
    await startManagedWorld(options, {
      spawnServer,
      spawnController,
      verifyArtifacts: async () => ARTIFACTS_OK,
      inspectRuntime: async () => runtimeEvidence(serverAlive && serverPid ? serverPid : null),
      stdout: () => {},
      stderr: () => {},
    }),
  );
  assert.equal(inspectWorldControl(fixture.controlRoot, 'fixture').state, 'held');
  assert.equal(run.runId, 'fixture-1');
  assert.equal(fs.existsSync(fixture.lease), true);
  assert.equal(fs.existsSync(builderLease), true);
  assert.equal(run.control.record().state, 'running');
  assert.deepEqual(
    run.residents.map((resident) => resident.entityId),
    ['Scout', 'Builder'],
  );
  assert.equal(new Set(run.residents.map((resident) => resident.leasePath)).size, 2);
  assert.equal(new Set(run.residents.map((resident) => resident.journalDirectory)).size, 2);
  assert.equal(run.control.record().controllers.length, 2);

  await run.quiesceResidents('fixture_witness');
  assert.equal(fs.existsSync(fixture.lease), false);
  assert.equal(fs.existsSync(builderLease), false);
  assert.equal(run.control.record().state, 'running');
  assert.deepEqual(run.control.record().controllers, []);
  assert.equal(serverAlive, true);

  await run.stop('fixture_complete');
  await run.finished;

  assert.equal(inspectWorldControl(fixture.controlRoot, 'fixture').state, 'clear');
  assert.equal(fs.existsSync(fixture.lease), false);
  assert.equal(fs.existsSync(builderLease), false);
  assert.deepEqual(fs.readFileSync(commandLog, 'utf8').trim().split('\n'), [
    'save-all flush',
    'stop',
  ]);
  const events = fs
    .readFileSync(run.control.journalFile, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.ok(events.some((event) => event.type === 'server_ready'));
  assert.ok(events.some((event) => event.type === 'run_ready'));
  assert.equal(events.filter((event) => event.type === 'controller_ready').length, 2);
  assert.deepEqual(events.find((event) => event.type === 'resident_start_stagger')?.data, {
    afterEntityId: 'Scout',
    beforeEntityId: 'Builder',
    milliseconds: 1,
  });
  assert.ok(events.some((event) => event.type === 'residents_quiesced'));
  assert.ok(events.some((event) => event.type === 'server_save_acknowledged'));
  assert.ok(events.some((event) => event.type === 'run_stopped'));
  assert.equal(events.at(-1).type, 'control_released');
});

test('held lifecycle authority executes the canonical reset and rebinds the runtime inode', async (t) => {
  const fixture = makeManagedResetFixture(t);
  const beforeInode = fs.statSync(fixture.runtime).ino;
  const control = acquireWorldControl({
    controlRoot: fixture.controlRoot,
    world: 'fixture',
    runtimePath: fixture.runtime,
  });
  const clear = async (): Promise<OwnershipEvidence> => ({ ...CLEAR });

  const result = await resetHeldManagedWorldFixture(
    {
      worldId: 'fixture',
      world: fixture.world,
      control,
      resetRunId: 'managed-reset-one',
      entityRoot: fixture.entityRoot,
    },
    {
      probeSessionLock: clear,
      probeListeningPort: clear,
      fixtureExecutionCapability: fixture.fixtureCapability,
    },
  );

  assert.equal(result.mode, 'executed');
  assert.equal(control.record().state, 'stopped_verified');
  assert.equal(control.record().runtime.inode, fs.statSync(fixture.runtime).ino);
  assert.notEqual(control.record().runtime.inode, beforeInode);
  assert.equal(digestTree(fixture.runtime).digest, fixture.world.preparedBaseline?.expectedDigest);
  assert.equal(fs.readFileSync(path.join(fixture.runtime, 'level.dat'), 'utf8'), 'prepared');
  assert.equal(
    fs.readFileSync(path.join(result.archivePath!, 'old-run.txt'), 'utf8'),
    'persistent consequence',
  );
  const firstActivatedInode = control.record().runtime.inode;
  control.release();
  const secondControl = acquireWorldControl({
    controlRoot: fixture.controlRoot,
    world: 'fixture',
    runtimePath: fixture.runtime,
  });
  assert.equal(secondControl.record().epoch, 2);
  const second = await resetHeldManagedWorldFixture(
    {
      worldId: 'fixture',
      world: fixture.world,
      control: secondControl,
      resetRunId: 'managed-reset-two',
      entityRoot: fixture.entityRoot,
    },
    {
      probeSessionLock: clear,
      probeListeningPort: clear,
      fixtureExecutionCapability: fixture.fixtureCapability,
    },
  );
  assert.equal(second.mode, 'executed');
  assert.equal(secondControl.record().state, 'stopped_verified');
  assert.notEqual(secondControl.record().runtime.inode, firstActivatedInode);
  assert.equal(digestTree(fixture.runtime).digest, fixture.world.preparedBaseline?.expectedDigest);
  secondControl.release();
  assert.equal(inspectWorldControl(fixture.controlRoot, 'fixture').state, 'clear');
});

test('a controller lease appearing during staging fences activation and requires recovery', async (t) => {
  const fixture = makeManagedResetFixture(t);
  const control = acquireWorldControl({
    controlRoot: fixture.controlRoot,
    world: 'fixture',
    runtimePath: fixture.runtime,
  });
  const clear = async (): Promise<OwnershipEvidence> => ({ ...CLEAR });

  await assert.rejects(
    () =>
      resetHeldManagedWorldFixture(
        {
          worldId: 'fixture',
          world: fixture.world,
          control,
          resetRunId: 'lease-race',
          entityRoot: fixture.entityRoot,
        },
        {
          probeSessionLock: clear,
          probeListeningPort: clear,
          mutationOperations: {
            copyDirectory(from, to) {
              fs.cpSync(from, to, { recursive: true, force: false, errorOnExist: true });
              const entityDirectory = path.join(fixture.entityRoot, 'Scout');
              fs.mkdirSync(entityDirectory, { recursive: true });
              fs.writeFileSync(
                path.join(entityDirectory, 'circle.json'),
                JSON.stringify({
                  protocol: 'behold.entity-circle-binding.v1',
                  entityId: 'Scout',
                  circleId: 'minecraft://127.0.0.1:25598',
                }),
              );
              fs.writeFileSync(
                path.join(entityDirectory, 'runtime.lock'),
                JSON.stringify({
                  protocol: 'behold.entity-runtime-lease.v1',
                  entityId: 'Scout',
                  pid: 77,
                }),
              );
            },
          },
          fixtureExecutionCapability: fixture.fixtureCapability,
        },
      ),
    /Baseline activation failed/,
  );

  assert.equal(control.record().state, 'recovery_required');
  assert.equal(
    fs.readFileSync(path.join(fixture.runtime, 'old-run.txt'), 'utf8'),
    'persistent consequence',
  );
  assert.throws(() => control.release(), /cannot release/);
});

test('managed world runner refuses foreign ownership before spawning or taking control', async (t) => {
  const fixture = makeFixture(t);
  let spawns = 0;
  await assert.rejects(
    () =>
      startManagedWorld(fixture.options, {
        inspectRuntime: async () => runtimeEvidence(999),
        verifyArtifacts: async () => ARTIFACTS_OK,
        spawnServer: () => {
          spawns += 1;
          throw new Error('must not spawn');
        },
      }),
    (error: any) => {
      assert.ok(error instanceof WorldRunnerError);
      assert.equal(error.code, 'world_not_stopped');
      return true;
    },
  );
  assert.equal(spawns, 0);
  assert.equal(inspectWorldControl(fixture.controlRoot, 'fixture').state, 'clear');
});

test('managed world runner refuses an existing controller lease bound to the world', async (t) => {
  const fixture = makeFixture(t);
  const entityDirectory = path.join(path.dirname(path.dirname(fixture.lease)), 'Other');
  fs.mkdirSync(entityDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(entityDirectory, 'circle.json'),
    JSON.stringify({
      protocol: 'behold.entity-circle-binding.v1',
      entityId: 'Other',
      circleId: 'fixture',
    }),
  );
  fs.writeFileSync(
    path.join(entityDirectory, 'runtime.lock'),
    JSON.stringify({ protocol: 'behold.entity-runtime-lease.v1', entityId: 'Other', pid: 99 }),
  );
  let spawns = 0;
  await assert.rejects(
    () =>
      startManagedWorld(fixture.options, {
        inspectRuntime: async () => runtimeEvidence(null),
        verifyArtifacts: async () => ARTIFACTS_OK,
        spawnServer: () => {
          spawns += 1;
          throw new Error('must not spawn');
        },
      }),
    (error: any) => {
      assert.equal(error.code, 'world_controller_lease_not_clear');
      return true;
    },
  );
  assert.equal(spawns, 0);
  assert.equal(inspectWorldControl(fixture.controlRoot, 'fixture').state, 'clear');
});

test('managed world runner directly refuses its configured lease even with another circle binding', async (t) => {
  const fixture = makeFixture(t);
  const entityDirectory = path.dirname(fixture.lease);
  fs.writeFileSync(
    path.join(entityDirectory, 'circle.json'),
    JSON.stringify({
      protocol: 'behold.entity-circle-binding.v1',
      entityId: 'Scout',
      circleId: 'another-world',
    }),
  );
  fs.writeFileSync(
    fixture.lease,
    JSON.stringify({ protocol: 'behold.entity-runtime-lease.v1', entityId: 'Scout', pid: 100 }),
  );
  await assert.rejects(
    () =>
      startManagedWorld(fixture.options, {
        inspectRuntime: async () => runtimeEvidence(null),
        verifyArtifacts: async () => ARTIFACTS_OK,
      }),
    (error: any) => {
      assert.equal(error.code, 'configured_controller_lease_present');
      return true;
    },
  );
  assert.equal(inspectWorldControl(fixture.controlRoot, 'fixture').state, 'clear');
});

test('managed world runner verifies the pinned server jar before acquiring authority', async (t) => {
  const fixture = makeFixture(t);
  await assert.rejects(
    () =>
      startManagedWorld(
        { ...fixture.options, expectedServerJarSha256: '0'.repeat(64) },
        {
          inspectRuntime: async () => runtimeEvidence(null),
          verifyArtifacts: async () => ARTIFACTS_OK,
        },
      ),
    (error: any) => {
      assert.equal(error.code, 'server_jar_digest_mismatch');
      return true;
    },
  );
  assert.equal(inspectWorldControl(fixture.controlRoot, 'fixture').state, 'clear');
});

test('managed world runner refuses unverified source or baseline artifacts before control', async (t) => {
  const fixture = makeFixture(t);
  await assert.rejects(
    () =>
      startManagedWorld(fixture.options, {
        inspectRuntime: async () => runtimeEvidence(null),
        verifyArtifacts: async () => ({
          artifactIntegrityOk: false,
          artifacts: { preparedBaseline: { matches: false } },
        }),
      }),
    (error: any) => {
      assert.equal(error.code, 'world_artifact_integrity_failed');
      return true;
    },
  );
  assert.equal(inspectWorldControl(fixture.controlRoot, 'fixture').state, 'clear');
});

test('a failed readiness proof cleanly saves and stops the child it started', async (t) => {
  const fixture = makeFixture(t);
  const commandLog = path.join(fixture.root, 'failed-start-commands.log');
  const spawnServer = () => {
    const script = `
      const fs = require('node:fs');
      const readline = require('node:readline');
      const log = process.argv[1];
      console.log('[Server thread/INFO]: Done (0.1s)! For help, type "help"');
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', (line) => {
        fs.appendFileSync(log, line + '\\n');
        if (line === 'save-all flush') console.log('[Server thread/INFO]: Saved the game');
        if (line === 'stop') process.exit(0);
      });
    `;
    return spawn(process.execPath, ['-e', script, commandLog], {
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;
  };

  await assert.rejects(
    () =>
      startManagedWorld(
        { ...fixture.options, startupTimeoutMs: 150, shutdownTimeoutMs: 1000 },
        {
          spawnServer,
          verifyArtifacts: async () => ARTIFACTS_OK,
          inspectRuntime: async () => runtimeEvidence(null),
          stdout: () => {},
          stderr: () => {},
        },
      ),
    (error: any) => {
      assert.equal(error.code, 'runner_timeout');
      return true;
    },
  );

  assert.equal(inspectWorldControl(fixture.controlRoot, 'fixture').state, 'clear');
  assert.deepEqual(fs.readFileSync(commandLog, 'utf8').trim().split('\n'), [
    'save-all flush',
    'stop',
  ]);
});

test('an early child exit is recorded and releases control when OS evidence is clear', async (t) => {
  const fixture = makeFixture(t);
  await assert.rejects(
    () =>
      startManagedWorld(fixture.options, {
        spawnServer: () =>
          spawn(
            process.execPath,
            ['-e', "console.error('fixture boot failure'); process.exit(7)"],
            {
              stdio: ['pipe', 'pipe', 'pipe'],
            },
          ) as ChildProcessWithoutNullStreams,
        inspectRuntime: async () => runtimeEvidence(null),
        verifyArtifacts: async () => ARTIFACTS_OK,
        stdout: () => {},
        stderr: () => {},
      }),
    (error: any) => {
      assert.equal(error.code, 'child_exited_before_ready');
      assert.equal(error.evidence.code, 7);
      return true;
    },
  );
  assert.equal(inspectWorldControl(fixture.controlRoot, 'fixture').state, 'clear');
});

test('one resident exiting makes the shared epoch unhealthy and drains every remaining child', async (t) => {
  const fixture = makeFixture(t);
  let serverPid: number | null = null;
  let serverAlive = false;
  const spawnServer = () => {
    const script = `
      const readline = require('node:readline');
      console.log('[Server thread/INFO]: Done (0.1s)! For help, type "help"');
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', (line) => {
        if (line === 'save-all flush') console.log('[Server thread/INFO]: Saved the game');
        if (line === 'stop') process.exit(0);
      });
    `;
    const child = spawn(process.execPath, ['-e', script], {
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;
    serverPid = child.pid!;
    serverAlive = true;
    child.once('exit', () => {
      serverAlive = false;
    });
    return child;
  };
  const spawnController = ({ runId, resident, leasePath }: any) => {
    const script = `
      const fs = require('node:fs');
      const os = require('node:os');
      const path = require('node:path');
      const lease = process.argv[1];
      const entityId = process.argv[2];
      const managedRunId = process.argv[3];
      const fail = process.argv[4] === 'fail';
      fs.mkdirSync(path.dirname(lease), { recursive: true });
      fs.writeFileSync(lease, JSON.stringify({
        protocol: 'behold.entity-runtime-lease.v1', entityId,
        pid: process.pid, hostname: os.hostname(), managedRunId
      }));
      console.log('[bot] Local world loaded.');
      process.stdin.resume();
      process.stdin.on('end', () => {
        if (fs.existsSync(lease)) fs.unlinkSync(lease);
        process.exit(0);
      });
      if (fail) setTimeout(() => {
        if (fs.existsSync(lease)) fs.unlinkSync(lease);
        process.exit(7);
      }, 500);
    `;
    return spawn(
      process.execPath,
      [
        '-e',
        script,
        leasePath,
        resident.entityId,
        runId,
        resident.entityId === 'Builder' ? 'fail' : 'live',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    ) as ChildProcessWithoutNullStreams;
  };
  const run = fixture.trackRun(
    await startManagedWorld(
      {
        ...fixture.options,
        residents: [
          { entityId: 'Scout', model: 'fixture/model' },
          { entityId: 'Builder', model: 'fixture/model' },
        ],
      },
      {
        spawnServer,
        spawnController,
        verifyArtifacts: async () => ARTIFACTS_OK,
        inspectRuntime: async () => runtimeEvidence(serverAlive && serverPid ? serverPid : null),
        stdout: () => {},
        stderr: () => {},
      },
    ),
  );

  await assert.rejects(
    run.finished,
    (error: any) =>
      error?.code === 'managed_child_exited' && error?.evidence?.name === 'controller:Builder',
  );
  await assert.rejects(
    () => run.stop('resident_failed'),
    (error: any) =>
      error?.code === 'managed_child_exit_abnormal' &&
      error.evidence.some((exit: any) => exit.name === 'controller:Builder' && exit.code === 7),
  );
  assert.equal(serverAlive, false);
  assert.equal(fs.existsSync(fixture.lease), false);
  assert.equal(
    fs.existsSync(path.join(fixture.options.entityRoot, 'Builder', 'runtime.lock')),
    false,
  );
  const inspection = inspectWorldControl(fixture.controlRoot, 'fixture');
  assert.equal(inspection.state, 'held');
  assert.equal(inspection.state === 'held' ? inspection.record.state : null, 'recovery_required');
});

test('world ownership is never released while any resident lease remains', async (t) => {
  const fixture = makeFixture(t);
  let server: ChildProcessWithoutNullStreams | null = null;
  let serverAlive = false;
  const spawnServer = () => {
    const script = `
      const readline = require('node:readline');
      console.log('[Server thread/INFO]: Done (0.1s)! For help, type "help"');
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', (line) => {
        if (line === 'save-all flush') console.log('[Server thread/INFO]: Saved the game');
        if (line === 'stop') process.exit(0);
      });
    `;
    server = spawn(process.execPath, ['-e', script], {
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;
    serverAlive = true;
    server.once('exit', () => {
      serverAlive = false;
    });
    return server;
  };
  const spawnController = ({ runId, resident, leasePath }: any) => {
    const script = `
      const fs = require('node:fs');
      const os = require('node:os');
      const path = require('node:path');
      const lease = process.argv[1];
      const entityId = process.argv[2];
      const managedRunId = process.argv[3];
      const retain = process.argv[4] === 'retain';
      fs.mkdirSync(path.dirname(lease), { recursive: true });
      fs.writeFileSync(lease, JSON.stringify({
        protocol: 'behold.entity-runtime-lease.v1', entityId,
        pid: process.pid, hostname: os.hostname(), managedRunId
      }));
      console.log('[bot] Local world loaded.');
      process.stdin.resume();
      process.stdin.on('end', () => {
        if (!retain && fs.existsSync(lease)) fs.unlinkSync(lease);
        process.exit(0);
      });
    `;
    return spawn(
      process.execPath,
      [
        '-e',
        script,
        leasePath,
        resident.entityId,
        runId,
        resident.entityId === 'Builder' ? 'retain' : 'release',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    ) as ChildProcessWithoutNullStreams;
  };
  const run = fixture.trackRun(
    await startManagedWorld(
      {
        ...fixture.options,
        residents: [
          { entityId: 'Scout', model: 'fixture/model' },
          { entityId: 'Builder', model: 'fixture/model' },
        ],
        shutdownTimeoutMs: 200,
      },
      {
        spawnServer,
        spawnController,
        verifyArtifacts: async () => ARTIFACTS_OK,
        inspectRuntime: async () => runtimeEvidence(serverAlive && server?.pid ? server.pid : null),
        stdout: () => {},
        stderr: () => {},
      },
    ),
  );
  const retainedLease = path.join(fixture.options.entityRoot, 'Builder', 'runtime.lock');

  await assert.rejects(
    () => run.stop('retained_lease_fixture'),
    (error: any) =>
      error?.code === 'runner_timeout' && String(error?.evidence?.label).includes('Builder'),
  );
  assert.equal(inspectWorldControl(fixture.controlRoot, 'fixture').state, 'held');
  assert.equal(fs.existsSync(fixture.lease), false);
  assert.equal(fs.existsSync(retainedLease), true);

  if (server && server.exitCode === null && server.signalCode === null) {
    server.stdin.write('stop\n');
    server.stdin.end();
    await new Promise<void>((resolve) => server!.once('exit', () => resolve()));
  }
});

test('abnormal child exits can clear OS resources but never release successful control', async (t) => {
  const fixture = makeFixture(t);
  let serverPid: number | null = null;
  let serverAlive = false;
  const spawnServer = () => {
    const script = `
      const readline = require('node:readline');
      console.log('[Server thread/INFO]: Done (0.1s)! For help, type "help"');
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', (line) => {
        if (line === 'save-all flush') console.log('[Server thread/INFO]: Saved the game');
        if (line === 'stop') process.exit(9);
      });
    `;
    const child = spawn(process.execPath, ['-e', script], {
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;
    serverPid = child.pid!;
    serverAlive = true;
    child.once('exit', () => {
      serverAlive = false;
    });
    return child;
  };
  const spawnController = ({ runId, resident, leasePath }: any) => {
    const script = `
      const fs = require('node:fs');
      const os = require('node:os');
      const lease = process.argv[1];
      const entityId = process.argv[2];
      const managedRunId = process.argv[3];
      fs.writeFileSync(lease, JSON.stringify({
        protocol: 'behold.entity-runtime-lease.v1', entityId,
        pid: process.pid, hostname: os.hostname(), managedRunId
      }));
      console.log('[bot] Local world loaded.');
      process.stdin.resume();
      process.stdin.on('end', () => { fs.unlinkSync(lease); process.exit(7); });
    `;
    return spawn(process.execPath, ['-e', script, leasePath, resident.entityId, runId], {
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;
  };
  const run = fixture.trackRun(
    await startManagedWorld(fixture.options, {
      spawnServer,
      spawnController,
      verifyArtifacts: async () => ARTIFACTS_OK,
      inspectRuntime: async () => runtimeEvidence(serverAlive && serverPid ? serverPid : null),
      stdout: () => {},
      stderr: () => {},
    }),
  );

  await assert.rejects(
    () => run.stop('abnormal_fixture'),
    (error: any) => {
      assert.equal(error.code, 'managed_child_exit_abnormal');
      assert.deepEqual(error.evidence.map((exit: any) => exit.code).sort(), [7, 9]);
      return true;
    },
  );
  await run.finished;
  const inspection = inspectWorldControl(fixture.controlRoot, 'fixture');
  assert.equal(inspection.state, 'held');
  if (inspection.state === 'held') {
    assert.equal(inspection.record.state, 'recovery_required');
    assert.equal(inspection.record.server, null);
    assert.deepEqual(inspection.record.controllers, []);
  }
});

function makeFixture(t: test.TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-world-runner-'));
  const ownedRuns: Array<Awaited<ReturnType<typeof startManagedWorld>>> = [];
  let cleanupStarted = false;
  let cleanupPromise: Promise<ManagedFixtureCleanupEvidence> | null = null;
  const cleanupManagedRuns = () => {
    if (cleanupPromise) return cleanupPromise;
    cleanupStarted = true;
    cleanupPromise = cleanupOwnedManagedRuns(root, ownedRuns);
    return cleanupPromise;
  };
  // This is deliberately the first hook. It owns every successfully returned
  // managed run and closes those resources before the fixture tree disappears,
  // including when a later assertion throws.
  t.after(async () => {
    try {
      const cleanup = await cleanupManagedRuns();
      if (cleanup.diagnosticDirectory) {
        t.diagnostic(`managed fixture cleanup evidence: ${cleanup.diagnosticDirectory}`);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  const source = path.join(root, 'source');
  const baseline = path.join(root, 'baseline');
  const runtime = path.join(root, 'server', 'world');
  const archive = path.join(root, 'archive');
  const controlRoot = path.join(root, 'control');
  const entityRoot = path.join(root, 'entities');
  const runRoot = path.join(root, 'runs');
  const lease = path.join(entityRoot, 'Scout', 'runtime.lock');
  const jar = path.join(root, 'server', 'server.jar');
  for (const directory of [source, baseline, runtime, archive, path.dirname(lease)]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  fs.writeFileSync(jar, 'fixture server jar');
  const digest = createHash('sha256').update(fs.readFileSync(jar)).digest('hex');
  const world: WorldLabDefinition = {
    source: { path: source, digestProfile: 'behold-tree-v2', expectedDigest: '1'.repeat(64) },
    preparedBaseline: {
      path: baseline,
      digestProfile: 'behold-tree-v2',
      expectedDigest: '2'.repeat(64),
    },
    runtime: { worldPath: runtime, archiveRoot: archive },
    server: { host: '127.0.0.1', port: 25599 },
  };
  return {
    root,
    controlRoot,
    lease,
    trackRun<T extends Awaited<ReturnType<typeof startManagedWorld>>>(run: T) {
      if (cleanupStarted) throw new Error('cannot register a managed run after fixture cleanup');
      // Keep the original promise observable to the test while also preventing
      // an assertion path from creating an unhandled rejection before cleanup.
      void run.finished.catch(() => {});
      ownedRuns.push(run);
      return run;
    },
    cleanupManagedRuns,
    options: {
      worldId: 'fixture',
      world,
      controlRoot,
      serverDirectory: path.dirname(jar),
      serverJar: jar,
      expectedServerJarSha256: digest,
      java: process.execPath,
      controllerEntry: '/fixture/controller.js',
      entityRoot,
      runRoot,
      residents: [
        {
          entityId: 'Scout',
          model: 'fixture/model',
          task: 'come-see-do-report',
          target: 'human',
          allowTools: ['chat', 'approach_entity'],
        },
      ],
      startupTimeoutMs: 3000,
      shutdownTimeoutMs: 3000,
    },
  };
}

type ManagedFixtureCleanupEvidence = Readonly<{
  intervened: boolean;
  diagnosticDirectory: string | null;
  before: readonly ManagedFixtureRunEvidence[];
  after: readonly ManagedFixtureRunEvidence[];
  cleanupErrors: readonly string[];
  openRootDescriptorsAfter: readonly string[];
  listenersBefore: readonly string[];
  listenersAfter: readonly string[];
}>;

type ManagedFixtureRunEvidence = Readonly<{
  runId: string;
  control: ReturnType<typeof inspectWorldControl>;
  serverPid: number;
  residentPids: readonly number[];
  livePids: readonly number[];
  lifecycleFile: string;
  cognitionJournal: string | null;
}>;

async function cleanupOwnedManagedRuns(
  root: string,
  runs: readonly Awaited<ReturnType<typeof startManagedWorld>>[],
): Promise<ManagedFixtureCleanupEvidence> {
  const before = runs.map(managedFixtureRunEvidence);
  const listenersBefore = currentProcessListeners();
  const intervened = before.some(
    (entry) =>
      entry.livePids.length > 0 ||
      (entry.control.state === 'held' &&
        ['starting', 'running', 'stopping'].includes(entry.control.record.state)),
  );
  const cleanupErrors: string[] = [];
  for (const run of [...runs].reverse()) {
    const inspection = inspectWorldControl(path.join(root, 'control'), 'fixture');
    if (inspection.state === 'held' && ['starting', 'running'].includes(inspection.record.state)) {
      try {
        await fixtureTimeout(run.stop('test_fixture_unconditional_cleanup'), 10_000);
      } catch (error: any) {
        cleanupErrors.push(`stop ${run.runId}: ${error?.message || String(error)}`);
      }
    }
    for (const pid of [run.serverPid, ...run.residents.map((resident) => resident.pid)]) {
      if (!testPidAlive(pid)) continue;
      try {
        process.kill(pid, 'SIGTERM');
      } catch (error: any) {
        if (error?.code !== 'ESRCH') cleanupErrors.push(`SIGTERM ${pid}: ${error.message}`);
      }
    }
    await waitForTestPidsToExit(
      [run.serverPid, ...run.residents.map((resident) => resident.pid)],
      2_000,
    );
    for (const pid of [run.serverPid, ...run.residents.map((resident) => resident.pid)]) {
      if (!testPidAlive(pid)) continue;
      try {
        process.kill(pid, 'SIGKILL');
      } catch (error: any) {
        if (error?.code !== 'ESRCH') cleanupErrors.push(`SIGKILL ${pid}: ${error.message}`);
      }
    }
    await waitForTestPidsToExit(
      [run.serverPid, ...run.residents.map((resident) => resident.pid)],
      2_000,
    );
  }
  const after = runs.map(managedFixtureRunEvidence);
  const listenersAfter = currentProcessListeners();
  const openRootDescriptorsAfter = currentProcessOpenFiles().filter((line) => line.includes(root));
  let diagnosticDirectory: string | null = null;
  if (intervened || cleanupErrors.length > 0 || openRootDescriptorsAfter.length > 0) {
    diagnosticDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), `behold-world-runner-diagnostic-${path.basename(root)}-`),
    );
    for (const [index, run] of runs.entries()) {
      copyDiagnosticFile(
        run.control.journalFile,
        path.join(diagnosticDirectory, `lifecycle-${index}.jsonl`),
      );
      if (run.cognition?.journalFile) {
        copyDiagnosticFile(
          run.cognition.journalFile,
          path.join(diagnosticDirectory, `cognition-${index}.jsonl`),
        );
      }
      for (const resident of run.residents) {
        const destination = path.join(diagnosticDirectory, `residents-${index}`, resident.entityId);
        try {
          fs.cpSync(resident.journalDirectory, destination, { recursive: true });
        } catch (error: any) {
          fs.mkdirSync(destination, { recursive: true });
          fs.writeFileSync(
            path.join(destination, 'unavailable.txt'),
            `unavailable: ${error?.message || String(error)}\n`,
            'utf8',
          );
        }
      }
    }
    fs.writeFileSync(
      path.join(diagnosticDirectory, 'cleanup.json'),
      `${JSON.stringify(
        {
          protocol: 'behold.managed-fixture-cleanup.v1',
          root,
          intervened,
          before,
          after,
          cleanupErrors,
          openRootDescriptorsAfter,
          listenersBefore,
          listenersAfter,
        },
        null,
        2,
      )}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
  }
  return Object.freeze({
    intervened,
    diagnosticDirectory,
    before,
    after,
    cleanupErrors: Object.freeze(cleanupErrors),
    openRootDescriptorsAfter: Object.freeze(openRootDescriptorsAfter),
    listenersBefore: Object.freeze(listenersBefore),
    listenersAfter: Object.freeze(listenersAfter),
  });
}

function managedFixtureRunEvidence(
  run: Awaited<ReturnType<typeof startManagedWorld>>,
): ManagedFixtureRunEvidence {
  const pids = [run.serverPid, ...run.residents.map((resident) => resident.pid)];
  return Object.freeze({
    runId: run.runId,
    control: inspectWorldControl(path.dirname(path.dirname(run.control.file)), 'fixture'),
    serverPid: run.serverPid,
    residentPids: Object.freeze(run.residents.map((resident) => resident.pid)),
    livePids: Object.freeze(pids.filter(testPidAlive)),
    lifecycleFile: run.control.journalFile,
    cognitionJournal: run.cognition?.journalFile ?? null,
  });
}

function currentProcessOpenFiles() {
  const result = spawnSync('lsof', ['-nP', '-p', String(process.pid)], { encoding: 'utf8' });
  return result.status === 0 ? String(result.stdout).split(/\r?\n/) : [];
}

function currentProcessListeners() {
  return currentProcessOpenFiles().filter((line) => /TCP .*\(LISTEN\)$/.test(line));
}

function testPidAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return error?.code === 'EPERM';
  }
}

async function waitForTestPidsToExit(pids: readonly number[], timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (pids.some(testPidAlive) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for test condition');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function fixtureTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`fixture cleanup timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function copyDiagnosticFile(source: string, destination: string) {
  try {
    fs.copyFileSync(source, destination);
  } catch (error: any) {
    fs.writeFileSync(destination, `unavailable: ${error?.message || String(error)}\n`, 'utf8');
  }
}

function makeManagedResetFixture(t: test.TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-world-lab-managed-reset-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const baseline = path.join(root, 'baseline');
  const runtime = path.join(root, 'server', 'world');
  const archiveRoot = path.join(root, 'archive');
  const controlRoot = path.join(root, 'control');
  const entityRoot = path.join(root, 'entities');
  for (const directory of [source, baseline, runtime, archiveRoot, entityRoot]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  fs.writeFileSync(path.join(source, 'source.txt'), 'recovered source');
  fs.writeFileSync(path.join(baseline, 'level.dat'), 'prepared');
  fs.writeFileSync(path.join(runtime, 'old-run.txt'), 'persistent consequence');
  const world: WorldLabDefinition = {
    source: {
      path: source,
      digestProfile: 'behold-tree-v2',
      expectedDigest: digestTree(source).digest,
    },
    preparedBaseline: {
      path: baseline,
      digestProfile: 'behold-tree-v2',
      expectedDigest: digestTree(baseline).digest,
    },
    runtime: { worldPath: runtime, archiveRoot },
    server: { host: '127.0.0.1', port: 25598 },
  };
  const fixtureCapability = createFixtureExecutionCapability(root);
  return { root, runtime, archiveRoot, controlRoot, entityRoot, world, fixtureCapability };
}

function runtimeEvidence(ownerPid: number | null): any {
  const ownership: OwnershipEvidence = ownerPid
    ? { state: 'owned', probe: 'fixture', owners: [{ pid: ownerPid }] }
    : CLEAR;
  return {
    runtimeExists: true,
    runtimePath: '/fixture/runtime',
    runtimeSessionLockPath: '/fixture/runtime/session.lock',
    runtimeSessionLock: ownership,
    preparedBaselineSessionLockPath: '/fixture/baseline/session.lock',
    preparedBaselineSessionLock: CLEAR,
    serverPort: ownership,
    topology: { safe: true, blockers: [], artifacts: {} },
    safe: ownerPid == null,
    blockers: ownerPid == null ? [] : ['runtime_session_lock_owned', 'server_port_listening'],
  };
}

function restoreTestEnvironment(name: string, value: string | undefined) {
  if (value == null) delete process.env[name];
  else process.env[name] = value;
}
