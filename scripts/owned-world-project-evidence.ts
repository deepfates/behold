import {
  decisionActionName,
  decisionMatchesEntityTurn,
  eventData,
  inventoryCount,
  modelChoseOfferedTool,
  promptedObservation,
  requestToolNames,
  summarizeUsage,
  terminalMinecraftResult,
  type RunJournalEvent,
} from './owned-world-model-evidence';

export type BlockPosition = Readonly<{ x: number; y: number; z: number }>;

export type ProjectWorldWitness = Readonly<{
  entityId: string;
  worldId: string;
  managedRunId: string;
  source: 'fresh_minecraft_connection';
  observedAt: number;
  blocks: readonly Readonly<{
    position: BlockPosition;
    name: string | null;
    stateId: number | null;
  }>[];
}>;

export type ProjectTreeDigest = Readonly<{
  profile: string;
  digest: string;
  files: number;
}>;

export type ProjectPlaceBindingEvidence = Readonly<{
  worldId: string;
  serverJarSha256: string;
  descriptor: any;
  declaredDescriptorSha256: string;
  actualDescriptorSha256: string;
  sourceTree: ProjectTreeDigest;
  baselineTree: ProjectTreeDigest;
  admittedRuntimeTree: ProjectTreeDigest;
  initialRuntimeTree: ProjectTreeDigest;
  afterActTree: ProjectTreeDigest;
  afterResumeTree: ProjectTreeDigest;
  finalSourceTree: ProjectTreeDigest;
  finalBaselineTree: ProjectTreeDigest;
}>;

export function assessProjectPlaceBinding(input: ProjectPlaceBindingEvidence) {
  const descriptor = input.descriptor;
  const assertions = {
    admittedDescriptorIdentityBound:
      descriptor?.protocol === 'behold.place-epoch-admission.v1' &&
      descriptor?.worldId === input.worldId &&
      isSha256(input.declaredDescriptorSha256) &&
      input.actualDescriptorSha256 === input.declaredDescriptorSha256,
    placeReleaseAndProfileDigestsBound:
      descriptor?.place?.declaredWorldTreeSha256 === descriptor?.place?.verifiedWorldTreeSha256 &&
      [
        descriptor?.place?.releaseManifestSha256,
        descriptor?.place?.releaseChecksumsSha256,
        descriptor?.place?.worldArchiveSha256,
        descriptor?.place?.evidenceArchiveSha256,
        descriptor?.place?.verifiedWorldTreeSha256,
        descriptor?.profile?.sha256,
      ].every(isSha256) &&
      typeof descriptor?.profile?.id === 'string' &&
      descriptor.profile.id.length > 0,
    beholdMaterializationBound:
      descriptor?.behold?.sourceTree?.digest === input.sourceTree.digest &&
      descriptor?.behold?.baselineTree?.digest === input.baselineTree.digest &&
      descriptor?.behold?.serverJarSha256 === input.serverJarSha256 &&
      isSha256(descriptor?.behold?.worldDefinitionSha256),
    admittedRuntimeStartedFromVerifiedBaseline:
      input.admittedRuntimeTree.digest === input.baselineTree.digest &&
      input.admittedRuntimeTree.profile === input.baselineTree.profile,
    immutableInputsStayedStable:
      input.finalSourceTree.digest === input.sourceTree.digest &&
      input.finalBaselineTree.digest === input.baselineTree.digest,
    runtimeAdvancedThroughBothLives:
      input.initialRuntimeTree.digest !== input.afterActTree.digest &&
      input.afterActTree.digest !== input.afterResumeTree.digest,
  };
  return {
    assertions,
    failed: Object.entries(assertions)
      .filter(([, passed]) => !passed)
      .map(([name]) => name),
  };
}

export type OwnedWorldProjectExpectation = Readonly<{
  worldId: string;
  entityId: string;
  model: string;
  task: string;
  projectId: string;
  material: string;
  firstBlock: BlockPosition;
  secondBlock: BlockPosition;
  actRunId: string;
  resumeRunId: string;
  contextBudget?: Readonly<{
    maxTotalPromptTokens: number;
    maxPromptTokensPerCall: number;
    maxRequestBodyChars: number;
  }>;
}>;

