import { createHash } from 'node:crypto';
import type { EntityLifeRangeReference, EntityTurn } from '../entity/loom';
import type { MindProgramIdentity, ModelCallEvidence } from '../mind/evidence';
import {
  createResidentMindRequestArtifact,
  type ResidentMindRequestArtifact,
} from '../mind/request-artifact';
import { validateResidentActionInput } from '../mind/schema';
import type {
  EvaluationEpisodeDefinition,
  EvaluationLoomReference,
  EvaluationTurnReference,
} from './episode';

type JournalEnvelope = Readonly<{
  sequence: number;
  agent: string;
  type: string;
  data: any;
}>;

type VerifiedWorldLifecycle = Readonly<{
  world: string | null;
  epoch: number | null;
  tipDigest: string | null;
  events: readonly Readonly<{ type: string; data: any }>[];
}>;

export type TurnAssessmentInput = Readonly<{
  expected: Readonly<{
    worldId: string;
    managedRunId: string;
    entityId: string;
    policyProfile: string;
    actionProfile: string;
    safetyProfile: string;
  }>;
  runStarted: JournalEnvelope;
  modelTurn: JournalEnvelope;
  entityTurn: JournalEnvelope;
  life: EntityLifeRangeReference;
  lifeTurn: Readonly<EntityTurn>;
  episode: Readonly<{
    definition: EvaluationEpisodeDefinition;
    loomReference: EvaluationLoomReference;
    definitionReference: EvaluationTurnReference;
  }>;
  lifecycle: VerifiedWorldLifecycle;
  runJournalSha256: string;
  worldLifecycleSha256: string;
}>;

export type DecisionTurnBinding = Readonly<{
  protocol: 'behold.decision-turn-binding.v1';
  suite: EvaluationEpisodeDefinition['suite'];
  world: Readonly<{
    id: string;
    epoch: number;
    managedRunId: string;
    lifecycleTipDigest: string;
  }>;
  entity: Readonly<{
    id: string;
    life: EntityLifeRangeReference;
    turnSequence: number;
  }>;
  episode: Readonly<{
    loom: EvaluationLoomReference;
    definition: EvaluationTurnReference;
  }>;
  mind: Readonly<{
    adapter: string;
    model: string;
    requestArtifactProtocol: ResidentMindRequestArtifact['protocol'];
    requestSha256: string;
    program: MindProgramIdentity | null;
  }>;
  decision: Readonly<{
    modelTurnJournalSequence: number;
    entityTurnJournalSequence: number;
    actionName: string;
    actionKind: EntityTurn['action']['kind'];
    actionInputSha256: string;
  }>;
  record: Readonly<{
    eventType: string;
    ok: boolean;
    resultSha256: string;
    nextObservationSha256: string;
  }>;
  artifacts: Readonly<{
    runJournalSha256: string;
    worldLifecycleSha256: string;
  }>;
}>;

export type WorldActionTurnBinding = Readonly<{
  protocol: 'behold.world-action-turn-binding.v2';
  suite: EvaluationEpisodeDefinition['suite'];
  world: Readonly<{
    id: string;
    epoch: number;
    managedRunId: string;
    lifecycleTipDigest: string;
  }>;
  entity: Readonly<{
    id: string;
    life: EntityLifeRangeReference;
    turnSequence: number;
  }>;
  episode: Readonly<{
    loom: EvaluationLoomReference;
    definition: EvaluationTurnReference;
  }>;
  mind: Readonly<{
    adapter: string;
    model: string;
    requestArtifactProtocol: ResidentMindRequestArtifact['protocol'];
    requestSha256: string;
    program: MindProgramIdentity | null;
  }>;
  decision: Readonly<{
    modelTurnJournalSequence: number;
    actionName: string;
    actionInputSha256: string;
  }>;
  worldAction: Readonly<{
    entityTurnJournalSequence: number;
    permissionEventSequence: number;
    authority: string;
    startedEventSequence: number;
    terminalEvent: string;
    ok: boolean;
    resultSha256: string;
    freshObservationSha256: string;
    witnessEventSequence: number;
  }>;
  artifacts: Readonly<{
    runJournalSha256: string;
    worldLifecycleSha256: string;
  }>;
}>;

