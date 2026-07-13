import fs from 'node:fs';
import path from 'node:path';
import {
  parseRunJournal,
  summarizeUsage,
  type RunJournalEvent,
} from './owned-world-model-evidence';
import { readJson, sha256File } from './owned-world-fixture';

export const OWNED_WORLD_PORTFOLIO_PROTOCOL = 'behold.owned-world-evaluation-portfolio.v1' as const;

const REASSESSMENT_PROTOCOLS = new Set([
  'behold.owned-world-model-reassessment.v1',
  'behold.owned-world-project-reassessment.v1',
]);

type RequestComponents = {
  systemMessageChars: number;
  latestUserMessageChars: number;
  priorUserMessageChars: number;
  assistantHistoryChars: number;
  toolResultHistoryChars: number;
  otherMessageChars: number;
  toolDefinitionChars: number;
  otherRequestValueChars: number;
  structuralChars: number;
};

export type RequestAttribution = {
  bodyChars: number;
  messageCount: number;
  toolDefinitionCount: number;
  latestUserLooksLikeWorldExperience: boolean;
  components: RequestComponents;
};

type LoadedCall = {
  phase: 'act' | 'resume';
  journalSequence: number;
  purpose: string;
  call: any;
};

export function attributeRequestBody(body: any): RequestAttribution {
  if (!isRecord(body)) throw new Error('model request body must be an object');
  if (!Array.isArray(body.messages)) throw new Error('model request body must contain messages');

  const bodyChars = jsonChars(body, 'model request body');
  const entries = Object.entries(body);
  const topLevelValueChars = entries.reduce(
    (sum, [, value]) => sum + jsonChars(value, 'model request value'),
    0,
  );
  const topLevelSyntaxChars = bodyChars - topLevelValueChars;
  if (topLevelSyntaxChars < 0) throw new Error('model request attribution underflow');

  const messages = body.messages;
  const messageValueChars = jsonChars(messages, 'model request messages');
  const messageObjectChars = messages.map((message: any) =>
    jsonChars(message, 'model request message'),
  );
  const messageSyntaxChars = messageValueChars - sum(messageObjectChars);
  if (messageSyntaxChars < 0) throw new Error('model message attribution underflow');

  let latestUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      latestUserIndex = index;
      break;
    }
  }

  const components: RequestComponents = {
    systemMessageChars: 0,
    latestUserMessageChars: 0,
    priorUserMessageChars: 0,
    assistantHistoryChars: 0,
    toolResultHistoryChars: 0,
    otherMessageChars: 0,
    toolDefinitionChars: Object.hasOwn(body, 'tools')
      ? jsonChars(body.tools, 'model tool definitions')
      : 0,
    otherRequestValueChars: entries
      .filter(([key]) => key !== 'messages' && key !== 'tools')
      .reduce((total, [, value]) => total + jsonChars(value, 'other model request value'), 0),
    structuralChars: topLevelSyntaxChars + messageSyntaxChars,
  };

  messages.forEach((message: any, index: number) => {
    const chars = messageObjectChars[index];
    if (message?.role === 'system') components.systemMessageChars += chars;
    else if (message?.role === 'user' && index === latestUserIndex) {
      components.latestUserMessageChars += chars;
    } else if (message?.role === 'user') components.priorUserMessageChars += chars;
    else if (message?.role === 'assistant') components.assistantHistoryChars += chars;
    else if (message?.role === 'tool') components.toolResultHistoryChars += chars;
    else components.otherMessageChars += chars;
  });

  const attributedChars = sum(Object.values(components));
  if (attributedChars !== bodyChars) {
    throw new Error(
      `model request attribution mismatch: ${attributedChars} component chars != ${bodyChars} body chars`,
    );
  }

  const latestUserContent =
    latestUserIndex >= 0 && typeof messages[latestUserIndex]?.content === 'string'
      ? messages[latestUserIndex].content
      : '';
  return {
    bodyChars,
    messageCount: messages.length,
    toolDefinitionCount: Array.isArray(body.tools) ? body.tools.length : 0,
    latestUserLooksLikeWorldExperience:
      /^(?:New|Current) world experience:\n|^World after .+:\n/.test(latestUserContent),
    components,
  };
}

