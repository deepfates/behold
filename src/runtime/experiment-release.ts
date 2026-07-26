import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ollamaLocalPolicy, type OllamaLocalPolicy } from '../mind/ollama-local';
import { lmStudioLocalPolicy, type LmStudioLocalPolicy } from '../mind/lmstudio-local';
import { openRouterRoutePolicy, type OpenRouterRoutePolicy } from '../mind/openrouter-route';
import {
  assertFixedDecisionPilotPopulation,
  fixedDecisionPilotSchedule,
  type FixedDecisionPilotSchedule,
} from '../policy/fixed-decision-pilot';

export const EXPERIMENT_RELEASE_PLAN_PROTOCOL = 'behold.experiment-release-plan.v1' as const;
export const EXPERIMENT_RELEASE_ARM_PROTOCOL = 'behold.experiment-release-arm.v1' as const;
export const EXPERIMENT_RELEASE_PROTOCOL = 'behold.experiment-release.v1' as const;
export const EXPERIMENT_RELEASE_CLAIM_PROTOCOL = 'behold.experiment-release-claim.v1' as const;
export const EXPERIMENT_RELEASE_REFERENCE_PROTOCOL =
  'behold.experiment-release-reference.v1' as const;

export type ExperimentReleaseResident = Readonly<{
  entityId: string;
  bodyUsername: string;
  model: string;
  urgentModel: string | null;
  mind: 'direct' | 'ax';
  providerRoute?: OpenRouterRoutePolicy;
  ollamaLocal?: OllamaLocalPolicy;
  lmStudioLocal?: LmStudioLocalPolicy;
  decisionSchedule?: FixedDecisionPilotSchedule;
  profiles: Readonly<{
    policy: string;
    body: string;
    actions: string;
    safety: string;
  }>;
  quotaAccount: Readonly<{
    accountId: string;
    ledgerFile: string;
    limits: Readonly<{ resident_decision: number; loom_fold: number }>;
    used: Readonly<{ resident_decision: number; loom_fold: number }>;
    remaining: Readonly<{ resident_decision: number; loom_fold: number }>;
    tipDigest: string;
  }>;
}>;

export type ExperimentReleasePlan = Readonly<{
  protocol: typeof EXPERIMENT_RELEASE_PLAN_PROTOCOL;
  releaseId: string;
  createdAt: string;
  world: string;
  runId: string;
  ownerEpoch: number;
  worldBasis: Readonly<{
    runtimePath: string;
    runtimeDevice: number;
    runtimeInode: number;
    runtimeDigestProfile: 'behold-tree-v2';
    runtimeDigest: string;
    sourceDigest: string;
    preparedBaselineDigest: string;
  }>;
  accountingScope: Readonly<{ scopeId: string; scopeDigest: string }>;
  residents: readonly ExperimentReleaseResident[];
  populationDigest: string;
}>;

export type ExperimentReleaseArm = Readonly<{
  protocol: typeof EXPERIMENT_RELEASE_ARM_PROTOCOL;
  releaseId: string;
  planSha256: string;
  entityId: string;
  bodyUsername: string;
  pid: number;
  journalFile: string;
  setupObservationSha256: string;
  armedAt: string;
  digest: string;
}>;

export type ExperimentRelease = Readonly<{
  protocol: typeof EXPERIMENT_RELEASE_PROTOCOL;
  releaseId: string;
  planSha256: string;
  world: string;
  runId: string;
  ownerEpoch: number;
  populationDigest: string;
  releasedAt: string;
  worldState: Readonly<{
    runtimeDigestProfile: 'behold-tree-v2';
    runtimeDigest: string;
    minecraftTicks: 'frozen_before_release';
    saveAcknowledged: true;
  }>;
  lifecycle: Readonly<{
    file: string;
    sequence: number;
    digest: string;
  }>;
  digest: string;
}>;

export type ExperimentReleaseReference = Readonly<{
  protocol: typeof EXPERIMENT_RELEASE_REFERENCE_PROTOCOL;
  releaseId: string;
  releaseDigest: string;
  lifecycleSequence: number;
  lifecycleDigest: string;
  residentObservedOrder: number;
  residentObservedAt: string;
}>;

export type ExperimentReleaseClaim = Readonly<{
  protocol: typeof EXPERIMENT_RELEASE_CLAIM_PROTOCOL;
  releaseId: string;
  releaseDigest: string;
  entityId: string;
  pid: number;
  reference: ExperimentReleaseReference;
  digest: string;
}>;

export type PreparedExperimentRelease = Readonly<{
  directory: string;
  planFile: string;
  planSha256: string;
  plan: ExperimentReleasePlan;
}>;