export function assessDecisionTurn(input: TurnAssessmentInput) {
  const context = deriveContext(input);
  const { expected } = input;
  const { call, requestArtifact, request, intent, turn, configuredResident } = context;
  const configured = input.lifecycle.events.find((event) => event.type === 'run_configured');
  const lifecycleReady = input.lifecycle.events.some((event) => event.type === 'run_ready');
  const lifecycleStopped = input.lifecycle.events.some((event) => event.type === 'run_stopped');
  const admittedAction = request?.actions.find((action) => action.name === intent?.tool);
  const actionInputValidation = admittedAction
    ? validateResidentActionInput(intent?.input, admittedAction.inputSchema)
    : null;

  const assertions = {
    authenticatedWorldEpoch:
      input.lifecycle.world === expected.worldId &&
      Number.isSafeInteger(input.lifecycle.epoch) &&
      input.lifecycle.epoch! > 0 &&
      digest(input.lifecycle.tipDigest) &&
      configured?.data?.runId === expected.managedRunId &&
      configured?.data?.world?.id === expected.worldId &&
      lifecycleReady &&
      lifecycleStopped,
    authenticatedConfiguration:
      input.runStarted.type === 'run_started' &&
      input.runStarted.agent === expected.entityId &&
      input.runStarted.data?.runId === expected.managedRunId &&
      stableJson(input.runStarted.data?.task ?? null) ===
        stableJson(configuredResident?.task ?? null) &&
      stableJson(input.runStarted.data?.controller?.allowTools ?? null) ===
        stableJson(configuredResident?.allowTools ?? null) &&
      input.runStarted.data?.controller?.policyProfile === expected.policyProfile &&
      input.runStarted.data?.controller?.actionProfile === expected.actionProfile &&
      input.runStarted.data?.controller?.safetyProfile === expected.safetyProfile &&
      configuredResident?.policyProfile === expected.policyProfile &&
      configuredResident?.actionProfile === expected.actionProfile &&
      configuredResident?.safetyProfile === expected.safetyProfile,
    exactMindRequest:
      input.modelTurn.type === 'model_turn' &&
      input.modelTurn.agent === expected.entityId &&
      call?.protocol === 'behold.model-call.v1' &&
      requestArtifact != null &&
      call.request.mindRequestSha256 === requestArtifact.requestSha256 &&
      request?.entityId === expected.entityId &&
      request?.model === input.modelTurn.data?.model &&
      request?.policyProfile === expected.policyProfile &&
      request?.actionProfile === expected.actionProfile &&
      request?.safetyProfile === expected.safetyProfile &&
      stableJson(request?.observation) === stableJson(input.modelTurn.data?.observation),
    admittedDecision:
      intent?.source === 'llm' &&
      typeof intent?.id === 'string' &&
      admittedAction != null &&
      actionInputValidation?.ok === true,
    recordedDecision:
      input.entityTurn.type === 'entity_turn' &&
      input.entityTurn.agent === expected.entityId &&
      input.modelTurn.sequence < input.entityTurn.sequence &&
      turn?.protocol === 'behold.entity-turn.v1' &&
      turn?.entityId === expected.entityId &&
      turn?.circleId === expected.worldId &&
      turn?.action?.source === 'llm' &&
      turn?.action?.id === intent?.id &&
      turn?.action?.name === intent?.tool &&
      stableJson(turn?.action?.input) === stableJson(intent?.input) &&
      ['exclusive', 'parallel', 'yield'].includes(String(turn?.action?.kind)) &&
      typeof turn?.outcome?.eventType === 'string' &&
      typeof turn?.outcome?.ok === 'boolean',
    exactLyncTurn:
      input.life.entityId === expected.entityId &&
      input.life.circleId === expected.worldId &&
      input.life.sequences.start <= turn?.sequence &&
      input.life.sequences.end >= turn?.sequence &&
      stableJson(input.lifeTurn) === stableJson(turn),
    evaluatorEpisodeAnchored:
      stableJson(input.episode.definition.life) === stableJson(input.life) &&
      input.episode.loomReference.loomId === input.episode.definitionReference.loomId,
    artifactDigests: digest(input.runJournalSha256) && digest(input.worldLifecycleSha256),
  };
  const failed = failedAssertions(assertions);
  const binding =
    failed.length === 0 && requestArtifact && call
      ? deepFreeze({
          protocol: 'behold.decision-turn-binding.v1' as const,
          suite: structuredClone(input.episode.definition.suite),
          world: {
            id: expected.worldId,
            epoch: input.lifecycle.epoch!,
            managedRunId: expected.managedRunId,
            lifecycleTipDigest: input.lifecycle.tipDigest!,
          },
          entity: {
            id: expected.entityId,
            life: structuredClone(input.life),
            turnSequence: turn.sequence,
          },
          episode: {
            loom: structuredClone(input.episode.loomReference),
            definition: structuredClone(input.episode.definitionReference),
          },
          mind: {
            adapter: String(call.adapter?.name || 'unknown'),
            model: requestArtifact.request.model,
            requestArtifactProtocol: requestArtifact.protocol,
            requestSha256: requestArtifact.requestSha256,
            program: call.program ? structuredClone(call.program) : null,
          },
          decision: {
            modelTurnJournalSequence: input.modelTurn.sequence,
            entityTurnJournalSequence: input.entityTurn.sequence,
            actionName: turn.action.name,
            actionKind: turn.action.kind,
            actionInputSha256: sha256(stableJson(turn.action.input)),
          },
          record: {
            eventType: turn.outcome.eventType,
            ok: turn.outcome.ok,
            resultSha256: sha256(stableJson(turn.outcome.result ?? null)),
            nextObservationSha256: sha256(stableJson(turn.nextObservation)),
          },
          artifacts: {
            runJournalSha256: input.runJournalSha256,
            worldLifecycleSha256: input.worldLifecycleSha256,
          },
        })
      : null;
  return deepFreeze({
    status: failed.length === 0 ? ('passed' as const) : ('failed' as const),
    assertions,
    failed,
    binding,
  });
}