export function buildOwnedWorldEvaluationPortfolio(
  reassessmentFiles: readonly string[],
  options: { now?: () => Date; repositoryRevision?: string } = {},
) {
  if (reassessmentFiles.length === 0) {
    throw new Error('at least one canonical reassessment report is required');
  }

  const scenarios = reassessmentFiles.map((file) => loadScenario(file));
  const scenarioIds = scenarios.map((scenario) => scenario.runId);
  if (new Set(scenarioIds).size !== scenarioIds.length) {
    throw new Error('portfolio contains duplicate scenario run identity');
  }

  const models = [...new Set(scenarios.map((scenario) => scenario.model))].sort();
  const worlds = [...new Set(scenarios.map((scenario) => scenario.worldId))].sort();
  const cellCounts = new Map<string, number>();
  for (const scenario of scenarios) {
    const key = `${scenario.sourceProtocol}\u0000${scenario.model}`;
    cellCounts.set(key, (cellCounts.get(key) ?? 0) + 1);
  }
  const unreplicatedCells = [...cellCounts.entries()]
    .filter(([, count]) => count < 2)
    .map(([key, count]) => {
      const [sourceProtocol, model] = key.split('\u0000');
      return { sourceProtocol, model, runs: count };
    });

  const nonclaims: any[] = [];
  if (models.length < 2) {
    nonclaims.push({ code: 'model_interchange_not_proven', observedModels: models });
  }
  if (worlds.length < 2) {
    nonclaims.push({ code: 'cross_world_generality_not_proven', observedWorlds: worlds });
  }
  if (unreplicatedCells.length > 0) {
    nonclaims.push({
      code: 'statistical_reliability_not_proven',
      unreplicatedScenarioModelCells: unreplicatedCells,
    });
  }
  if (scenarios.some((scenario) => scenario.localEvidenceOnly)) {
    nonclaims.push({
      code: 'portable_evidence_bundle_not_proven',
      reason: 'one or more evidence chains resolve only through local .behold-runtime paths',
    });
  }

  const allCalls = scenarios.flatMap((scenario) => scenario.callsForSummary);
  return {
    protocol: OWNED_WORLD_PORTFOLIO_PROTOCOL,
    status: 'passed',
    generatedAt: (options.now?.() ?? new Date()).toISOString(),
    repositoryRevision: options.repositoryRevision ?? null,
    summary: {
      scenarioCount: scenarios.length,
      passedScenarios: scenarios.length,
      models,
      worlds,
      entities: [...new Set(scenarios.map((scenario) => scenario.entityId))].sort(),
      usage: summarizeUsage(allCalls),
      requestAttribution: aggregateAttribution(
        scenarios.flatMap((scenario) => scenario.callAttribution),
      ),
      actionCount: scenarios.reduce((total, scenario) => total + scenario.actionCount, 0),
      modelFailureCount: scenarios.reduce(
        (total, scenario) => total + scenario.modelFailureCount,
        0,
      ),
    },
    scenarios: scenarios.map(({ callsForSummary: _calls, ...scenario }) => scenario),
    nonclaims,
  };
}