export function assessOwnedWorldProjectEvidence(
  actEvents: readonly RunJournalEvent[],
  resumeEvents: readonly RunJournalEvent[],
  firstWitness: ProjectWorldWitness,
  finalWitness: ProjectWorldWitness,
  expected: OwnedWorldProjectExpectation,
) {
  const actStarted = eventData(actEvents, 'run_started')[0] ?? null;
  const resumeStarted = eventData(resumeEvents, 'run_started')[0] ?? null;
  const actModelTurns = eventData(actEvents, 'model_turn');
  const resumeModelTurns = eventData(resumeEvents, 'model_turn');
  const actEntityTurns = eventData(actEvents, 'entity_turn');
  const resumeEntityTurns = eventData(resumeEvents, 'entity_turn');
  const actFailures = eventData(actEvents, 'model_call_failed');
  const resumeFailures = eventData(resumeEvents, 'model_call_failed');
  const actAuxiliaryCalls = eventData(actEvents, 'model_auxiliary_call');
  const resumeAuxiliaryCalls = eventData(resumeEvents, 'model_auxiliary_call');
  const actAuxiliaryFailures = eventData(actEvents, 'model_auxiliary_call_failed');
  const resumeAuxiliaryFailures = eventData(resumeEvents, 'model_auxiliary_call_failed');
  const actPromptObservation = promptedObservation(actModelTurns[0]?.call?.request?.body);

  const startTurn = projectTurn(actEntityTurns, expected.projectId, 'start');
  const collectionTurn = actEntityTurns.find(
    (turn) =>
      turn?.action?.source === 'llm' &&
      turn?.action?.name === 'collect_nearby_item' &&
      terminalMinecraftResult(turn)?.ok === true &&
      terminalMinecraftResult(turn)?.item === expected.material &&
      terminalMinecraftResult(turn)?.confirmation === 'mineflayer:playerCollect',
  );
  const actPlacements = actEntityTurns.map(verifiedPlacement).filter(isPlacement);
  const firstPlacement = actPlacements[0] ?? null;
  const firstPosition = firstPlacement?.position ?? null;
  const firstPlacementIndex = turnIndex(actEntityTurns, firstPlacement?.turn);
  const actUpdateTurn = actEntityTurns.find(
    (turn, index) =>
      index > firstPlacementIndex && projectOperation(turn, expected.projectId) === 'update',
  );
  const actUpdateIndex = turnIndex(actEntityTurns, actUpdateTurn);
  const actYieldTurn =
    actUpdateIndex >= 0
      ? (actEntityTurns
          .slice(actUpdateIndex + 1)
          .find((turn) => turn?.action?.name === 'wait_for_event') ?? null)
      : null;

  const resumeFirstTurn = resumeEntityTurns[0] ?? null;
  const resumeFirstDecision = resumeFirstTurn
    ? (resumeModelTurns.find((turn) => decisionMatchesEntityTurn(turn, resumeFirstTurn)) ?? null)
    : null;
  const resumePromptObservation = promptedObservation(resumeFirstDecision?.call?.request?.body);
  const resumeRequestBody = resumeFirstDecision?.call?.request?.body;
  const resumeRequestText = JSON.stringify(resumeRequestBody ?? null);
  const resumePlacementAttempts = resumeEntityTurns.filter(
    (turn) => turn?.action?.name === 'place_block',
  );
  const resumePlacements = resumeEntityTurns.map(verifiedPlacement).filter(isPlacement);
  const secondPlacement = resumePlacements[0] ?? null;
  const secondPosition = secondPlacement?.position ?? null;
  const secondPlacementIndex = turnIndex(resumeEntityTurns, secondPlacement?.turn);
  const completeTurn = resumeEntityTurns.find(
    (turn, index) =>
      index > secondPlacementIndex && projectOperation(turn, expected.projectId) === 'complete',
  );
  const completeIndex = turnIndex(resumeEntityTurns, completeTurn);
  const resumeYieldTurn =
    completeIndex >= 0
      ? (resumeEntityTurns
          .slice(completeIndex + 1)
          .find((turn) => turn?.action?.name === 'wait_for_event') ?? null)
      : null;

  const criticalTurns = [
    startTurn,
    collectionTurn,
    firstPlacement?.turn,
    actUpdateTurn,
    actYieldTurn,
    resumeFirstTurn,
    secondPlacement?.turn,
    completeTurn,
    resumeYieldTurn,
  ].filter(Boolean);
  const criticalDecisions = criticalTurns.map((turn) =>
    [...actModelTurns, ...resumeModelTurns].find((decision) =>
      decisionMatchesEntityTurn(decision, turn),
    ),
  );
  const calls = [
    ...actModelTurns,
    ...resumeModelTurns,
    ...actAuxiliaryCalls,
    ...resumeAuxiliaryCalls,
  ]
    .map((turn) => turn?.call)
    .filter((call) => call?.protocol === 'behold.model-call.v1');
  const usage = summarizeUsage(calls);
  // Project memory deliberately canonicalizes and bounds model prose before it
  // becomes durable state. Compare the restart view to that committed result,
  // not to an arbitrarily longer raw tool argument.
  const nextStep = String(terminalMinecraftResult(actUpdateTurn)?.project?.nextStep || '');
  const restatedNextStep = String(
    terminalMinecraftResult(resumeFirstTurn)?.project?.nextStep || '',
  );

  const assertions = {
    productionModelRan:
      calls.length >= 6 &&
      calls.every(
        (call) =>
          call?.request?.model === expected.model &&
          typeof call?.response?.id === 'string' &&
          call.response.id.length > 0,
      ),
    firstLifeStartedFresh:
      actStarted?.runId === expected.actRunId &&
      actStarted?.model === expected.model &&
      actStarted?.task === expected.task &&
      Number(actStarted?.priorEntityTurns) === 0,
    projectStartedBeforeConstruction:
      projectOperation(startTurn, expected.projectId) === 'start' &&
      turnIndex(actEntityTurns, startTurn) < turnIndex(actEntityTurns, firstPlacement?.turn),
    twoBlocksCollectedFromMinecraft:
      inventoryCount(collectionTurn?.nextObservation, expected.material) === 2,
    firstLifeBuiltExactlyOneVerifiedBlock:
      actPlacements.length === 1 &&
      firstPlacement?.material === expected.material &&
      samePosition(firstPosition, expected.firstBlock),
    firstLifeRecordedAnUnfinishedNextStep:
      projectOperation(actUpdateTurn, expected.projectId) === 'update' &&
      meaningfulRemainingStep(nextStep) &&
      turnIndex(actEntityTurns, actUpdateTurn) > firstPlacementIndex,
    firstLifeDidNotClaimCompletion: !actEntityTurns.some(
      (turn) => projectOperation(turn, expected.projectId) === 'complete',
    ),
    firstLifeYieldedWithProjectActive:
      actYieldTurn?.outcome?.ok === true &&
      turnIndex(actEntityTurns, actYieldTurn) > actUpdateIndex,
    independentBodySawThePartialBuild:
      witnessBoundTo(firstWitness, expected.worldId, expected.actRunId, expected.entityId) &&
      witnessHasBlock(firstWitness, firstPosition, expected.material),
    restartedAsSamePersistentEntity:
      resumeStarted?.runId === expected.resumeRunId &&
      resumeStarted?.model === expected.model &&
      resumeStarted?.task === expected.task &&
      Number(resumeStarted?.priorEntityTurns) >= 4 &&
      resumePromptObservation?.circle?.id === expected.worldId &&
      resumePromptObservation?.circle?.managedRunId === expected.resumeRunId &&
      resumePromptObservation?.self?.identity === expected.entityId,
    restartReceivedActiveProjectAndMaterial:
      activeProject(resumePromptObservation, expected.projectId)?.nextStep === nextStep &&
      inventoryCount(resumePromptObservation, expected.material) === 1,
    restartPromptCarriedThePriorWorldChange:
      requestNamesContain(resumeRequestBody, ['manage_project', 'place_block']) &&
      resumeRequestText.includes(expected.projectId) &&
      resumeRequestText.includes('mineflayer:blockUpdate') &&
      positionAppears(resumeRequestText, firstPosition),
    restartFirstRestatedTheUnfinishedCommitment:
      projectOperation(resumeFirstTurn, expected.projectId) === 'update' &&
      meaningfulRemainingStep(restatedNextStep),
    restartDidNotRepeatTheCompletedPlacement:
      firstPosition != null &&
      !resumePlacementAttempts.some((turn) => samePosition(actionPosition(turn), firstPosition)),
    restartBuiltOneDistinctAdjacentBlock:
      resumePlacements.length === 1 &&
      secondPlacement?.material === expected.material &&
      samePosition(secondPosition, expected.secondBlock) &&
      distinctAdjacent(firstPosition, secondPosition),
    projectCompletedOnlyAfterSecondBlock:
      projectOperation(completeTurn, expected.projectId) === 'complete' &&
      completeTurn?.outcome?.ok === true &&
      terminalMinecraftResult(completeTurn)?.evidence?.satisfied === true &&
      secondPlacementIndex >= 0 &&
      completeIndex > secondPlacementIndex,
    completedLifeYielded:
      resumeYieldTurn?.outcome?.ok === true &&
      turnIndex(resumeEntityTurns, resumeYieldTurn) > completeIndex,
    independentBodySawTheFinishedLandmark:
      witnessBoundTo(finalWitness, expected.worldId, expected.resumeRunId, expected.entityId) &&
      witnessHasBlock(finalWitness, firstPosition, expected.material) &&
      witnessHasBlock(finalWitness, secondPosition, expected.material),
    modelFreelyChoseEveryCriticalStep:
      criticalDecisions.length === criticalTurns.length &&
      criticalDecisions.every((decision) =>
        modelChoseOfferedTool(decision, String(decisionActionName(decision))),
      ),
    firstPersonWithoutLoadedWorldScan:
      actPromptObservation?.protocol === 'behold.inhabitant.v2' &&
      resumePromptObservation?.protocol === 'behold.inhabitant.v2' &&
      actPromptObservation?.scene?.terrain?.source === 'vision' &&
      resumePromptObservation?.scene?.terrain?.source === 'vision' &&
      [...actModelTurns, ...resumeModelTurns].every(
        (turn) => !requestToolNames(turn?.call?.request?.body).includes('inspect_volume'),
      ),
    noModelCallFailed:
      actFailures.length === 0 &&
      resumeFailures.length === 0 &&
      actAuxiliaryFailures.length === 0 &&
      resumeAuxiliaryFailures.length === 0,
    usageRecorded: usage.callCount >= 6 && usage.totalTokens > 0 && usage.totalLatencyMs >= 0,
    contextBudgetSatisfied:
      expected.contextBudget == null ||
      (usage.promptTokens <= expected.contextBudget.maxTotalPromptTokens &&
        usage.maxPromptTokens <= expected.contextBudget.maxPromptTokensPerCall &&
        usage.maxRequestBodyChars <= expected.contextBudget.maxRequestBodyChars),
  };
  const failed = Object.entries(assertions)
    .filter(([, value]) => !value)
    .map(([name]) => name);

  return {
    assertions,
    failed,
    firstPosition,
    secondPosition,
    act: {
      runStarted: actStarted,
      startTurn,
      collectionTurn,
      firstPlacement: firstPlacement?.turn ?? null,
      updateTurn: actUpdateTurn,
      yieldTurn: actYieldTurn,
      modelFailures: actFailures,
    },
    resume: {
      runStarted: resumeStarted,
      firstDecision: resumeFirstDecision,
      firstTurn: resumeFirstTurn,
      promptObservation: resumePromptObservation,
      secondPlacement: secondPlacement?.turn ?? null,
      completeTurn,
      yieldTurn: resumeYieldTurn,
      modelFailures: resumeFailures,
    },
    usage,
  };
}

