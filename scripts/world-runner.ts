#!/usr/bin/env node
import 'dotenv/config';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  assertFixtureExecutionScope,
  digestTree,
  loadWorldLabConfig,
  resolveWorldLabConfigPath,
  resetWorld,
  statusWorld,
  verifyWorld,
  worldLabDefinitionDigest,
  type OwnershipEvidence,
  type ResetResult,
  type RuntimeEvidence,
  type FixtureExecutionCapability,
  type WorldLabDependencies,
  type WorldLabDefinition,
} from './world-lab';
import {
  acquireWorldControl,
  inspectEntityLeaseFence,
  inspectWorldControl,
  issueManagedWorldResetCapability,
  settleManagedWorldResetCapability,
  verifyWorldLifecycleJournal,
  type HeldWorldControl,
  type ManagedWorldResetScope,
  type WorldOwnerRecord,
} from '../src/runtime/world-control';
import { DEFAULT_LLM_MODEL } from '../src/config';
import { sanitizeName } from '../src/observability/journal';
import {
  startCognitionBroker,
  verifyCognitionBrokerJournal,
  type CognitionBroker,
} from '../src/mind/cognition-broker';
import { verifyCognitionTransportCapture } from '../src/mind/transport-capture';
import {
  openRouterRoutePolicy,
  serializeOpenRouterRoutePolicy,
  type OpenRouterRoutePolicy,
} from '../src/mind/openrouter-route';
import {
  ollamaLocalPolicy,
  preflightOllamaLocal,
  serializeOllamaLocalPolicy,
  type OllamaLocalPolicy,
  type OllamaLocalPreflight,
} from '../src/mind/ollama-local';
import {
  COGNITION_TRANSPORT_PROTOCOL,
  cognitionAccountId,
  cognitionResidentKey,
} from '../src/mind/cognition';
import {
  minecraftActionProfile,
  minecraftSafetyProfile,
  type MinecraftActionProfile,
  type MinecraftSafetyProfile,
} from '../src/agent/action-profiles';
import { residentPolicyProfile, type ResidentPolicyProfile } from '../src/policy/profile';
import {
  minecraftBodyProfile,
  usesHumanSemanticBody,
  type MinecraftBodyProfile,
} from '../src/mind/minecraft-body';
import { verifyQuotaLedger } from '../src/observability/quota-ledger';
import {
  commitExperimentRelease,
  createExperimentReleasePlan,
  prepareExperimentRelease,
  readExperimentReleaseClaims,
  verifyExperimentReleaseArms,
  verifyExperimentReleaseClaims,
  type PreparedExperimentRelease,
} from '../src/runtime/experiment-release';

export const COME_SEE_DO_REPORT_ALLOW_TOOLS = Object.freeze([
  'chat',
  'look_at',
  'look',
  'move_to',
  'approach_entity',
  'stop',
  'stop_digging',
  'dig_block',
  'place_against',
  'place_block',
  'find_blocks',
  'block_at_cursor',
  'inspect_volume',
  'inspect_reachable_space',
  'entity_at_cursor',
  'nearest_entity',
  'get_nearby',
  'survey_area',
  'status',
]);

export type ManagedControllerProfile = Readonly<{
  task?: string;
  target?: string;
  allowTools?: readonly string[];
}>;

/**
 * The normal managed experience is an untasked resident. Evaluations must opt
 * into their task contract and narrower action surface explicitly.
 */
export function managedControllerProfile(
  taskValue?: unknown,
  targetValue?: unknown,
): ManagedControllerProfile {
  const task = optionalText(taskValue);
  const target = optionalText(targetValue);
  if (!task) {
    if (target) {
      throw new WorldRunnerError(
        '--target is meaningful only with an explicit --task',
        'controller_target_without_task',
      );
    }
    return {};
  }
  if (task === 'come-see-do-report') {
    return {
      task,
      target: target || 'importdf',
      allowTools: COME_SEE_DO_REPORT_ALLOW_TOOLS,
    };
  }
  return { task, ...(target ? { target } : {}) };
}

/**
 * Optional live-time boundary for an operator session. The clock begins only
 * after Minecraft and every configured resident have become ready; startup and
 * graceful save/stop time therefore cannot consume the inhabitant's episode.
 */
export function managedSessionDurationMs(value?: unknown): number | null {
  if (value == null || String(value).trim() === '') return null;
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 7 * 24 * 60 * 60) {
    throw new WorldRunnerError(
      '--duration must be a whole number of live seconds from 1 through 604800',
      'session_duration_invalid',
      { value },
    );
  }
  return seconds * 1000;
}

/**
 * Hard population-wide admission budget for one managed epoch. This is
 * independent of concurrency: the broker refuses every valid request after
 * the exact accepted-call ceiling, even if its owner has not stopped yet.
 */
export function managedTotalModelCallLimit(value?: unknown): number | null {
  if (value == null || String(value).trim() === '') return null;
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100_000_000) {
    throw new WorldRunnerError(
      '--maxModelCalls must be a whole number from 1 through 100000000',
      'model_call_limit_invalid',
      { value },
    );
  }
  return limit;
}

type RuntimeInspection = RuntimeEvidence & {
  world?: string;
  baselineConfigured?: boolean;
  sourceExists?: boolean;
};

export type ManagedResidentSpec = Readonly<{
  /** Continuing private-life identity and owner of the resident Lync. */
  entityId: string;
  /** Minecraft connection identity. Defaults to entityId. */
  bodyUsername?: string;
  model: string;
  urgentModel?: string;
  mind?: 'direct' | 'ax';
  policyProfile?: ResidentPolicyProfile;
  bodyProfile?: MinecraftBodyProfile;
  actionProfile?: MinecraftActionProfile;
  safetyProfile?: MinecraftSafetyProfile;
  tickMs?: number;
  /** Maximum entity turns in one uninterrupted cognition burst. */
  maxTurnSteps?: number;
  /** Whether cognition resumes after the burst budget is reached. */
  resumeAfterBudget?: boolean;
  task?: string;
  target?: string;
  allowTools?: readonly string[];
  /** Hard provider-attempt quotas; response tokens/cost are accounted but not predicted. */
  providerQuotas?: Readonly<{
    residentDecisionAttempts: number;
    auxiliaryContextAttempts: number;
  }>;
  /** Exact direct-provider route and output contract; absent only for legacy/uncontrolled runs. */
  providerRoute?: OpenRouterRoutePolicy;
  /** Exact loopback Ollama model/content/settings contract. */
  ollamaLocal?: OllamaLocalPolicy;
  /** Explicit, non-authoritative variables for a specialized controller entrypoint. */
  environment?: Readonly<Record<string, string>>;
  /** Connect the body and preserve the life without starting cognition. */
  paused?: boolean;
}>;

export const MANAGED_RESIDENT_SET_PROTOCOL = 'behold.managed-resident-set.v1' as const;

const MANAGED_RESIDENT_SET_FIELDS = new Set([
  'entityId',
  'bodyUsername',
  'model',
  'urgentModel',
  'mind',
  'policyProfile',
  'bodyProfile',
  'actionProfile',
  'safetyProfile',
  'tickMs',
  'maxTurnSteps',
  'resumeAfterBudget',
  'task',
  'target',
  'allowTools',
  'providerQuotas',
  'providerRoute',
  'ollamaLocal',
  'paused',
]);

const RESIDENT_LEVEL_CLI_FIELDS = [
  'controller',
  'body',
  'model',
  'urgentModel',
  'mind',
  'paused',
  'policyProfile',
  'bodyProfile',
  'actionProfile',
  'safetyProfile',
  'tickMs',
  'task',
  'target',
] as const;

/** A resident-set file is an alternative to positional resident flags. */
export function assertResidentConfigExclusive(values: Readonly<Record<string, unknown>>) {
  if (!optionalText(values.residents)) return;
  const conflicts = RESIDENT_LEVEL_CLI_FIELDS.filter((field) => {
    const value = values[field];
    if (Array.isArray(value)) return value.length > 0;
    return value !== undefined && value !== null && value !== false && value !== '';
  });
  if (conflicts.length > 0) {
    throw new WorldRunnerError(
      `--residents cannot be combined with resident-level flags: ${conflicts
        .map((field) => `--${field}`)
        .join(', ')}`,
      'resident_config_cli_conflict',
      { conflicts },
    );
  }
}

/**
 * Load one explicit, versioned operator document and map it directly onto the
 * already-supported programmatic resident seam. Unknown keys fail closed so a
 * typo cannot silently turn a heterogeneous population into a defaulted one.
 */
export function loadManagedResidentSet(fileValue: string): readonly ManagedResidentSpec[] {
  const file = path.resolve(fileValue);
  let document: unknown;
  try {
    const stats = fs.lstatSync(file);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error('not a plain file');
    }
    document = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error: any) {
    throw new WorldRunnerError(
      `Resident config could not be read as a plain JSON file: ${error?.message || String(error)}`,
      'resident_config_invalid',
      { file },
    );
  }
  if (!isPlainRecord(document)) {
    throw residentConfigInvalid(file, 'resident config root must be an object');
  }
  const topLevelUnknown = Object.keys(document).filter(
    (key) => key !== 'protocol' && key !== 'residents',
  );
  if (topLevelUnknown.length > 0) {
    throw residentConfigInvalid(file, `unknown top-level field ${topLevelUnknown.join(', ')}`);
  }
  if (document.protocol !== MANAGED_RESIDENT_SET_PROTOCOL) {
    throw residentConfigInvalid(file, `wrong protocol; expected ${MANAGED_RESIDENT_SET_PROTOCOL}`);
  }
  if (!Array.isArray(document.residents) || document.residents.length === 0) {
    throw residentConfigInvalid(file, 'missing nonempty residents array');
  }

  const residents = document.residents.map((candidate, index) => {
    if (!isPlainRecord(candidate)) {
      throw residentConfigInvalid(file, `resident ${index} must be an object`);
    }
    const unknown = Object.keys(candidate).filter((key) => !MANAGED_RESIDENT_SET_FIELDS.has(key));
    if (unknown.length > 0) {
      throw residentConfigInvalid(file, `unknown resident ${index} field ${unknown.join(', ')}`);
    }
    const entityId = requiredResidentText(candidate.entityId, 'entityId', index, file);
    const model = requiredResidentText(candidate.model, 'model', index, file);
    const result: Record<string, unknown> = { entityId, model };
    for (const field of ['bodyUsername', 'urgentModel', 'task', 'target'] as const) {
      if (candidate[field] !== undefined) {
        result[field] = requiredResidentText(candidate[field], field, index, file);
      }
    }
    if (candidate.mind !== undefined) {
      if (candidate.mind !== 'direct' && candidate.mind !== 'ax') {
        throw residentConfigInvalid(file, `wrong mind for resident ${index}`);
      }
      result.mind = candidate.mind;
    }
    for (const [field, normalize] of [
      ['policyProfile', residentPolicyProfile],
      ['bodyProfile', minecraftBodyProfile],
      ['actionProfile', minecraftActionProfile],
      ['safetyProfile', minecraftSafetyProfile],
    ] as const) {
      if (candidate[field] === undefined) continue;
      try {
        result[field] = normalize(candidate[field]);
      } catch (error: any) {
        throw residentConfigInvalid(
          file,
          `wrong ${field} for resident ${index}: ${error?.message || String(error)}`,
        );
      }
    }
    for (const [field, min, max] of [
      ['tickMs', 500, Number.MAX_SAFE_INTEGER],
      ['maxTurnSteps', 1, 32],
    ] as const) {
      if (candidate[field] === undefined) continue;
      if (
        typeof candidate[field] !== 'number' ||
        !Number.isSafeInteger(candidate[field]) ||
        candidate[field] < min ||
        candidate[field] > max
      ) {
        throw residentConfigInvalid(file, `wrong ${field} type or range for resident ${index}`);
      }
      result[field] = candidate[field];
    }
    for (const field of ['resumeAfterBudget', 'paused'] as const) {
      if (candidate[field] === undefined) continue;
      if (typeof candidate[field] !== 'boolean') {
        throw residentConfigInvalid(file, `wrong ${field} type for resident ${index}`);
      }
      result[field] = candidate[field];
    }
    if (candidate.allowTools !== undefined) {
      if (
        !Array.isArray(candidate.allowTools) ||
        candidate.allowTools.some((tool) => typeof tool !== 'string' || tool.trim() === '')
      ) {
        throw residentConfigInvalid(file, `wrong allowTools type for resident ${index}`);
      }
      result.allowTools = Object.freeze(candidate.allowTools.map((tool) => tool.trim()));
    }
    if (candidate.providerQuotas !== undefined) {
      try {
        result.providerQuotas = normalizeProviderQuotas(candidate.providerQuotas);
      } catch (error: any) {
        throw residentConfigInvalid(
          file,
          `wrong providerQuotas for resident ${index}: ${error?.message || String(error)}`,
        );
      }
    }
    if (candidate.providerRoute !== undefined) {
      try {
        result.providerRoute = openRouterRoutePolicy(candidate.providerRoute);
      } catch (error: any) {
        throw residentConfigInvalid(
          file,
          `wrong providerRoute for resident ${index}: ${error?.message || String(error)}`,
        );
      }
      if ((result.mind ?? 'direct') !== 'direct') {
        throw residentConfigInvalid(file, `resident ${index} providerRoute requires direct mind`);
      }
    }
    if (candidate.ollamaLocal !== undefined) {
      try {
        result.ollamaLocal = ollamaLocalPolicy(candidate.ollamaLocal);
      } catch (error: any) {
        throw residentConfigInvalid(
          file,
          `wrong ollamaLocal for resident ${index}: ${error?.message || String(error)}`,
        );
      }
      if ((result.mind ?? 'direct') !== 'direct') {
        throw residentConfigInvalid(file, `resident ${index} ollamaLocal requires direct mind`);
      }
      if ((result.ollamaLocal as OllamaLocalPolicy).modelTag !== model) {
        throw residentConfigInvalid(file, `resident ${index} ollamaLocal tag must equal model`);
      }
      if (result.providerRoute) {
        throw residentConfigInvalid(
          file,
          `resident ${index} cannot combine providerRoute and ollamaLocal`,
        );
      }
    }
    if (result.target && !result.task) {
      throw residentConfigInvalid(file, `resident ${index} target requires task`);
    }
    return Object.freeze(result as ManagedResidentSpec);
  });
  return Object.freeze(residents);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredResidentText(value: unknown, field: string, index: number, file: string) {
  const text = optionalText(value);
  if (!text) throw residentConfigInvalid(file, `missing ${field} for resident ${index}`);
  return text;
}

function residentConfigInvalid(file: string, reason: string) {
  return new WorldRunnerError(`Resident config ${reason}`, 'resident_config_invalid', {
    file,
    reason,
  });
}

function normalizeProviderQuotas(value: unknown) {
  if (!isPlainRecord(value)) {
    throw new Error('provider quotas must be an object');
  }
  const expected = ['auxiliaryContextAttempts', 'residentDecisionAttempts'];
  const actual = Object.keys(value).sort();
  if (actual.join(',') !== expected.join(',')) {
    throw new Error(`provider quotas require exactly ${expected.join(', ')}`);
  }
  for (const field of expected) {
    const limit = value[field];
    if (!Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > 100_000_000) {
      throw new Error(`${field} must be an integer from 1 through 100000000`);
    }
  }
  return Object.freeze({
    residentDecisionAttempts: Number(value.residentDecisionAttempts),
    auxiliaryContextAttempts: Number(value.auxiliaryContextAttempts),
  });
}

/**
 * Resolve the one explicit operator-selected storage-root boundary. Descendant
 * paths remain untouched so their existing no-symlink checks still fail closed.
 */
export function resolveManagedDataRoot(candidate: string, label: string) {
  const requested = path.resolve(candidate);
  try {
    fs.lstatSync(requested);
  } catch (error: any) {
    if (error?.code === 'ENOENT') return requested;
    throw new WorldRunnerError(
      `Managed ${label} could not be inspected: ${error?.message || String(error)}`,
      'resident_root_invalid',
      { label, requested },
    );
  }
  try {
    const canonical = fs.realpathSync.native(requested);
    const stats = fs.lstatSync(canonical);
    if (!stats.isDirectory() || stats.isSymbolicLink())
      throw new Error('target is not a plain directory');
    return canonical;
  } catch (error: any) {
    throw new WorldRunnerError(
      `Managed ${label} must resolve to a plain directory: ${error?.message || String(error)}`,
      'resident_root_invalid',
      { label, requested },
    );
  }
}