/**
 * Suite-level evidence that the recorded decision was not selected by a task,
 * action allowlist, required action, or provider tool-choice override. This is
 * intentionally separate from the reusable decision binding: tasked minds are
 * still valid inhabitants, but they are not evidence of an uncoached choice.
 */
export function assessUncoachedDecisionTurn(input: TurnAssessmentInput) {
  const decisionAssessment = assessDecisionTurn(input);
  const { call, request } = deriveContext(input);
  const configured = input.lifecycle.events.find((event) => event.type === 'run_configured');
  const configuredResident = configured?.data?.population?.residents?.find(
    (resident: any) => resident?.entityId === input.expected.entityId,
  );
  const program = call?.program;
  const axProgramIdentity =
    call?.adapter?.name !== 'ax' ||
    (program?.protocol === 'behold.mind-program-identity.v1' &&
      program.runtime?.name === 'ax' &&
      digest(program.artifactSha256) &&
      digest(program.signatureSha256));
  const assertions = {
    ...decisionAssessment.assertions,
    untasked:
      input.runStarted.data?.task == null &&
      configuredResident?.task == null &&
      (request?.observation as any)?.task == null,
    unrestrictedActionCatalog:
      input.runStarted.data?.controller?.allowTools == null &&
      configuredResident?.allowTools == null,
    noRequiredAction: request?.requiredAction == null,
    noProviderToolChoice: call?.request?.toolChoice == null,
    contentAddressedMindProgram: axProgramIdentity,
  };
  const failed = failedAssertions(assertions);
  return deepFreeze({
    status: failed.length === 0 ? ('passed' as const) : ('failed' as const),
    assertions,
    failed,
    binding: failed.length === 0 ? decisionAssessment.binding : null,
  });
}

