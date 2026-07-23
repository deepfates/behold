import type { ModelCallEvidence, ModelCallFailureEvidence } from '../mind/evidence';
import { ResidentMindCallError } from '../mind/evidence';
import type { ResidentMind, ResidentMindDecision } from '../mind/interface';
import {
  parseResidentMindRequestArtifact,
  residentMindRequestSha256,
  type ResidentMindRequestArtifact,
} from '../mind/request-artifact';
import { validateResidentActionInput } from '../mind/schema';

export type ResidentMindComparisonArm = Readonly<{
  label: string;
  mind: ResidentMind;
}>;

export type ResidentMindComparison = Readonly<{
  protocol: 'behold.mind-comparison.v1';
  request: Readonly<{
    artifactProtocol: ResidentMindRequestArtifact['protocol'];
    sha256: string;
    model: string;
  }>;
  safety: Readonly<{
    worldMutationEnabled: false;
    executableWorldFunctionsExposed: false;
  }>;
  arms: readonly Readonly<{
    label: string;
    mind: string;
    status: 'completed' | 'failed' | 'invalid';
    inputMatched: boolean;
    decision: null | Readonly<{
      disposition: ResidentMindDecision['disposition'];
      utterance: string | null;
      action: ResidentMindDecision['action'];
    }>;
    call: ModelCallEvidence | ModelCallFailureEvidence | null;
    error: string | null;
  }>[];
  verdict: Readonly<{
    inputMatched: boolean;
    allCompleted: boolean;
    allValid: boolean;
    sameProposedAction: boolean | null;
  }>;
}>;

/** Run replaceable minds from one immutable framework input without admitting an action. */
export async function compareResidentMinds(
  artifactValue: unknown,
  arms: readonly ResidentMindComparisonArm[],
  options: Readonly<{ timeoutMs?: number }> = {},
): Promise<ResidentMindComparison> {
  const artifact = parseResidentMindRequestArtifact(artifactValue);
  if (arms.length < 2) throw new Error('mind comparison requires at least two arms');
  const labels = new Set<string>();
  for (const arm of arms) {
    if (!arm.label.trim()) throw new Error('mind comparison arm label must be non-empty');
    if (labels.has(arm.label)) throw new Error(`mind comparison arm ${arm.label} is duplicated`);
    labels.add(arm.label);
  }
  const timeoutMs = boundedTimeout(options.timeoutMs ?? 30_000);
  const results = await Promise.all(arms.map((arm) => runArm(artifact, arm, timeoutMs)));
  const completed = results.filter((arm) => arm.status === 'completed');
  const actions = completed.map((arm) =>
    stableJson(
      arm.decision?.action == null
        ? null
        : { name: arm.decision.action.name, input: arm.decision.action.input },
    ),
  );
  return deepFreeze({
    protocol: 'behold.mind-comparison.v1',
    request: {
      artifactProtocol: artifact.protocol,
      sha256: artifact.requestSha256,
      model: artifact.request.model,
    },
    safety: {
      worldMutationEnabled: false,
      executableWorldFunctionsExposed: false,
    },
    arms: results,
    verdict: {
      inputMatched: results.every((arm) => arm.inputMatched),
      allCompleted: results.every((arm) => arm.status === 'completed'),
      allValid: results.every((arm) => arm.status !== 'invalid'),
      sameProposedAction:
        completed.length === results.length
          ? actions.every((action) => action === actions[0])
          : null,
    },
  });
}

async function runArm(
  artifact: ResidentMindRequestArtifact,
  arm: ResidentMindComparisonArm,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const deadline = setTimeout(
    () => controller.abort(new Error(`mind comparison exceeded ${timeoutMs}ms`)),
    timeoutMs,
  );
  deadline.unref?.();
  try {
    const decision = await arm.mind.decide(artifact.request, { signal: controller.signal });
    const sourceCall = decision?.call ?? null;
    const inputMatched = callMatchesArtifact(sourceCall, artifact);
    const invalid = validateDecision(decision, artifact);
    const call = sourceCall == null ? null : cloneJson(sourceCall);
    return deepFreeze({
      label: arm.label,
      mind: arm.mind.id,
      status: invalid ? ('invalid' as const) : ('completed' as const),
      inputMatched,
      decision: publicDecision(decision),
      call,
      error: invalid,
    });
  } catch (error: any) {
    const sourceCall = failureCall(error);
    const call = sourceCall == null ? null : cloneJson(sourceCall);
    return deepFreeze({
      label: arm.label,
      mind: arm.mind.id,
      status: 'failed' as const,
      inputMatched: callMatchesArtifact(sourceCall, artifact),
      decision: null,
      call,
      error: error?.message || String(error),
    });
  } finally {
    clearTimeout(deadline);
  }
}

function validateDecision(
  decision: ResidentMindDecision,
  artifact: ResidentMindRequestArtifact,
): string | null {
  if (decision?.protocol !== 'behold.mind-decision.v1') {
    return 'mind returned an unsupported decision protocol';
  }
  if (!callMatchesArtifact(decision.call, artifact)) {
    return 'mind call does not identify the compared request artifact';
  }
  if (decision.call.request.model !== artifact.request.model) {
    return 'mind call model differs from the compared request';
  }
  if (decision.disposition === 'no_action') {
    if (artifact.request.requiredAction) return 'mind omitted the required action';
    return decision.action == null ? null : 'no_action decision contains an action';
  }
  if (decision.disposition !== 'act' && decision.disposition !== 'wait') {
    return 'mind returned an invalid disposition';
  }
  const action = decision.action;
  if (!action || typeof action.name !== 'string') return 'mind decision contains no action';
  const expectedName = decision.disposition === 'wait' ? 'wait_for_event' : action.name;
  if (action.name !== expectedName) return 'wait decision did not select wait_for_event';
  if (artifact.request.requiredAction && action.name !== artifact.request.requiredAction) {
    return 'mind decision differs from the required action';
  }
  const admitted = artifact.request.actions.find((candidate) => candidate.name === action.name);
  if (!admitted) return `mind selected unadmitted action ${action.name}`;
  if (action.input == null || typeof action.input !== 'object' || Array.isArray(action.input)) {
    return `mind selected non-object input for ${action.name}`;
  }
  const validation = validateResidentActionInput(action.input, admitted.inputSchema);
  return validation.ok === true
    ? null
    : `mind selected invalid input: ${validation.errors.join('; ')}`;
}

function callMatchesArtifact(
  call: ModelCallEvidence | ModelCallFailureEvidence | null | undefined,
  artifact: ResidentMindRequestArtifact,
) {
  if (call?.protocol !== 'behold.model-call.v1') return false;
  if (call.request?.mindRequestSha256 !== artifact.requestSha256) return false;
  if (call.request.mindRequest != null) {
    try {
      return residentMindRequestSha256(call.request.mindRequest) === artifact.requestSha256;
    } catch {
      return false;
    }
  }
  return true;
}

function publicDecision(decision: ResidentMindDecision) {
  return deepFreeze({
    disposition: decision.disposition,
    utterance: typeof decision.utterance === 'string' ? decision.utterance : null,
    action: decision.action == null ? null : cloneJson(decision.action),
  });
}

function failureCall(error: any): ModelCallFailureEvidence | null {
  if (error instanceof ResidentMindCallError) return error.call;
  return error?.call?.protocol === 'behold.model-call.v1' ? error.call : null;
}

function boundedTimeout(value: number) {
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 120_000) {
    throw new Error('mind comparison timeout must be an integer from 1000 through 120000');
  }
  return value;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  }
  return value;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