export type ManagedWorldRunOptions = Readonly<{
  worldId: string;
  world: WorldLabDefinition;
  controlRoot: string;
  serverDirectory: string;
  serverJar: string;
  expectedServerJarSha256: string;
  java: string;
  controllerEntry: string;
  entityRoot: string;
  runRoot: string;
  residents: readonly ManagedResidentSpec[];
  maxResidents?: number;
  maxConcurrentModelCalls?: number;
  maxTotalModelCalls?: number;
  /** Stable experiment identity required when per-resident provider quotas are configured. */
  accountingScopeId?: string;
  /** Plain local config proving Ollama cloud routes are disabled. */
  ollamaServerConfigFile?: string;
  residentStartupDelayMs?: number;
  startupTimeoutMs?: number;
  shutdownTimeoutMs?: number;
}>;

export type WorldRunnerDependencies = Readonly<{
  inspectRuntime?: () => Promise<RuntimeInspection>;
  verifyArtifacts?: () => Promise<{ artifactIntegrityOk: boolean; artifacts: unknown }>;
  spawnServer?: () => ChildProcessWithoutNullStreams;
  spawnController?: (context: {
    runId: string;
    resident: ManagedResidentSpec;
    index: number;
    leasePath: string;
    journalDirectory: string;
    environment: Readonly<NodeJS.ProcessEnv>;
  }) => ChildProcessWithoutNullStreams;
  /** Deterministic provider-free upstream used only by managed integration fixtures. */
  cognitionFetch?: typeof fetch;
  /** Read-only local Ollama version/tags/show/ps preflight fixture. */
  ollamaPreflightFetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}>;

export type ManagedWorldRun = Readonly<{
  runId: string;
  control: HeldWorldControl;
  serverPid: number;
  residents: readonly Readonly<{
    entityId: string;
    bodyUsername: string;
    model: string;
    urgentModel: string | null;
    mind: 'direct' | 'ax';
    policyProfile: ResidentPolicyProfile;
    bodyProfile: MinecraftBodyProfile;
    actionProfile: MinecraftActionProfile;
    safetyProfile: MinecraftSafetyProfile;
    tickMs: number;
    maxTurnSteps: number | null;
    resumeAfterBudget: boolean | null;
    providerQuotas: ManagedResidentSpec['providerQuotas'] | null;
    providerRoute: OpenRouterRoutePolicy | null;
    ollamaLocal: OllamaLocalPolicy | null;
    paused: boolean;
    pid: number;
    leasePath: string;
    journalDirectory: string;
  }>[];
  cognition: Readonly<{
    brokerId: string;
    concurrencyLimit: number;
    maxTotalModelCalls: number | null;
    journalFile: string;
    transportCaptureDirectory: string;
    accountingSnapshot(): ReturnType<CognitionBroker['snapshot']>['accounting'];
    admissionLimitReached: CognitionBroker['admissionLimitReached'];
    admissionLimitSettled: CognitionBroker['admissionLimitSettled'];
    ollamaPreflight: OllamaLocalPreflight | null;
  }> | null;
  experimentRelease: Readonly<{
    releaseId: string;
    planFile: string;
    planSha256: string;
    releaseFile: string;
    lifecycleSequence: number;
    lifecycleDigest: string;
  }> | null;
  finished: Promise<void>;
  quiesceResidents(reason?: string): Promise<void>;
  stop(reason?: string): Promise<void>;
}>;

export type ManagedWorldRecoveryOptions = Readonly<{
  worldId: string;
  world: WorldLabDefinition;
  controlRoot: string;
  entityRoot: string;
}>;

export type ManagedWorldRecovery = Readonly<{
  protocol: 'behold.world-recovery-result.v1';
  world: string;
  epoch: number;
  classification: 'abandoned_after_save_ack' | 'abandoned_unclean_shutdown';
  preparedEvidence: string;
  completedEvidence: string;
}>;

export class WorldRunnerError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly evidence?: unknown,
  ) {
    super(message);
    this.name = 'WorldRunnerError';
  }
}

export type ManagedWorldResetOptions = Readonly<{
  worldId: string;
  world: WorldLabDefinition;
  control: HeldWorldControl;
  resetRunId: string;
  entityRoot: string;
}>;

type ManagedResetTestDependencies = Omit<
  WorldLabDependencies,
  'fixtureExecutionCapability' | 'managedResetCapability'
> & {
  fixtureExecutionCapability: FixtureExecutionCapability;
};

type NormalizedManagedResident = Readonly<{
  entityId: string;
  bodyUsername: string;
  model: string;
  urgentModel?: string;
  mind: 'direct' | 'ax';
  policyProfile: ResidentPolicyProfile;
  bodyProfile: MinecraftBodyProfile;
  actionProfile: MinecraftActionProfile;
  safetyProfile: MinecraftSafetyProfile;
  tickMs: number;
  maxTurnSteps?: number;
  resumeAfterBudget?: boolean;
  task?: string;
  target?: string;
  allowTools?: readonly string[];
  providerQuotas?: Readonly<{
    residentDecisionAttempts: number;
    auxiliaryContextAttempts: number;
  }>;
  providerRoute?: OpenRouterRoutePolicy;
  ollamaLocal?: OllamaLocalPolicy;
  environment: Readonly<Record<string, string>>;
  paused: boolean;
  leasePath: string;
}>;

type ManagedResidentProcess = Readonly<{
  resident: NormalizedManagedResident;
  journalDirectory: string;
  child: ChildProcessWithoutNullStreams;
  exit: Promise<ProcessExit>;
  output: OutputCapture;
}>;

type ManagedCognition = Readonly<{
  broker: CognitionBroker;
  clients: ReadonlyMap<
    string,
    Readonly<{
      bearer: string;
      residentKey: string;
      model: string;
      models?: readonly string[];
      routePolicy?: OpenRouterRoutePolicy;
      ollamaLocal?: OllamaLocalPolicy;
      accounting?: {
        scopeId: string;
        worldId: string;
        accountId: string;
        ledgerFile: string;
        limits: { resident_decision: number; loom_fold: number };
      };
    }>
  >;
  concurrencyLimit: number;
  maxTotalModelCalls: number | null;
  ollamaPreflight: OllamaLocalPreflight | null;
}>;

type ManagedExperimentRelease = Readonly<{
  prepared: PreparedExperimentRelease;
  initialAccounting: NonNullable<ReturnType<CognitionBroker['snapshot']>['accounting']>;
}>;

function normalizeManagedResidents(
  options: ManagedWorldRunOptions,
): readonly NormalizedManagedResident[] {
  if (!path.isAbsolute(options.entityRoot) || !path.isAbsolute(options.runRoot)) {
    throw new WorldRunnerError(
      'Managed entity and run roots must be absolute',
      'resident_root_not_absolute',
      { entityRoot: options.entityRoot, runRoot: options.runRoot },
    );
  }
  const maxResidents = options.maxResidents ?? 16;
  if (!Number.isSafeInteger(maxResidents) || maxResidents < 1) {
    throw new WorldRunnerError(
      'maxResidents must be a positive safe integer',
      'resident_limit_invalid',
      { maxResidents },
    );
  }
  const residentStartupDelayMs = options.residentStartupDelayMs ?? 0;
  if (
    !Number.isSafeInteger(residentStartupDelayMs) ||
    residentStartupDelayMs < 0 ||
    residentStartupDelayMs > 60_000
  ) {
    throw new WorldRunnerError(
      'residentStartupDelayMs must be a safe integer from 0 through 60000',
      'resident_start_delay_invalid',
      { residentStartupDelayMs },
    );
  }
  if (!Array.isArray(options.residents) || options.residents.length === 0) {
    throw new WorldRunnerError(
      'A managed world requires at least one resident',
      'resident_set_empty',
    );
  }
  if (options.residents.length > maxResidents) {
    throw new WorldRunnerError(
      `Configured ${options.residents.length} residents exceeds the process budget ${maxResidents}`,
      'resident_limit_exceeded',
      { residentCount: options.residents.length, maxResidents },
    );
  }

  const entityRoot = path.resolve(options.entityRoot);
  const identities = new Map<string, string>();
  const bodyUsernames = new Map<string, string>();
  const leasePaths = new Map<string, string>();
  const residents = Object.freeze(
    options.residents.map((candidate, index) => {
      const entityId = optionalText(candidate?.entityId);
      const model = optionalText(candidate?.model);
      const urgentModel = optionalText(candidate?.urgentModel);
      if (
        !entityId ||
        !model ||
        model.length > 300 ||
        (urgentModel != null && urgentModel.length > 300)
      ) {
        throw new WorldRunnerError(
          'Every resident requires a nonempty bounded entityId and model configuration',
          'resident_identity_invalid',
          {
            index,
            entityId: candidate?.entityId,
            model: candidate?.model,
            urgentModel: candidate?.urgentModel,
          },
        );
      }
      const safeEntityId = sanitizeName(entityId);
      const identityKey = safeEntityId.normalize('NFKC').toLowerCase();
      const priorIdentity = identities.get(identityKey);
      if (priorIdentity) {
        throw new WorldRunnerError(
          `Resident identities ${priorIdentity} and ${entityId} share one canonical body path`,
          'resident_identity_collision',
          { index, entityId, priorIdentity, canonical: safeEntityId },
        );
      }
      identities.set(identityKey, entityId);

      const bodyUsername = optionalText(candidate.bodyUsername) ?? entityId;
      if (!/^[A-Za-z0-9_]{1,16}$/.test(bodyUsername)) {
        throw new WorldRunnerError(
          `Resident ${entityId} has an invalid Minecraft body username`,
          'resident_body_identity_invalid',
          { index, entityId, bodyUsername },
        );
      }
      const bodyKey = bodyUsername.normalize('NFKC').toLowerCase();
      const priorBody = bodyUsernames.get(bodyKey);
      if (priorBody) {
        throw new WorldRunnerError(
          `Resident lives ${priorBody} and ${entityId} cannot simultaneously inhabit Minecraft body ${bodyUsername}`,
          'resident_body_identity_collision',
          { index, entityId, priorEntityId: priorBody, bodyUsername },
        );
      }
      bodyUsernames.set(bodyKey, entityId);

      const mind = candidate.mind ?? 'direct';
      if (mind !== 'direct' && mind !== 'ax') {
        throw new WorldRunnerError(
          `Unsupported mind adapter for ${entityId}: ${String(mind)}`,
          'resident_mind_invalid',
          { index, entityId, mind },
        );
      }
      let policyProfile: ResidentPolicyProfile;
      let bodyProfile: MinecraftBodyProfile;
      let actionProfile: MinecraftActionProfile;
      let safetyProfile: MinecraftSafetyProfile;
      try {
        policyProfile = residentPolicyProfile(candidate.policyProfile);
        bodyProfile = minecraftBodyProfile(
          candidate.bodyProfile ??
            (policyProfile === 'neutral-benchmark-v1'
              ? 'minecraft-human-semantic-v1'
              : 'minecraft-resident-v1'),
        );
        actionProfile = minecraftActionProfile(
          candidate.actionProfile ??
            (policyProfile === 'neutral-benchmark-v1'
              ? 'minecraft-human-semantic-v1'
              : 'resident-v1'),
        );
        if (
          usesHumanSemanticBody(bodyProfile) !==
          (actionProfile === 'minecraft-human-semantic-v1')
        ) {
          throw new Error(
            `body profile ${bodyProfile} must be paired with its matching action profile; received ${actionProfile}`,
          );
        }
        safetyProfile = minecraftSafetyProfile(
          candidate.safetyProfile ??
            (policyProfile === 'neutral-benchmark-v1' ? 'vanilla-player-v1' : 'resident-safe-v1'),
        );
      } catch (error: any) {
        throw new WorldRunnerError(
          `Invalid resident profile for ${entityId}: ${error?.message || String(error)}`,
          'resident_profile_invalid',
          {
            index,
            entityId,
            policyProfile: candidate.policyProfile,
            bodyProfile: candidate.bodyProfile,
            actionProfile: candidate.actionProfile,
            safetyProfile: candidate.safetyProfile,
          },
        );
      }
      const tickMs = candidate.tickMs ?? 4000;
      if (!Number.isSafeInteger(tickMs) || tickMs < 500) {
        throw new WorldRunnerError(
          `Resident ${entityId} tickMs must be an integer of at least 500ms`,
          'resident_tick_budget_invalid',
          { index, entityId, tickMs },
        );
      }
      const maxTurnSteps = candidate.maxTurnSteps;
      if (
        maxTurnSteps != null &&
        (!Number.isSafeInteger(maxTurnSteps) || maxTurnSteps < 1 || maxTurnSteps > 32)
      ) {
        throw new WorldRunnerError(
          `Resident ${entityId} maxTurnSteps must be an integer from 1 through 32`,
          'resident_turn_step_budget_invalid',
          { index, entityId, maxTurnSteps },
        );
      }
      if (candidate.resumeAfterBudget != null && typeof candidate.resumeAfterBudget !== 'boolean') {
        throw new WorldRunnerError(
          `Resident ${entityId} resumeAfterBudget must be a boolean`,
          'resident_turn_resume_invalid',
          { index, entityId, resumeAfterBudget: candidate.resumeAfterBudget },
        );
      }
      let providerQuotas: ManagedResidentSpec['providerQuotas'];
      try {
        providerQuotas =
          candidate.providerQuotas == null
            ? undefined
            : normalizeProviderQuotas(candidate.providerQuotas);
      } catch (error: any) {
        throw new WorldRunnerError(
          `Resident ${entityId} has invalid provider quotas: ${error?.message || String(error)}`,
          'resident_provider_quota_invalid',
          { index, entityId, providerQuotas: candidate.providerQuotas },
        );
      }
      let providerRoute: OpenRouterRoutePolicy | undefined;
      try {
        providerRoute =
          candidate.providerRoute == null
            ? undefined
            : openRouterRoutePolicy(candidate.providerRoute);
      } catch (error: any) {
        throw new WorldRunnerError(
          `Resident ${entityId} has invalid provider route: ${error?.message || String(error)}`,
          'resident_provider_route_invalid',
          { index, entityId, providerRoute: candidate.providerRoute },
        );
      }
      if (providerRoute && mind !== 'direct') {
        throw new WorldRunnerError(
          `Resident ${entityId} provider route requires the direct mind adapter`,
          'resident_provider_route_mind_invalid',
          { index, entityId, mind },
        );
      }
      let ollamaLocal: OllamaLocalPolicy | undefined;
      try {
        ollamaLocal =
          candidate.ollamaLocal == null ? undefined : ollamaLocalPolicy(candidate.ollamaLocal);
      } catch (error: any) {
        throw new WorldRunnerError(
          `Resident ${entityId} has invalid Ollama policy: ${error?.message || String(error)}`,
          'resident_ollama_policy_invalid',
          { index, entityId, ollamaLocal: candidate.ollamaLocal },
        );
      }
      if (ollamaLocal && mind !== 'direct') {
        throw new WorldRunnerError(
          `Resident ${entityId} Ollama policy requires the direct mind adapter`,
          'resident_ollama_mind_invalid',
          { index, entityId, mind },
        );
      }
      if (ollamaLocal && ollamaLocal.modelTag !== model) {
        throw new WorldRunnerError(
          `Resident ${entityId} Ollama tag must equal its configured model`,
          'resident_ollama_model_invalid',
          { index, entityId, model, modelTag: ollamaLocal.modelTag },
        );
      }
      if (ollamaLocal && urgentModel) {
        throw new WorldRunnerError(
          `Resident ${entityId} Ollama pilot does not admit a second urgent model`,
          'resident_ollama_urgent_model_unsupported',
          { index, entityId, urgentModel },
        );
      }
      if (ollamaLocal && providerRoute) {
        throw new WorldRunnerError(
          `Resident ${entityId} cannot combine OpenRouter and Ollama transport`,
          'resident_transport_policy_conflict',
          { index, entityId },
        );
      }
      if (candidate.target && !candidate.task) {
        throw new WorldRunnerError(
          `Resident ${entityId} has a target without a task`,
          'controller_target_without_task',
          { index, entityId, target: candidate.target },
        );
      }
      const environment = normalizeResidentEnvironment(candidate.environment, entityId);
      const leasePath = path.join(entityRoot, safeEntityId, 'runtime.lock');
      const leaseKey =
        process.platform === 'win32' || process.platform === 'darwin'
          ? leasePath.normalize('NFKC').toLowerCase()
          : leasePath;
      const priorLease = leasePaths.get(leaseKey);
      if (priorLease) {
        throw new WorldRunnerError(
          `Resident ${entityId} shares a lease path with ${priorLease}`,
          'resident_lease_collision',
          { index, entityId, priorIdentity: priorLease, leasePath },
        );
      }
      leasePaths.set(leaseKey, entityId);
      return Object.freeze({
        entityId,
        bodyUsername,
        model,
        ...(urgentModel && urgentModel !== model ? { urgentModel } : {}),
        mind,
        policyProfile,
        bodyProfile,
        actionProfile,
        safetyProfile,
        tickMs,
        ...(maxTurnSteps == null ? {} : { maxTurnSteps }),
        ...(candidate.resumeAfterBudget == null
          ? {}
          : { resumeAfterBudget: candidate.resumeAfterBudget }),
        ...(candidate.task ? { task: String(candidate.task) } : {}),
        ...(candidate.target ? { target: String(candidate.target) } : {}),
        ...(candidate.allowTools ? { allowTools: Object.freeze([...candidate.allowTools]) } : {}),
        ...(providerQuotas ? { providerQuotas } : {}),
        ...(providerRoute ? { providerRoute } : {}),
        ...(ollamaLocal ? { ollamaLocal } : {}),
        environment,
        paused: candidate.paused === true,
        leasePath,
      });
    }),
  );
  const activeResidents = residents.filter((resident) => !resident.paused);
  const routedResidents = activeResidents.filter((resident) => resident.providerRoute != null);
  if (routedResidents.length > 0 && routedResidents.length !== activeResidents.length) {
    throw new WorldRunnerError(
      'Provider route control must cover every active resident or none of them',
      'resident_provider_route_population_incomplete',
      {
        configured: routedResidents.map((resident) => resident.entityId),
        missing: activeResidents
          .filter((resident) => resident.providerRoute == null)
          .map((resident) => resident.entityId),
      },
    );
  }
  const outputCaps = new Set(
    routedResidents.map((resident) => resident.providerRoute!.maxOutputTokens),
  );
  if (outputCaps.size > 1) {
    throw new WorldRunnerError(
      'Route-controlled residents must share one exact provider output cap',
      'resident_provider_route_output_cap_mismatch',
      {
        residents: routedResidents.map((resident) => ({
          entityId: resident.entityId,
          maxOutputTokens: resident.providerRoute!.maxOutputTokens,
        })),
      },
    );
  }
  const ollamaResidents = activeResidents.filter((resident) => resident.ollamaLocal != null);
  if (ollamaResidents.length > 0 && ollamaResidents.length !== activeResidents.length) {
    throw new WorldRunnerError(
      'Local Ollama control must cover every active resident or none of them',
      'resident_ollama_population_incomplete',
      {
        configured: ollamaResidents.map((resident) => resident.entityId),
        missing: activeResidents
          .filter((resident) => resident.ollamaLocal == null)
          .map((resident) => resident.entityId),
      },
    );
  }
  if (ollamaResidents.length > 0 && routedResidents.length > 0) {
    throw new WorldRunnerError(
      'A managed population cannot mix local Ollama and OpenRouter route policy',
      'resident_transport_population_conflict',
    );
  }
  const ollamaEndpoints = new Set(
    ollamaResidents.map((resident) => resident.ollamaLocal!.endpoint),
  );
  const ollamaSettings = new Set(
    ollamaResidents.map((resident) => JSON.stringify(resident.ollamaLocal!.settings)),
  );
  const ollamaTransports = new Set(
    ollamaResidents.map((resident) =>
      JSON.stringify({
        protocol: resident.ollamaLocal!.transport.protocol,
        schemaProtocol: resident.ollamaLocal!.transport.schemaProtocol,
        schemaSha256: resident.ollamaLocal!.transport.schemaSha256,
      }),
    ),
  );
  if (ollamaEndpoints.size > 1 || ollamaSettings.size > 1 || ollamaTransports.size > 1) {
    throw new WorldRunnerError(
      'Local Ollama residents must share one endpoint, JSON action transport/schema, and exact output, context, temperature, and load settings',
      'resident_ollama_common_settings_mismatch',
      {
        residents: ollamaResidents.map((resident) => ({
          entityId: resident.entityId,
          endpoint: resident.ollamaLocal!.endpoint,
          transport: resident.ollamaLocal!.transport,
          settings: resident.ollamaLocal!.settings,
        })),
      },
    );
  }
  return Object.freeze(residents);
}

