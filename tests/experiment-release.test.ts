import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  commitExperimentRelease,
  createExperimentReleasePlan,
  experimentReleaseGateFromEnvironment,
  prepareExperimentRelease,
  verifyExperimentReleaseArms,
  verifyExperimentReleaseClaims,
} from '../src/runtime/experiment-release';

const digest = (character: string) => character.repeat(64);

function fixture(t: { after(callback: () => void): void }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-release-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runtime = path.join(root, 'world');
  fs.mkdirSync(runtime);
  const residents = ['IrisLife', 'MossLife'].map((entityId, index) => ({
    entityId,
    bodyUsername: index === 0 ? 'IrisBody' : 'MossBody',
    model: index === 0 ? 'fixture/model-a' : 'fixture/model-b',
    urgentModel: null,
    mind: 'direct' as const,
    ollamaLocal: {
      protocol: 'behold.ollama-local-policy.v1' as const,
      endpoint: 'http://127.0.0.1:11434/api/chat',
      modelTag: index === 0 ? 'fixture/model-a' : 'fixture/model-b',
      modelDigest: digest(index === 0 ? '5' : '6'),
      settings: {
        contextTokens: 16_384,
        maxOutputTokens: 512,
        temperature: 0.2,
        keepAlive: '5m',
      },
    },
    profiles: {
      policy: 'resident-v1',
      body: 'minecraft-human-semantic-v1',
      actions: 'minecraft-human-semantic-v1',
      safety: 'vanilla-player-v1',
    },
    quotaAccount: {
      accountId: digest(index === 0 ? 'a' : 'b'),
      ledgerFile: path.join(root, `${entityId}.jsonl`),
      limits: { resident_decision: 10, loom_fold: 4 },
      used: { resident_decision: 0, loom_fold: 0 },
      remaining: { resident_decision: 10, loom_fold: 4 },
      tipDigest: digest(index === 0 ? 'c' : 'd'),
    },
  }));
  const plan = createExperimentReleasePlan({
    createdAt: '2026-07-25T12:00:00.000Z',
    world: 'release-world',
    runId: 'release-world-7',
    ownerEpoch: 7,
    worldBasis: {
      runtimePath: runtime,
      runtimeDevice: 1,
      runtimeInode: 2,
      runtimeDigestProfile: 'behold-tree-v2',
      runtimeDigest: digest('1'),
      sourceDigest: digest('2'),
      preparedBaselineDigest: digest('3'),
    },
    accountingScope: { scopeId: 'matched-model-1', scopeDigest: digest('4') },
    residents,
  });
  const prepared = prepareExperimentRelease(path.join(root, 'gate'), plan);
  const gate = (index: number) =>
    experimentReleaseGateFromEnvironment(
      {
        entityId: residents[index].entityId,
        bodyUsername: residents[index].bodyUsername,
        model: residents[index].model,
        urgentModel: null,
        mind: 'direct',
        ollamaLocal: residents[index].ollamaLocal,
        profiles: residents[index].profiles,
        quotaAccountId: residents[index].quotaAccount.accountId,
      },
      {
        BEHOLD_EXPERIMENT_RELEASE_PLAN: prepared.planFile,
        BEHOLD_EXPERIMENT_RELEASE_PLAN_SHA256: prepared.planSha256,
      },
    )!;
  return { root, residents, prepared, gate };
}

test('release plan binds exact resident body, profile, model, and quota identity', (t) => {
  const { prepared, residents, gate } = fixture(t);
  assert.equal(gate(0).resident.entityId, 'IrisLife');
  assert.throws(
    () =>
      experimentReleaseGateFromEnvironment(
        {
          entityId: residents[0].entityId,
          bodyUsername: residents[0].bodyUsername,
          model: residents[0].model,
          urgentModel: null,
          mind: 'direct',
          profiles: { ...residents[0].profiles, body: 'minecraft-native-v1' },
          quotaAccountId: residents[0].quotaAccount.accountId,
        },
        {
          BEHOLD_EXPERIMENT_RELEASE_PLAN: prepared.planFile,
          BEHOLD_EXPERIMENT_RELEASE_PLAN_SHA256: prepared.planSha256,
        },
      ),
    /configuration mismatch/,
  );
  assert.throws(
    () =>
      experimentReleaseGateFromEnvironment(
        {
          entityId: residents[0].entityId,
          bodyUsername: residents[0].bodyUsername,
          model: residents[0].model,
          urgentModel: null,
          mind: 'direct',
          ollamaLocal: {
            ...residents[0].ollamaLocal,
            modelDigest: digest('f'),
          },
          profiles: residents[0].profiles,
          quotaAccountId: residents[0].quotaAccount.accountId,
        },
        {
          BEHOLD_EXPERIMENT_RELEASE_PLAN: prepared.planFile,
          BEHOLD_EXPERIMENT_RELEASE_PLAN_SHA256: prepared.planSha256,
        },
      ),
    /configuration mismatch/,
  );
  assert.throws(
    () =>
      experimentReleaseGateFromEnvironment(
        {
          entityId: residents[0].entityId,
          bodyUsername: residents[0].bodyUsername,
          model: residents[0].model,
          urgentModel: null,
          mind: 'direct',
          profiles: residents[0].profiles,
          quotaAccountId: digest('e'),
        },
        {
          BEHOLD_EXPERIMENT_RELEASE_PLAN: prepared.planFile,
          BEHOLD_EXPERIMENT_RELEASE_PLAN_SHA256: prepared.planSha256,
        },
      ),
    /configuration mismatch/,
  );
});