function loadScenario(reassessmentFile: string) {
  const reportFile = path.resolve(reassessmentFile);
  const reassessment = readJson(reportFile);
  const protocol = String(reassessment?.protocol || '');
  if (!REASSESSMENT_PROTOCOLS.has(protocol)) {
    throw new Error(`unsupported reassessment protocol in ${reportFile}: ${protocol || 'missing'}`);
  }
  if (reassessment?.status !== 'passed') {
    throw new Error(`reassessment is not passed: ${reportFile}`);
  }
  if (!Array.isArray(reassessment?.assessment?.failed) || reassessment.assessment.failed.length) {
    throw new Error(`reassessment carries failed assertions: ${reportFile}`);
  }
  if (!Array.isArray(reassessment?.failedIntegrity) || reassessment.failedIntegrity.length) {
    throw new Error(`reassessment carries failed integrity checks: ${reportFile}`);
  }
  const integrity = reassessment?.integrity;
  for (const required of ['actJournal', 'resumeJournal', 'loom']) {
    if (integrity?.[required] !== true) {
      throw new Error(`reassessment does not prove ${required}: ${reportFile}`);
    }
  }

  const sourceFile = path.resolve(String(reassessment?.source?.file || ''));
  requireFile(sourceFile, 'source report');
  assertSha256(sourceFile, reassessment?.source?.sha256, 'source report');
  const source = readJson(sourceFile);
  if (
    source?.protocol !== reassessment?.source?.protocol ||
    source?.status !== reassessment?.source?.status
  ) {
    throw new Error(`source report identity differs from reassessment: ${reportFile}`);
  }

  const runId = nonempty(source?.runId, 'source runId');
  const worldId = nonempty(source?.worldId, 'source worldId');
  const entityId = nonempty(source?.entityId, 'source entityId');
  const model = nonempty(source?.model, 'source model');
  const loomFile = path.resolve(String(source?.evidence?.loomFile || ''));
  requireFile(loomFile, 'entity Lync');
  assertSha256(loomFile, source?.evidence?.loomSha256, 'entity Lync');

  const loadedCalls: LoadedCall[] = [];
  const actions: any[] = [];
  const modelFailures: any[] = [];
  const phases: any[] = [];
  for (const phase of ['act', 'resume'] as const) {
    const evidence = source?.evidence?.[phase];
    const journalFile = path.resolve(String(evidence?.journalFile || ''));
    requireFile(journalFile, `${phase} journal`);
    assertSha256(journalFile, evidence?.journalSha256, `${phase} journal`);
    const events = parseRunJournal(fs.readFileSync(journalFile, 'utf8'));
    phases.push({
      phase,
      managedRunId: nonempty(evidence?.managedRunId, `${phase} managedRunId`),
      journalFile,
      journalSha256: sha256File(journalFile),
      eventCount: events.length,
    });
    collectJournalEvidence(events, phase, model, loadedCalls, actions, modelFailures);
  }

  const calls = loadedCalls.map((entry) => entry.call);
  const measuredUsage = summarizeUsage(calls);
  assertUsageAgreement(measuredUsage, reassessment?.assessment?.usage, reportFile);

  const callAttribution = loadedCalls.map((entry, index) => ({
    index: index + 1,
    phase: entry.phase,
    journalSequence: entry.journalSequence,
    purpose: entry.purpose,
    requestId: String(entry.call.requestId || ''),
    model: entry.call.request.model,
    latencyMs: Number(entry.call.latencyMs),
    usage: entry.call.response.usage,
    request: attributeRequestBody(entry.call.request.body),
  }));
  const actionNames = actions.map((turn) => String(turn?.action?.name || '')).filter(Boolean);
  const assertionEntries = Object.entries(reassessment?.assessment?.assertions || {});
  if (assertionEntries.length === 0 || assertionEntries.some(([, value]) => value !== true)) {
    throw new Error(
      `canonical reassessment does not contain an all-true assertion set: ${reportFile}`,
    );
  }

  return {
    runId,
    sourceProtocol: String(source.protocol),
    sourceStatus: String(source.status),
    worldId,
    entityId,
    model,
    repository: source.repository ?? null,
    verifierRevision: nonempty(reassessment?.verifierRevision, 'verifier revision'),
    reassessment: {
      file: reportFile,
      sha256: sha256File(reportFile),
      protocol,
    },
    source: {
      file: sourceFile,
      sha256: sha256File(sourceFile),
      protocol: String(source.protocol),
      status: String(source.status),
    },
    integrity: {
      reassessment: { ...integrity },
      phases,
      loomFile,
      loomSha256: sha256File(loomFile),
    },
    assertions: Object.fromEntries(assertionEntries),
    usage: measuredUsage,
    actionCount: actions.length,
    actionNames,
    uniqueActionNames: [...new Set(actionNames)].sort(),
    modelFailureCount: modelFailures.length,
    modelFailures,
    callAttribution,
    requestAttribution: aggregateAttribution(callAttribution),
    localEvidenceOnly: [
      reportFile,
      sourceFile,
      loomFile,
      ...phases.map((entry) => entry.journalFile),
    ].some((file) => file.split(path.sep).includes('.behold-runtime')),
    callsForSummary: calls,
  };
}