type ManagedProviderAccounting = Readonly<{
  scopeId: string;
  scopeDigest: string;
  accounts: ReadonlyMap<
    string,
    Readonly<{
      accountId: string;
      ledgerFile: string;
      limits: Readonly<{ resident_decision: number; loom_fold: number }>;
    }>
  >;
}>;

function managedProviderAccounting(
  options: ManagedWorldRunOptions,
  residents: readonly NormalizedManagedResident[],
): ManagedProviderAccounting | null {
  const configured = residents.filter((resident) => resident.providerQuotas != null);
  const requestedScope = optionalText(options.accountingScopeId);
  if (configured.length === 0) {
    if (requestedScope) {
      throw new WorldRunnerError(
        'accountingScopeId requires providerQuotas for every resident',
        'provider_accounting_scope_without_quotas',
        { accountingScopeId: requestedScope },
      );
    }
    return null;
  }
  if (configured.length !== residents.length) {
    throw new WorldRunnerError(
      'Per-resident provider quotas must be configured for the whole population',
      'provider_quota_population_incomplete',
      {
        configured: configured.map((resident) => resident.entityId),
        missing: residents
          .filter((resident) => resident.providerQuotas == null)
          .map((resident) => resident.entityId),
      },
    );
  }
  const paused = residents.filter((resident) => resident.paused);
  if (paused.length > 0) {
    throw new WorldRunnerError(
      'Release-gated residents must keep their normal policy and broker credentials armed',
      'provider_release_paused_resident',
      { residents: paused.map((resident) => resident.entityId) },
    );
  }
  if (!requestedScope || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(requestedScope)) {
    throw new WorldRunnerError(
      'Per-resident provider quotas require a bounded explicit accountingScopeId',
      'provider_accounting_scope_invalid',
      { accountingScopeId: options.accountingScopeId ?? null },
    );
  }
  const shared = configured[0].providerQuotas!;
  const mismatched = configured.filter(
    (resident) =>
      resident.providerQuotas!.residentDecisionAttempts !== shared.residentDecisionAttempts ||
      resident.providerQuotas!.auxiliaryContextAttempts !== shared.auxiliaryContextAttempts,
  );
  if (mismatched.length > 0) {
    throw new WorldRunnerError(
      'Quota-controlled residents must have equal provider-attempt budgets',
      'provider_quota_population_mismatch',
      { residents: mismatched.map((resident) => resident.entityId) },
    );
  }
  const bodyContract = {
    bodyProfile: configured[0].bodyProfile,
    actionProfile: configured[0].actionProfile,
    safetyProfile: configured[0].safetyProfile,
  };
  const bodyMismatches = configured.filter(
    (resident) =>
      resident.bodyProfile !== bodyContract.bodyProfile ||
      resident.actionProfile !== bodyContract.actionProfile ||
      resident.safetyProfile !== bodyContract.safetyProfile,
  );
  if (bodyMismatches.length > 0) {
    throw new WorldRunnerError(
      'Release-gated residents must share one exact observation, action, and safety body contract',
      'experiment_release_body_contract_mismatch',
      {
        expected: bodyContract,
        residents: bodyMismatches.map((resident) => ({
          entityId: resident.entityId,
          bodyProfile: resident.bodyProfile,
          actionProfile: resident.actionProfile,
          safetyProfile: resident.safetyProfile,
        })),
      },
    );
  }
  const scopeDigest = sha256Bytes(Buffer.from(requestedScope));
  const ledgerRoot = path.join(
    path.resolve(options.controlRoot),
    'accounting',
    scopeDigest,
    'provider',
  );
  return Object.freeze({
    scopeId: requestedScope,
    scopeDigest,
    accounts: new Map(
      residents.map((resident) => {
        const accountId = cognitionAccountId(requestedScope, options.worldId, resident.entityId);
        return [
          resident.entityId,
          Object.freeze({
            accountId,
            ledgerFile: path.join(ledgerRoot, `${accountId}.jsonl`),
            limits: Object.freeze({
              resident_decision: resident.providerQuotas!.residentDecisionAttempts,
              loom_fold: resident.providerQuotas!.auxiliaryContextAttempts,
            }),
          }),
        ];
      }),
    ),
  });
}

function matchedReleaseAccounting(
  cognition: ManagedCognition,
  configured: ManagedProviderAccounting,
  residents: readonly NormalizedManagedResident[],
): NonNullable<ReturnType<CognitionBroker['snapshot']>['accounting']> {
  const accounting = cognition.broker.snapshot().accounting;
  if (!accounting || accounting.accounts.length !== residents.length) {
    throw new WorldRunnerError(
      'Release cognition accounting does not cover the exact resident population',
      'experiment_release_accounting_incomplete',
      { expected: residents.length, actual: accounting?.accounts.length ?? 0 },
    );
  }
  const balances = new Set<string>();
  for (const resident of residents) {
    const expected = configured.accounts.get(resident.entityId)!;
    const actual = accounting.accounts.find((account) => account.accountId === expected.accountId);
    if (
      !actual ||
      actual.file !== expected.ledgerFile ||
      actual.scopeId !== configured.scopeId ||
      actual.worldId !== residentWorldId(cognition, resident.entityId) ||
      actual.layer !== 'provider' ||
      actual.limits.resident_decision !== expected.limits.resident_decision ||
      actual.limits.loom_fold !== expected.limits.loom_fold ||
      actual.unsettled !== 0
    ) {
      throw new WorldRunnerError(
        `Release quota account mismatches ${resident.entityId}`,
        'experiment_release_accounting_mismatch',
        { entityId: resident.entityId, expected, actual: actual ?? null },
      );
    }
    balances.add(
      JSON.stringify({ limits: actual.limits, used: actual.used, remaining: actual.remaining }),
    );
  }
  if (balances.size !== 1) {
    throw new WorldRunnerError(
      'Release-gated residents do not have equal remaining per-purpose budgets',
      'experiment_release_accounting_unmatched',
      { accounts: accounting.accounts },
    );
  }
  return accounting;
}

function residentWorldId(cognition: ManagedCognition, entityId: string) {
  const worldId = cognition.clients.get(entityId)?.accounting?.worldId;
  if (!worldId) throw new Error(`Cognition accounting world is missing for ${entityId}`);
  return worldId;
}