export type ExperimentReleaseGate = Readonly<{
  prepared: PreparedExperimentRelease;
  resident: ExperimentReleaseResident;
  arm(input: {
    pid?: number;
    journalFile: string;
    setupObservation: unknown;
    now?: () => Date;
  }): ExperimentReleaseArm;
  waitAndClaim(input?: {
    pid?: number;
    signal?: AbortSignal;
    timeoutMs?: number;
    pollMs?: number;
    now?: () => Date;
  }): Promise<ExperimentReleaseReference>;
}>;

export function createExperimentReleasePlan(input: {
  createdAt: string;
  world: string;
  runId: string;
  ownerEpoch: number;
  worldBasis: ExperimentReleasePlan['worldBasis'];
  accountingScope: ExperimentReleasePlan['accountingScope'];
  residents: readonly ExperimentReleaseResident[];
}): ExperimentReleasePlan {
  const createdAt = isoTimestamp(input.createdAt, 'release plan creation');
  const world = boundedId(input.world, 'release world');
  const runId = boundedId(input.runId, 'release run');
  const ownerEpoch = positiveInteger(input.ownerEpoch, 'release owner epoch');
  const worldBasis = parseWorldBasis(input.worldBasis);
  const accountingScope = parseAccountingScope(input.accountingScope);
  if (
    !Array.isArray(input.residents) ||
    input.residents.length < 1 ||
    input.residents.length > 64
  ) {
    throw new Error('release plan requires 1 through 64 residents');
  }
  const residents = Object.freeze(input.residents.map(parseResident));
  assertFixedDecisionPilotPopulation(residents);
  for (const resident of residents) {
    if (!resident.decisionSchedule) continue;
    const account = resident.quotaAccount;
    const expectedDecisionAttempts = 4 + (resident.lmStudioLocal ? 1 : 0);
    if (
      account.limits.resident_decision !== expectedDecisionAttempts ||
      account.used.resident_decision !== 0 ||
      account.used.loom_fold !== 0 ||
      account.remaining.resident_decision !== expectedDecisionAttempts ||
      account.remaining.loom_fold !== account.limits.loom_fold
    ) {
      throw new Error(
        `fixed decision pilot release requires a fresh ${expectedDecisionAttempts}-attempt decision account for ${resident.entityId}`,
      );
    }
  }
  assertUnique(
    residents.map((resident) => resident.entityId),
    'release resident identity',
  );
  assertUnique(
    residents.map((resident) => resident.bodyUsername.toLowerCase()),
    'release body identity',
  );
  assertUnique(
    residents.map((resident) => resident.quotaAccount.accountId),
    'release quota account',
  );
  const populationDigest = sha256(stableJson(residents));
  const base = {
    protocol: EXPERIMENT_RELEASE_PLAN_PROTOCOL,
    createdAt,
    world,
    runId,
    ownerEpoch,
    worldBasis,
    accountingScope,
    residents,
    populationDigest,
  };
  return deepFreeze({
    ...base,
    releaseId: sha256(stableJson(base)),
  });
}

export function prepareExperimentRelease(
  directoryValue: string,
  planValue: ExperimentReleasePlan,
): PreparedExperimentRelease {
  const directory = path.resolve(directoryValue);
  const parent = path.dirname(directory);
  ensurePrivateDirectory(parent);
  try {
    fs.mkdirSync(directory, { mode: 0o700 });
    fsyncDirectory(parent);
  } catch (error: any) {
    if (error?.code === 'EEXIST') {
      throw new Error(`experiment release directory already exists: ${directory}`);
    }
    throw error;
  }
  const plan = parseExperimentReleasePlan(planValue);
  const planFile = path.join(directory, 'plan.json');
  writeExclusiveJson(planFile, plan);
  return Object.freeze({
    directory,
    planFile,
    planSha256: sha256File(planFile),
    plan,
  });
}

export function readPreparedExperimentRelease(
  planFileValue: string,
  expectedSha256: string,
): PreparedExperimentRelease {
  const planFile = plainFile(planFileValue, 'experiment release plan');
  const planSha256 = digest(expectedSha256, 'experiment release plan digest');
  if (sha256File(planFile) !== planSha256) {
    throw new Error('experiment release plan bytes do not match the expected digest');
  }
  const plan = parseExperimentReleasePlan(readJson(planFile));
  return Object.freeze({ directory: path.dirname(planFile), planFile, planSha256, plan });
}