function collectJournalEvidence(
  events: readonly RunJournalEvent[],
  phase: 'act' | 'resume',
  expectedModel: string,
  calls: LoadedCall[],
  actions: any[],
  failures: any[],
) {
  for (const event of events) {
    if (event.type === 'entity_turn') actions.push(event.data);
    if (event.type === 'model_call_failed' || event.type === 'model_auxiliary_call_failed') {
      failures.push({ phase, journalSequence: event.sequence, type: event.type, data: event.data });
    }
    if (event.type !== 'model_turn' && event.type !== 'model_auxiliary_call') continue;
    const call = event.data?.call;
    validateCall(call, expectedModel, phase, event.sequence);
    calls.push({
      phase,
      journalSequence: event.sequence,
      purpose:
        event.type === 'model_turn'
          ? 'resident_decision'
          : `auxiliary:${String(event.data?.purpose || 'unspecified')}`,
      call,
    });
  }
}

function validateCall(call: any, expectedModel: string, phase: string, sequence: number) {
  const location = `${phase} journal sequence ${sequence}`;
  if (call?.protocol !== 'behold.model-call.v1') {
    throw new Error(`invalid model call protocol at ${location}`);
  }
  if (call?.request?.model !== expectedModel) {
    throw new Error(`model call changed model at ${location}`);
  }
  if (!isRecord(call?.request?.body)) {
    throw new Error(`model call omitted reproducible request body at ${location}`);
  }
  if (typeof call?.response?.id !== 'string' || !call.response.id) {
    throw new Error(`model call omitted response identity at ${location}`);
  }
  const usage = call?.response?.usage;
  for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens']) {
    if (!Number.isFinite(Number(usage?.[key])) || Number(usage[key]) < 0) {
      throw new Error(`model call has invalid ${key} at ${location}`);
    }
  }
  if (!Number.isFinite(Number(call?.latencyMs)) || Number(call.latencyMs) < 0) {
    throw new Error(`model call has invalid latency at ${location}`);
  }
  attributeRequestBody(call.request.body);
}

function assertUsageAgreement(measured: any, canonical: any, reportFile: string) {
  if (!isRecord(canonical)) throw new Error(`canonical usage is missing: ${reportFile}`);
  for (const [key, value] of Object.entries(canonical)) {
    if (!Object.hasOwn(measured, key)) continue;
    if (measured[key] !== value) {
      throw new Error(
        `journal usage disagrees with canonical reassessment for ${key}: ${measured[key]} != ${value}`,
      );
    }
  }
}

function aggregateAttribution(entries: readonly any[]) {
  const aggregate: RequestAttribution & { callCount: number } = {
    callCount: entries.length,
    bodyChars: 0,
    messageCount: 0,
    toolDefinitionCount: 0,
    latestUserLooksLikeWorldExperience: true,
    components: {
      systemMessageChars: 0,
      latestUserMessageChars: 0,
      priorUserMessageChars: 0,
      assistantHistoryChars: 0,
      toolResultHistoryChars: 0,
      otherMessageChars: 0,
      toolDefinitionChars: 0,
      otherRequestValueChars: 0,
      structuralChars: 0,
    },
  };
  for (const entry of entries) {
    const attribution: RequestAttribution = entry.request ?? entry;
    aggregate.bodyChars += attribution.bodyChars;
    aggregate.messageCount += attribution.messageCount;
    aggregate.toolDefinitionCount += attribution.toolDefinitionCount;
    aggregate.latestUserLooksLikeWorldExperience &&= attribution.latestUserLooksLikeWorldExperience;
    for (const key of Object.keys(aggregate.components) as (keyof RequestComponents)[]) {
      aggregate.components[key] += attribution.components[key];
    }
  }
  if (sum(Object.values(aggregate.components)) !== aggregate.bodyChars) {
    throw new Error('aggregate request attribution does not sum to aggregate body characters');
  }
  return aggregate;
}

function assertSha256(file: string, expected: unknown, label: string) {
  const digest = sha256File(file);
  if (typeof expected !== 'string' || digest !== expected) {
    throw new Error(`${label} sha256 mismatch: ${file}`);
  }
}

function requireFile(file: string, label: string) {
  if (!file || !fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`${label} is unavailable: ${file || '(missing path)'}`);
  }
}

function nonempty(value: unknown, label: string) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label} is missing`);
  return text;
}

function jsonChars(value: unknown, label: string) {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error(`${label} is not JSON-serializable`);
  }
  if (serialized == null) throw new Error(`${label} is not JSON-serializable`);
  return serialized.length;
}

function sum(values: readonly number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function isRecord(value: unknown): value is Record<string, any> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