function sameAccountingSnapshot(
  left: NonNullable<ReturnType<CognitionBroker['snapshot']>['accounting']>,
  right: NonNullable<ReturnType<CognitionBroker['snapshot']>['accounting']>,
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function managedModelConcurrencyLimit(options: ManagedWorldRunOptions, residentCount: number) {
  const value = options.maxConcurrentModelCalls ?? Math.min(2, residentCount);
  if (!Number.isSafeInteger(value) || value < 1 || value > residentCount) {
    throw new WorldRunnerError(
      `maxConcurrentModelCalls must be an integer from 1 through ${residentCount}`,
      'model_concurrency_limit_invalid',
      { value, residentCount },
    );
  }
  return value;
}

function controllerRecords(residents: readonly ManagedResidentProcess[]) {
  return residents.map((entry) => ({
    entityId: entry.resident.entityId,
    pid: entry.child.pid!,
    leasePath: entry.resident.leasePath,
  }));
}

function publicResidentRecords(residents: readonly ManagedResidentProcess[]) {
  return Object.freeze(
    residents.map((entry) =>
      Object.freeze({
        entityId: entry.resident.entityId,
        bodyUsername: entry.resident.bodyUsername,
        model: entry.resident.model,
        urgentModel: entry.resident.urgentModel ?? null,
        mind: entry.resident.mind,
        policyProfile: entry.resident.policyProfile,
        bodyProfile: entry.resident.bodyProfile,
        actionProfile: entry.resident.actionProfile,
        safetyProfile: entry.resident.safetyProfile,
        tickMs: entry.resident.tickMs,
        maxTurnSteps: entry.resident.maxTurnSteps ?? null,
        resumeAfterBudget: entry.resident.resumeAfterBudget ?? null,
        providerQuotas: entry.resident.providerQuotas ?? null,
        providerRoute: entry.resident.providerRoute ?? null,
        ollamaLocal: entry.resident.ollamaLocal ?? null,
        paused: entry.resident.paused,
        pid: entry.child.pid!,
        leasePath: entry.resident.leasePath,
        journalDirectory: entry.journalDirectory,
      }),
    ),
  );
}

/**
 * Runs the canonical world-lab transaction beneath an already-held lifecycle
 * owner. This seam is programmatic until crash recovery and a named baseline
 * are proven; the standalone world-lab CLI remains dry-run only.
 */
export async function resetHeldManagedWorld(
  options: ManagedWorldResetOptions,
): Promise<ResetResult> {
  return resetHeldManagedWorldInternal(options, {});
}

/** Test-only dependency seam, structurally confined to an issued temporary fixture. */
export async function resetHeldManagedWorldFixture(
  options: ManagedWorldResetOptions,
  dependencies: ManagedResetTestDependencies,
): Promise<ResetResult> {
  assertFixtureExecutionScope(dependencies.fixtureExecutionCapability, [
    options.world.source.path,
    options.world.preparedBaseline?.path ?? options.world.source.path,
    options.world.runtime.worldPath,
    options.world.runtime.archiveRoot,
    options.entityRoot,
  ]);
  const { fixtureExecutionCapability: _fixtureExecutionCapability, ...fixtureDependencies } =
    dependencies;
  return resetHeldManagedWorldInternal(options, fixtureDependencies);
}

async function resetHeldManagedWorldInternal(
  options: ManagedWorldResetOptions,
  dependencies: WorldLabDependencies,
): Promise<ResetResult> {
  const planned = await resetWorld(
    options.worldId,
    options.world,
    { mode: 'dry-run', runId: options.resetRunId },
    dependencies,
  );
  const plan = planned.plan;
  const scope: ManagedWorldResetScope = {
    world: options.worldId,
    runId: options.resetRunId,
    worldConfigDigest: worldLabDefinitionDigest(options.world),
    baselinePath: plan.baselinePath,
    baselineDigest: plan.expectedBaselineDigest,
    runtimePath: plan.runtimePath,
    archiveRoot: path.dirname(plan.archivePath),
    stagePath: plan.stagePath,
    archivePath: plan.archivePath,
    entityRoot: path.resolve(options.entityRoot),
    circleIds: worldCircleIds(options.worldId, options.world),
  };
  const capability = issueManagedWorldResetCapability(options.control, scope);
  try {
    const result = await resetWorld(
      options.worldId,
      options.world,
      { mode: 'execute', runId: options.resetRunId },
      { ...dependencies, managedResetCapability: capability },
    );
    const stopped = await statusWorld(options.worldId, options.world, dependencies);
    assertStoppedEvidence(stopped, 'after_managed_reset');
    const activatedDigest = digestTree(options.world.runtime.worldPath).digest;
    if (activatedDigest !== plan.expectedBaselineDigest) {
      throw new WorldRunnerError(
        'Managed reset activated an unexpected runtime digest',
        'managed_reset_digest_mismatch',
        { expected: plan.expectedBaselineDigest, actual: activatedDigest },
      );
    }
    settleManagedWorldResetCapability(capability, 'completed');
    return result;
  } catch (error) {
    try {
      settleManagedWorldResetCapability(capability, 'recovery_required');
    } catch {}
    throw error;
  }
}

export async function startManagedWorld(
  options: ManagedWorldRunOptions,
  dependencies: WorldRunnerDependencies = {},
): Promise<ManagedWorldRun> {
  const residents = normalizeManagedResidents(options);
  const activeOllamaPolicies = residents
    .filter((resident) => !resident.paused && resident.ollamaLocal != null)
    .map((resident) => resident.ollamaLocal!);
  const providerAccounting = managedProviderAccounting(options, residents);
  if (activeOllamaPolicies.length > 0 && !providerAccounting) {
    throw new WorldRunnerError(
      'Local Ollama managed runs require per-resident quotas and a durable experiment release',
      'resident_ollama_release_accounting_missing',
    );
  }
  const ollamaPreflight =
    activeOllamaPolicies.length > 0
      ? await preflightOllamaLocal({
          policies: activeOllamaPolicies,
          cloudConfigFile:
            options.ollamaServerConfigFile ?? path.join(os.homedir(), '.ollama', 'server.json'),
          ...(dependencies.ollamaPreflightFetch
            ? { fetch: dependencies.ollamaPreflightFetch }
            : {}),
          ...(dependencies.now ? { now: dependencies.now } : {}),
        })
      : null;
  const cognitionResidentCount = residents.filter((resident) => !resident.paused).length;
  const maxConcurrentModelCalls =
    cognitionResidentCount > 0 ? managedModelConcurrencyLimit(options, cognitionResidentCount) : 0;
  const maxTotalModelCalls = managedTotalModelCallLimit(options.maxTotalModelCalls);
  if (providerAccounting && maxTotalModelCalls != null) {
    throw new WorldRunnerError(
      'Per-resident purpose quotas cannot be combined with the purpose-blind population call limit',
      'provider_accounting_aggregate_limit_conflict',
      { accountingScopeId: providerAccounting.scopeId, maxTotalModelCalls },
    );
  }
  const inspectRuntime =
    dependencies.inspectRuntime ?? (() => statusWorld(options.worldId, options.world));
  const verifyArtifacts =
    dependencies.verifyArtifacts ?? (() => verifyWorld(options.worldId, options.world));
  const sleep =
    dependencies.sleep ?? ((milliseconds) => new Promise((r) => setTimeout(r, milliseconds)));
  const stdout = dependencies.stdout ?? ((text) => process.stdout.write(text));
  const stderr = dependencies.stderr ?? ((text) => process.stderr.write(text));
  const startupTimeoutMs = Math.max(100, options.startupTimeoutMs ?? 60_000);
  const shutdownTimeoutMs = Math.max(100, options.shutdownTimeoutMs ?? 60_000);
  const entityRoot = path.resolve(options.entityRoot);
  const runRoot = path.resolve(options.runRoot);
  const circleIds = worldCircleIds(options.worldId, options.world);

  const existingControl = inspectWorldControl(options.controlRoot, options.worldId);
  if (existingControl.state !== 'clear') {
    throw new WorldRunnerError(
      `World control is ${existingControl.state}: ${existingControl.file}`,
      'world_control_not_clear',
      existingControl,
    );
  }
  const verification = await verifyArtifacts();
  if (!verification.artifactIntegrityOk) {
    throw new WorldRunnerError(
      'World source or prepared baseline failed integrity verification',
      'world_artifact_integrity_failed',
      verification.artifacts,
    );
  }
  const before = await inspectRuntime();
  assertStoppedEvidence(before, 'before_control_acquisition');
  assertNoWorldControllerLeases(entityRoot, residents, circleIds, 'before_control_acquisition');
  if (providerAccounting && !options.world.preparedBaseline) {
    throw new WorldRunnerError(
      'Release-gated experiments require a verified prepared baseline digest',
      'experiment_release_baseline_missing',
      { worldId: options.worldId },
    );
  }
  const stoppedRuntimeDigest = providerAccounting
    ? digestTree(options.world.runtime.worldPath).digest
    : null;
  const jarSha256 = sha256File(options.serverJar);
  if (jarSha256 !== options.expectedServerJarSha256.toLowerCase()) {
    throw new WorldRunnerError(
      'Minecraft server jar digest mismatch',
      'server_jar_digest_mismatch',
      {
        file: options.serverJar,
        expected: options.expectedServerJarSha256,
        actual: jarSha256,
      },
    );
  }

  const control = acquireWorldControl({
    controlRoot: options.controlRoot,
    world: options.worldId,
    runtimePath: options.world.runtime.worldPath,
    now: dependencies.now,
  });
  const managedRunId = `${options.worldId}-${control.record().epoch}`;
  let server: ChildProcessWithoutNullStreams | null = null;
  let serverExit: Promise<ProcessExit> | null = null;
  let serverOutput: OutputCapture | null = null;
  const controllerProcesses: ManagedResidentProcess[] = [];
  let cognition: ManagedCognition | null = null;
  let experiment: ManagedExperimentRelease | null = null;
  let committedExperimentRelease: ManagedWorldRun['experimentRelease'] = null;
  let stopping = false;
  let residentsQuiescing = false;

  try {
    const fenced = await inspectRuntime();
    assertStoppedEvidence(fenced, 'after_control_acquisition');
    assertNoWorldControllerLeases(entityRoot, residents, circleIds, 'after_control_acquisition');
    const launchJarSha256 = sha256File(options.serverJar);
    if (launchJarSha256 !== jarSha256) {
      throw new WorldRunnerError(
        'Minecraft server jar changed after control acquisition',
        'server_jar_changed_before_launch',
        { before: jarSha256, after: launchJarSha256 },
      );
    }
    if (
      stoppedRuntimeDigest &&
      digestTree(options.world.runtime.worldPath).digest !== stoppedRuntimeDigest
    ) {
      throw new WorldRunnerError(
        'Release-gated world changed between verification and fenced launch',
        'experiment_release_world_drift',
        { phase: 'before_server_launch', expected: stoppedRuntimeDigest },
      );
    }
    const upstreamApiKey = optionalText(process.env.OPENROUTER_API_KEY);
    if ((upstreamApiKey || ollamaPreflight) && cognitionResidentCount > 0) {
      const clients = new Map(
        residents
          .filter((resident) => !resident.paused)
          .map((resident) => {
            const accounting = providerAccounting?.accounts.get(resident.entityId);
            return [
              resident.entityId,
              Object.freeze({
                bearer: randomBytes(32).toString('base64url'),
                residentKey: cognitionResidentKey(managedRunId, resident.entityId),
                model: resident.model,
                ...(resident.urgentModel ? { models: Object.freeze([resident.urgentModel]) } : {}),
                ...(resident.providerRoute ? { routePolicy: resident.providerRoute } : {}),
                ...(resident.ollamaLocal ? { ollamaLocal: resident.ollamaLocal } : {}),
                ...(accounting
                  ? {
                      accounting: Object.freeze({
                        scopeId: providerAccounting!.scopeId,
                        worldId: options.worldId,
                        ...accounting,
                      }),
                    }
                  : {}),
              }),
            ] as const;
          }),
      );
      const journalFile = path.join(runRoot, managedRunId, '_cognition', 'broker.jsonl');
      const transportCaptureDirectory = path.join(runRoot, managedRunId, '_cognition', 'transport');
      const broker = await startCognitionBroker({
        upstreamEndpoint: ollamaPreflight
          ? activeOllamaPolicies[0].endpoint
          : chatCompletionEndpoint(process.env.OPENROUTER_BASE_URL),
        ...(ollamaPreflight ? { ollamaPreflight } : { upstreamApiKey: upstreamApiKey! }),
        clients: [...clients.values()],
        maxConcurrent: maxConcurrentModelCalls,
        ...(maxTotalModelCalls == null ? {} : { maxAccepted: maxTotalModelCalls }),
        journalFile,
        transportCaptureDirectory,
        ...(dependencies.cognitionFetch ? { fetch: dependencies.cognitionFetch } : {}),
      });
      cognition = Object.freeze({
        broker,
        clients,
        concurrencyLimit: maxConcurrentModelCalls,
        maxTotalModelCalls,
        ollamaPreflight,
      });
    }
    if (providerAccounting && !cognition) {
      throw new WorldRunnerError(
        'Release-gated experiments require an armed cognition broker and normal resident credentials',
        'experiment_release_cognition_missing',
        { accountingScopeId: providerAccounting.scopeId },
      );
    }
    const sourceRevision = gitProvenance();
    control.append('run_configured', {
      runId: managedRunId,
      population: {
        residents: residents.map((resident) => ({
          entityId: resident.entityId,
          bodyUsername: resident.bodyUsername,
          model: resident.model,
          urgentModel: resident.urgentModel ?? null,
          mind: resident.mind,
          policyProfile: resident.policyProfile,
          bodyProfile: resident.bodyProfile,
          actionProfile: resident.actionProfile,
          safetyProfile: resident.safetyProfile,
          tickMs: resident.tickMs,
          maxTurnSteps: resident.maxTurnSteps ?? null,
          resumeAfterBudget: resident.resumeAfterBudget ?? null,
          paused: resident.paused,
          task: resident.task ?? null,
          target: resident.target ?? null,
          allowTools: resident.allowTools ?? null,
          providerRoute: resident.providerRoute ?? null,
          ollamaLocal: resident.ollamaLocal ?? null,
          providerAccounting: providerAccounting
            ? {
                accountId: providerAccounting.accounts.get(resident.entityId)!.accountId,
                ledgerFile: providerAccounting.accounts.get(resident.entityId)!.ledgerFile,
                limits: providerAccounting.accounts.get(resident.entityId)!.limits,
              }
            : null,
          leasePath: resident.leasePath,
        })),
        residentCount: residents.length,
        maxResidentProcesses: Math.max(1, Math.floor(options.maxResidents ?? 16)),
        maxConcurrentModelCalls: cognition?.concurrencyLimit ?? 0,
        maxTotalModelCalls: cognition?.maxTotalModelCalls ?? null,
        providerAccounting: providerAccounting
          ? {
              protocol: 'behold.quota-ledger-event.v1',
              scopeId: providerAccounting.scopeId,
              scopeDigest: providerAccounting.scopeDigest,
              layer: 'provider',
              hardQuotaUnit: 'provider_attempt_authorization',
              purposes: {
                resident_decision: 'resident decision provider attempt',
                loom_fold: 'auxiliary context provider attempt',
              },
              equalityEnforced: true,
              tokensAndCost: 'provider_reported_post_settlement',
              releaseGate: 'behold.experiment-release-plan.v1',
            }
          : null,
        residentStartupDelayMs: options.residentStartupDelayMs ?? 0,
        residentProcessLauncher: dependencies.spawnController
          ? 'injected_dependency'
          : 'default_node_process',
        cognition: cognition
          ? {
              protocol: COGNITION_TRANSPORT_PROTOCOL,
              brokerId: cognition.broker.brokerId,
              journalFile: cognition.broker.journalFile,
              transportCaptureDirectory: cognition.broker.transportCaptureDirectory,
              credentialOwner: 'world_runner',
              transport: cognition.ollamaPreflight
                ? 'ollama_local_native_chat'
                : 'openrouter_chat_completions',
              ollamaPreflight: cognition.ollamaPreflight,
            }
          : null,
      },
      world: {
        id: options.worldId,
        sourceDigest: options.world.source.expectedDigest,
        preparedBaselineDigest: options.world.preparedBaseline?.expectedDigest ?? null,
        runtime: control.record().runtime,
      },
      serverJarSha256: jarSha256,
      sourceRevision,
      contracts: {
        observation: 'behold.inhabitant.v2',
        controller: 'behold.llm-policy.v1',
        mind: 'behold.mind-request.v1 / behold.mind-decision.v1',
        cognition: cognition ? COGNITION_TRANSPORT_PROTOCOL : null,
        experimentRelease: providerAccounting ? 'behold.experiment-release.v1' : null,
        owner: 'behold.world-owner.v1',
      },
    });
    if (cognition) {
      control.append('cognition_broker_ready', {
        brokerId: cognition.broker.brokerId,
        concurrencyLimit: cognition.concurrencyLimit,
        maxTotalModelCalls: cognition.maxTotalModelCalls,
        journalFile: cognition.broker.journalFile,
        transportCaptureDirectory: cognition.broker.transportCaptureDirectory,
        accounting: cognition.broker.snapshot().accounting,
        ollamaPreflight: cognition.ollamaPreflight,
      });
    }
    control.update('starting', { server: null, controllers: [] });

    server = dependencies.spawnServer?.() ?? spawnDefaultServer(options);
    if (!server.pid) throw new WorldRunnerError('Server process has no PID', 'server_pid_missing');
    serverExit = waitForExit(server, 'server');
    serverOutput = captureOutput(server, stdout, stderr);
    control.update('starting', { server: { pid: server.pid, jarSha256 }, controllers: [] });
    control.append('server_started', { pid: server.pid });

    await raceProcessExits(
      (signal) =>
        waitForCondition(
          'Minecraft server readiness',
          startupTimeoutMs,
          sleep,
          async () => {
            if (!serverOutput.lines().some(isMinecraftReadyLine)) return false;
            const evidence = await inspectRuntime();
            return (
              evidenceOwnedBy(evidence.runtimeSessionLock, server!.pid!) &&
              evidenceOwnedBy(evidence.serverPort, server!.pid!)
            );
          },
          signal,
        ),
      [serverExit],
    );
    control.append('server_ready', { pid: server.pid });

    if (providerAccounting) {
      const freezeAcknowledgement = await setMinecraftTickState({
        server,
        serverExit,
        output: serverOutput,
        timeoutMs: startupTimeoutMs,
        sleep,
        state: 'frozen',
      });
      control.append('experiment_setup_operator_action', {
        phase: 'setup',
        action: 'minecraft_tick_freeze',
        command: 'tick freeze',
        acknowledgement: freezeAcknowledgement,
      });
      const saveAcknowledgement = await saveMinecraftWorld({
        server,
        serverExit,
        output: serverOutput,
        timeoutMs: startupTimeoutMs,
        sleep,
        reason: 'experiment_release_basis',
      });
      control.append('experiment_setup_operator_action', {
        phase: 'setup',
        action: 'minecraft_save_all_flush',
        command: 'save-all flush',
        acknowledgement: saveAcknowledgement,
      });

      const initialAccounting = matchedReleaseAccounting(cognition!, providerAccounting, residents);
      const accounts = new Map(
        initialAccounting.accounts.map((account) => [account.accountId, account] as const),
      );
      const frozenBasisDigest = (
        await digestStableReleaseRuntime(options.world.runtime.worldPath, {
          sleep,
          onAttempt: (attempt) =>
            control.append('experiment_setup_world_digest_attempt', {
              phase: 'pre_population',
              ...attempt,
            }),
        })
      ).digest;
      const owner = control.record();
      const plan = createExperimentReleasePlan({
        createdAt: (dependencies.now?.() ?? new Date()).toISOString(),
        world: options.worldId,
        runId: managedRunId,
        ownerEpoch: owner.epoch,
        worldBasis: {
          runtimePath: owner.runtime.path,
          runtimeDevice: owner.runtime.device,
          runtimeInode: owner.runtime.inode,
          runtimeDigestProfile: 'behold-tree-v2',
          runtimeDigest: frozenBasisDigest,
          sourceDigest: options.world.source.expectedDigest,
          preparedBaselineDigest: options.world.preparedBaseline!.expectedDigest,
        },
        accountingScope: {
          scopeId: providerAccounting.scopeId,
          scopeDigest: providerAccounting.scopeDigest,
        },
        residents: residents.map((resident) => {
          const configured = providerAccounting.accounts.get(resident.entityId)!;
          const account = accounts.get(configured.accountId)!;
          return {
            entityId: resident.entityId,
            bodyUsername: resident.bodyUsername,
            model: resident.model,
            urgentModel: resident.urgentModel ?? null,
            mind: resident.mind,
            ...(resident.providerRoute ? { providerRoute: resident.providerRoute } : {}),
            ...(resident.ollamaLocal ? { ollamaLocal: resident.ollamaLocal } : {}),
            profiles: {
              policy: resident.policyProfile,
              body: resident.bodyProfile,
              actions: resident.actionProfile,
              safety: resident.safetyProfile,
            },
            quotaAccount: {
              accountId: account.accountId,
              ledgerFile: account.file,
              limits: {
                resident_decision: account.limits.resident_decision,
                loom_fold: account.limits.loom_fold,
              },
              used: {
                resident_decision: account.used.resident_decision,
                loom_fold: account.used.loom_fold,
              },
              remaining: {
                resident_decision: account.remaining.resident_decision,
                loom_fold: account.remaining.loom_fold,
              },
              tipDigest: account.tipDigest,
            },
          };
        }),
      });
      const prepared = prepareExperimentRelease(
        path.join(runRoot, managedRunId, '_experiment_release'),
        plan,
      );
      experiment = Object.freeze({ prepared, initialAccounting });
      control.append('experiment_setup_started', {
        phase: 'setup',
        releaseId: plan.releaseId,
        planFile: prepared.planFile,
        planSha256: prepared.planSha256,
        populationDigest: plan.populationDigest,
        worldBasis: plan.worldBasis,
        accountingScope: plan.accountingScope,
        postReleaseObservationOrdering: 'resident_claim_ordinals_are_sequential',
      });
    }

    for (const [index, resident] of residents.entries()) {
      const journalDirectory = path.join(runRoot, managedRunId, sanitizeName(resident.entityId));
      const environment = managedControllerEnvironment(
        options,
        resident,
        managedRunId,
        control.file,
        journalDirectory,
        cognition,
        experiment,
      );
      const controller =
        dependencies.spawnController?.({
          runId: managedRunId,
          resident,
          index,
          leasePath: resident.leasePath,
          journalDirectory,
          environment,
        }) ?? spawnDefaultController(options, resident, environment);
      if (!controller.pid) {
        throw new WorldRunnerError(
          `Controller process for ${resident.entityId} has no PID`,
          'controller_pid_missing',
          { entityId: resident.entityId, index },
        );
      }
      const processRecord: ManagedResidentProcess = {
        resident,
        journalDirectory,
        child: controller,
        exit: waitForExit(controller, `controller:${resident.entityId}`),
        output: captureOutput(controller, stdout, stderr),
      };
      controllerProcesses.push(processRecord);
      control.update('starting', { controllers: controllerRecords(controllerProcesses) });
      control.append('controller_started', {
        index,
        pid: controller.pid,
        entityId: resident.entityId,
        bodyUsername: resident.bodyUsername,
        model: resident.model,
        urgentModel: resident.urgentModel ?? null,
        mind: resident.mind,
        providerRoute: resident.providerRoute ?? null,
        ollamaLocal: resident.ollamaLocal ?? null,
        tickMs: resident.tickMs,
        maxTurnSteps: resident.maxTurnSteps ?? null,
        resumeAfterBudget: resident.resumeAfterBudget ?? null,
        paused: resident.paused,
        leasePath: resident.leasePath,
        journalDirectory,
      });

      await raceProcessExits(
        (signal) =>
          waitForCondition(
            `controller readiness for ${resident.entityId}`,
            startupTimeoutMs,
            sleep,
            async () =>
              processRecord.output
                .lines()
                .some((line) =>
                  experiment
                    ? isControllerReleaseArmedLine(
                        line,
                        experiment.prepared.plan.releaseId,
                        resident.entityId,
                      )
                    : isControllerReadyLine(line),
                ) &&
              leaseOwnedBy(resident.leasePath, controller.pid!, resident.entityId, managedRunId),
            signal,
          ),
        [serverExit, ...controllerProcesses.map((entry) => entry.exit)],
      );
      control.append('controller_ready', {
        ...(experiment ? { phase: 'setup' } : {}),
        index,
        pid: controller.pid,
        entityId: resident.entityId,
        releaseArmed: experiment != null,
        releaseId: experiment?.prepared.plan.releaseId ?? null,
      });
      if (index < residents.length - 1 && (options.residentStartupDelayMs ?? 0) > 0) {
        control.append(
          experiment ? 'experiment_setup_resident_stagger' : 'resident_start_stagger',
          {
            ...(experiment ? { phase: 'setup' } : {}),
            afterEntityId: resident.entityId,
            beforeEntityId: residents[index + 1].entityId,
            milliseconds: options.residentStartupDelayMs,
          },
        );
        await sleep(options.residentStartupDelayMs!);
      }
    }
    let releaseClaims: ReturnType<typeof verifyExperimentReleaseClaims> = Object.freeze([]);
    if (experiment) {
      const arms = verifyExperimentReleaseArms(experiment.prepared);
      for (const arm of arms) {
        const processRecord = controllerProcesses.find(
          (entry) => entry.resident.entityId === arm.entityId,
        );
        if (
          !processRecord ||
          arm.pid !== processRecord.child.pid ||
          !pathIsWithin(processRecord.journalDirectory, arm.journalFile)
        ) {
          throw new WorldRunnerError(
            `Release arm evidence mismatches controller ${arm.entityId}`,
            'experiment_release_arm_mismatch',
            { arm, controller: processRecord ? controllerRecords([processRecord])[0] : null },
          );
        }
      }
      const cognitionBeforeRelease = cognition!.broker.snapshot();
      if (
        cognitionBeforeRelease.accepted !== 0 ||
        cognitionBeforeRelease.admitted !== 0 ||
        cognitionBeforeRelease.active !== 0 ||
        cognitionBeforeRelease.queued !== 0 ||
        cognitionBeforeRelease.completed !== 0 ||
        cognitionBeforeRelease.failed !== 0 ||
        cognitionBeforeRelease.cancelled !== 0 ||
        cognitionBeforeRelease.rejected !== 0 ||
        cognitionBeforeRelease.admissionOrdinal !== 0
      ) {
        throw new WorldRunnerError(
          'Resident cognition reached the broker before the population release',
          'experiment_release_early_cognition',
          cognitionBeforeRelease,
        );
      }
      const accountingBeforeRelease = matchedReleaseAccounting(
        cognition!,
        providerAccounting!,
        residents,
      );
      if (!sameAccountingSnapshot(experiment.initialAccounting, accountingBeforeRelease)) {
        throw new WorldRunnerError(
          'Resident quota accounting changed before the population release',
          'experiment_release_early_quota_mutation',
          { initial: experiment.initialAccounting, actual: accountingBeforeRelease },
        );
      }

      const releaseSaveAcknowledgement = await saveMinecraftWorld({
        server,
        serverExit,
        output: serverOutput,
        timeoutMs: startupTimeoutMs,
        sleep,
        reason: 'experiment_release_population_armed',
      });
      control.append('experiment_setup_operator_action', {
        phase: 'setup',
        action: 'minecraft_save_all_flush',
        command: 'save-all flush',
        acknowledgement: releaseSaveAcknowledgement,
      });
      const releaseRuntimeDigest = (
        await digestStableReleaseRuntime(options.world.runtime.worldPath, {
          sleep,
          onAttempt: (attempt) =>
            control.append('experiment_setup_world_digest_attempt', {
              phase: 'population_armed',
              ...attempt,
            }),
        })
      ).digest;
      control.append('experiment_population_armed', {
        phase: 'setup',
        releaseId: experiment.prepared.plan.releaseId,
        arms,
        cognition: cognitionBeforeRelease,
        accounting: accountingBeforeRelease,
        worldState: {
          runtimeDigestProfile: 'behold-tree-v2',
          runtimeDigest: releaseRuntimeDigest,
          minecraftTicks: 'frozen_before_release',
          saveAcknowledged: true,
        },
      });
      const unfreezeAcknowledgement = await setMinecraftTickState({
        server,
        serverExit,
        output: serverOutput,
        timeoutMs: startupTimeoutMs,
        sleep,
        state: 'running',
      });
      const releaseEvent = control.append('experiment_released', {
        releaseId: experiment.prepared.plan.releaseId,
        planFile: experiment.prepared.planFile,
        planSha256: experiment.prepared.planSha256,
        populationDigest: experiment.prepared.plan.populationDigest,
        worldState: {
          runtimeDigestProfile: 'behold-tree-v2',
          runtimeDigest: releaseRuntimeDigest,
          minecraftTicks: 'frozen_before_release',
          saveAcknowledged: true,
        },
        operatorBoundary: {
          action: 'minecraft_tick_unfreeze',
          command: 'tick unfreeze',
          acknowledgement: unfreezeAcknowledgement,
        },
        postReleaseObservationOrdering: 'resident_claim_ordinals_are_sequential',
      });
      const release = commitExperimentRelease(experiment.prepared, {
        releasedAt: releaseEvent.at,
        worldState: {
          runtimeDigestProfile: 'behold-tree-v2',
          runtimeDigest: releaseRuntimeDigest,
          minecraftTicks: 'frozen_before_release',
          saveAcknowledged: true,
        },
        lifecycle: {
          file: control.journalFile,
          sequence: releaseEvent.sequence,
          digest: releaseEvent.digest,
        },
      });
      await raceProcessExits(
        (signal) =>
          waitForCondition(
            'resident experiment release claims',
            startupTimeoutMs,
            sleep,
            async () => {
              if (signal.aborted) return false;
              return (
                readExperimentReleaseClaims(experiment!.prepared, release).length ===
                residents.length
              );
            },
            signal,
          ),
        [serverExit, ...controllerProcesses.map((entry) => entry.exit)],
      );
      releaseClaims = verifyExperimentReleaseClaims(experiment.prepared);
      for (const claim of releaseClaims) {
        const processRecord = controllerProcesses.find(
          (entry) => entry.resident.entityId === claim.entityId,
        );
        if (!processRecord || claim.pid !== processRecord.child.pid) {
          throw new WorldRunnerError(
            `Release claim evidence mismatches controller ${claim.entityId}`,
            'experiment_release_claim_mismatch',
            claim,
          );
        }
        control.append('resident_release_observed', {
          releaseId: release.releaseId,
          entityId: claim.entityId,
          pid: claim.pid,
          observedOrder: claim.reference.residentObservedOrder,
          observedAt: claim.reference.residentObservedAt,
          executionSemantics: 'sequential_observation_order',
        });
      }
      committedExperimentRelease = Object.freeze({
        releaseId: release.releaseId,
        planFile: experiment.prepared.planFile,
        planSha256: experiment.prepared.planSha256,
        releaseFile: path.join(experiment.prepared.directory, 'release.json'),
        lifecycleSequence: releaseEvent.sequence,
        lifecycleDigest: releaseEvent.digest,
      });
    }
    control.update('running');
    control.append('run_ready', {
      serverPid: server.pid,
      residents: publicResidentRecords(controllerProcesses),
      experimentRelease: committedExperimentRelease,
      residentReleaseClaims: releaseClaims,
    });

    const finished = Promise.race([
      serverExit,
      ...controllerProcesses.map((entry) => entry.exit),
      ...(cognition
        ? [
            cognition.broker.failed.then((error) => {
              throw new WorldRunnerError(
                `Cognition broker failed: ${error.message}`,
                'cognition_broker_failed',
              );
            }),
          ]
        : []),
    ]).then((exit) => {
      if (!stopping && !(exit.name.startsWith('controller:') && residentsQuiescing)) {
        throw new WorldRunnerError(
          `${exit.name} exited while the managed world was running`,
          'managed_child_exited',
          exit,
        );
      }
    });

    let stopPromise: Promise<void> | null = null;
    let quiescePromise: Promise<void> | null = null;
    const quiesceResidents = (reason = 'witness_observation') => {
      if (quiescePromise) return quiescePromise;
      if (stopPromise || stopping) {
        return Promise.reject(
          new WorldRunnerError(
            'Residents cannot be quiesced after managed shutdown begins',
            'resident_quiesce_after_stop',
          ),
        );
      }
      residentsQuiescing = true;
      quiescePromise = quiesceManagedResidents({
        control,
        residents: controllerProcesses,
        timeoutMs: shutdownTimeoutMs,
        sleep,
        reason,
      });
      return quiescePromise;
    };
    const stop = (reason = 'operator_request') => {
      if (stopPromise) return stopPromise;
      stopping = true;
      stopPromise = stopManagedWorld({
        control,
        server: server!,
        serverExit: serverExit!,
        residents: controllerProcesses,
        serverOutput: serverOutput!,
        inspectRuntime,
        entityRoot,
        circleIds,
        timeoutMs: shutdownTimeoutMs,
        sleep,
        reason,
        cognition,
      });
      return stopPromise;
    };

    const runningCognition = cognition;
    return Object.freeze({
      runId: managedRunId,
      control,
      serverPid: server.pid,
      residents: publicResidentRecords(controllerProcesses),
      cognition: runningCognition
        ? Object.freeze({
            brokerId: runningCognition.broker.brokerId,
            concurrencyLimit: runningCognition.concurrencyLimit,
            maxTotalModelCalls: runningCognition.maxTotalModelCalls,
            journalFile: runningCognition.broker.journalFile!,
            transportCaptureDirectory: runningCognition.broker.transportCaptureDirectory!,
            accountingSnapshot: () => runningCognition.broker.snapshot().accounting,
            admissionLimitReached: runningCognition.broker.admissionLimitReached,
            admissionLimitSettled: runningCognition.broker.admissionLimitSettled,
            ollamaPreflight: runningCognition.ollamaPreflight,
          })
        : null,
      experimentRelease: committedExperimentRelease,
      finished,
      quiesceResidents,
      stop,
    });
  } catch (error: any) {
    const failure = error instanceof Error ? error : new Error(String(error));
    try {
      control.append('run_start_failed', { error: failure.message });
    } catch {}
    const cleaned = await cleanupFailedStart({
      control,
      server,
      serverExit,
      residents: controllerProcesses,
      serverOutput,
      inspectRuntime,
      entityRoot,
      circleIds,
      timeoutMs: shutdownTimeoutMs,
      sleep,
      cognition,
    });
    if (!cleaned) {
      try {
        control.update('recovery_required', {
          server: server?.pid ? { pid: server.pid, jarSha256 } : null,
          controllers: controllerRecords(controllerProcesses),
        });
      } catch {}
    }
    throw failure;
  }
}

/**
 * Releases only a same-host recovery-required owner whose entire recorded
 * process set is dead and whose runtime, lifecycle journal, port, session
 * lock, and controller leases still match the abandoned epoch. Immutable
 * evidence is durable before any stale ownership file is removed.
 */
export async function recoverAbandonedManagedWorld(
  options: ManagedWorldRecoveryOptions,
  dependencies: Pick<WorldRunnerDependencies, 'inspectRuntime' | 'now'> = {},
): Promise<ManagedWorldRecovery> {
  const inspectRuntime =
    dependencies.inspectRuntime ?? (() => statusWorld(options.worldId, options.world));
  const now = dependencies.now ?? (() => new Date());
  const inspection = inspectWorldControl(options.controlRoot, options.worldId);
  if (inspection.state !== 'held' || inspection.record.state !== 'recovery_required') {
    throw new WorldRunnerError(
      `World ${options.worldId} has no recovery-required owner`,
      'world_control_not_recoverable',
      inspection,
    );
  }
  const owner = inspection.record;
  const ownerFile = inspection.file;
  const ownerStats = plainFileStats(ownerFile, 'world owner');
  const ownerBytes = fs.readFileSync(ownerFile);
  const ownerSha256 = sha256Bytes(ownerBytes);
  if (owner.hostname !== os.hostname()) {
    throw new WorldRunnerError(
      `Recovery refuses owner from ${owner.hostname}; this host is ${os.hostname()}`,
      'recovery_owner_remote',
      { owner: owner.hostname, local: os.hostname() },
    );
  }
  assertRecoveryRuntimeIdentity(owner);

  const lifecycleFile = path.join(path.dirname(ownerFile), `lifecycle-${owner.epoch}.jsonl`);
  plainFileStats(lifecycleFile, 'world lifecycle journal');
  const lifecycle = verifyWorldLifecycleJournal(lifecycleFile);
  assertRecoveryLifecycle(owner, lifecycle);

  const processes = recoveryProcesses(owner);
  const alive = processes.filter((entry) => isProcessAlive(entry.pid));
  if (alive.length) {
    throw new WorldRunnerError(
      'Recovery refuses while a recorded owner process may still be alive',
      'recovery_process_alive',
      alive,
    );
  }

  const entityRoot = fs.realpathSync.native(options.entityRoot);
  const circleIds = worldCircleIds(options.worldId, options.world);
  const leases = inspectRecoveryLeases(owner, entityRoot, circleIds);
  const runtime = await inspectRuntime();
  assertStoppedEvidence(runtime, 'before_abandoned_owner_recovery');
  const saveAcknowledged = lifecycle.events.some(
    (event) => event.type === 'server_save_acknowledged',
  );
  const classification = saveAcknowledged
    ? ('abandoned_after_save_ack' as const)
    : ('abandoned_unclean_shutdown' as const);
  const evidenceStem = `recovery-${owner.epoch}-${String(lifecycle.tipDigest).slice(0, 12)}`;
  const preparedEvidence = path.join(path.dirname(ownerFile), `${evidenceStem}.prepared.json`);
  const prepared = Object.freeze({
    protocol: 'behold.world-recovery-evidence.v1',
    phase: 'prepared',
    preparedAt: now().toISOString(),
    classification,
    world: owner.world,
    epoch: owner.epoch,
    owner: { file: ownerFile, sha256: ownerSha256, record: owner },
    lifecycle: {
      file: lifecycle.file,
      tipDigest: lifecycle.tipDigest,
      eventCount: lifecycle.events.length,
      saveAcknowledged,
    },
    runtime,
    processes: processes.map((entry) => ({ ...entry, observedDead: true })),
    controllerLeases: leases.map((lease) => ({
      file: lease.file,
      present: lease.present,
      sha256: lease.sha256,
      record: lease.record,
    })),
    recoveryCode: gitProvenance(),
  });
  writeImmutableEvidence(preparedEvidence, prepared, {
    world: owner.world,
    epoch: owner.epoch,
    ownerSha256,
    lifecycleTipDigest: lifecycle.tipDigest,
  });

  assertRecoveryOwnerUnchanged(ownerFile, ownerStats, ownerSha256, owner);
  assertRecoveryLeasesUnchanged(leases);
  const finalRuntime = await inspectRuntime();
  assertStoppedEvidence(finalRuntime, 'immediately_before_abandoned_owner_release');
  for (const lease of leases) {
    if (!lease.present) continue;
    fs.unlinkSync(lease.file);
    fsyncDirectory(path.dirname(lease.file));
  }
  assertNoControllerLeasesAtRoot(entityRoot, circleIds, 'after_abandoned_lease_release');
  assertRecoveryOwnerUnchanged(ownerFile, ownerStats, ownerSha256, owner);
  fs.unlinkSync(ownerFile);
  fsyncDirectory(path.dirname(ownerFile));

  const completedEvidence = path.join(path.dirname(ownerFile), `${evidenceStem}.completed.json`);
  const preparedSha256 = sha256File(preparedEvidence);
  writeImmutableEvidence(completedEvidence, {
    protocol: 'behold.world-recovery-evidence.v1',
    phase: 'completed',
    completedAt: now().toISOString(),
    classification,
    world: owner.world,
    epoch: owner.epoch,
    preparedEvidence,
    preparedSha256,
    releasedOwnerFile: ownerFile,
    releasedControllerLeases: leases.filter((lease) => lease.present).map((lease) => lease.file),
  });
  if (inspectWorldControl(options.controlRoot, options.worldId).state !== 'clear') {
    throw new WorldRunnerError(
      'Recovered owner file did not become clear',
      'recovery_owner_release_failed',
    );
  }
  return Object.freeze({
    protocol: 'behold.world-recovery-result.v1',
    world: owner.world,
    epoch: owner.epoch,
    classification,
    preparedEvidence,
    completedEvidence,
  });
}

async function quiesceManagedResidents(input: {
  control: HeldWorldControl;
  residents: readonly ManagedResidentProcess[];
  timeoutMs: number;
  sleep: (milliseconds: number) => Promise<void>;
  reason: string;
}) {
  input.control.append('residents_quiescing', {
    reason: input.reason,
    residents: input.residents.map((entry) => entry.resident.entityId),
  });
  for (const entry of input.residents) {
    if (!processExited(entry.child)) entry.child.stdin.end();
  }
  const exits = await Promise.all(
    input.residents.map((entry) =>
      withTimeout(entry.exit, input.timeoutMs, `resident ${entry.resident.entityId} quiescence`),
    ),
  );
  const abnormalExits = exits.filter((exit) => !cleanExit(exit));
  if (abnormalExits.length > 0) {
    throw new WorldRunnerError(
      'One or more residents exited abnormally while entering witness quiescence',
      'resident_quiesce_exit_abnormal',
      abnormalExits,
    );
  }
  await Promise.all(
    input.residents.map((entry) =>
      waitForCondition(
        `resident lease release before witness for ${entry.resident.entityId}`,
        input.timeoutMs,
        input.sleep,
        async () => !fs.existsSync(entry.resident.leasePath),
      ),
    ),
  );
  input.control.update('running', { controllers: [] });
  input.control.append('residents_quiesced', { reason: input.reason, exits });
}

async function cleanupFailedStart(input: {
  control: HeldWorldControl;
  server: ChildProcessWithoutNullStreams | null;
  serverExit: Promise<ProcessExit> | null;
  residents: readonly ManagedResidentProcess[];
  serverOutput: OutputCapture | null;
  inspectRuntime: () => Promise<RuntimeInspection>;
  entityRoot: string;
  circleIds: readonly string[];
  timeoutMs: number;
  sleep: (milliseconds: number) => Promise<void>;
  cognition: ManagedCognition | null;
}) {
  try {
    let cognitionFailure: Error | null = null;
    input.control.update('stopping');
    input.control.append('failed_start_cleanup_started');
    if (input.residents.length > 0) {
      for (const entry of input.residents) {
        if (!processExited(entry.child)) entry.child.stdin.end();
      }
      await Promise.all(
        input.residents.map((entry) =>
          withTimeout(
            entry.exit,
            input.timeoutMs,
            `failed resident cleanup for ${entry.resident.entityId}`,
          ),
        ),
      );
      await Promise.all(
        input.residents.map((entry) =>
          waitForCondition(
            `failed resident lease cleanup for ${entry.resident.entityId}`,
            input.timeoutMs,
            input.sleep,
            async () => !fs.existsSync(entry.resident.leasePath),
          ),
        ),
      );
      input.control.update('stopping', { controllers: [] });
    }
    if (input.cognition) {
      try {
        await drainManagedCognition(
          input.control,
          input.cognition,
          input.timeoutMs,
          'failed_start',
        );
      } catch (error: any) {
        cognitionFailure = error instanceof Error ? error : new Error(String(error));
        input.control.append('cognition_broker_drain_failed', {
          phase: 'failed_start',
          error: cognitionFailure.message,
        });
      }
    }
    if (input.server && input.serverExit) {
      if (!processExited(input.server) && input.serverOutput?.lines().some(isMinecraftReadyLine)) {
        const marker = input.serverOutput.mark();
        input.server.stdin.write('save-all flush\n');
        await waitForCondition(
          'failed-start save acknowledgement',
          input.timeoutMs,
          input.sleep,
          async () => input.serverOutput!.linesAfter(marker).some(isMinecraftSaveAcknowledgement),
        );
      }
      if (!processExited(input.server)) {
        input.server.stdin.write('stop\n');
        input.server.stdin.end();
      }
      await withTimeout(input.serverExit, input.timeoutMs, 'failed server cleanup');
    }
    const stopped = await input.inspectRuntime();
    assertStoppedEvidence(stopped, 'after_failed_start_cleanup');
    assertNoControllerLeasesAtRoot(input.entityRoot, input.circleIds, 'after_failed_start_cleanup');
    if (cognitionFailure) throw cognitionFailure;
    input.control.update('stopped_verified', { server: null, controllers: [] });
    input.control.append('failed_start_cleanup_completed');
    input.control.release();
    return true;
  } catch (cleanupError: any) {
    try {
      input.control.append('failed_start_cleanup_failed', {
        error: cleanupError?.message || String(cleanupError),
      });
    } catch {}
    return false;
  }
}

async function stopManagedWorld(input: {
  control: HeldWorldControl;
  server: ChildProcessWithoutNullStreams;
  serverExit: Promise<ProcessExit>;
  residents: readonly ManagedResidentProcess[];
  serverOutput: OutputCapture;
  inspectRuntime: () => Promise<RuntimeInspection>;
  entityRoot: string;
  circleIds: readonly string[];
  timeoutMs: number;
  sleep: (milliseconds: number) => Promise<void>;
  reason: string;
  cognition: ManagedCognition | null;
}) {
  const { control, server } = input;
  control.update('stopping');
  control.append('run_stopping', { reason: input.reason });
  try {
    const abnormalExits: ProcessExit[] = [];
    for (const entry of input.residents) {
      if (!processExited(entry.child)) entry.child.stdin.end();
    }
    const residentExits = await Promise.all(
      input.residents.map((entry) =>
        withTimeout(
          entry.exit,
          input.timeoutMs,
          `resident ${entry.resident.entityId} graceful shutdown`,
        ),
      ),
    );
    abnormalExits.push(...residentExits.filter((exit) => !cleanExit(exit)));
    await Promise.all(
      input.residents.map((entry) =>
        waitForCondition(
          `resident lease release for ${entry.resident.entityId}`,
          input.timeoutMs,
          input.sleep,
          async () => !fs.existsSync(entry.resident.leasePath),
        ),
      ),
    );
    control.update('stopping', { controllers: [] });
    control.append('residents_stopped', {
      residentCount: input.residents.length,
      exits: residentExits,
    });

    let cognitionFailure: Error | null = null;
    if (input.cognition) {
      try {
        await drainManagedCognition(control, input.cognition, input.timeoutMs, 'managed_stop');
      } catch (error: any) {
        cognitionFailure = error instanceof Error ? error : new Error(String(error));
        control.append('cognition_broker_drain_failed', {
          phase: 'managed_stop',
          error: cognitionFailure.message,
        });
      }
    }

    if (!processExited(server)) {
      const outputMarker = input.serverOutput.mark();
      server.stdin.write('save-all flush\n');
      await waitForCondition(
        'Minecraft save acknowledgement',
        input.timeoutMs,
        input.sleep,
        async () =>
          input.serverOutput.linesAfter(outputMarker).some(isMinecraftSaveAcknowledgement),
      );
      control.append('server_save_acknowledged');
      server.stdin.write('stop\n');
      server.stdin.end();
    }
    const serverExit = await withTimeout(
      input.serverExit,
      input.timeoutMs,
      'server graceful shutdown',
    );
    if (!cleanExit(serverExit)) abnormalExits.push(serverExit);
    control.append('server_stopped', serverExit);

    const stopped = await input.inspectRuntime();
    assertStoppedEvidence(stopped, 'after_managed_shutdown');
    assertNoControllerLeasesAtRoot(input.entityRoot, input.circleIds, 'after_managed_shutdown');
    if (cognitionFailure) {
      control.update('stopping', { server: null, controllers: [] });
      throw new WorldRunnerError(
        'Cognition broker did not drain cleanly',
        'cognition_broker_shutdown_failed',
        { error: cognitionFailure.message, snapshot: input.cognition?.broker.snapshot() ?? null },
      );
    }
    if (abnormalExits.length) {
      control.update('stopping', { server: null, controllers: [] });
      throw new WorldRunnerError(
        'One or more managed children exited abnormally',
        'managed_child_exit_abnormal',
        abnormalExits,
      );
    }
    control.update('stopped_verified', { server: null, controllers: [] });
    control.append('run_stopped', { reason: input.reason });
    control.release();
  } catch (error: any) {
    const failure = error instanceof Error ? error : new Error(String(error));
    try {
      control.append('run_stop_failed', { reason: input.reason, error: failure.message });
      control.update('recovery_required');
    } catch {}
    throw failure;
  }
}

async function drainManagedCognition(
  control: HeldWorldControl,
  cognition: ManagedCognition,
  timeoutMs: number,
  phase: string,
) {
  control.append('cognition_broker_draining', {
    phase,
    brokerId: cognition.broker.brokerId,
    snapshot: cognition.broker.snapshot(),
  });
  const snapshot = await withTimeout(
    cognition.broker.close(),
    timeoutMs,
    `cognition broker drain during ${phase}`,
  );
  if (!snapshot.healthy || snapshot.active !== 0 || snapshot.queued !== 0) {
    throw new Error('cognition broker reported an unhealthy or nonempty drain');
  }
  if (!cognition.broker.journalFile) throw new Error('cognition broker has no evidence journal');
  const verified = verifyCognitionBrokerJournal(cognition.broker.journalFile);
  if (!cognition.broker.transportCaptureDirectory) {
    throw new Error('cognition broker has no raw transport capture directory');
  }
  const transportCapture = verifyCognitionTransportCapture(
    cognition.broker.transportCaptureDirectory,
    verified.events,
  );
  if (
    verified.brokerId !== cognition.broker.brokerId ||
    verified.peakActive > cognition.concurrencyLimit ||
    verified.acceptedLimit !== cognition.maxTotalModelCalls ||
    (cognition.maxTotalModelCalls != null && verified.accepted > cognition.maxTotalModelCalls)
  ) {
    throw new Error(
      'cognition broker evidence violates its identity, concurrency, or admission limit',
    );
  }
  const quotaVerification = [...cognition.clients.values()]
    .filter((client) => client.accounting != null)
    .map((client) => {
      const expected = client.accounting!;
      const verifiedQuota = verifyQuotaLedger(expected.ledgerFile).snapshot;
      if (
        verifiedQuota.scopeId !== expected.scopeId ||
        verifiedQuota.worldId !== expected.worldId ||
        verifiedQuota.accountId !== expected.accountId ||
        verifiedQuota.layer !== 'provider' ||
        verifiedQuota.limits.resident_decision !== expected.limits.resident_decision ||
        verifiedQuota.limits.loom_fold !== expected.limits.loom_fold
      ) {
        throw new Error('provider quota ledger violates its configured resident identity');
      }
      return {
        file: verifiedQuota.file,
        accountId: verifiedQuota.accountId,
        limits: verifiedQuota.limits,
        used: verifiedQuota.used,
        remaining: verifiedQuota.remaining,
        settled: verifiedQuota.settled,
        unsettled: verifiedQuota.unsettled,
        usage: verifiedQuota.usage,
        eventCount: verifiedQuota.eventCount,
        tipDigest: verifiedQuota.tipDigest,
      };
    })
    .sort((left, right) => left.accountId.localeCompare(right.accountId));
  control.append('cognition_broker_drained', {
    phase,
    brokerId: cognition.broker.brokerId,
    snapshot,
    verification: {
      journalFile: verified.file,
      tipDigest: verified.tipDigest,
      accepted: verified.accepted,
      admitted: verified.admitted,
      terminal: verified.terminal,
      measuredPeakActive: verified.peakActive,
      transportCapture: {
        directory: transportCapture.directory,
        attempts: transportCapture.attempts,
        responses: transportCapture.responses,
        successfulResponses: transportCapture.successfulResponses,
        providerFailures: transportCapture.providerFailures,
        transportErrors: transportCapture.transportErrors,
        cancellations: transportCapture.cancellations,
        correctionAttempts: transportCapture.correctionAttempts,
        usage: transportCapture.usage,
      },
      quotaAccounts: quotaVerification,
    },
  });
}

function spawnDefaultServer(options: ManagedWorldRunOptions) {
  return spawn(
    options.java,
    ['-Xms1G', '-Xmx2G', '-jar', fs.realpathSync.native(options.serverJar), 'nogui'],
    {
      cwd: options.serverDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
      // A terminal interrupt belongs to the lifecycle owner. Keep managed
      // children outside its foreground process group so they can finish the
      // explicit controller-drain and Minecraft save/stop protocol.
      detached: process.platform !== 'win32',
    },
  );
}

function spawnDefaultController(
  options: ManagedWorldRunOptions,
  resident: NormalizedManagedResident,
  environment: Readonly<NodeJS.ProcessEnv>,
) {
  const args = [
    options.controllerEntry,
    resident.entityId,
    '--body',
    resident.bodyUsername,
    '--server',
    options.world.server.host,
    '--port',
    String(options.world.server.port),
    '--world',
    options.worldId,
    '--model',
    resident.model,
    '--policyProfile',
    resident.policyProfile,
    '--bodyProfile',
    resident.bodyProfile,
    '--actionProfile',
    resident.actionProfile,
    '--safetyProfile',
    resident.safetyProfile,
    '--tickMs',
    String(resident.tickMs),
  ];
  if (resident.maxTurnSteps != null) {
    args.push('--maxTurnSteps', String(resident.maxTurnSteps));
  }
  if (resident.resumeAfterBudget != null) {
    args.push('--resumeAfterBudget', String(resident.resumeAfterBudget));
  }
  if (resident.urgentModel) args.push('--urgentModel', resident.urgentModel);
  if (resident.task) args.push('--task', resident.task);
  if (resident.target) args.push('--target', resident.target);
  if (resident.allowTools?.length) args.push('--allowTools', resident.allowTools.join(','));
  if (resident.paused) args.push('--paused');
  return spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: environment,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
}

function managedControllerEnvironment(
  options: ManagedWorldRunOptions,
  resident: NormalizedManagedResident,
  runId: string,
  controlFile: string,
  journalDirectory: string,
  cognition: ManagedCognition | null,
  experiment: ManagedExperimentRelease | null,
) {
  const env: NodeJS.ProcessEnv = {};
  for (const name of [
    'PATH',
    'HOME',
    'USER',
    'LOGNAME',
    'TMPDIR',
    'SHELL',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'TZ',
    'NODE_ENV',
    'NODE_EXTRA_CA_CERTS',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
    'BEHOLD_RECORD_MODEL_IO',
  ]) {
    if (process.env[name] != null) env[name] = process.env[name];
  }
  Object.assign(env, resident.environment);
  if (cognition && !resident.paused) {
    const client = cognition.clients.get(resident.entityId);
    if (!client) {
      throw new WorldRunnerError(
        `Cognition client missing for ${resident.entityId}`,
        'cognition_client_missing',
      );
    }
    env.BEHOLD_COGNITION_TRANSPORT = COGNITION_TRANSPORT_PROTOCOL;
    if (resident.ollamaLocal) {
      env.BEHOLD_COGNITION_BEARER = client.bearer;
      env.BEHOLD_COGNITION_ENDPOINT = cognition.broker.endpoint;
      env.BEHOLD_OLLAMA_LOCAL_POLICY = serializeOllamaLocalPolicy(resident.ollamaLocal);
    } else {
      env.OPENROUTER_API_KEY = client.bearer;
      env.OPENROUTER_BASE_URL = cognition.broker.endpoint;
    }
    if (resident.providerRoute) {
      env.BEHOLD_OPENROUTER_ROUTE_POLICY = serializeOpenRouterRoutePolicy(resident.providerRoute);
    }
    if (client.accounting) env.BEHOLD_COGNITION_ACCOUNT_ID = client.accounting.accountId;
  }
  if (experiment) {
    env.BEHOLD_EXPERIMENT_RELEASE_PLAN = experiment.prepared.planFile;
    env.BEHOLD_EXPERIMENT_RELEASE_PLAN_SHA256 = experiment.prepared.planSha256;
  }
  env.VIEWER_ENABLED = '0';
  env.BEHOLD_LOAD_DOTENV = '0';
  env.BEHOLD_RUN_ID = runId;
  env.BEHOLD_WORLD_ID = options.worldId;
  env.BEHOLD_WORLD_CONTROL_FILE = controlFile;
  env.BEHOLD_WORLD_CONTROL_ROOT = path.dirname(path.dirname(controlFile));
  env.BEHOLD_ENTITY_DIR = path.resolve(options.entityRoot);
  env.BEHOLD_RUN_DIR = journalDirectory;
  env.MINECRAFT_USERNAME = resident.bodyUsername;
  env.BEHOLD_MIND = resident.mind;
  env.BEHOLD_POLICY_PROFILE = resident.policyProfile;
  env.BEHOLD_BODY_PROFILE = resident.bodyProfile;
  env.BEHOLD_ACTION_PROFILE = resident.actionProfile;
  env.BEHOLD_SAFETY_PROFILE = resident.safetyProfile;
  return Object.freeze(env);
}

const RESERVED_RESIDENT_ENVIRONMENT = new Set([
  'OPENROUTER_API_KEY',
  'OPENROUTER_BASE_URL',
  'BEHOLD_COGNITION_TRANSPORT',
  'BEHOLD_COGNITION_BEARER',
  'BEHOLD_COGNITION_ENDPOINT',
  'BEHOLD_COGNITION_ACCOUNT_ID',
  'BEHOLD_OPENROUTER_ROUTE_POLICY',
  'BEHOLD_OLLAMA_LOCAL_POLICY',
  'BEHOLD_OLLAMA_SERVER_CONFIG',
  'BEHOLD_EXPERIMENT_RELEASE_PLAN',
  'BEHOLD_EXPERIMENT_RELEASE_PLAN_SHA256',
  'VIEWER_ENABLED',
  'BEHOLD_LOAD_DOTENV',
  'BEHOLD_RUN_ID',
  'BEHOLD_WORLD_ID',
  'BEHOLD_WORLD_CONTROL_FILE',
  'BEHOLD_WORLD_CONTROL_ROOT',
  'BEHOLD_ENTITY_DIR',
  'BEHOLD_RUN_DIR',
  'MINECRAFT_USERNAME',
  'BEHOLD_MIND',
  'BEHOLD_POLICY_PROFILE',
  'BEHOLD_BODY_PROFILE',
  'BEHOLD_ACTION_PROFILE',
  'BEHOLD_SAFETY_PROFILE',
]);

function normalizeResidentEnvironment(
  value: Readonly<Record<string, string>> | undefined,
  entityId: string,
) {
  if (value == null) return Object.freeze({});
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new WorldRunnerError(
      `Resident ${entityId} environment must be a string map`,
      'resident_environment_invalid',
      { entityId },
    );
  }
  const entries = Object.entries(value);
  if (entries.length > 32) {
    throw new WorldRunnerError(
      `Resident ${entityId} environment exceeds 32 variables`,
      'resident_environment_invalid',
      { entityId, count: entries.length },
    );
  }
  const normalized: Record<string, string> = {};
  for (const [name, rawValue] of entries) {
    if (
      !/^BEHOLD_[A-Z0-9_]{1,120}$/.test(name) ||
      RESERVED_RESIDENT_ENVIRONMENT.has(name) ||
      typeof rawValue !== 'string' ||
      rawValue.length > 4096 ||
      rawValue.includes('\0')
    ) {
      throw new WorldRunnerError(
        `Resident ${entityId} has an invalid or authoritative environment variable ${name}`,
        'resident_environment_invalid',
        { entityId, name },
      );
    }
    normalized[name] = rawValue;
  }
  return Object.freeze(normalized);
}

