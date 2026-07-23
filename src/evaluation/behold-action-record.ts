import type { EntityTurn } from '../entity/loom';
import type { ModelCallEvidence } from '../mind/evidence';
import { createResidentMindRequestArtifact } from '../mind/request-artifact';
import {
  actionRecordSha256,
  assessActionRecordBundle,
  completeActionRecord,
  createActionRecordEnvelope,
  type ActionRecordAccess,
} from './action-record';
import { assessWorldActionTurn, type TurnAssessmentInput } from './causal-turn';

export type BeholdActionRecordEvidence = Readonly<{
  assessedAt: string;
  checkerRevision: string;
  refs: Readonly<{
    runJournal: string;
    worldLifecycle: string;
    mindRequest: string;
    lifeTurn: string;
  }>;
}>;

/**
 * Project one verified Behold world action into the shared record graph. This
 * adapter authenticates Behold's real permission and execution events but does
 * not fabricate a world_fact. Material effects require a separate
 * Minecraft-native confirmation profile.
 */
export function createWorldActionRecord(
  input: TurnAssessmentInput,
  evidence: BeholdActionRecordEvidence,
) {
  const worldAction = assessWorldActionTurn(input);
  if (worldAction.status !== 'passed') {
    return deepFreeze({
      status: worldAction.status,
      failed: worldAction.failed,
      notExercised: worldAction.notExercised,
      bundle: null,
      binding: null,
    });
  }

  const context = recordContext(input);
  const { call, requestArtifact, request, turn, permissionEvent, startEvent, terminalEvent } =
    context;
  if (!call || !requestArtifact || !request || !permissionEvent || !startEvent || !terminalEvent) {
    return deepFreeze({
      status: 'failed' as const,
      failed: ['actionRecordContext'],
      notExercised: [],
      bundle: null,
      binding: null,
    });
  }

  const { expected } = input;
  const intent = permissionEvent.data.intent;
  const authorization = permissionEvent.data.authorization;
  const admittedAction = request.actions.find((action) => action.name === turn.action.name)!;
  const access: ActionRecordAccess = {
    visibility: 'private',
    audience: [`inhabitant:${expected.entityId}`, 'role:run-operator'],
    projection: 'digest-and-access-controlled-reference',
  };
  const control = {
    controllerInstanceId: `behold:${expected.managedRunId}:${expected.entityId}`,
    bodyId: expected.entityId,
    leaseEpoch: null,
  } as const;
  const shared = {
    worldId: expected.worldId,
    runId: expected.managedRunId,
    responsible: null,
    access,
  } as const;
  const runtime = { name: 'behold-controller', version: '0.1.0-alpha.0' } as const;
  const bodyObserver = { kind: 'world-observer', id: 'behold.inhabitant-observer' } as const;
  const observationSources = [
    {
      name: 'mineflayer-body',
      kind: 'server-synchronized-body-state',
      fields: ['self.pose', 'self.condition', 'self.inventory'],
    },
    {
      name: 'behold.first-person-projection',
      kind: 'bounded-sensor-projection',
      fields: ['scene'],
    },
    {
      name: 'behold.entity-life-projection',
      kind: 'controller-owned-continuity',
      fields: ['self.projects', 'self.places', 'self.placeConflicts'],
    },
    {
      name: 'behold.experience-window',
      kind: 'bounded-lived-events',
      fields: ['events', 'self.currentAction'],
    },
  ];
  const before = createActionRecordEnvelope({
    ...shared,
    stage: 'observation',
    at: isoTime(turn.observation.observedAt),
    author: bodyObserver,
    via: runtime,
    causes: [],
    localOrder: { domain: 'behold.observation.sequence', value: turn.observation.sequence },
    control,
    payload: {
      bodyId: expected.entityId,
      sources: observationSources,
      limits: observationLimits(turn.observation),
      asOf: { domain: 'behold.observation.sequence', cursor: turn.observation.sequence },
      dataRef: `${evidence.refs.mindRequest}#request.observation`,
      dataSha256: actionRecordSha256(turn.observation),
    },
  });
  const proposal = createActionRecordEnvelope({
    ...shared,
    stage: 'proposal',
    at: isoTime(intent.decidedAt ?? call.completedAt),
    author: { kind: 'controller', id: control.controllerInstanceId },
    via: {
      name: String(call.adapter?.name || 'unknown'),
      version: call.adapter?.version == null ? null : String(call.adapter.version),
    },
    causes: [before.id],
    localOrder: { domain: 'behold.run-journal.sequence', value: input.modelTurn.sequence },
    control,
    payload: {
      bodyId: expected.entityId,
      basisObservation: before.id,
      action: turn.action.name,
      argumentsSha256: actionRecordSha256(turn.action.input),
      affordanceSchemaSha256: actionRecordSha256(admittedAction.inputSchema),
      why: proposalWhy(turn),
      source: turn.action.source,
      programArtifact: call.program?.artifactSha256 ?? null,
    },
  });
  const decision = createActionRecordEnvelope({
    ...shared,
    stage: 'decision',
    at: isoTime(permissionEvent.at),
    author: { kind: 'authority', id: String(authorization.authority) },
    via: runtime,
    causes: [proposal.id],
    localOrder: { domain: 'behold.experience-event.sequence', value: permissionEvent.sequence },
    control,
    payload: {
      proposal: proposal.id,
      status: 'allowed',
      reasons: authorization.reason ? [String(authorization.reason)] : [],
      authority: {
        name: String(authorization.authority),
        evidence: beholdExperienceEventRef(permissionEvent, expected),
      },
    },
  });
  const started = createActionRecordEnvelope({
    ...shared,
    stage: 'execution',
    at: isoTime(startEvent.at),
    author: { kind: 'runtime-engine', id: 'behold.action-engine' },
    via: runtime,
    causes: [decision.id],
    localOrder: { domain: 'behold.experience-event.sequence', value: startEvent.sequence },
    control,
    payload: {
      proposal: proposal.id,
      decision: decision.id,
      status: 'started',
      nativeRefs: [beholdExperienceEventRef(startEvent, expected)],
    },
  });
  const completed = createActionRecordEnvelope({
    ...shared,
    stage: 'execution',
    at: isoTime(terminalEvent.at),
    author: { kind: 'runtime-engine', id: 'behold.action-engine' },
    via: runtime,
    causes: [started.id],
    localOrder: { domain: 'behold.experience-event.sequence', value: terminalEvent.sequence },
    control,
    payload: {
      proposal: proposal.id,
      decision: decision.id,
      status: turn.outcome.eventType === 'action_completed' ? 'completed' : 'failed',
      nativeRefs: [beholdExperienceEventRef(terminalEvent, expected)],
      resultSha256: actionRecordSha256(turn.outcome.result ?? null),
    },
  });
  const after = createActionRecordEnvelope({
    ...shared,
    stage: 'observation',
    at: isoTime(turn.nextObservation.observedAt),
    author: bodyObserver,
    via: runtime,
    causes: [],
    localOrder: {
      domain: 'behold.observation.sequence',
      value: turn.nextObservation.sequence,
    },
    control,
    payload: {
      bodyId: expected.entityId,
      sources: observationSources,
      limits: observationLimits(turn.nextObservation),
      asOf: { domain: 'behold.observation.sequence', cursor: turn.nextObservation.sequence },
      observedAfter: completed.id,
      dataRef: `${evidence.refs.lifeTurn}#nextObservation`,
      dataSha256: actionRecordSha256(turn.nextObservation),
    },
  });
  const bundle = completeActionRecord([before, proposal, decision, started, completed, after], {
    checker: {
      name: 'behold.action-record-graph-assessor',
      version: '1',
      revision: evidence.checkerRevision,
    },
    at: evidence.assessedAt,
    access,
    evidence: [
      evidenceRef('run-journal', evidence.refs.runJournal, input.runJournalSha256, access),
      evidenceRef(
        'world-lifecycle',
        evidence.refs.worldLifecycle,
        input.worldLifecycleSha256,
        access,
      ),
      evidenceRef('mind-request', evidence.refs.mindRequest, requestArtifact.requestSha256, access),
      evidenceRef(
        'entity-life-turn',
        evidence.refs.lifeTurn,
        actionRecordSha256(input.lifeTurn),
        access,
      ),
    ],
  });
  const assessment = assessActionRecordBundle(bundle);
  return deepFreeze({
    status: assessment.status,
    failed: assessment.failed,
    notExercised: [],
    bundle,
    binding: assessment.binding,
  });
}