export function hasInterruptedProjectMilestone(
  events: readonly RunJournalEvent[],
  projectId: string,
  material: string,
  expectedPosition?: BlockPosition,
) {
  const turns = eventData(events, 'entity_turn');
  const placements = turns.map(verifiedPlacement).filter(isPlacement);
  if (
    placements.length !== 1 ||
    placements[0].material !== material ||
    (expectedPosition != null && !samePosition(placements[0].position, expectedPosition))
  ) {
    return false;
  }
  const placementIndex = turnIndex(turns, placements[0].turn);
  const startIndex = turns.findIndex((turn) => projectOperation(turn, projectId) === 'start');
  const updateIndex = turns.findIndex(
    (turn, index) => index > placementIndex && projectOperation(turn, projectId) === 'update',
  );
  const yieldIndex = turns.findIndex(
    (turn, index) => index > updateIndex && turn?.action?.name === 'wait_for_event',
  );
  return (
    startIndex >= 0 &&
    startIndex < placementIndex &&
    updateIndex > placementIndex &&
    yieldIndex > updateIndex &&
    !turns.some((turn) => projectOperation(turn, projectId) === 'complete')
  );
}

export function hasCompletedProjectMilestone(
  events: readonly RunJournalEvent[],
  projectId: string,
  material: string,
  firstPosition: BlockPosition,
  expectedPosition?: BlockPosition,
) {
  const turns = eventData(events, 'entity_turn');
  if (projectOperation(turns[0], projectId) !== 'update') return false;
  const attempts = turns.filter((turn) => turn?.action?.name === 'place_block');
  if (attempts.some((turn) => samePosition(actionPosition(turn), firstPosition))) return false;
  const placements = turns.map(verifiedPlacement).filter(isPlacement);
  if (
    placements.length !== 1 ||
    placements[0].material !== material ||
    (expectedPosition != null && !samePosition(placements[0].position, expectedPosition)) ||
    !distinctAdjacent(firstPosition, placements[0].position)
  ) {
    return false;
  }
  const placementIndex = turnIndex(turns, placements[0].turn);
  const completeIndex = turns.findIndex(
    (turn, index) => index > placementIndex && projectOperation(turn, projectId) === 'complete',
  );
  const yieldIndex = turns.findIndex(
    (turn, index) => index > completeIndex && turn?.action?.name === 'wait_for_event',
  );
  return completeIndex > placementIndex && yieldIndex > completeIndex;
}