export function experimentReleaseGateFromEnvironment(
  expected: Omit<ExperimentReleaseResident, 'quotaAccount'> & {
    quotaAccountId?: string;
  },
  environment: NodeJS.ProcessEnv = process.env,
): ExperimentReleaseGate | null {
  const planFile = optionalText(environment.BEHOLD_EXPERIMENT_RELEASE_PLAN);
  const planSha256 = optionalText(environment.BEHOLD_EXPERIMENT_RELEASE_PLAN_SHA256);
  if (!planFile && !planSha256) return null;
  if (!planFile || !planSha256) {
    throw new Error('experiment release environment is incomplete');
  }
  const prepared = readPreparedExperimentRelease(planFile, planSha256);
  const resident = prepared.plan.residents.find(
    (candidate) => candidate.entityId === expected.entityId,
  );
  if (!resident || !sameResidentConfiguration(resident, expected)) {
    throw new Error(`experiment release resident configuration mismatch for ${expected.entityId}`);
  }
  return Object.freeze({
    prepared,
    resident,
    arm: (input) => armExperimentResident(prepared, resident, input),
    waitAndClaim: (input = {}) => waitAndClaimExperimentRelease(prepared, resident, input),
  });
}

export function armExperimentResident(
  prepared: PreparedExperimentRelease,
  residentValue: ExperimentReleaseResident,
  input: {
    pid?: number;
    journalFile: string;
    setupObservation: unknown;
    now?: () => Date;
  },
): ExperimentReleaseArm {
  const resident = prepared.plan.residents.find(
    (candidate) => candidate.entityId === residentValue.entityId,
  );
  if (!resident || stableJson(resident) !== stableJson(parseResident(residentValue))) {
    throw new Error('experiment release arm resident is not in the prepared population');
  }
  const base = {
    protocol: EXPERIMENT_RELEASE_ARM_PROTOCOL,
    releaseId: prepared.plan.releaseId,
    planSha256: prepared.planSha256,
    entityId: resident.entityId,
    bodyUsername: resident.bodyUsername,
    pid: positiveInteger(input.pid ?? process.pid, 'release arm pid'),
    journalFile: absolutePath(input.journalFile, 'release arm journal'),
    setupObservationSha256: sha256(stableJson(cloneJson(input.setupObservation))),
    armedAt: (input.now ?? (() => new Date()))().toISOString(),
  };
  const candidate = deepFreeze({ ...base, digest: sha256(stableJson(base)) });
  const file = armFile(prepared.directory, resident.quotaAccount.accountId);
  return writeIdempotentRecord(file, candidate, (existing) =>
    sameArmIdentity(parseArm(existing), candidate),
  ) as ExperimentReleaseArm;
}

export function verifyExperimentReleaseArms(
  prepared: PreparedExperimentRelease,
): readonly ExperimentReleaseArm[] {
  const expectedFiles = prepared.plan.residents.map((resident) =>
    path.basename(armFile(prepared.directory, resident.quotaAccount.accountId)),
  );
  assertExactProtocolFiles(prepared.directory, /^arm-[a-f0-9]{64}\.json$/, expectedFiles, 'arms');
  const arms = prepared.plan.residents.map((resident) => {
    const arm = parseArm(readJson(armFile(prepared.directory, resident.quotaAccount.accountId)));
    if (
      arm.releaseId !== prepared.plan.releaseId ||
      arm.planSha256 !== prepared.planSha256 ||
      arm.entityId !== resident.entityId ||
      arm.bodyUsername !== resident.bodyUsername
    ) {
      throw new Error(`experiment release arm mismatches ${resident.entityId}`);
    }
    return arm;
  });
  assertUnique(
    arms.map((arm) => arm.pid),
    'release arm pid',
  );
  return Object.freeze(arms);
}

export function commitExperimentRelease(
  prepared: PreparedExperimentRelease,
  input: {
    releasedAt: string;
    worldState: ExperimentRelease['worldState'];
    lifecycle: ExperimentRelease['lifecycle'];
  },
): ExperimentRelease {
  verifyExperimentReleaseArms(prepared);
  const base = {
    protocol: EXPERIMENT_RELEASE_PROTOCOL,
    releaseId: prepared.plan.releaseId,
    planSha256: prepared.planSha256,
    world: prepared.plan.world,
    runId: prepared.plan.runId,
    ownerEpoch: prepared.plan.ownerEpoch,
    populationDigest: prepared.plan.populationDigest,
    releasedAt: isoTimestamp(input.releasedAt, 'experiment release'),
    worldState: parseReleaseWorldState(input.worldState),
    lifecycle: parseLifecycleReference(input.lifecycle),
  };
  const candidate = deepFreeze({ ...base, digest: sha256(stableJson(base)) });
  return writeIdempotentRecord(
    releaseFile(prepared.directory),
    candidate,
    (existing) => stableJson(existing) === stableJson(candidate),
  ) as ExperimentRelease;
}

export function readExperimentRelease(prepared: PreparedExperimentRelease): ExperimentRelease {
  const release = parseRelease(readJson(releaseFile(prepared.directory)));
  if (
    release.releaseId !== prepared.plan.releaseId ||
    release.planSha256 !== prepared.planSha256 ||
    release.world !== prepared.plan.world ||
    release.runId !== prepared.plan.runId ||
    release.ownerEpoch !== prepared.plan.ownerEpoch ||
    release.populationDigest !== prepared.plan.populationDigest
  ) {
    throw new Error('experiment release does not match its prepared plan');
  }
  return release;
}