function recordContext(input: TurnAssessmentInput) {
  const call = input.modelTurn.data?.call as ModelCallEvidence | undefined;
  let requestArtifact = null;
  try {
    if (call?.request?.mindRequest != null) {
      requestArtifact = createResidentMindRequestArtifact(call.request.mindRequest);
    }
  } catch {}
  const turn = input.entityTurn.data as EntityTurn;
  const events = turn?.nextObservation?.events ?? [];
  const event = (type: string) =>
    events.find(
      (candidate: any) =>
        candidate?.type === type && candidate?.data?.intent?.id === turn?.action?.id,
    );
  return {
    call,
    requestArtifact,
    request: requestArtifact?.request,
    turn,
    permissionEvent: event('permission_decision'),
    startEvent: event('action_started'),
    terminalEvent: event(turn?.outcome?.eventType),
  };
}

function beholdExperienceEventRef(event: any, expected: TurnAssessmentInput['expected']) {
  return {
    domain: 'behold.experience-event',
    cursor: Number(event.sequence),
    type: String(event.type),
    digest: actionRecordSha256(event),
    worldId: expected.worldId,
    runId: expected.managedRunId,
  };
}

function observationLimits(observation: any) {
  return [
    {
      code: 'embodied-perspective',
      detail: 'One Minecraft body; no global server-state claim.',
    },
    {
      code: 'bounded-event-window',
      detail: observation?.eventWindow?.complete
        ? 'Requested event window is complete.'
        : `Event window reports ${Number(observation?.eventWindow?.missingBeforeOldest ?? 0)} missing earlier events.`,
    },
    {
      code: 'absence-is-unknown',
      detail: 'A missing projected field or entity is not proof of world absence.',
    },
  ];
}

function evidenceRef(kind: string, ref: string, sha256: string, access: ActionRecordAccess) {
  return { kind, ref, sha256, access };
}

function proposalWhy(turn: EntityTurn) {
  const content = turn?.utterance?.assistant?.content;
  return typeof content === 'string' && content.trim() ? content.trim() : null;
}

function isoTime(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error('action record time is unavailable');
  return new Date(number).toISOString();
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  }
  return value;
}
