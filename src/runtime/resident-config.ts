import { getConfig, type Config, type ConfigEnvironment } from '../config';
import {
  minecraftActionProfile,
  minecraftSafetyProfile,
  type MinecraftActionProfile,
  type MinecraftSafetyProfile,
} from '../agent/action-profiles';
import { boundedUrgentDecisionTimeoutMs } from '../policy/llm';
import {
  residentPolicyProfile,
  usesHumanSemanticPolicySurface,
  type ResidentPolicyProfile,
} from '../policy/profile';
import {
  minecraftBodyProfile,
  usesHumanSemanticBody,
  type MinecraftBodyProfile,
} from '../mind/minecraft-body';
import { isCognitionTransportEnabled } from '../mind/cognition';
import {
  openRouterRoutePolicyFromEnvironment,
  type OpenRouterRoutePolicy,
} from '../mind/openrouter-route';
import { ollamaLocalPolicyFromEnvironment, type OllamaLocalPolicy } from '../mind/ollama-local';
import {
  lmStudioLocalPolicyFromEnvironment,
  type LmStudioLocalPolicy,
} from '../mind/lmstudio-local';
import { assertOllamaLocalJsonActionTreatment } from '../mind/ollama-json-action';
import {
  fixedDecisionPilotSchedule,
  type FixedDecisionPilotSchedule,
} from '../policy/fixed-decision-pilot';

export type ResidentMindAdapter = 'direct' | 'ax';

export type ResidentRuntimeOptions = Readonly<{
  /** Continuing private-life identity. */
  agentName?: string;
  /** Minecraft connection identity. Defaults to agentName. */
  bodyUsername?: string;
  model?: string;
  urgentModel?: string;
  urgentDecisionTimeoutMs?: number;
  tickMs?: number;
  maxTurnSteps?: number;
  resumeAfterBudget?: boolean;
  decisionSchedule?: FixedDecisionPilotSchedule;
  paused?: boolean;
  policyProfile?: ResidentPolicyProfile;
  bodyProfile?: MinecraftBodyProfile;
  actionProfile?: MinecraftActionProfile;
  safetyProfile?: MinecraftSafetyProfile;
  allowTools?: string[] | null;
  task?: string;
  target?: string;
  serverHost?: string;
  serverPort?: number;
  circleId?: string;
}>;

/**
 * One resolved, immutable description of the resident process Behold is about
 * to assemble. Environment variables are an input at the process boundary;
 * downstream composition must not rewrite them to configure itself.
 */
export type ResidentRuntimeConfig = Readonly<{
  minecraft: Config;
  entityId: string;
  bodyUsername: string;
  model: string;
  urgentModel: string | undefined;
  urgentDecisionTimeoutMs: number;
  tickMs: number;
  maxTurnSteps: number;
  resumeAfterBudget: boolean;
  decisionSchedule: FixedDecisionPilotSchedule | null;
  paused: boolean;
  allowTools: readonly string[] | null;
  task: string | undefined;
  target: string | undefined;
  profiles: Readonly<{
    policy: ResidentPolicyProfile;
    body: MinecraftBodyProfile;
    actions: MinecraftActionProfile;
    safety: MinecraftSafetyProfile;
  }>;
  cognition: Readonly<{
    mind: ResidentMindAdapter;
    authenticatedTransport: boolean;
    apiKey: string | undefined;
    endpoint: string | undefined;
    recordModelIO: boolean;
    providerRoute: OpenRouterRoutePolicy | null;
    ollamaLocal: OllamaLocalPolicy | null;
    lmStudioLocal: LmStudioLocalPolicy | null;
    lmStudioModelInstanceId: string | undefined;
  }>;
  managed: Readonly<{
    runId: string | null;
    quotaAccountId: string | undefined;
  }>;
}>;

