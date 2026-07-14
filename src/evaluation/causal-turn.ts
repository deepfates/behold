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

export type CausalTurnBinding = Readonly<{
  protocol: 'behold.causal-turn-binding.v1';
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
  consequence: Readonly<{
    entityTurnJournalSequence: number;
    terminalEvent: string;
    ok: boolean;
    resultSha256: string;
    nextObservationSha256: string;
    witnessEventSequence: number;
  }>;
  artifacts: Readonly<{
    runJournalSha256: string;
    worldLifecycleSha256: string;
  }>;
}>;

export function assessCausalTurn(
  input: Readonly<{
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
  }>,
) {
  const { expected } = input;
  const call = input.modelTurn.data?.call as ModelCallEvidence | undefined;
  let requestArtifact: ResidentMindRequestArtifact | null = null;
  try {
    if (call?.request?.mindRequest != null) {
      requestArtifact = createResidentMindRequestArtifact(call.request.mindRequest);
    }
  } catch {}
  const request = requestArtifact?.request;
  const intent = input.modelTurn.data?.intent;
  const turn = input.entityTurn.data as EntityTurn;
  const matchingTerminalEvents = (turn?.nextObservation?.events ?? []).filter(
    (event: any) =>
      event?.type === turn?.outcome?.eventType && event?.data?.intent?.id === turn?.action?.id,
  );
  const terminalEvent = matchingTerminalEvents[0] ?? null;
  const configured = input.lifecycle.events.find((event) => event.type === 'run_configured');
  const configuredResident = configured?.data?.population?.residents?.find(
    (resident: any) => resident?.entityId === expected.entityId,
  );
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
    neutralUncoachedConfiguration:
      input.runStarted.type === 'run_started' &&
      input.runStarted.agent === expected.entityId &&
      input.runStarted.data?.runId === expected.managedRunId &&
      input.runStarted.data?.task == null &&
      input.runStarted.data?.controller?.allowTools == null &&
      input.runStarted.data?.controller?.policyProfile === expected.policyProfile &&
      input.runStarted.data?.controller?.actionProfile === expected.actionProfile &&
      input.runStarted.data?.controller?.safetyProfile === expected.safetyProfile &&
      configuredResident?.task == null &&
      configuredResident?.allowTools == null &&
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
    admittedProposal:
      intent?.source === 'llm' &&
      typeof intent?.id === 'string' &&
      admittedAction != null &&
      actionInputValidation?.ok === true &&
      intent.tool !== 'wait_for_event',
    terminalWorldResult:
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
      ['action_completed', 'action_failed', 'intent_blocked'].includes(
        String(turn?.outcome?.eventType),
      ) &&
      typeof turn?.outcome?.ok === 'boolean',
    independentlyObservedConsequence:
      turn?.nextObservation?.protocol === 'behold.inhabitant.v2' &&
      Number(turn?.nextObservation?.sequence) >= Number(turn?.observation?.sequence) &&
      matchingTerminalEvents.length === 1 &&
      stableJson(terminalEvent?.data?.result ?? null) ===
        stableJson(turn?.outcome?.result ?? null) &&
      turn?.nextObservation?.self?.currentAction?.id === turn?.action?.id &&
      terminalStatus(turn?.nextObservation?.self?.currentAction?.status) ===
        turn?.outcome?.eventType,
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
  const failed = Object.entries(assertions)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  const binding =
    failed.length === 0 && requestArtifact && call && terminalEvent
      ? deepFreeze({
          protocol: 'behold.causal-turn-binding.v1' as const,
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
          consequence: {
            entityTurnJournalSequence: input.entityTurn.sequence,
            terminalEvent: turn.outcome.eventType,
            ok: turn.outcome.ok,
            resultSha256: sha256(stableJson(turn.outcome.result ?? null)),
            nextObservationSha256: sha256(stableJson(turn.nextObservation)),
            witnessEventSequence: Number(terminalEvent.sequence),
          },
          artifacts: {
            runJournalSha256: input.runJournalSha256,
            worldLifecycleSha256: input.worldLifecycleSha256,
          },
        })
      : null;
  return deepFreeze({ assertions, failed, binding });
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