test('partial population cannot release and durable arms are exact and idempotent', async (t) => {
  const { root, prepared, gate } = fixture(t);
  const iris = gate(0);
  const first = iris.arm({
    pid: 101,
    journalFile: path.join(root, 'iris.jsonl'),
    setupObservation: { sequence: 0 },
    now: () => new Date('2026-07-25T12:00:01.000Z'),
  });
  const replay = iris.arm({
    pid: 101,
    journalFile: path.join(root, 'iris.jsonl'),
    setupObservation: { sequence: 0 },
    now: () => new Date('2026-07-25T12:00:09.000Z'),
  });
  assert.deepEqual(replay, first);
  assert.throws(
    () =>
      iris.arm({
        pid: 101,
        journalFile: path.join(root, 'iris.jsonl'),
        setupObservation: { sequence: 1 },
      }),
    /conflicting durable record/,
  );
  assert.throws(() => verifyExperimentReleaseArms(prepared));
  await assert.rejects(iris.waitAndClaim({ pid: 101, timeoutMs: 20, pollMs: 2 }), /timed out/);
  assert.equal(fs.existsSync(path.join(prepared.directory, 'release.json')), false);
  assert.deepEqual(
    fs.readdirSync(prepared.directory).filter((file) => file.startsWith('claim-')),
    [],
  );
});

test('one durable release yields explicit sequential observation claims without double release', async (t) => {
  const { root, prepared, gate } = fixture(t);
  gate(0).arm({
    pid: 101,
    journalFile: path.join(root, 'iris.jsonl'),
    setupObservation: { ready: true },
  });
  gate(1).arm({
    pid: 102,
    journalFile: path.join(root, 'moss.jsonl'),
    setupObservation: { ready: true },
  });
  assert.equal(verifyExperimentReleaseArms(prepared).length, 2);
  const extraArm = path.join(prepared.directory, `arm-${digest('e')}.json`);
  fs.writeFileSync(extraArm, '{}\n');
  assert.throws(() => verifyExperimentReleaseArms(prepared), /exact population/);
  fs.unlinkSync(extraArm);
  const releaseInput = {
    releasedAt: '2026-07-25T12:00:02.000Z',
    worldState: {
      runtimeDigestProfile: 'behold-tree-v2' as const,
      runtimeDigest: digest('5'),
      minecraftTicks: 'frozen_before_release' as const,
      saveAcknowledged: true as const,
    },
    lifecycle: {
      file: path.join(root, 'lifecycle.jsonl'),
      sequence: 8,
      digest: digest('6'),
    },
  };
  const release = commitExperimentRelease(prepared, releaseInput);
  assert.deepEqual(commitExperimentRelease(prepared, releaseInput), release);
  assert.throws(
    () =>
      commitExperimentRelease(prepared, {
        ...releaseInput,
        lifecycle: { ...releaseInput.lifecycle, sequence: 9 },
      }),
    /conflicting durable record/,
  );

  const references = await Promise.all([
    gate(0).waitAndClaim({ pid: 101 }),
    gate(1).waitAndClaim({ pid: 102 }),
  ]);
  assert.deepEqual(
    references.map((reference) => reference.residentObservedOrder),
    [1, 2],
  );
  assert.ok(references.every((reference) => reference.releaseId === release.releaseId));
  assert.ok(references.every((reference) => reference.releaseDigest === release.digest));
  const claims = verifyExperimentReleaseClaims(prepared);
  assert.deepEqual(
    claims.map((claim) => claim.entityId),
    ['IrisLife', 'MossLife'],
  );
  fs.writeFileSync(path.join(prepared.directory, 'claim-0003.json'), '{}\n');
  assert.throws(() => verifyExperimentReleaseClaims(prepared), /exact population/);
});
