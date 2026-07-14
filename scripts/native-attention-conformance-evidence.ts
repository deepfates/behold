export const NATIVE_ATTENTION_CONFORMANCE_PROTOCOL =
  'behold.native-attention-conformance.v1' as const;
export const NATIVE_ATTENTION_PHASE_PROTOCOL = 'behold.native-attention-phase.v1' as const;

export function assessNativeAttentionConformance(report: any) {
  const phase = report?.phase;
  const events = Array.isArray(phase?.engineEvents) ? phase.engineEvents : [];
  const turns = Array.isArray(phase?.turns) ? phase.turns : [];
  const request = phase?.mindRequest;
  const turn = turns[0];
  const intentId = turn?.action?.id;
  const started = eventFor(events, 'action_started', intentId);
  const cancellation = eventFor(events, 'cancellation_requested', intentId);
  const terminal = eventFor(events, 'action_failed', intentId);
  const bodily = phase?.bodilyUrgency;
  const bodilyEvent = bodily?.event;
  const nextBodilyEvent = turn?.nextObservation?.events?.find(
    (event: any) => Number(event?.sequence) === Number(bodilyEvent?.sequence),
  );
  const start = request?.observation?.self?.pose?.position;
  const atUrgency = bodily?.bodyPosition;
  const final = terminal?.data?.result?.final;
  const requested = terminal?.data?.result?.requestedDestination;
  const displacementBeforeUrgency = positionDistance(start, atUrgency);
  const remainingAfterTerminal = positionDistance(final, requested);
  const witnessBlocks = Array.isArray(report?.independentWitness?.blocks)
    ? report.independentWitness.blocks
    : [];

  const assertions = {
    protocol:
      report?.protocol === NATIVE_ATTENTION_CONFORMANCE_PROTOCOL &&
      phase?.protocol === NATIVE_ATTENTION_PHASE_PROTOCOL,
    sourceIdentity:
      typeof report?.repositoryRevision === 'string' &&
      report.repositoryRevision.length === 40 &&
      phase?.repositoryRevision === report.repositoryRevision,
    managedIdentity:
      typeof report?.worldId === 'string' &&
      report.worldId === phase?.worldId &&
      report?.managedRunId === phase?.managedRunId &&
      request?.observation?.circle?.id === report.worldId &&
      request?.observation?.circle?.managedRunId === report.managedRunId,
    declaredUnderwaterSetup:
      phase?.fixtureSetup?.kind === 'underwater_corridor_before_recorded_action' &&
      samePosition(phase?.fixtureSetup?.startBody, start) &&
      samePosition(phase?.fixtureSetup?.destination, phase?.destination) &&
      phase?.fixtureSetup?.startFeetBlock === 'water' &&
      phase?.fixtureSetup?.startHeadBlock === 'water' &&
      phase?.fixtureSetup?.destinationFeetBlock === 'water' &&
      phase?.fixtureSetup?.destinationHeadBlock === 'water',
    modelOwnedAction:
      request?.protocol === 'behold.mind-request.v1' &&
      request?.attention?.mode === 'deliberative' &&
      turn?.model === 'script/native-attention-conformance-v1' &&
      turn?.action?.source === 'llm' &&
      turn?.action?.name === 'move_to' &&
      samePosition(turn?.action?.input, phase?.destination) &&
      started?.data?.intent?.source === 'llm' &&
      started?.data?.intent?.tool === 'move_to',
    realBodilyUrgency:
      bodilyEvent?.type === 'condition_changed' &&
      bodilyEvent?.source === 'body' &&
      bodilyEvent?.salience === 'urgent' &&
      Number(bodilyEvent?.data?.previous?.oxygen) > 5 &&
      Number(bodilyEvent?.data?.current?.oxygen) <= 5 &&
      nextBodilyEvent?.source === 'body' &&
      Number(nextBodilyEvent?.sequence) === Number(bodilyEvent?.sequence) &&
      cancellation?.data?.requestedBy?.source === 'system' &&
      cancellation?.data?.requestedBy?.input?.eventType === 'condition_changed' &&
      cancellation?.data?.requestedBy?.input?.eventSource === 'body' &&
      Number(cancellation?.data?.requestedBy?.input?.eventSequence) ===
        Number(bodilyEvent?.sequence),
    actionWasUnderway:
      Number.isFinite(displacementBeforeUrgency) &&
      displacementBeforeUrgency >= 0.25 &&
      finiteAt(started) &&
      finiteAt(cancellation) &&
      finiteAt(terminal) &&
      started.at <= bodilyEvent.at &&
      bodilyEvent.at <= cancellation.at &&
      cancellation.at <= terminal.at,
    acknowledgedCancellation:
      cancellation?.data?.reason === 'bodily_urgent_attention' &&
      terminal?.data?.failureKind === 'adapter_acknowledged_cancellation' &&
      terminal?.data?.cancellation?.requested === true &&
      terminal?.data?.cancellation?.reason === 'bodily_urgent_attention' &&
      terminal?.data?.cancellation?.acknowledged === true &&
      terminal?.data?.cancellation?.adapter === 'mineflayer-pathfinder' &&
      terminal?.data?.result?.cancellation?.acknowledged === true &&
      turn?.outcome?.eventType === 'action_failed' &&
      turn?.outcome?.cancellation?.reason === 'bodily_urgent_attention' &&
      turn?.outcome?.cancellation?.acknowledged === true,
    stoppedShortAndSettled:
      Number.isFinite(remainingAfterTerminal) &&
      remainingAfterTerminal > 1.25 &&
      positionDistance(final, phase?.settledBodyPosition) <= 0.15 &&
      phase?.policyState?.pendingIntentId == null &&
      phase?.engineState?.inFlightIntent == null &&
      phase?.engineState?.queuedLease == null,
    oneDurableTurn:
      phase?.priorTurns === 0 &&
      phase?.resultingTurns === 1 &&
      turns.length === 1 &&
      typeof report?.loomSha256 === 'string' &&
      /^[a-f0-9]{64}$/.test(report.loomSha256),
    independentCorridorWitness:
      report?.independentWitness?.source === 'fresh_minecraft_connection' &&
      report?.independentWitness?.entityId !== phase?.entityId &&
      witnessedBlock(witnessBlocks, phase?.fixtureSetup?.startFeet, 'water') &&
      witnessedBlock(witnessBlocks, phase?.fixtureSetup?.startHead, 'water') &&
      witnessedBlock(witnessBlocks, phase?.fixtureSetup?.destinationFeet, 'water') &&
      witnessedBlock(witnessBlocks, phase?.fixtureSetup?.destinationHead, 'water'),
    evidenceIntegrity:
      typeof report?.phaseSha256 === 'string' &&
      /^[a-f0-9]{64}$/.test(report.phaseSha256) &&
      typeof report?.serverPropertiesSha256 === 'string' &&
      /^[a-f0-9]{64}$/.test(report.serverPropertiesSha256),
    cleanManagedStop:
      report?.lifecycle?.verified === true &&
      typeof report?.lifecycle?.tipDigest === 'string' &&
      /^[a-f0-9]{64}$/.test(report.lifecycle.tipDigest) &&
      report?.finalOwnership?.control === 'clear' &&
      report?.finalOwnership?.port === 'clear' &&
      report?.finalOwnership?.leases === 'clear',
  };

  return {
    protocol: NATIVE_ATTENTION_CONFORMANCE_PROTOCOL,
    assertions,
    pass: Object.values(assertions).every(Boolean),
  };
}

function eventFor(events: any[], type: string, intentId: unknown) {
  return events.find(
    (event: any) => event?.type === type && String(event?.data?.intent?.id) === String(intentId),
  );
}

function finiteAt(event: any) {
  return Number.isFinite(Number(event?.at));
}

function witnessedBlock(blocks: any[], position: any, name: string) {
  return blocks.some(
    (block: any) => samePosition(block?.position, position) && block?.name === name,
  );
}

function positionDistance(left: any, right: any) {
  if (![left?.x, left?.y, left?.z, right?.x, right?.y, right?.z].every(Number.isFinite)) {
    return Infinity;
  }
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function samePosition(left: any, right: any) {
  return positionDistance(left, right) <= 0.01;
}