export async function waitAndClaimExperimentRelease(
  prepared: PreparedExperimentRelease,
  resident: ExperimentReleaseResident,
  input: {
    pid?: number;
    signal?: AbortSignal;
    timeoutMs?: number;
    pollMs?: number;
    now?: () => Date;
  } = {},
): Promise<ExperimentReleaseReference> {
  const timeoutMs = positiveInteger(input.timeoutMs ?? 120_000, 'release wait timeout');
  const pollMs = positiveInteger(input.pollMs ?? 25, 'release wait poll');
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(releaseFile(prepared.directory))) {
    if (input.signal?.aborted) throw input.signal.reason ?? new Error('release wait aborted');
    if (Date.now() >= deadline) throw new Error('experiment release wait timed out');
    await abortableDelay(Math.min(pollMs, Math.max(1, deadline - Date.now())), input.signal);
  }
  const release = readExperimentRelease(prepared);
  return claimExperimentRelease(prepared, release, resident, {
    pid: input.pid,
    now: input.now,
  }).reference;
}

export function claimExperimentRelease(
  prepared: PreparedExperimentRelease,
  release: ExperimentRelease,
  residentValue: ExperimentReleaseResident,
  input: { pid?: number; now?: () => Date } = {},
): ExperimentReleaseClaim {
  const resident = prepared.plan.residents.find(
    (candidate) => candidate.entityId === residentValue.entityId,
  );
  if (!resident || release.releaseId !== prepared.plan.releaseId) {
    throw new Error('experiment release claim does not match the prepared population');
  }
  const prior = readExperimentReleaseClaims(prepared, release);
  const existing = prior.find((claim) => claim.entityId === resident.entityId);
  if (existing) return existing;
  const order = prior.length + 1;
  const reference: ExperimentReleaseReference = deepFreeze({
    protocol: EXPERIMENT_RELEASE_REFERENCE_PROTOCOL,
    releaseId: release.releaseId,
    releaseDigest: release.digest,
    lifecycleSequence: release.lifecycle.sequence,
    lifecycleDigest: release.lifecycle.digest,
    residentObservedOrder: order,
    residentObservedAt: (input.now ?? (() => new Date()))().toISOString(),
  });
  const base = {
    protocol: EXPERIMENT_RELEASE_CLAIM_PROTOCOL,
    releaseId: release.releaseId,
    releaseDigest: release.digest,
    entityId: resident.entityId,
    pid: positiveInteger(input.pid ?? process.pid, 'release claim pid'),
    reference,
  };
  const candidate = deepFreeze({ ...base, digest: sha256(stableJson(base)) });
  const file = claimFile(prepared.directory, order);
  try {
    writeExclusiveJson(file, candidate);
    return candidate;
  } catch (error: any) {
    if (error?.code !== 'EEXIST') throw error;
    return claimExperimentRelease(prepared, release, resident, input);
  }
}

export function readExperimentReleaseClaims(
  prepared: PreparedExperimentRelease,
  release = readExperimentRelease(prepared),
): readonly ExperimentReleaseClaim[] {
  const claims: ExperimentReleaseClaim[] = [];
  for (let order = 1; order <= prepared.plan.residents.length; order += 1) {
    const file = claimFile(prepared.directory, order);
    if (!fs.existsSync(file)) break;
    const claim = parseClaim(readJson(file));
    if (
      claim.releaseId !== release.releaseId ||
      claim.releaseDigest !== release.digest ||
      claim.reference.residentObservedOrder !== order
    ) {
      throw new Error(`experiment release claim ${order} mismatches its release`);
    }
    claims.push(claim);
  }
  assertUnique(
    claims.map((claim) => claim.entityId),
    'release claim resident',
  );
  return Object.freeze(claims);
}

export function verifyExperimentReleaseClaims(
  prepared: PreparedExperimentRelease,
): readonly ExperimentReleaseClaim[] {
  const expectedFiles = prepared.plan.residents.map((_resident, index) =>
    path.basename(claimFile(prepared.directory, index + 1)),
  );
  assertExactProtocolFiles(prepared.directory, /^claim-[0-9]{4}\.json$/, expectedFiles, 'claims');
  const claims = readExperimentReleaseClaims(prepared);
  if (claims.length !== prepared.plan.residents.length) {
    throw new Error('experiment release claims are incomplete');
  }
  const expected = new Set(prepared.plan.residents.map((resident) => resident.entityId));
  if (claims.some((claim) => !expected.delete(claim.entityId)) || expected.size > 0) {
    throw new Error('experiment release claims do not match the prepared population');
  }
  return claims;
}

