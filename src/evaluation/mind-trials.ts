import type { ModelCallEvidence, ModelCallFailureEvidence } from '../mind/evidence';
import type { ResidentMindComparisonArm } from './mind-comparison';
import { compareResidentMinds, type ResidentMindComparison } from './mind-comparison';
import {
  parseResidentMindRequestArtifact,
  type ResidentMindRequestArtifact,
} from '../mind/request-artifact';

export type ResidentMindTrials = Readonly<{
  protocol: 'behold.mind-trials.v1';
  request: Readonly<{
    artifactProtocol: ResidentMindRequestArtifact['protocol'];
    sha256: string;
    model: string;
  }>;
  trialsPerMind: number;
  safety: Readonly<{
    worldMutationEnabled: false;
    executableWorldFunctionsExposed: false;
  }>;
  trials: readonly Readonly<{
    index: number;
    comparison: ResidentMindComparison;
  }>[];
  minds: readonly Readonly<{
    label: string;
    mind: string;
    outcomes: Readonly<{
      completed: number;
      failed: number;
      invalid: number;
      inputMatched: number;
    }>;
    actions: readonly Readonly<{
      disposition: string;
      action: unknown;
      count: number;
    }>[];
    latencyMs: Readonly<{
      samples: number;
      min: number | null;
      p50: number | null;
      p95: number | null;
      max: number | null;
      mean: number | null;
    }>;
    usage: Readonly<{
      reportedTrials: number;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      cost: number;
      providerAttemptsReported: number;
      providerAttempts: number;
    }>;
  }>[];
  verdict: Readonly<{
    inputMatched: boolean;
    allCompleted: boolean;
    allValid: boolean;
  }>;
}>;

/** Repeatedly sample replaceable minds from one immutable input without admitting an action. */
export async function runResidentMindTrials(
  artifactValue: unknown,
  arms: readonly ResidentMindComparisonArm[],
  options: Readonly<{ trials?: number; timeoutMs?: number }> = {},
): Promise<ResidentMindTrials> {
  const artifact = parseResidentMindRequestArtifact(artifactValue);
  const trialCount = boundedTrials(options.trials ?? 1);
  const trials: { index: number; comparison: ResidentMindComparison }[] = [];
  for (let index = 1; index <= trialCount; index += 1) {
    trials.push({
      index,
      comparison: await compareResidentMinds(artifact, arms, {
        ...(options.timeoutMs == null ? {} : { timeoutMs: options.timeoutMs }),
      }),
    });
  }
  return deepFreeze({
    protocol: 'behold.mind-trials.v1' as const,
    request: {
      artifactProtocol: artifact.protocol,
      sha256: artifact.requestSha256,
      model: artifact.request.model,
    },
    trialsPerMind: trialCount,
    safety: {
      worldMutationEnabled: false as const,
      executableWorldFunctionsExposed: false as const,
    },
    trials,
    minds: arms.map((arm) => summarizeArm(arm.label, arm.mind.id, trials)),
    verdict: {
      inputMatched: trials.every((trial) => trial.comparison.verdict.inputMatched),
      allCompleted: trials.every((trial) => trial.comparison.verdict.allCompleted),
      allValid: trials.every((trial) => trial.comparison.verdict.allValid),
    },
  });
}

function summarizeArm(
  label: string,
  mind: string,
  trials: readonly { index: number; comparison: ResidentMindComparison }[],
) {
  const results = trials.map((trial) => {
    const result = trial.comparison.arms.find((arm) => arm.label === label);
    if (!result) throw new Error(`mind trial ${trial.index} has no arm ${label}`);
    return result;
  });
  const actionCounts = new Map<string, { disposition: string; action: unknown; count: number }>();
  const latencies: number[] = [];
  let reportedTrials = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let cost = 0;
  let providerAttemptsReported = 0;
  let providerAttempts = 0;
  for (const result of results) {
    if (result.decision) {
      const key = stableJson({
        disposition: result.decision.disposition,
        action: result.decision.action,
      });
      const existing = actionCounts.get(key);
      if (existing) existing.count += 1;
      else {
        actionCounts.set(key, {
          disposition: result.decision.disposition,
          action: cloneJson(result.decision.action),
          count: 1,
        });
      }
    }
    const latency = Number(result.call?.latencyMs);
    if (Number.isFinite(latency) && latency >= 0) latencies.push(latency);
    const usage = providerUsage(result.call);
    if (usage) {
      reportedTrials += 1;
      promptTokens += usage.promptTokens;
      completionTokens += usage.completionTokens;
      totalTokens += usage.totalTokens;
      cost += usage.cost;
    }
    const attempts = reportedProviderAttempts(result.call);
    if (attempts != null) {
      providerAttemptsReported += 1;
      providerAttempts += attempts;
    }
  }
  return {
    label,
    mind,
    outcomes: {
      completed: results.filter((result) => result.status === 'completed').length,
      failed: results.filter((result) => result.status === 'failed').length,
      invalid: results.filter((result) => result.status === 'invalid').length,
      inputMatched: results.filter((result) => result.inputMatched).length,
    },
    actions: [...actionCounts.values()].sort(
      (left, right) =>
        right.count - left.count || stableJson(left).localeCompare(stableJson(right)),
    ),
    latencyMs: distribution(latencies),
    usage: {
      reportedTrials,
      promptTokens,
      completionTokens,
      totalTokens,
      cost,
      providerAttemptsReported,
      providerAttempts,
    },
  };
}

function providerUsage(call: ModelCallEvidence | ModelCallFailureEvidence | null) {
  if (!call || !('usage' in call.response)) return null;
  const raw: any = call.response.usage;
  const usage = raw?.provider ?? raw;
  if (!usage || typeof usage !== 'object') return null;
  const values = {
    promptTokens: Number(usage.prompt_tokens),
    completionTokens: Number(usage.completion_tokens),
    totalTokens: Number(usage.total_tokens),
    cost: Number(usage.cost ?? 0),
  };
  if (
    !Number.isFinite(values.promptTokens) ||
    !Number.isFinite(values.completionTokens) ||
    !Number.isFinite(values.totalTokens) ||
    !Number.isFinite(values.cost)
  ) {
    return null;
  }
  return values;
}

function reportedProviderAttempts(
  call: ModelCallEvidence | ModelCallFailureEvidence | null,
): number | null {
  if (!call || !('usage' in call.response)) return null;
  const raw: any = call.response.usage;
  const attempts = Number(raw?.provider?.attempts);
  if (Number.isSafeInteger(attempts) && attempts >= 1) return attempts;
  return raw == null ? null : 1;
}

function distribution(values: readonly number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) {
    return { samples: 0, min: null, p50: null, p95: null, max: null, mean: null };
  }
  return {
    samples: sorted.length,
    min: sorted[0],
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1)!,
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
  };
}

function percentile(sorted: readonly number[], fraction: number) {
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function boundedTrials(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 20) {
    throw new Error('mind trials must be an integer from 1 through 20');
  }
  return value;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as any)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