export function assessWorldActionTurn(input: TurnAssessmentInput) {
  const { expected } = input;
  const decisionAssessment = assessDecisionTurn(input);
  const {
    call,
    requestArtifact,
    turn,
    matchingPermissionEvents,
    permissionEvent,
    matchingStartEvents,
    startEvent,
    matchingTerminalEvents,
    terminalEvent,
  } = deriveContext(input);
  const assertions = {
    ...decisionAssessment.assertions,
    worldActionProposed: turn?.action?.kind !== 'yield',
    worldPermissionDecision:
      turn?.action?.kind !== 'yield' &&
      matchingPermissionEvents.length === 1 &&
      permissionEvent?.source === 'event' &&
      permissionEvent?.isNew === true &&
      Number.isSafeInteger(permissionEvent?.sequence) &&
      Number.isFinite(Number(permissionEvent?.at)) &&
      permissionEvent?.data?.authorization?.ok === true &&
      typeof permissionEvent?.data?.authorization?.authority === 'string',
    worldActionStarted:
      turn?.action?.kind !== 'yield' &&
      matchingPermissionEvents.length === 1 &&
      matchingStartEvents.length === 1 &&
      startEvent?.source === 'event' &&
      startEvent?.isNew === true &&
      Number.isSafeInteger(startEvent?.sequence) &&
      Number.isFinite(Number(startEvent?.at)) &&
      Number(permissionEvent?.sequence) < Number(startEvent?.sequence) &&
      Number(permissionEvent?.at) <= Number(startEvent?.at) &&
      stableJson(startEvent?.data?.authorization) ===
        stableJson(permissionEvent?.data?.authorization),
    terminalWorldResult:
      decisionAssessment.assertions.recordedDecision &&
      turn?.action?.kind !== 'yield' &&
      matchingStartEvents.length === 1 &&
      ['action_completed', 'action_failed'].includes(String(turn?.outcome?.eventType)) &&
      matchingTerminalEvents.length === 1 &&
      Number.isSafeInteger(terminalEvent?.sequence) &&
      Number.isFinite(Number(terminalEvent?.at)) &&
      Number(startEvent?.sequence) < Number(terminalEvent?.sequence) &&
      Number(startEvent?.at) <= Number(terminalEvent?.at) &&
      stableJson(terminalEvent?.data?.authorization) ===
        stableJson(permissionEvent?.data?.authorization),
    freshTerminalReobservation:
      turn?.action?.kind !== 'yield' &&
      matchingStartEvents.length === 1 &&
      turn?.nextObservation?.protocol === 'behold.inhabitant.v2' &&
      Number(turn?.nextObservation?.sequence) > Number(turn?.observation?.sequence) &&
      turn?.nextObservation?.eventWindow?.complete === true &&
      matchingTerminalEvents.length === 1 &&
      terminalEvent?.source === 'event' &&
      terminalEvent?.isNew === true &&
      stableJson(terminalEvent?.data?.result ?? null) ===
        stableJson(turn?.outcome?.result ?? null) &&
      turn?.nextObservation?.self?.currentAction?.id === turn?.action?.id &&
      terminalStatus(turn?.nextObservation?.self?.currentAction?.status) ===
        turn?.outcome?.eventType,
  };
  const decisionPassed = decisionAssessment.failed.length === 0;
  const worldActionExercised =
    decisionPassed && assertions.worldActionProposed && matchingStartEvents.length > 0;
  const status = !decisionPassed
    ? 'failed'
    : !worldActionExercised
      ? 'not_exercised'
      : assertions.worldPermissionDecision &&
          assertions.worldActionStarted &&
          assertions.terminalWorldResult &&
          assertions.freshTerminalReobservation
        ? 'passed'
        : 'failed';
  const failed =
    status === 'not_exercised'
      ? []
      : failedAssertions(assertions).filter((name) => name !== 'worldActionProposed');
  const notExercised =
    status === 'not_exercised'
      ? [
          ...(assertions.worldActionProposed ? [] : ['worldActionProposed']),
          ...(assertions.worldPermissionDecision ? [] : ['worldPermissionDecision']),
          ...(assertions.worldActionStarted ? [] : ['worldActionStarted']),
          'terminalWorldResult',
          'freshTerminalReobservation',
        ]
      : [];
  const binding =
    status === 'passed' && requestArtifact && call && permissionEvent && startEvent && terminalEvent
      ? deepFreeze({
          protocol: 'behold.world-action-turn-binding.v2' as const,
          suite: structuredClone(input.episode.definition.suite),
          world: {
            id: expected.worldId,
            epoch: input.lifecycle.epoch!,
            managedRunId: expected.managedRunId,
            lifecycleTipDigest: input.lifecycle.tipDigest!,
          },
          entity: {
            id: expected.entityId,
            life: structuredClone(input.life),
            turnSequence: turn.sequence,
          },
          episode: {
            loom: structuredClone(input.episode.loomReference),
            definition: structuredClone(input.episode.definitionReference),
          },
          mind: {
            adapter: String(call.adapter?.name || 'unknown'),
            model: requestArtifact.request.model,
            requestArtifactProtocol: requestArtifact.protocol,
            requestSha256: requestArtifact.requestSha256,
            program: call.program ? structuredClone(call.program) : null,
          },
          decision: {
            modelTurnJournalSequence: input.modelTurn.sequence,
            actionName: turn.action.name,
            actionInputSha256: sha256(stableJson(turn.action.input)),
          },
          worldAction: {
            entityTurnJournalSequence: input.entityTurn.sequence,
            permissionEventSequence: Number(permissionEvent.sequence),
            authority: String(permissionEvent.data.authorization.authority),
            startedEventSequence: Number(startEvent.sequence),
            terminalEvent: turn.outcome.eventType,
            ok: turn.outcome.ok,
            resultSha256: sha256(stableJson(turn.outcome.result ?? null)),
            freshObservationSha256: sha256(stableJson(turn.nextObservation)),
            witnessEventSequence: Number(terminalEvent.sequence),
          },
          artifacts: {
            runJournalSha256: input.runJournalSha256,
            worldLifecycleSha256: input.worldLifecycleSha256,
          },
        })
      : null;
  return deepFreeze({
    status,
    assertions,
    failed,
    notExercised,
    binding,
    decisionBinding: decisionAssessment.binding,
  });
}