type ProcessExit = Readonly<{ name: string; code: number | null; signal: NodeJS.Signals | null }>;

function waitForExit(child: ChildProcessWithoutNullStreams, name: string): Promise<ProcessExit> {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ name, code, signal }));
  });
}

function processExited(child: ChildProcessWithoutNullStreams) {
  return child.exitCode !== null || child.signalCode !== null;
}

function cleanExit(exit: ProcessExit) {
  return exit.code === 0 && exit.signal === null;
}

type OutputCapture = Readonly<{
  lines(): readonly string[];
  mark(): number;
  linesAfter(sequence: number): readonly string[];
}>;

function captureOutput(
  child: ChildProcessWithoutNullStreams,
  stdout: (text: string) => void,
  stderr: (text: string) => void,
): OutputCapture {
  let sequence = 0;
  const lines: Array<{ sequence: number; text: string }> = [];
  const remainders = new Map<'stdout' | 'stderr', string>([
    ['stdout', ''],
    ['stderr', ''],
  ]);
  const append = (
    stream: 'stdout' | 'stderr',
    chunk: Buffer | string,
    sink: (value: string) => void,
  ) => {
    const value = String(chunk);
    sink(value);
    const fragments = `${remainders.get(stream) || ''}${value}`.split(/\r?\n/);
    remainders.set(stream, fragments.pop() || '');
    for (const line of fragments) lines.push({ sequence: ++sequence, text: line });
    if (lines.length > 10_000) lines.splice(0, lines.length - 10_000);
  };
  child.stdout.on('data', (chunk) => append('stdout', chunk, stdout));
  child.stderr.on('data', (chunk) => append('stderr', chunk, stderr));
  return Object.freeze({
    lines: () => lines.map((line) => line.text),
    mark: () => sequence,
    linesAfter: (marker: number) =>
      lines.filter((line) => line.sequence > marker).map((line) => line.text),
  });
}