function assertExactProtocolFiles(
  directory: string,
  pattern: RegExp,
  expectedFiles: readonly string[],
  label: string,
) {
  const actual = fs
    .readdirSync(directory)
    .filter((file) => pattern.test(file))
    .sort();
  const expected = [...expectedFiles].sort();
  if (actual.join(',') !== expected.join(',')) {
    throw new Error(`experiment release ${label} do not match the exact population`);
  }
}

export function parseExperimentReleaseReference(value: unknown): ExperimentReleaseReference {
  const record = exactRecord(
    value,
    [
      'protocol',
      'releaseId',
      'releaseDigest',
      'lifecycleSequence',
      'lifecycleDigest',
      'residentObservedOrder',
      'residentObservedAt',
    ],
    'experiment release reference',
  );
  if (record.protocol !== EXPERIMENT_RELEASE_REFERENCE_PROTOCOL) {
    throw new Error('unsupported experiment release reference');
  }
  return deepFreeze({
    protocol: EXPERIMENT_RELEASE_REFERENCE_PROTOCOL,
    releaseId: digest(record.releaseId, 'release id'),
    releaseDigest: digest(record.releaseDigest, 'release digest'),
    lifecycleSequence: positiveInteger(record.lifecycleSequence, 'release lifecycle sequence'),
    lifecycleDigest: digest(record.lifecycleDigest, 'release lifecycle digest'),
    residentObservedOrder: positiveInteger(record.residentObservedOrder, 'release observed order'),
    residentObservedAt: isoTimestamp(record.residentObservedAt, 'release observation'),
  });
}

function parseExperimentReleasePlan(value: unknown): ExperimentReleasePlan {
  const record = exactRecord(
    value,
    [
      'protocol',
      'releaseId',
      'createdAt',
      'world',
      'runId',
      'ownerEpoch',
      'worldBasis',
      'accountingScope',
      'residents',
      'populationDigest',
    ],
    'experiment release plan',
  );
  if (record.protocol !== EXPERIMENT_RELEASE_PLAN_PROTOCOL) {
    throw new Error('unsupported experiment release plan');
  }
  const parsed = createExperimentReleasePlan({
    createdAt: record.createdAt as any,
    world: record.world as any,
    runId: record.runId as any,
    ownerEpoch: record.ownerEpoch as any,
    worldBasis: record.worldBasis as any,
    accountingScope: record.accountingScope as any,
    residents: record.residents as any,
  });
  if (
    record.populationDigest !== parsed.populationDigest ||
    record.releaseId !== parsed.releaseId
  ) {
    throw new Error('experiment release plan content identity is invalid');
  }
  return parsed;
}

function parseResident(value: unknown): ExperimentReleaseResident {
  const hasProviderRoute =
    value != null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, 'providerRoute');
  const hasOllamaLocal =
    value != null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, 'ollamaLocal');
  const hasLmStudioLocal =
    value != null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, 'lmStudioLocal');
  const hasDecisionSchedule =
    value != null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, 'decisionSchedule');
  const record = exactRecord(
    value,
    [
      'entityId',
      'bodyUsername',
      'model',
      'urgentModel',
      'mind',
      ...(hasProviderRoute ? ['providerRoute'] : []),
      ...(hasOllamaLocal ? ['ollamaLocal'] : []),
      ...(hasLmStudioLocal ? ['lmStudioLocal'] : []),
      ...(hasDecisionSchedule ? ['decisionSchedule'] : []),
      'profiles',
      'quotaAccount',
    ],
    'release resident',
  );
  const profiles = exactRecord(
    record.profiles,
    ['policy', 'body', 'actions', 'safety'],
    'release resident profiles',
  );
  const quota = exactRecord(
    record.quotaAccount,
    ['accountId', 'ledgerFile', 'limits', 'used', 'remaining', 'tipDigest'],
    'release quota account',
  );
  const limits = parsePurposeCounts(quota.limits, 'release quota limits', true);
  const used = parsePurposeCounts(quota.used, 'release quota used', false);
  const remaining = parsePurposeCounts(quota.remaining, 'release quota remaining', false);
  for (const purpose of ['resident_decision', 'loom_fold'] as const) {
    if (used[purpose] + remaining[purpose] !== limits[purpose]) {
      throw new Error(`release quota ${purpose} accounting is inconsistent`);
    }
  }
  if (record.mind !== 'direct' && record.mind !== 'ax') {
    throw new Error('release resident mind must be direct or ax');
  }
  if ([hasProviderRoute, hasOllamaLocal, hasLmStudioLocal].filter(Boolean).length > 1) {
    throw new Error('release resident cannot combine OpenRouter, Ollama, and LM Studio transport');
  }
  if (hasOllamaLocal && record.mind !== 'direct') {
    throw new Error('release resident Ollama transport requires the direct mind');
  }
  if (hasLmStudioLocal && record.mind !== 'direct') {
    throw new Error('release resident LM Studio transport requires the direct mind');
  }
  const localPolicy = hasOllamaLocal ? ollamaLocalPolicy(record.ollamaLocal) : null;
  const lmStudioPolicy = hasLmStudioLocal ? lmStudioLocalPolicy(record.lmStudioLocal) : null;
  if (localPolicy && localPolicy.modelTag !== record.model) {
    throw new Error('release resident Ollama tag differs from resident model');
  }
  if (lmStudioPolicy && lmStudioPolicy.modelKey !== record.model) {
    throw new Error('release resident LM Studio model differs from resident model');
  }
  return deepFreeze({
    entityId: boundedId(record.entityId, 'release resident'),
    bodyUsername: minecraftUsername(record.bodyUsername),
    model: boundedText(record.model, 'release model', 300),
    urgentModel:
      record.urgentModel == null
        ? null
        : boundedText(record.urgentModel, 'release urgent model', 300),
    mind: record.mind,
    ...(hasProviderRoute ? { providerRoute: openRouterRoutePolicy(record.providerRoute) } : {}),
    ...(localPolicy ? { ollamaLocal: localPolicy } : {}),
    ...(lmStudioPolicy ? { lmStudioLocal: lmStudioPolicy } : {}),
    ...(hasDecisionSchedule
      ? { decisionSchedule: fixedDecisionPilotSchedule(record.decisionSchedule) }
      : {}),
    profiles: {
      policy: boundedId(profiles.policy, 'release policy profile'),
      body: boundedId(profiles.body, 'release body profile'),
      actions: boundedId(profiles.actions, 'release action profile'),
      safety: boundedId(profiles.safety, 'release safety profile'),
    },
    quotaAccount: {
      accountId: digest(quota.accountId, 'release quota account'),
      ledgerFile: absolutePath(quota.ledgerFile, 'release quota ledger'),
      limits,
      used,
      remaining,
      tipDigest: digest(quota.tipDigest, 'release quota tip'),
    },
  });
}