export function verifiedPlacementPosition(turn: any): BlockPosition | null {
  return verifiedPlacement(turn)?.position ?? null;
}

function projectTurn(turns: readonly any[], projectId: string, operation: string) {
  return turns.find((turn) => projectOperation(turn, projectId) === operation) ?? null;
}

function projectOperation(turn: any, projectId: string) {
  if (
    turn?.action?.name !== 'manage_project' ||
    turn?.action?.source !== 'llm' ||
    String(turn?.action?.input?.id || '') !== projectId ||
    turn?.outcome?.ok !== true ||
    terminalMinecraftResult(turn)?.ok !== true
  ) {
    return null;
  }
  return String(turn.action.input.operation || '');
}

function verifiedPlacement(turn: any) {
  if (
    turn?.action?.name !== 'place_block' ||
    turn?.action?.source !== 'llm' ||
    turn?.outcome?.ok !== true
  ) {
    return null;
  }
  const result = terminalMinecraftResult(turn);
  const change = (Array.isArray(result?.changes) ? result.changes : []).find(
    (candidate: any) =>
      candidate?.verb === 'place' &&
      candidate?.verified === true &&
      candidate?.confirmation?.source === 'mineflayer:blockUpdate',
  );
  const position = blockPosition(change?.position);
  if (!position) return null;
  return {
    turn,
    position,
    material: String(change?.after || result?.item || turn?.action?.input?.name || ''),
  };
}