export function isMinecraftReadyLine(line: string) {
  return /^(?:\[[^\]\r\n]+\] )?\[Server thread\/INFO\]: Done \([^)]+\)! For help, type "help"$/.test(
    line.trim(),
  );
}

export function isControllerReadyLine(line: string) {
  return line.trim() === '[bot] Local world loaded.';
}

export function isControllerReleaseArmedLine(line: string, releaseId: string, entityId: string) {
  return line.trim() === `[bot] Experiment release armed: ${releaseId} ${entityId}`;
}

export function isMinecraftTickFrozenAcknowledgement(line: string) {
  return /^(?:\[[^\]\r\n]+\] )?\[Server thread\/INFO\]: The game is frozen$/.test(line.trim());
}

export function isMinecraftTickRunningAcknowledgement(line: string) {
  return /^(?:\[[^\]\r\n]+\] )?\[Server thread\/INFO\]: The game is running normally$/.test(
    line.trim(),
  );
}

export function isMinecraftSaveAcknowledgement(line: string) {
  return /^(?:\[[^\]\r\n]+\] )?\[Server thread\/INFO\]: Saved the game$/.test(line.trim());
}

export type ReleaseRuntimeDigestAttempt = Readonly<{
  attempt: number;
  outcome: 'changed_while_hashing' | 'candidate' | 'changed_between_reads' | 'stable';
  digest: string | null;
  previousDigest: string | null;
  error: string | null;
}>;

