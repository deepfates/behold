import {
  actionRecordSha256,
  assessActionRecordBundle,
  completeActionRecord,
  createActionRecordEnvelope,
  type ActionRecordAccess,
} from './action-record';
import { assessNativeBodyConformance } from './native-body-conformance';

export const MINECRAFT_MATERIAL_FACT_BINDING_PROTOCOL =
  'behold.minecraft-material-fact-binding.v1' as const;

export type MinecraftMaterialActionRecordEvidence = Readonly<{
  assessedAt: string;
  checkerRevision: string;
  refs: Readonly<{
    phase: Readonly<{ file: string; sha256: string }>;
    witness: Readonly<{ file: string; sha256: string }>;
    life: Readonly<{ file: string; sha256: string }>;
    lifecycle: Readonly<{ file: string; sha256: string }>;
  }>;
}>;

/**
 * Project the existing native-body placement proof into the shared causal
 * graph. The scripted proposal remains explicitly scripted. A world_fact is
 * emitted only after the Minecraft blockUpdate verifier and a fresh second
 * body agree on the exact placed block.
 */
export function createMinecraftMaterialActionRecord(
  report: any,
  evidence: MinecraftMaterialActionRecordEvidence,
) {
  const nativeAssessment = assessNativeBodyConformance(report);
  if (!nativeAssessment.pass) {
    return failedResult(
      Object.entries(nativeAssessment.assertions)
        .filter(([, passed]) => !passed)
        .map(([name]) => `native:${name}`),
      nativeAssessment,
    );
  }

  const phase = report.phase;
  const wrapper = phase.turn;
  const turn = wrapper.turn;
  const events = Array.isArray(wrapper.events) ? wrapper.events : [];
  const actionId = turn?.action?.id;
  const matching = (type: string) =>
    events
      .map((event: any, index: number) => ({ event, index }))
      .filter(
        ({ event }: any) =>
          event?.type === type &&
          event?.data?.intent?.id === actionId &&
          Number.isFinite(event?.at),
      );
  const permissionMatches = matching('permission_decision');
  const startMatches = matching('action_started');
  const terminalMatches = matching(turn?.outcome?.eventType);
  const permission = permissionMatches[0];
  const started = startMatches[0];
  const terminal = terminalMatches[0];
  const change = wrapper?.result?.changes?.[0];
  const witness = report.independentWitness;
  const witnessBlock = witness?.blocks?.find((candidate: any) =>
    samePosition(candidate?.position, phase.target),
  );
  const actorDimension = String(turn?.observation?.self?.condition?.dimension || '');
  const actorAfterDimension = String(turn?.nextObservation?.self?.condition?.dimension || '');
  const witnessDimension = String(witness?.dimension || '');
  const quiescenceAt = Date.parse(String(report?.lifecycle?.quiescence?.at || ''));
  const permissionIntent = permission?.event?.data?.intent;
  const contextAssertions = {
    exactTurnProjection:
      actionRecordSha256(wrapper?.action) === actionRecordSha256(turn?.action) &&
      actionRecordSha256(wrapper?.result) === actionRecordSha256(turn?.outcome?.result),
    onePermission: permissionMatches.length === 1,
    oneStart: startMatches.length === 1,
    oneTerminal: terminalMatches.length === 1,
    eventOrder:
      permission != null &&
      started != null &&
      terminal != null &&
      permission.index < started.index &&
      started.index < terminal.index &&
      permission.event.at <= started.event.at &&
      started.event.at <= terminal.event.at,
    authenticAuthorization:
      permission?.event?.data?.authorization?.ok === true &&
      nonEmpty(permission?.event?.data?.authorization?.authority) &&
      actionRecordSha256(started?.event?.data?.authorization) ===
        actionRecordSha256(permission?.event?.data?.authorization) &&
      actionRecordSha256(terminal?.event?.data?.authorization) ===
        actionRecordSha256(permission?.event?.data?.authorization) &&
      actionRecordSha256(permissionIntent) === actionRecordSha256(started?.event?.data?.intent) &&
      actionRecordSha256(permissionIntent) === actionRecordSha256(terminal?.event?.data?.intent) &&
      permissionIntent?.id === turn?.action?.id &&
      permissionIntent?.source === turn?.action?.source &&
      permissionIntent?.tool === turn?.action?.name &&
      actionRecordSha256(permissionIntent?.input) === actionRecordSha256(turn?.action?.input) &&
      permissionIntent?.observationSequence === turn?.observation?.sequence &&
      permissionIntent?.decidedAt === turn?.startedAt,
    exactTerminalResult:
      actionRecordSha256(terminal?.event?.data?.result) === actionRecordSha256(wrapper?.result),
    exactBlockUpdate:
      change?.verified === true &&
      change?.observed === true &&
      change?.confirmation?.source === 'mineflayer:blockUpdate' &&
      Number.isFinite(change?.confirmation?.observedAt) &&
      samePosition(change?.confirmation?.position, change?.position) &&
      change.confirmation.dimension === actorDimension &&
      change.confirmation.before?.name === change?.before &&
      change.confirmation.after?.name === change?.after &&
      change.confirmation.before?.stateId === change.confirmation.beforeStateId &&
      change.confirmation.after?.stateId === change.confirmation.afterStateId &&
      change.confirmation.observedAt >= started?.event?.at &&
      change.confirmation.observedAt <= terminal?.event?.at,
    exactFreshWitness:
      witness?.source === 'fresh_minecraft_connection' &&
      Number.isFinite(witness?.observedAt) &&
      witness.observedAt >= terminal?.event?.at &&
      report?.lifecycle?.quiescence?.reason === 'native_body_before_independent_witness' &&
      Number.isFinite(quiescenceAt) &&
      terminal.event.at <= quiescenceAt &&
      witness.observedAt >= quiescenceAt &&
      actorDimension.length > 0 &&
      actorAfterDimension === actorDimension &&
      actorDimension === witnessDimension &&
      witnessBlock?.name === change?.after &&
      samePosition(witnessBlock?.position, change?.position) &&
      Number.isFinite(witnessBlock?.stateId) &&
      witnessBlock.stateId === change?.confirmation?.afterStateId,
  };
  const contextFailed = failedAssertions(contextAssertions);
  if (contextFailed.length > 0) {
    return failedResult(
      contextFailed.map((name) => `record:${name}`),
      nativeAssessment,
      contextAssertions,
    );
  }

  const worldId = String(report.worldId);
  const runId = String(report.managedRunId);
  const entityId = String(phase.entityId);
  const witnessId = String(witness.entityId);
  const access: ActionRecordAccess = {
    visibility: 'private',
    audience: [
      `inhabitant:${entityId}`,
      `inhabitant:${witnessId}`,
      'role:run-operator',
      'role:evaluator',
    ],
    projection: 'digest-and-access-controlled-reference',
  };
  const control = {
    controllerInstanceId: `behold:${runId}:${entityId}:script`,
    bodyId: entityId,
    leaseEpoch: null,
  } as const;
  const shared = { worldId, runId, responsible: null, access } as const;
  const runtime = { name: 'behold-controller', version: '0.1.0-alpha.0' } as const;
  const residentObserver = {
    kind: 'world-observer',
    id: 'behold.inhabitant-observer',
  } as const;
  const observationSources = [
    { name: 'mineflayer-body', kind: 'server-synchronized-body-state' },
    { name: 'behold.first-person-projection', kind: 'bounded-sensor-projection' },
    { name: 'behold.experience-window', kind: 'bounded-lived-events' },
  ];
  const before = createActionRecordEnvelope({
    ...shared,
    stage: 'observation',
    at: isoTime(turn.observation.observedAt),
    author: residentObserver,
    via: runtime,
    causes: [],
    localOrder: { domain: 'behold.observation.sequence', value: turn.observation.sequence },
    control,
    payload: {
      bodyId: entityId,
      sources: observationSources,
      limits: bodyObservationLimits(turn.observation),
      asOf: { domain: 'behold.observation.sequence', cursor: turn.observation.sequence },
      dataRef: `${evidence.refs.phase.file}#turn.turn.observation`,
      dataSha256: actionRecordSha256(turn.observation),
    },
  });
  const proposal = createActionRecordEnvelope({
    ...shared,
    stage: 'proposal',
    at: isoTime(turn.startedAt),
    author: { kind: 'scripted-controller', id: 'behold.native-body-conformance-driver' },
    via: { name: 'behold.scripted-inhabitant-turn', version: '1' },
    causes: [before.id],
    localOrder: { domain: 'behold.entity-turn.sequence', value: turn.sequence },
    control,
    payload: {
      bodyId: entityId,
      basisObservation: before.id,
      action: turn.action.name,
      argumentsSha256: actionRecordSha256(turn.action.input),
      why: 'Exercise one admitted ordinary placement through the production body and world edge.',
      source: 'script',
    },
  });
  const decision = createActionRecordEnvelope({
    ...shared,
    stage: 'decision',
    at: isoTime(permission!.event.at),
    author: {
      kind: 'authority',
      id: String(permission!.event.data.authorization.authority),
    },
    via: runtime,
    causes: [proposal.id],
    localOrder: { domain: 'behold.engine-event.index', value: permission!.index },
    control,
    payload: {
      proposal: proposal.id,
      status: 'allowed',
      reasons: [],
      authority: {
        name: String(permission!.event.data.authorization.authority),
        evidence: engineEventRef(permission!, worldId, runId),
      },
    },
  });
  const executionStarted = createActionRecordEnvelope({
    ...shared,
    stage: 'execution',
    at: isoTime(started!.event.at),
    author: { kind: 'runtime-engine', id: 'behold.action-engine' },
    via: runtime,
    causes: [decision.id],
    localOrder: { domain: 'behold.engine-event.index', value: started!.index },
    control,
    payload: {
      proposal: proposal.id,
      decision: decision.id,
      status: 'started',
      nativeRefs: [engineEventRef(started!, worldId, runId)],
    },
  });
  const executionCompleted = createActionRecordEnvelope({
    ...shared,
    stage: 'execution',
    at: isoTime(terminal!.event.at),
    author: { kind: 'runtime-engine', id: 'behold.action-engine' },
    via: runtime,
    causes: [executionStarted.id],
    localOrder: { domain: 'behold.engine-event.index', value: terminal!.index },
    control,
    payload: {
      proposal: proposal.id,
      decision: decision.id,
      status: 'completed',
      nativeRefs: [engineEventRef(terminal!, worldId, runId)],
      resultSha256: actionRecordSha256(wrapper.result),
    },
  });
  const after = createActionRecordEnvelope({
    ...shared,
    stage: 'observation',
    at: isoTime(turn.nextObservation.observedAt),
    author: residentObserver,
    via: runtime,
    causes: [],
    localOrder: {
      domain: 'behold.observation.sequence',
      value: turn.nextObservation.sequence,
    },
    control,
    payload: {
      bodyId: entityId,
      sources: observationSources,
      limits: bodyObservationLimits(turn.nextObservation),
      asOf: {
        domain: 'behold.observation.sequence',
        cursor: turn.nextObservation.sequence,
      },
      observedAfter: executionCompleted.id,
      dataRef: `${evidence.refs.phase.file}#turn.turn.nextObservation`,
      dataSha256: actionRecordSha256(turn.nextObservation),
    },
  });
  const witnessObservation = createActionRecordEnvelope({
    ...shared,
    stage: 'observation',
    at: isoTime(witness.observedAt),
    author: { kind: 'world-observer', id: `minecraft.fresh-body:${witnessId}` },
    via: { name: 'behold.fresh-minecraft-witness', version: '1' },
    causes: [],
    localOrder: { domain: 'minecraft.fresh-body.observed-at', value: witness.observedAt },
    control: null,
    payload: {
      bodyId: witnessId,
      sources: [{ name: 'mineflayer.blockAt', kind: 'fresh-server-synchronized-read' }],
      limits: [
        {
          code: 'requested-coordinate-only',
          detail: 'The witness read only the exact requested Minecraft block coordinate.',
        },
        {
          code: 'independent-connection-not-independent-server',
          detail: 'The witness used a fresh body and connection in the same authoritative epoch.',
        },
      ],
      asOf: { domain: 'minecraft.fresh-body.observed-at', cursor: witness.observedAt },
      observedAfter: executionCompleted.id,
      dataRef: evidence.refs.witness.file,
      dataSha256: evidence.refs.witness.sha256,
    },
  });
  const materialClaim = {
    protocol: 'behold.minecraft-block-transition-and-later-presence-claim.v1',
    worldId,
    runId,
    verb: change.verb,
    position: structuredClone(change.position),
    before: change.before,
    after: change.after,
    resident: entityId,
    witness: witnessId,
    dimension: actorDimension,
    blockUpdate: structuredClone(change.confirmation),
    laterBlock: structuredClone(witnessBlock),
    witnessObservedAt: witness.observedAt,
    residentQuiescenceDigest: report.lifecycle.quiescence.digest,
  };
  const factAt = Math.max(
    Number(change.confirmation.observedAt),
    Number(turn.nextObservation.observedAt),
    Number(witness.observedAt),
  );
  const worldFact = createActionRecordEnvelope({
    ...shared,
    stage: 'world_fact',
    at: isoTime(factAt),
    author: { kind: 'world-verifier', id: 'behold.minecraft-native-body-conformance' },
    via: { name: 'behold.minecraft-material-change-assessor', version: '1' },
    causes: [executionCompleted.id, after.id, witnessObservation.id],
    localOrder: { domain: 'minecraft.fresh-body.observed-at', value: witness.observedAt },
    control: null,
    payload: {
      execution: executionCompleted.id,
      claim: {
        kind: 'minecraft.block-transition-and-later-presence.v1',
        sha256: actionRecordSha256(materialClaim),
        verifier: { name: 'behold.native-body-conformance', version: '2' },
        data: materialClaim,
      },
      confirmationSources: [after.id, witnessObservation.id],
      nativeRefs: [
        {
          domain: 'minecraft.client-event',
          cursor: change.confirmation.observedAt,
          type: 'blockUpdate',
          digest: actionRecordSha256(change.confirmation),
          worldId,
          runId,
        },
        {
          domain: 'minecraft.fresh-body-observation',
          cursor: witness.observedAt,
          type: 'blockAt',
          digest: evidence.refs.witness.sha256,
          worldId,
          runId,
        },
      ],
    },
  });
  const bundle = completeActionRecord(
    [
      before,
      proposal,
      decision,
      executionStarted,
      executionCompleted,
      after,
      witnessObservation,
      worldFact,
    ],
    {
      checker: {
        name: 'behold.action-record-graph-assessor',
        version: '1',
        revision: evidence.checkerRevision,
      },
      at: evidence.assessedAt,
      access,
      evidence: [
        evidenceRef('native-body-phase', evidence.refs.phase, access),
        evidenceRef('fresh-body-witness', evidence.refs.witness, access),
        evidenceRef('entity-life', evidence.refs.life, access),
        evidenceRef('world-lifecycle', evidence.refs.lifecycle, access),
      ],
    },
  );
  const graph = assessActionRecordBundle(bundle);
  const status = graph.status;
  return deepFreeze({
    status,
    failed: graph.failed,
    nativeAssessment,
    contextAssertions,
    bundle,
    binding: graph.binding,
    materialBinding:
      status === 'passed'
        ? {
            protocol: MINECRAFT_MATERIAL_FACT_BINDING_PROTOCOL,
            worldId,
            runId,
            entityId,
            witnessId,
            action: turn.action.name,
            actionId,
            factId: worldFact.id,
            claimSha256: worldFact.payload.claim.sha256,
            position: structuredClone(change.position),
            dimension: actorDimension,
            before: change.before,
            after: change.after,
          }
        : null,
  });
}