function deriveContext(input: TurnAssessmentInput) {
  const call = input.modelTurn.data?.call as ModelCallEvidence | undefined;
  let requestArtifact: ResidentMindRequestArtifact | null = null;
  try {
    if (call?.request?.mindRequest != null) {
      requestArtifact = createResidentMindRequestArtifact(call.request.mindRequest);
    }
  } catch {}
  const request = requestArtifact?.request;
  const intent = recordedDecisionProposal(input.modelTurn);
  const turn = input.entityTurn.data as EntityTurn;
  const matchingTerminalEvents = (turn?.nextObservation?.events ?? []).filter(
    (event: any) =>
      event?.type === turn?.outcome?.eventType && event?.data?.intent?.id === turn?.action?.id,
  );
  const matchingStartEvents = (turn?.nextObservation?.events ?? []).filter(
    (event: any) =>
      event?.type === 'action_started' && event?.data?.intent?.id === turn?.action?.id,
  );
  const matchingPermissionEvents = (turn?.nextObservation?.events ?? []).filter(
    (event: any) =>
      event?.type === 'permission_decision' && event?.data?.intent?.id === turn?.action?.id,
  );
  const permissionEvent = matchingPermissionEvents[0] ?? null;
  const startEvent = matchingStartEvents[0] ?? null;
  const terminalEvent = matchingTerminalEvents[0] ?? null;
  const configured = input.lifecycle.events.find((event) => event.type === 'run_configured');
  const configuredResident = configured?.data?.population?.residents?.find(
    (resident: any) => resident?.entityId === input.expected.entityId,
  );
  return {
    call,
    requestArtifact,
    request,
    intent,
    turn,
    matchingPermissionEvents,
    permissionEvent,
    matchingStartEvents,
    startEvent,
    matchingTerminalEvents,
    terminalEvent,
    configuredResident,
  };
}

function recordedDecisionProposal(modelTurn: JournalEnvelope) {
  const intent = modelTurn.data?.intent;
  if (intent?.source === 'llm' && typeof intent?.id === 'string') return intent;
  const toolCall = modelTurn.data?.assistant?.tool_calls?.[0];
  const name = toolCall?.function?.name;
  const id = toolCall?.id;
  if (typeof name !== 'string' || !name || typeof id !== 'string' || !id) return null;
  let input: unknown = toolCall.function?.arguments;
  if (typeof input === 'string') {
    try {
      input = JSON.parse(input);
    } catch {
      return null;
    }
  }
  if (input == null) input = {};
  return { id, source: 'llm', tool: name, input };
}

function failedAssertions(assertions: Readonly<Record<string, unknown>>) {
  return Object.entries(assertions)
    .filter(([, value]) => !value)
    .map(([name]) => name);
}

function terminalStatus(value: unknown) {
  if (value === 'completed') return 'action_completed';
  if (value === 'failed') return 'action_failed';
  if (value === 'cancelled' || value === 'blocked') return 'intent_blocked';
  return null;
}

function digest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
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