/**
 * A flushed, frozen Minecraft server may still finish an already-scheduled
 * region write. Release requires two complete, consecutive reads of the same
 * runtime tree; only the digest reader's explicit concurrent-change failure
 * is retryable, and every attempt is exposed to the lifecycle journal.
 */
export async function digestStableReleaseRuntime(
  root: string,
  dependencies: Readonly<{
    digest?: typeof digestTree;
    sleep?: (milliseconds: number) => Promise<void>;
    onAttempt?: (attempt: ReleaseRuntimeDigestAttempt) => void;
  }> = {},
) {
  const readDigest = dependencies.digest ?? digestTree;
  const wait =
    dependencies.sleep ??
    ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let previous: ReturnType<typeof digestTree> | null = null;
  const attempts: ReleaseRuntimeDigestAttempt[] = [];
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    let current: ReturnType<typeof digestTree>;
    try {
      current = readDigest(root);
    } catch (error: any) {
      const message = error?.message || String(error);
      if (!message.startsWith('Filesystem entry changed while it was being hashed:')) throw error;
      previous = null;
      const evidence = Object.freeze({
        attempt,
        outcome: 'changed_while_hashing' as const,
        digest: null,
        previousDigest: null,
        error: message,
      });
      attempts.push(evidence);
      dependencies.onAttempt?.(evidence);
      await wait(100);
      continue;
    }
    const stable = previous?.digest === current.digest;
    const evidence = Object.freeze({
      attempt,
      outcome: stable
        ? ('stable' as const)
        : previous
          ? ('changed_between_reads' as const)
          : ('candidate' as const),
      digest: current.digest,
      previousDigest: previous?.digest ?? null,
      error: null,
    });
    attempts.push(evidence);
    dependencies.onAttempt?.(evidence);
    if (stable) return current;
    previous = current;
    await wait(100);
  }
  throw new WorldRunnerError(
    'Frozen Minecraft runtime did not produce two consecutive matching tree digests',
    'experiment_release_world_digest_unstable',
    { attempts },
  );
}

async function setMinecraftTickState(input: {
  server: ChildProcessWithoutNullStreams;
  serverExit: Promise<ProcessExit>;
  output: OutputCapture;
  timeoutMs: number;
  sleep: (milliseconds: number) => Promise<void>;
  state: 'frozen' | 'running';
}) {
  const marker = input.output.mark();
  const command = input.state === 'frozen' ? 'tick freeze' : 'tick unfreeze';
  const matches =
    input.state === 'frozen'
      ? isMinecraftTickFrozenAcknowledgement
      : isMinecraftTickRunningAcknowledgement;
  input.server.stdin.write(`${command}\n`);
  await raceProcessExits(
    (signal) =>
      waitForCondition(
        `Minecraft tick ${input.state} acknowledgement`,
        input.timeoutMs,
        input.sleep,
        async () => input.output.linesAfter(marker).some(matches),
        signal,
      ),
    [input.serverExit],
  );
  return input.output.linesAfter(marker).find(matches)!;
}

async function saveMinecraftWorld(input: {
  server: ChildProcessWithoutNullStreams;
  serverExit: Promise<ProcessExit>;
  output: OutputCapture;
  timeoutMs: number;
  sleep: (milliseconds: number) => Promise<void>;
  reason: string;
}) {
  const marker = input.output.mark();
  input.server.stdin.write('save-all flush\n');
  await raceProcessExits(
    (signal) =>
      waitForCondition(
        `Minecraft save acknowledgement for ${input.reason}`,
        input.timeoutMs,
        input.sleep,
        async () => input.output.linesAfter(marker).some(isMinecraftSaveAcknowledgement),
        signal,
      ),
    [input.serverExit],
  );
  return input.output.linesAfter(marker).find(isMinecraftSaveAcknowledgement)!;
}

function pathIsWithin(directory: string, file: string) {
  const relative = path.relative(path.resolve(directory), path.resolve(file));
  return (
    relative !== '' &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  );
}

async function raceProcessExits<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  exits: readonly Promise<ProcessExit>[],
) {
  const cancellation = new AbortController();
  try {
    return await Promise.race([
      operation(cancellation.signal),
      ...exits.map((exit) =>
        exit.then((e) => {
          throw new WorldRunnerError(
            `${e.name} exited before readiness`,
            'child_exited_before_ready',
            e,
          );
        }),
      ),
    ]);
  } finally {
    cancellation.abort();
  }
}

async function waitForCondition(
  label: string,
  timeoutMs: number,
  sleep: (milliseconds: number) => Promise<void>,
  condition: () => Promise<boolean>,
  signal?: AbortSignal,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    if (await condition()) return;
    await sleep(Math.min(100, Math.max(1, deadline - Date.now())));
  }
  throw new WorldRunnerError(`${label} timed out after ${timeoutMs}ms`, 'runner_timeout', {
    label,
    timeoutMs,
  });
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new WorldRunnerError(`${label} timed out`, 'runner_timeout', { label, timeoutMs }),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function assertStoppedEvidence(evidence: RuntimeInspection, phase: string) {
  const blockers: string[] = [];
  if (!evidence.runtimeExists) blockers.push('runtime_world_missing');
  if (!evidence.topology.safe) blockers.push(...evidence.topology.blockers);
  if (evidence.runtimeSessionLock.state !== 'clear') {
    blockers.push(`runtime_session_lock_${evidence.runtimeSessionLock.state}`);
  }
  if (evidence.serverPort.state !== 'clear') {
    blockers.push(`server_port_${evidence.serverPort.state}`);
  }
  if (evidence.preparedBaselineSessionLock?.state === 'owned') {
    blockers.push('prepared_baseline_session_lock_owned');
  }
  if (evidence.preparedBaselineSessionLock?.state === 'unknown') {
    blockers.push('prepared_baseline_session_lock_unknown');
  }
  if (blockers.length) {
    throw new WorldRunnerError(
      `World is not stopped and clear during ${phase}: ${[...new Set(blockers)].join(', ')}`,
      'world_not_stopped',
      { phase, blockers: [...new Set(blockers)], evidence },
    );
  }
}

function worldCircleIds(worldId: string, world: WorldLabDefinition) {
  const hosts =
    world.server.host === '127.0.0.1' ||
    world.server.host === 'localhost' ||
    world.server.host === '::1'
      ? ['127.0.0.1', 'localhost', '[::1]']
      : [world.server.host];
  return Object.freeze([
    worldId,
    ...hosts.map((host) => `minecraft://${host}:${world.server.port}`),
  ]);
}

function assertNoWorldControllerLeases(
  entityRoot: string,
  residents: readonly NormalizedManagedResident[],
  circleIds: readonly string[],
  phase: string,
) {
  for (const resident of residents) {
    if (!fs.existsSync(resident.leasePath)) continue;
    throw new WorldRunnerError(
      `Configured resident lease already exists during ${phase}: ${resident.entityId}`,
      'configured_controller_lease_present',
      { phase, entityId: resident.entityId, leasePath: resident.leasePath },
    );
  }
  return assertNoControllerLeasesAtRoot(entityRoot, circleIds, phase);
}

function assertNoControllerLeasesAtRoot(
  entityRoot: string,
  circleIds: readonly string[],
  phase: string,
) {
  const inspection = inspectEntityLeaseFence(entityRoot, circleIds);
  if (inspection.state !== 'clear') {
    throw new WorldRunnerError(
      `World controller lease fence is ${inspection.state} during ${phase}`,
      'world_controller_lease_not_clear',
      { phase, inspection },
    );
  }
  return inspection;
}

function evidenceOwnedBy(evidence: OwnershipEvidence, pid: number) {
  return (
    evidence.state === 'owned' && evidence.owners.length === 1 && evidence.owners[0].pid === pid
  );
}

function leaseOwnedBy(file: string, pid: number, entityId: string, managedRunId: string) {
  try {
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    return (
      record?.protocol === 'behold.entity-runtime-lease.v1' &&
      record?.entityId === entityId &&
      record?.managedRunId === managedRunId &&
      record?.hostname === os.hostname() &&
      Number(record?.pid) === pid
    );
  } catch {
    return false;
  }
}

type RecoveryLease = Readonly<{
  file: string;
  present: boolean;
  stats: Readonly<{ device: number; inode: number }> | null;
  sha256: string | null;
  record: unknown;
}>;

function assertRecoveryRuntimeIdentity(owner: WorldOwnerRecord) {
  const canonical = fs.realpathSync.native(owner.runtime.path);
  const stats = fs.statSync(canonical);
  if (
    canonical !== owner.runtime.path ||
    !stats.isDirectory() ||
    stats.dev !== owner.runtime.device ||
    stats.ino !== owner.runtime.inode
  ) {
    throw new WorldRunnerError(
      'Recovery runtime identity no longer matches the abandoned owner',
      'recovery_runtime_changed',
      { expected: owner.runtime, actual: { path: canonical, device: stats.dev, inode: stats.ino } },
    );
  }
}

function assertRecoveryLifecycle(
  owner: WorldOwnerRecord,
  lifecycle: ReturnType<typeof verifyWorldLifecycleJournal>,
) {
  const first: any = lifecycle.events[0];
  const last: any = lifecycle.events.at(-1);
  const initialOwner = first?.data?.owner;
  const expectedState = {
    state: owner.state,
    runtime: owner.runtime,
    server: owner.server,
    controllers: owner.controllers,
  };
  if (
    lifecycle.world !== owner.world ||
    lifecycle.epoch !== owner.epoch ||
    first?.type !== 'control_acquired' ||
    initialOwner?.world !== owner.world ||
    initialOwner?.epoch !== owner.epoch ||
    initialOwner?.token !== owner.token ||
    initialOwner?.hostname !== owner.hostname ||
    initialOwner?.managerPid !== owner.managerPid ||
    last?.type !== 'control_state_changed' ||
    JSON.stringify(last?.data) !== JSON.stringify(expectedState)
  ) {
    throw new WorldRunnerError(
      'Recovery lifecycle does not terminate at the exact abandoned owner state',
      'recovery_lifecycle_mismatch',
      { first, last, owner },
    );
  }
}

function recoveryProcesses(owner: WorldOwnerRecord) {
  return [
    { role: 'manager', pid: owner.managerPid },
    ...(owner.server ? [{ role: 'server', pid: owner.server.pid }] : []),
    ...owner.controllers.map((controller) => ({
      role: `controller:${controller.entityId}`,
      pid: controller.pid,
    })),
  ];
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return error?.code !== 'ESRCH';
  }
}