function failedResult(
  failed: string[],
  nativeAssessment: ReturnType<typeof assessNativeBodyConformance>,
  contextAssertions: Readonly<Record<string, unknown>> | null = null,
) {
  return deepFreeze({
    status: 'failed' as const,
    failed,
    nativeAssessment,
    contextAssertions,
    bundle: null,
    binding: null,
    materialBinding: null,
  });
}

function bodyObservationLimits(observation: any) {
  return [
    { code: 'embodied-perspective', detail: 'One Minecraft body; no global server-state claim.' },
    {
      code: 'bounded-event-window',
      detail: observation?.eventWindow?.complete
        ? 'Requested event window is complete.'
        : 'The observation reports an incomplete bounded event window.',
    },
    { code: 'absence-is-unknown', detail: 'Missing projected data is not proof of world absence.' },
  ];
}

function engineEventRef(located: { event: any; index: number }, worldId: string, runId: string) {
  return {
    domain: 'behold.engine-event.index',
    cursor: located.index,
    type: String(located.event.type),
    digest: actionRecordSha256(located.event),
    worldId,
    runId,
  };
}

function evidenceRef(
  kind: string,
  evidence: Readonly<{ file: string; sha256: string }>,
  access: ActionRecordAccess,
) {
  return { kind, ref: evidence.file, sha256: evidence.sha256, access };
}

function isoTime(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0)
    throw new Error('material record time is unavailable');
  return new Date(number).toISOString();
}

function samePosition(left: any, right: any) {
  return (
    [left?.x, left?.y, left?.z, right?.x, right?.y, right?.z].every(Number.isFinite) &&
    Number(left.x) === Number(right.x) &&
    Number(left.y) === Number(right.y) &&
    Number(left.z) === Number(right.z)
  );
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function failedAssertions(assertions: Readonly<Record<string, unknown>>) {
  return Object.entries(assertions)
    .filter(([, value]) => !value)
    .map(([name]) => name);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