function parseWorldBasis(value: unknown): ExperimentReleasePlan['worldBasis'] {
  const record = exactRecord(
    value,
    [
      'runtimePath',
      'runtimeDevice',
      'runtimeInode',
      'runtimeDigestProfile',
      'runtimeDigest',
      'sourceDigest',
      'preparedBaselineDigest',
    ],
    'release world basis',
  );
  if (record.runtimeDigestProfile !== 'behold-tree-v2') {
    throw new Error('release runtime digest profile must be behold-tree-v2');
  }
  return deepFreeze({
    runtimePath: absolutePath(record.runtimePath, 'release runtime'),
    runtimeDevice: nonnegativeInteger(record.runtimeDevice, 'release runtime device'),
    runtimeInode: positiveInteger(record.runtimeInode, 'release runtime inode'),
    runtimeDigestProfile: 'behold-tree-v2' as const,
    runtimeDigest: digest(record.runtimeDigest, 'release runtime digest'),
    sourceDigest: digest(record.sourceDigest, 'release source digest'),
    preparedBaselineDigest: digest(record.preparedBaselineDigest, 'release baseline digest'),
  });
}

function parseAccountingScope(value: unknown) {
  const record = exactRecord(value, ['scopeId', 'scopeDigest'], 'release accounting scope');
  return deepFreeze({
    scopeId: boundedId(record.scopeId, 'release accounting scope'),
    scopeDigest: digest(record.scopeDigest, 'release accounting scope digest'),
  });
}

function parseArm(value: unknown): ExperimentReleaseArm {
  const record = exactRecord(
    value,
    [
      'protocol',
      'releaseId',
      'planSha256',
      'entityId',
      'bodyUsername',
      'pid',
      'journalFile',
      'setupObservationSha256',
      'armedAt',
      'digest',
    ],
    'experiment release arm',
  );
  const { digest: claimedDigest, ...base } = record;
  if (
    record.protocol !== EXPERIMENT_RELEASE_ARM_PROTOCOL ||
    claimedDigest !== sha256(stableJson(base))
  ) {
    throw new Error('experiment release arm digest is invalid');
  }
  return deepFreeze({
    protocol: EXPERIMENT_RELEASE_ARM_PROTOCOL,
    releaseId: digest(record.releaseId, 'release arm id'),
    planSha256: digest(record.planSha256, 'release arm plan'),
    entityId: boundedId(record.entityId, 'release arm entity'),
    bodyUsername: minecraftUsername(record.bodyUsername),
    pid: positiveInteger(record.pid, 'release arm pid'),
    journalFile: absolutePath(record.journalFile, 'release arm journal'),
    setupObservationSha256: digest(record.setupObservationSha256, 'setup observation'),
    armedAt: isoTimestamp(record.armedAt, 'release arm'),
    digest: String(claimedDigest),
  });
}