function inspectRecoveryLeases(
  owner: WorldOwnerRecord,
  entityRoot: string,
  circleIds: readonly string[],
): RecoveryLease[] {
  const expected = new Set<string>();
  const runId = `${owner.world}-${owner.epoch}`;
  const leases = owner.controllers.map((controller) => {
    const requestedFile = path.resolve(controller.leasePath);
    const file = fs.existsSync(requestedFile)
      ? fs.realpathSync.native(requestedFile)
      : path.join(
          fs.realpathSync.native(path.dirname(requestedFile)),
          path.basename(requestedFile),
        );
    const required = path.join(entityRoot, controller.entityId, 'runtime.lock');
    if (file !== required || expected.has(file)) {
      throw new WorldRunnerError(
        'Recovery controller lease path is outside its exact entity slot or duplicated',
        'recovery_lease_path_invalid',
        { file, required },
      );
    }
    expected.add(file);
    if (!fs.existsSync(file)) {
      return Object.freeze({ file, present: false, stats: null, sha256: null, record: null });
    }
    const stats = plainFileStats(file, 'controller lease');
    const bytes = fs.readFileSync(file);
    const record = JSON.parse(bytes.toString('utf8'));
    if (
      record?.protocol !== 'behold.entity-runtime-lease.v1' ||
      record?.entityId !== controller.entityId ||
      record?.pid !== controller.pid ||
      record?.hostname !== owner.hostname ||
      record?.managedRunId !== runId
    ) {
      throw new WorldRunnerError(
        'Recovery controller lease does not belong to the abandoned owner epoch',
        'recovery_lease_mismatch',
        { file, record, controller, runId },
      );
    }
    return Object.freeze({
      file,
      present: true,
      stats: Object.freeze({ device: stats.dev, inode: stats.ino }),
      sha256: sha256Bytes(bytes),
      record,
    });
  });
  const fence = inspectEntityLeaseFence(entityRoot, circleIds);
  const observed = new Set(fence.owned.map((lease) => path.resolve(lease.leasePath)));
  const present = new Set(leases.filter((lease) => lease.present).map((lease) => lease.file));
  if (
    fence.state === 'unknown' ||
    observed.size !== present.size ||
    [...observed].some((file) => !present.has(file))
  ) {
    throw new WorldRunnerError(
      'Recovery found controller ownership beyond the exact abandoned epoch',
      'recovery_lease_fence_mismatch',
      { fence, expected: [...present] },
    );
  }
  return leases;
}

function assertRecoveryOwnerUnchanged(
  file: string,
  expectedStats: fs.Stats,
  expectedSha256: string,
  owner: WorldOwnerRecord,
) {
  const stats = plainFileStats(file, 'world owner');
  const bytes = fs.readFileSync(file);
  const observed = JSON.parse(bytes.toString('utf8'));
  if (
    stats.dev !== expectedStats.dev ||
    stats.ino !== expectedStats.ino ||
    sha256Bytes(bytes) !== expectedSha256 ||
    observed?.token !== owner.token ||
    observed?.epoch !== owner.epoch
  ) {
    throw new WorldRunnerError('Recovery owner changed after inspection', 'recovery_owner_changed');
  }
}

function assertRecoveryLeasesUnchanged(leases: readonly RecoveryLease[]) {
  for (const lease of leases) {
    if (!lease.present) {
      if (fs.existsSync(lease.file)) {
        throw new WorldRunnerError(
          'A controller lease appeared during recovery',
          'recovery_lease_changed',
          { file: lease.file },
        );
      }
      continue;
    }
    const stats = plainFileStats(lease.file, 'controller lease');
    const bytes = fs.readFileSync(lease.file);
    if (
      stats.dev !== lease.stats?.device ||
      stats.ino !== lease.stats?.inode ||
      sha256Bytes(bytes) !== lease.sha256
    ) {
      throw new WorldRunnerError(
        'A controller lease changed during recovery',
        'recovery_lease_changed',
        { file: lease.file },
      );
    }
  }
}

function plainFileStats(file: string, label: string) {
  const stats = fs.lstatSync(file);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new WorldRunnerError(
      `Recovery ${label} is not a plain file: ${file}`,
      'recovery_file_invalid',
    );
  }
  return stats;
}

function writeImmutableEvidence(
  file: string,
  value: unknown,
  expected?: Readonly<{
    world: string;
    epoch: number;
    ownerSha256: string;
    lifecycleTipDigest: string | null;
  }>,
) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  try {
    const descriptor = fs.openSync(file, 'wx', 0o600);
    try {
      fs.writeSync(descriptor, bytes);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fsyncDirectory(path.dirname(file));
    return;
  } catch (error: any) {
    if (error?.code !== 'EEXIST' || !expected) throw error;
  }
  const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (
    existing?.protocol !== 'behold.world-recovery-evidence.v1' ||
    existing?.phase !== 'prepared' ||
    existing?.world !== expected.world ||
    existing?.epoch !== expected.epoch ||
    existing?.owner?.sha256 !== expected.ownerSha256 ||
    existing?.lifecycle?.tipDigest !== expected.lifecycleTipDigest
  ) {
    throw new WorldRunnerError(
      'Existing recovery evidence does not match this abandoned epoch',
      'recovery_evidence_conflict',
      { file },
    );
  }
}

function sha256Bytes(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

function fsyncDirectory(directory: string) {
  const descriptor = fs.openSync(directory, 'r');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function sha256File(file: string) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function gitProvenance() {
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  const status = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  const changes = status.status === 0 ? String(status.stdout) : '';
  return {
    revision: revision.status === 0 ? String(revision.stdout).trim() : null,
    dirty: status.status !== 0 || changes.length > 0,
    statusSha256: createHash('sha256').update(changes).digest('hex'),
  };
}

export function bundledJava() {
  const candidate = path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'minecraft',
    'runtime',
    'java-runtime-delta',
    'mac-os-arm64',
    'java-runtime-delta',
    'jre.bundle',
    'Contents',
    'Home',
    'bin',
    'java',
  );
  return process.env.SERVER_JAVA || (fs.existsSync(candidate) ? candidate : 'java');
}

export async function runCli(argv = process.argv.slice(2)) {
  const command = argv[0];
  const parsed = parseArgs({
    args: argv.slice(1),
    options: {
      config: { type: 'string' },
      world: { type: 'string' },
      residents: { type: 'string' },
      model: { type: 'string' },
      urgentModel: { type: 'string' },
      policyProfile: { type: 'string' },
      bodyProfile: { type: 'string' },
      actionProfile: { type: 'string' },
      safetyProfile: { type: 'string' },
      controller: { type: 'string', multiple: true },
      body: { type: 'string', multiple: true },
      mind: { type: 'string' },
      paused: { type: 'boolean', default: false },
      tickMs: { type: 'string' },
      maxResidents: { type: 'string' },
      maxModelConcurrency: { type: 'string' },
      maxModelCalls: { type: 'string' },
      accountingScope: { type: 'string' },
      duration: { type: 'string' },
      task: { type: 'string' },
      target: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (parsed.values.help || !command) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const configPath = resolveWorldLabConfigPath({
    explicit: parsed.values.config == null ? undefined : String(parsed.values.config),
  });
  const worldId = String(parsed.values.world || 'sf-csdr');
  const config = loadWorldLabConfig(configPath);
  const world = config.worlds[worldId];
  if (!world) throw new WorldRunnerError(`Unknown world: ${worldId}`, 'unknown_world');
  const controlRoot = path.resolve('.behold-runtime/world-control');
  const entityRoot = resolveManagedDataRoot('.behold-entities', 'entity root');
  if (command === 'status') {
    const result = {
      control: inspectWorldControl(controlRoot, worldId),
      runtime: await statusWorld(worldId, world),
      controllerLeases: inspectEntityLeaseFence(entityRoot, worldCircleIds(worldId, world)),
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.control.state === 'clear' &&
      result.runtime.safe &&
      result.controllerLeases.state === 'clear'
      ? 0
      : 1;
  }
  if (command === 'recover') {
    const result = await recoverAbandonedManagedWorld({
      worldId,
      world,
      controlRoot,
      entityRoot,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  if (command !== 'start')
    throw new WorldRunnerError(`Unknown command: ${command}`, 'unknown_command');

  assertResidentConfigExclusive(parsed.values);
  const configuredResidents = parsed.values.residents
    ? loadManagedResidentSet(String(parsed.values.residents))
    : null;
  if (
    !process.env.OPENROUTER_API_KEY &&
    (configuredResidents
      ? configuredResidents.some(
          (resident) => resident.paused !== true && resident.ollamaLocal == null,
        )
      : !parsed.values.paused)
  ) {
    throw new WorldRunnerError(
      'OPENROUTER_API_KEY is required for a managed LLM run',
      'controller_credentials_missing',
    );
  }
  const sourceRevision = gitProvenance();
  if (sourceRevision.dirty) {
    throw new WorldRunnerError(
      'Managed runs require a clean Git worktree so their code is reproducible',
      'source_worktree_dirty',
      sourceRevision,
    );
  }

  const toolLock = JSON.parse(
    fs.readFileSync(path.resolve('docs/sf-world/tool-lock.json'), 'utf8'),
  );
  const serverDirectory = path.dirname(world.runtime.worldPath);
  const serverJar = path.resolve(String(toolLock.tools.minecraftServer.path));
  let residents: readonly ManagedResidentSpec[];
  if (configuredResidents) {
    residents = configuredResidents;
  } else {
    const controllerEntityIds = parsed.values.controller?.length
      ? parsed.values.controller.map(String)
      : ['ScoutLife'];
    const controllerBodyUsernames = parsed.values.body?.map(String) ?? [];
    if (
      controllerBodyUsernames.length > 0 &&
      controllerBodyUsernames.length !== controllerEntityIds.length
    ) {
      throw new WorldRunnerError(
        'Repeat --body exactly once per --controller, in the same order',
        'controller_body_count_mismatch',
        {
          controllers: controllerEntityIds.length,
          bodies: controllerBodyUsernames.length,
        },
      );
    }
    const controllerProfile = managedControllerProfile(parsed.values.task, parsed.values.target);
    const model = String(parsed.values.model || process.env.LLM_MODEL || DEFAULT_LLM_MODEL);
    const urgentModel = optionalText(parsed.values.urgentModel || process.env.LLM_URGENT_MODEL);
    const mind = String(parsed.values.mind || process.env.BEHOLD_MIND || 'direct') as
      'direct' | 'ax';
    const policyProfile = residentPolicyProfile(
      parsed.values.policyProfile || process.env.BEHOLD_POLICY_PROFILE,
    );
    const bodyProfile = minecraftBodyProfile(
      parsed.values.bodyProfile ||
        process.env.BEHOLD_BODY_PROFILE ||
        (policyProfile === 'neutral-benchmark-v1'
          ? 'minecraft-human-semantic-v1'
          : 'minecraft-resident-v1'),
    );
    const actionProfile = minecraftActionProfile(
      parsed.values.actionProfile ||
        process.env.BEHOLD_ACTION_PROFILE ||
        (policyProfile === 'neutral-benchmark-v1' ? 'minecraft-human-semantic-v1' : 'resident-v1'),
    );
    const safetyProfile = minecraftSafetyProfile(
      parsed.values.safetyProfile ||
        process.env.BEHOLD_SAFETY_PROFILE ||
        (policyProfile === 'neutral-benchmark-v1' ? 'vanilla-player-v1' : 'resident-safe-v1'),
    );
    const tickMs = Number(parsed.values.tickMs || process.env.AGENT_TICK_MS || 4000);
    residents = controllerEntityIds.map((entityId, index) => ({
      entityId,
      ...(controllerBodyUsernames[index] ? { bodyUsername: controllerBodyUsernames[index] } : {}),
      model,
      ...(urgentModel && urgentModel !== model ? { urgentModel } : {}),
      mind,
      policyProfile,
      bodyProfile,
      actionProfile,
      safetyProfile,
      tickMs,
      paused: parsed.values.paused,
      ...controllerProfile,
    }));
  }
  const maxResidents = Number(parsed.values.maxResidents || 16);
  const maxConcurrentModelCalls = Number(
    parsed.values.maxModelConcurrency || Math.min(2, residents.length),
  );
  const maxTotalModelCalls = managedTotalModelCallLimit(parsed.values.maxModelCalls);
  const durationMs = managedSessionDurationMs(parsed.values.duration);
  const run = await startManagedWorld({
    worldId,
    world,
    controlRoot,
    serverDirectory,
    serverJar,
    expectedServerJarSha256: String(toolLock.tools.minecraftServer.sha256),
    java: bundledJava(),
    controllerEntry: path.resolve('dist/src/cli/behold.js'),
    entityRoot,
    runRoot: resolveManagedDataRoot('.behold-runs', 'run root'),
    residents,
    maxResidents,
    maxConcurrentModelCalls,
    ...(maxTotalModelCalls == null ? {} : { maxTotalModelCalls }),
    ...(parsed.values.accountingScope == null
      ? {}
      : { accountingScopeId: String(parsed.values.accountingScope) }),
    ...(residents.some((resident) => resident.ollamaLocal != null)
      ? {
          ollamaServerConfigFile:
            process.env.BEHOLD_OLLAMA_SERVER_CONFIG ??
            path.join(os.homedir(), '.ollama', 'server.json'),
        }
      : {}),
  });
  process.stdout.write(
    `[world-runner] ready: ${worldId}, server ${run.serverPid}, residents ${run.residents
      .map((resident) => `${resident.entityId}:${resident.pid}`)
      .join(', ')}\n`,
  );
  if (durationMs != null) {
    run.control.append('session_duration_armed', {
      durationMs,
      beginsAt: 'run_ready',
      terminalReason: 'duration_elapsed',
    });
    process.stdout.write(`[world-runner] live-time boundary: ${durationMs / 1000}s\n`);
  }
  let requestStop!: (reason: string) => void;
  const stopRequested = new Promise<string>((resolve) => {
    requestStop = resolve;
  });
  const onSigint = () => requestStop('SIGINT');
  const onSigterm = () => requestStop('SIGTERM');
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);
  let durationTimer: NodeJS.Timeout | null = null;
  if (durationMs != null) {
    durationTimer = setTimeout(() => requestStop('duration_elapsed'), durationMs);
  }
  try {
    const outcome = await Promise.race([
      run.finished.then(() => ({ kind: 'children' as const })),
      stopRequested.then((reason) => ({ kind: 'stop' as const, reason })),
      ...(run.cognition && run.cognition.maxTotalModelCalls != null
        ? [
            run.cognition.admissionLimitSettled.then((evidence) => {
              run.control.append('cognition_admission_limit_settled', evidence);
              return {
                kind: 'stop' as const,
                reason: 'model_call_limit_settled',
              };
            }),
          ]
        : []),
    ]);
    if (outcome.kind === 'stop') {
      await run.stop(outcome.reason);
      await run.finished;
    }
  } catch (error) {
    await run.stop('managed_child_exit').catch(() => {});
    throw error;
  } finally {
    if (durationTimer) clearTimeout(durationTimer);
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
  }
  return 0;
}

function usage() {
  return [
    'Usage:',
    '  world-runner status --config <file> --world <id>',
    '  world-runner recover --config <file> --world <id>',
    '  world-runner start --config <file> --world <id> [--residents <json-file> | --controller <life-id> ...] [--body <minecraft-username> ...] [--model <slug>] [--urgentModel <slug>] [--mind direct|ax] [--paused] [--policyProfile resident-v1|neutral-benchmark-v1] [--bodyProfile minecraft-resident-v1|minecraft-human-semantic-v1] [--actionProfile resident-v1|minecraft-player-v1|minecraft-human-semantic-v1] [--safetyProfile resident-safe-v1|vanilla-player-v1] [--tickMs <ms>] [--maxResidents <n>] [--maxModelConcurrency <n>] [--maxModelCalls <n>] [--accountingScope <id>] [--duration <live-seconds>] [--task <name>] [--target <player>]',
    '',
    'Repeat --controller to start independently leased residents in one exact managed epoch.',
    'Repeat --body in the same order only when a life ID differs from its Minecraft username.',
    '--residents accepts a behold.managed-resident-set.v1 JSON document and cannot be mixed with resident-level flags.',
    'Without profile flags, the foreground runner starts the continuing resident profile. neutral-benchmark-v1 defaults to the matching minecraft-human-semantic-v1 body/action surface and vanilla-player-v1 risk policy.',
    'With --duration, graceful shutdown begins after that much post-readiness live time.',
    'With --maxModelCalls, the broker refuses calls past the exact population-wide admission ceiling and the owner then shuts down.',
    'With --accountingScope and resident-set providerQuotas, equal per-resident decision and auxiliary provider-attempt quotas persist across epochs.',
    'With --urgentModel, only newly urgent bodily/world evidence uses that model; ordinary and social decisions retain --model.',
    'Come-See-Do-Report remains available explicitly with --task come-see-do-report.',
    'Recovery releases only an exact same-host abandoned epoch after durable evidence and stopped-world verification.',
    'The foreground runner refuses foreign-owned ports, session locks, and owner records.',
  ].join('\n');
}

function optionalText(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || undefined;
}

function chatCompletionEndpoint(value: unknown) {
  const normalized = String(value || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  const endpoint = normalized.endsWith('/chat/completions')
    ? normalized
    : `${normalized}/chat/completions`;
  const url = new URL(endpoint);
  url.search = '';
  url.hash = '';
  return url.toString();
}

if (require.main === module) {
  void runCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: any) => {
      process.stderr.write(`[world-runner] ${error?.message || String(error)}\n`);
      process.exitCode = 1;
    });
}