export function resolveResidentRuntimeConfig(
  options: ResidentRuntimeOptions = {},
  environment: ConfigEnvironment = process.env,
): ResidentRuntimeConfig {
  const minecraft = getConfig(environment, {
    serverHost: options.serverHost,
    serverPort: options.serverPort,
    circleId: options.circleId,
    bodyUsername: options.bodyUsername || options.agentName,
    model: options.model,
    tickMs: options.tickMs,
  });
  const entityId = options.agentName?.trim() || minecraft.auth.username || 'Agent';
  const bodyUsername = minecraft.auth.username || 'BeholdBot';
  const policy = residentPolicyProfile(options.policyProfile ?? environment.BEHOLD_POLICY_PROFILE);
  const body = minecraftBodyProfile(
    options.bodyProfile ??
      environment.BEHOLD_BODY_PROFILE ??
      (usesHumanSemanticPolicySurface(policy)
        ? 'minecraft-human-semantic-v1'
        : 'minecraft-resident-v1'),
  );
  const actions = minecraftActionProfile(
    options.actionProfile ??
      environment.BEHOLD_ACTION_PROFILE ??
      (usesHumanSemanticPolicySurface(policy) ? 'minecraft-human-semantic-v1' : 'resident-v1'),
  );
  if (usesHumanSemanticBody(body) !== (actions === 'minecraft-human-semantic-v1')) {
    throw new Error(
      `body profile ${body} must be paired with its matching action profile; received ${actions}`,
    );
  }
  const safety = minecraftSafetyProfile(
    options.safetyProfile ??
      environment.BEHOLD_SAFETY_PROFILE ??
      (usesHumanSemanticPolicySurface(policy) ? 'vanilla-player-v1' : 'resident-safe-v1'),
  );
  const mind = residentMindAdapter(environment.BEHOLD_MIND);
  const authenticatedTransport = isCognitionTransportEnabled(
    environment.BEHOLD_COGNITION_TRANSPORT,
  );
  const providerRoute = openRouterRoutePolicyFromEnvironment(
    environment.BEHOLD_OPENROUTER_ROUTE_POLICY,
  );
  const ollamaLocal = ollamaLocalPolicyFromEnvironment(environment.BEHOLD_OLLAMA_LOCAL_POLICY);
  const lmStudioLocal = lmStudioLocalPolicyFromEnvironment(
    environment.BEHOLD_LMSTUDIO_LOCAL_POLICY,
  );
  if (
    policy === 'legible-resident-v1' &&
    providerRoute?.protocol !== 'behold.openrouter-route-policy.v2' &&
    providerRoute?.protocol !== 'behold.openrouter-route-policy.v3' &&
    !ollamaLocal &&
    !lmStudioLocal
  ) {
    throw new Error('legible-resident-v1 requires a strict resident-session transport');
  }
  if (ollamaLocal) assertOllamaLocalJsonActionTreatment({ policyProfile: policy }, ollamaLocal);
  if ((providerRoute || ollamaLocal || lmStudioLocal) && mind !== 'direct') {
    throw new Error('Configured resident-session transport requires the direct mind adapter');
  }
  if (
    Number(Boolean(providerRoute)) + Number(Boolean(ollamaLocal)) + Number(Boolean(lmStudioLocal)) >
    1
  ) {
    throw new Error('A resident cannot combine OpenRouter, Ollama, and LM Studio policies');
  }
  if ((ollamaLocal || lmStudioLocal) && !authenticatedTransport) {
    throw new Error('Local resident policy requires the authenticated cognition transport');
  }
  if (ollamaLocal && ollamaLocal.modelTag !== minecraft.llm.model) {
    throw new Error('Ollama local model tag differs from the configured resident model');
  }
  if (lmStudioLocal && lmStudioLocal.modelKey !== minecraft.llm.model) {
    throw new Error('LM Studio local model key differs from the configured resident model');
  }
  const maxTurnSteps = options.maxTurnSteps ?? (options.task ? 8 : 16);
  const resumeAfterBudget = options.resumeAfterBudget ?? options.task == null;
  const decisionSchedule = options.decisionSchedule
    ? fixedDecisionPilotSchedule(options.decisionSchedule)
    : null;
  if (decisionSchedule && (maxTurnSteps !== 1 || resumeAfterBudget !== false)) {
    throw new Error(
      'fixed decision pilot schedule requires maxTurnSteps 1 and resumeAfterBudget false',
    );
  }
  const localResidentSession = ollamaLocal != null || lmStudioLocal != null;
  const apiKey = localResidentSession
    ? environment.BEHOLD_COGNITION_BEARER
    : environment.OPENROUTER_API_KEY;
  const endpoint = localResidentSession
    ? environment.BEHOLD_COGNITION_ENDPOINT
    : environment.OPENROUTER_BASE_URL;
  if (localResidentSession && (!apiKey || !endpoint)) {
    throw new Error(
      'Local resident policy is missing its runner-owned broker credential or endpoint',
    );
  }

  return deepFreeze({
    minecraft,
    entityId,
    bodyUsername,
    model: minecraft.llm.model,
    urgentModel: options.urgentModel?.trim() || undefined,
    urgentDecisionTimeoutMs: boundedUrgentDecisionTimeoutMs(
      options.urgentDecisionTimeoutMs ?? environment.BEHOLD_URGENT_DECISION_TIMEOUT_MS,
    ),
    tickMs: Math.max(500, Number(options.tickMs ?? minecraft.agent.tickMs ?? 3000)),
    maxTurnSteps,
    resumeAfterBudget,
    decisionSchedule,
    paused: Boolean(options.paused),
    allowTools: options.allowTools ? [...options.allowTools] : null,
    task: options.task,
    target: options.target,
    profiles: { policy, body, actions, safety },
    cognition: {
      mind,
      authenticatedTransport,
      apiKey,
      endpoint,
      recordModelIO: environment.BEHOLD_RECORD_MODEL_IO === '1',
      providerRoute,
      ollamaLocal,
      lmStudioLocal,
      lmStudioModelInstanceId: optionalText(environment.BEHOLD_LMSTUDIO_MODEL_INSTANCE_ID),
    },
    managed: {
      runId: optionalText(environment.BEHOLD_RUN_ID) ?? null,
      quotaAccountId: optionalText(environment.BEHOLD_COGNITION_ACCOUNT_ID),
    },
  });
}

function residentMindAdapter(value: string | undefined): ResidentMindAdapter {
  const normalized = String(value || 'direct')
    .trim()
    .toLowerCase();
  if (normalized === 'direct' || normalized === 'ax') return normalized;
  throw new Error(`Unsupported BEHOLD_MIND ${JSON.stringify(value)}; expected direct or ax`);
}

function optionalText(value: unknown) {
  const normalized = String(value ?? '').trim();
  return normalized || undefined;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