function parseRelease(value: unknown): ExperimentRelease {
  const record = exactRecord(
    value,
    [
      'protocol',
      'releaseId',
      'planSha256',
      'world',
      'runId',
      'ownerEpoch',
      'populationDigest',
      'releasedAt',
      'worldState',
      'lifecycle',
      'digest',
    ],
    'experiment release',
  );
  const { digest: claimedDigest, ...base } = record;
  if (
    record.protocol !== EXPERIMENT_RELEASE_PROTOCOL ||
    claimedDigest !== sha256(stableJson(base))
  ) {
    throw new Error('experiment release digest is invalid');
  }
  return deepFreeze({
    protocol: EXPERIMENT_RELEASE_PROTOCOL,
    releaseId: digest(record.releaseId, 'release id'),
    planSha256: digest(record.planSha256, 'release plan'),
    world: boundedId(record.world, 'release world'),
    runId: boundedId(record.runId, 'release run'),
    ownerEpoch: positiveInteger(record.ownerEpoch, 'release owner epoch'),
    populationDigest: digest(record.populationDigest, 'release population'),
    releasedAt: isoTimestamp(record.releasedAt, 'experiment release'),
    worldState: parseReleaseWorldState(record.worldState),
    lifecycle: parseLifecycleReference(record.lifecycle),
    digest: String(claimedDigest),
  });
}

function parseReleaseWorldState(value: unknown): ExperimentRelease['worldState'] {
  const record = exactRecord(
    value,
    ['runtimeDigestProfile', 'runtimeDigest', 'minecraftTicks', 'saveAcknowledged'],
    'experiment release world state',
  );
  if (
    record.runtimeDigestProfile !== 'behold-tree-v2' ||
    record.minecraftTicks !== 'frozen_before_release' ||
    record.saveAcknowledged !== true
  ) {
    throw new Error('experiment release world state is not a frozen saved Minecraft state');
  }
  return deepFreeze({
    runtimeDigestProfile: 'behold-tree-v2' as const,
    runtimeDigest: digest(record.runtimeDigest, 'release runtime digest'),
    minecraftTicks: 'frozen_before_release' as const,
    saveAcknowledged: true as const,
  });
}

function parseClaim(value: unknown): ExperimentReleaseClaim {
  const record = exactRecord(
    value,
    ['protocol', 'releaseId', 'releaseDigest', 'entityId', 'pid', 'reference', 'digest'],
    'experiment release claim',
  );
  const { digest: claimedDigest, ...base } = record;
  if (
    record.protocol !== EXPERIMENT_RELEASE_CLAIM_PROTOCOL ||
    claimedDigest !== sha256(stableJson(base))
  ) {
    throw new Error('experiment release claim digest is invalid');
  }
  const reference = parseExperimentReleaseReference(record.reference);
  if (
    record.releaseId !== reference.releaseId ||
    record.releaseDigest !== reference.releaseDigest
  ) {
    throw new Error('experiment release claim reference mismatches its release');
  }
  return deepFreeze({
    protocol: EXPERIMENT_RELEASE_CLAIM_PROTOCOL,
    releaseId: digest(record.releaseId, 'release claim id'),
    releaseDigest: digest(record.releaseDigest, 'release claim digest'),
    entityId: boundedId(record.entityId, 'release claim entity'),
    pid: positiveInteger(record.pid, 'release claim pid'),
    reference,
    digest: String(claimedDigest),
  });
}

function parseLifecycleReference(value: unknown) {
  const record = exactRecord(value, ['file', 'sequence', 'digest'], 'release lifecycle reference');
  return deepFreeze({
    file: absolutePath(record.file, 'release lifecycle journal'),
    sequence: positiveInteger(record.sequence, 'release lifecycle sequence'),
    digest: digest(record.digest, 'release lifecycle event'),
  });
}

function parsePurposeCounts(value: unknown, label: string, positive: boolean) {
  const record = exactRecord(value, ['resident_decision', 'loom_fold'], label);
  const parse = positive ? positiveInteger : nonnegativeInteger;
  return deepFreeze({
    resident_decision: parse(record.resident_decision, `${label} resident_decision`),
    loom_fold: parse(record.loom_fold, `${label} loom_fold`),
  });
}

function sameResidentConfiguration(
  actual: ExperimentReleaseResident,
  expected: Omit<ExperimentReleaseResident, 'quotaAccount'> & { quotaAccountId?: string },
) {
  return (
    actual.entityId === expected.entityId &&
    actual.bodyUsername === expected.bodyUsername &&
    actual.model === expected.model &&
    actual.urgentModel === expected.urgentModel &&
    actual.mind === expected.mind &&
    stableJson(actual.providerRoute ?? null) === stableJson(expected.providerRoute ?? null) &&
    stableJson(actual.ollamaLocal ?? null) === stableJson(expected.ollamaLocal ?? null) &&
    stableJson(actual.lmStudioLocal ?? null) === stableJson(expected.lmStudioLocal ?? null) &&
    stableJson(actual.decisionSchedule ?? null) === stableJson(expected.decisionSchedule ?? null) &&
    stableJson(actual.profiles) === stableJson(expected.profiles) &&
    (expected.quotaAccountId == null || actual.quotaAccount.accountId === expected.quotaAccountId)
  );
}