function isPlacement(
  value: ReturnType<typeof verifiedPlacement>,
): value is NonNullable<ReturnType<typeof verifiedPlacement>> {
  return value != null;
}

function actionPosition(turn: any) {
  return blockPosition(turn?.action?.input);
}

function blockPosition(value: any): BlockPosition | null {
  if (![value?.x, value?.y, value?.z].every(Number.isFinite)) return null;
  return { x: Number(value.x), y: Number(value.y), z: Number(value.z) };
}

function turnIndex(turns: readonly any[], turn: any) {
  return turn == null ? -1 : turns.indexOf(turn);
}

function meaningfulRemainingStep(text: string) {
  const value = text.toLowerCase();
  return (
    value.length >= 12 &&
    /\b(?:second|remaining|finish|complete)\b/.test(value) &&
    /\b(?:adjacent|beside|next to)\b/.test(value) &&
    /\b(?:block|cobblestone|landmark|marker)\b/.test(value)
  );
}

function activeProject(observation: any, projectId: string) {
  return (Array.isArray(observation?.self?.projects) ? observation.self.projects : []).find(
    (project: any) => String(project?.id || '') === projectId,
  );
}

function requestNamesContain(body: any, names: readonly string[]) {
  const available = new Set(requestToolNames(body));
  return names.every((name) => available.has(name));
}

function distinctAdjacent(a: BlockPosition | null, b: BlockPosition | null) {
  return (
    a != null &&
    b != null &&
    !samePosition(a, b) &&
    Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z) === 1
  );
}

function samePosition(a: BlockPosition | null, b: BlockPosition | null) {
  return a != null && b != null && a.x === b.x && a.y === b.y && a.z === b.z;
}

function witnessBoundTo(
  witness: ProjectWorldWitness,
  worldId: string,
  managedRunId: string,
  residentId: string,
) {
  return (
    witness.source === 'fresh_minecraft_connection' &&
    witness.worldId === worldId &&
    witness.managedRunId === managedRunId &&
    witness.entityId !== residentId
  );
}

function witnessHasBlock(
  witness: ProjectWorldWitness,
  position: BlockPosition | null,
  material: string,
) {
  return (
    position != null &&
    witness.blocks.some(
      (block) => samePosition(block.position, position) && block.name === material,
    )
  );
}

function positionAppears(text: string, position: BlockPosition | null) {
  if (!position) return false;
  const raw = JSON.stringify(position);
  const quoted = raw.replaceAll('"', '\\"');
  return text.includes(raw) || text.includes(quoted);
}

function isSha256(value: unknown) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}