function sameArmIdentity(left: ExperimentReleaseArm, right: ExperimentReleaseArm) {
  return (
    left.releaseId === right.releaseId &&
    left.planSha256 === right.planSha256 &&
    left.entityId === right.entityId &&
    left.bodyUsername === right.bodyUsername &&
    left.pid === right.pid &&
    left.journalFile === right.journalFile &&
    left.setupObservationSha256 === right.setupObservationSha256
  );
}

function armFile(directory: string, accountId: string) {
  return path.join(directory, `arm-${digest(accountId, 'release arm account')}.json`);
}

function releaseFile(directory: string) {
  return path.join(directory, 'release.json');
}

function claimFile(directory: string, order: number) {
  return path.join(directory, `claim-${String(order).padStart(4, '0')}.json`);
}

function writeIdempotentRecord(
  file: string,
  candidate: unknown,
  sameIdentity: (existing: unknown) => boolean,
) {
  try {
    writeExclusiveJson(file, candidate);
    return candidate;
  } catch (error: any) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = readJson(file);
    if (!sameIdentity(existing))
      throw new Error(`conflicting durable record already exists: ${file}`);
    return deepFreeze(existing);
  }
}

function writeExclusiveJson(file: string, value: unknown) {
  const directory = path.dirname(file);
  const temporary = path.join(
    directory,
    `.pending-${path.basename(file)}-${process.pid}-${randomUUID()}`,
  );
  let descriptor: number | null = fs.openSync(
    temporary,
    fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW,
    0o600,
  );
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    // A hard-link publish preserves O_EXCL semantics while ensuring readers
    // can only discover the final protocol filename after all bytes are durable.
    fs.linkSync(temporary, file);
    fsyncDirectory(directory);
  } finally {
    if (descriptor != null) fs.closeSync(descriptor);
    try {
      fs.unlinkSync(temporary);
      fsyncDirectory(directory);
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

function readJson(fileValue: string) {
  const file = plainFile(fileValue, 'experiment release record');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function plainFile(fileValue: string, label: string) {
  const file = path.resolve(fileValue);
  const stats = fs.lstatSync(file);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`${label} is not a plain file`);
  return file;
}

function ensurePrivateDirectory(directory: string) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stats = fs.lstatSync(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`experiment release parent is not a plain directory: ${directory}`);
  }
  fs.chmodSync(directory, 0o700);
}

function fsyncDirectory(directory: string) {
  const descriptor = fs.openSync(directory, 'r');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function exactRecord(value: unknown, fields: readonly string[], label: string) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...fields].sort();
  if (actual.join(',') !== expected.join(',')) {
    throw new Error(`${label} fields are incomplete or unsupported`);
  }
  return record;
}

function boundedId(value: unknown, label: string) {
  const text = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(text)) {
    throw new Error(`${label} must be a bounded identifier`);
  }
  return text;
}

function boundedText(value: unknown, label: string, max: number) {
  const text = String(value || '').trim();
  if (!text || text.length > max) throw new Error(`${label} must be nonempty and bounded`);
  return text;
}

function minecraftUsername(value: unknown) {
  const text = String(value || '');
  if (!/^[A-Za-z0-9_]{1,16}$/.test(text)) throw new Error('release body username is invalid');
  return text;
}

function absolutePath(value: unknown, label: string) {
  const text = String(value || '');
  if (!path.isAbsolute(text)) throw new Error(`${label} must be absolute`);
  return path.normalize(text);
}

function positiveInteger(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return Number(value);
}

function nonnegativeInteger(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${label} must be a nonnegative safe integer`);
  }
  return Number(value);
}

function digest(value: unknown, label: string) {
  const text = String(value || '');
  if (!/^[a-f0-9]{64}$/.test(text)) throw new Error(`${label} must be a SHA-256 digest`);
  return text;
}

function isoTimestamp(value: unknown, label: string) {
  const text = String(value || '');
  if (!text || !Number.isFinite(Date.parse(text))) throw new Error(`${label} must be an ISO time`);
  return text;
}

function optionalText(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

function assertUnique(values: readonly (string | number)[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`${label} values must be unique`);
}

function abortableDelay(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('release wait aborted'));
      return;
    }
    const timer = setTimeout(finish, milliseconds);
    const onAbort = () => finish(signal?.reason ?? new Error('release wait aborted'));
    function finish(error?: unknown) {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function cloneJson(value: unknown): any {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as any)) deepFreeze(child);
  }
  return value;
}

function stableJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function sha256File(file: string) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
