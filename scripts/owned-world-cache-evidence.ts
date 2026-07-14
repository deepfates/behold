import type { WorldLifecycleEvent } from '../src/runtime/world-control';
import {
  decisionMatchesEntityTurn,
  eventData,
  promptedObservation,
  summarizeUsage,
  terminalMinecraftResult,
  type RunJournalEvent,
} from './owned-world-model-evidence';
import {
  assessPopulationLifecycle,
  canonicalIdentity,
  distinctCanonicalPaths,
  measuredModelConcurrency,
  populationInventoryCount,
  populationModelCalls,
  type PopulationBodyWitness,
  type PopulationProofBudgets,
  type PopulationResidentArtifacts,
} from './owned-world-population-evidence';

export const CACHE_PROOF_PROTOCOL = 'behold.owned-world-cache-proof.v1' as const;
export const CACHE_TRAJECTORY_PROTOCOL = 'behold.cache-resident-trajectory.v1' as const;
const NATIVE_CACHE_TOOLS = new Set([
  'collect_nearby_item',
  'deposit_in_container',
  'inspect_container',
  'chat',
  'wait_for_event',
]);

export type CacheWorldWitness = Readonly<{
  entityId: string;
  worldId: string;
  managedRunId: string;
  source: 'fresh_minecraft_connection';
  observedAt: number;
  droppedItems: readonly Readonly<{
    name: string;
    count: number;
    position?: Readonly<{ x: number; y: number; z: number }>;
  }>[];
  container: Readonly<{
    name: string;
    position: Readonly<{ x: number; y: number; z: number }>;
  }>;
  contents: readonly Readonly<{ name: string; count: number }>[];
  confirmation: 'mineflayer:openContainer';
}>;

export type CacheResidentEvidence = PopulationResidentArtifacts<PopulationBodyWitness> &
  Readonly<{
    model: string;
    task: string;
    targetItem: string;
  }>;

export type CacheEvidenceInput = Readonly<{
  worldId: string;
  containerPosition: Readonly<{ x: number; y: number; z: number }>;
  actRunId: string;
  resumeRunId: string;
  actLifecycle: readonly WorldLifecycleEvent[];
  resumeLifecycle: readonly WorldLifecycleEvent[];
  independentWitness: CacheWorldWitness;
  residents: readonly CacheResidentEvidence[];
  budgets: PopulationProofBudgets;
  proofWallMs: number;
}>;

export function assessOwnedWorldCacheEvidence(input: CacheEvidenceInput) {
  const residentIds = input.residents.map((resident) => resident.entityId);
  const contributionItems = input.residents.map((resident) => resident.targetItem);
  const allCalls = input.residents.flatMap((resident) =>
    populationModelCalls([...resident.actEvents, ...resident.resumeEvents]),
  );
  const admittedToolNames = allCalls.flatMap((call) =>
    (Array.isArray(call?.request?.body?.tools) ? call.request.body.tools : [])
      .map((tool: any) => String(tool?.function?.name || ''))
      .filter(Boolean),
  );
  const usage = summarizeUsage(allCalls);
  const maxConcurrentModelCalls = measuredModelConcurrency(allCalls);
  const maxResidentJournalBytes = Math.max(
    0,
    ...input.residents.map(
      (resident) => resident.files.actJournal.bytes + resident.files.resumeJournal.bytes,
    ),
  );
  const maxResidentLoomBytes = Math.max(
    0,
    ...input.residents.map((resident) => resident.files.loom.bytes),
  );
  const actLifecycle = assessPopulationLifecycle(
    input.actLifecycle,
    input.worldId,
    input.actRunId,
    residentIds,
    input.budgets,
  );
  const resumeLifecycle = assessPopulationLifecycle(
    input.resumeLifecycle,
    input.worldId,
    input.resumeRunId,
    residentIds,
    input.budgets,
  );
  const analyses = input.residents.map((resident) => {
    const peer = input.residents.find((candidate) => candidate.entityId !== resident.entityId);
    return analyzeResident(resident, peer ?? null, input);
  });
  const allTurnIds = new Map(
    input.residents.map((resident) => [
      resident.entityId,
      resident.trajectory.map((turn) => turn.id).filter(Boolean),
    ]),
  );

  const assertions = {
    exactlyTwoDistinctResidents:
      input.residents.length === 2 &&
      new Set(residentIds.map(canonicalIdentity)).size === input.residents.length,
    distinctOrdinaryContributions:
      contributionItems.every(Boolean) &&
      new Set(contributionItems.map(canonicalIdentity)).size === contributionItems.length,
    sharedActEpoch:
      input.actRunId !== input.resumeRunId &&
      input.residents.every(
        (resident) => eventData(resident.actEvents, 'run_started')[0]?.runId === input.actRunId,
      ),
    sharedResumeEpoch: input.residents.every(
      (resident) => eventData(resident.resumeEvents, 'run_started')[0]?.runId === input.resumeRunId,
    ),
    everyResidentFreelyPickedUpOwnItem: analyses.every(
      (analysis) => analysis.freelyChosePickup && analysis.minecraftConfirmedPickup,
    ),
    everyResidentFreelyDepositedOwnItem: analyses.every(
      (analysis) => analysis.freelyChoseDeposit && analysis.minecraftConfirmedDeposit,
    ),
    everyResidentSpokeAfterContributing: analyses.every((analysis) => analysis.spokeAfterDeposit),
    everyResidentHeardPeerThroughOwnObservation: analyses.every(
      (analysis) => analysis.observedPeerChat,
    ),
    everyResidentIndependentlyInspectedCompletedCache: analyses.every(
      (analysis) => analysis.inspectedCompletedCache,
    ),
    everyResidentYieldedAfterJointEvidence: analyses.every(
      (analysis) => analysis.yieldedAfterJointEvidence,
    ),
    onlyNativeCacheToolsAdmitted:
      admittedToolNames.length > 0 &&
      admittedToolNames.every((name) => NATIVE_CACHE_TOOLS.has(name)),
    noControllerOwnedCooperationMacro: input.residents.every((resident) => {
      const evidence = JSON.stringify([...resident.actEvents, ...resident.resumeEvents]);
      return (
        !evidence.includes('stock_shared_cache') &&
        !evidence.includes('coordinate_residents') &&
        !evidence.includes('complete_joint_task')
      );
    }),
    freshMinecraftWitnessSawExactCompletedCache:
      input.independentWitness.source === 'fresh_minecraft_connection' &&
      input.independentWitness.worldId === input.worldId &&
      input.independentWitness.managedRunId === input.actRunId &&
      samePosition(input.independentWitness.container.position, input.containerPosition) &&
      input.independentWitness.confirmation === 'mineflayer:openContainer' &&
      exactContributions(input.independentWitness.contents, contributionItems),
    freshMinecraftWitnessSawNoPreparedDrops: contributionItems.every(
      (item) => !input.independentWitness.droppedItems.some((drop) => drop.name === item),
    ),
    freshBodiesRetainNoContribution: input.residents.every(
      (resident) =>
        resident.bodyWitness.source === 'fresh_minecraft_connection' &&
        resident.bodyWitness.entityId === resident.entityId &&
        resident.bodyWitness.worldId === input.worldId &&
        resident.bodyWitness.managedRunId === input.actRunId &&
        contributionItems.every(
          (item) => populationInventoryCount(resident.bodyWitness.inventory, item) === 0,
        ),
    ),
    journalsStayResidentScoped: input.residents.every((resident) =>
      [...resident.actEvents, ...resident.resumeEvents].every(
        (event) => event.agent === resident.entityId,
      ),
    ),
    trajectoriesStayResidentScoped: input.residents.every((resident) =>
      resident.trajectory.every(
        (turn) =>
          turn.entityId === resident.entityId &&
          turn.observation?.self?.identity === resident.entityId &&
          turn.nextObservation?.self?.identity === resident.entityId,
      ),
    ),
    noForeignTurnIdsReachModelContext: input.residents.every((resident) => {
      const foreignIds = [...allTurnIds.entries()]
        .filter(([entityId]) => entityId !== resident.entityId)
        .flatMap(([, ids]) => ids);
      return populationModelCalls([...resident.actEvents, ...resident.resumeEvents]).every(
        (call) => {
          const request = JSON.stringify(call?.request?.body ?? null);
          return foreignIds.every((turnId) => !request.includes(turnId));
        },
      );
    }),
    evidenceFilesAreDistinct: distinctCanonicalPaths(
      input.residents.flatMap((resident) => [
        resident.files.actJournal.file,
        resident.files.resumeJournal.file,
        resident.files.loom.file,
      ]),
    ),
    restartPreservedEachResidentsOwnExperience: analyses.every(
      (analysis) => analysis.restartPreservedOwnExperience,
    ),
    restartDidNotRepeatOrUndoWork: analyses.every((analysis) => analysis.restartDidNotRepeatOrUndo),
    noModelCallFailed: input.residents.every(
      (resident) =>
        eventData(resident.actEvents, 'model_call_failed').length === 0 &&
        eventData(resident.resumeEvents, 'model_call_failed').length === 0 &&
        eventData(resident.actEvents, 'model_auxiliary_call_failed').length === 0 &&
        eventData(resident.resumeEvents, 'model_auxiliary_call_failed').length === 0,
    ),
    actLifecycleProvesPopulation: actLifecycle.failed.length === 0,
    resumeLifecycleProvesPopulation: resumeLifecycle.failed.length === 0,
    usageAndCostRecorded:
      usage.callCount > 0 &&
      usage.totalTokens > 0 &&
      usage.callsWithCost === usage.callCount &&
      usage.totalCost !== null,
    residentProcessBudgetHeld: input.residents.length <= input.budgets.maxResidents,
    modelConcurrencyBudgetHeld: maxConcurrentModelCalls <= input.budgets.maxConcurrentModelCalls,
    modelCallBudgetHeld: usage.callCount <= input.budgets.maxTotalModelCalls,
    tokenBudgetHeld: usage.totalTokens <= input.budgets.maxTotalTokens,
    latencyBudgetHeld: usage.maxLatencyMs <= input.budgets.maxSingleCallLatencyMs,
    costBudgetHeld:
      usage.totalCost !== null && usage.totalCost <= input.budgets.maxTotalModelCostUsd,
    journalStorageBudgetHeld:
      maxResidentJournalBytes > 0 &&
      maxResidentJournalBytes <= input.budgets.maxJournalBytesPerResident,
    loomStorageBudgetHeld:
      maxResidentLoomBytes > 0 && maxResidentLoomBytes <= input.budgets.maxLoomBytesPerResident,
    wallTimeBudgetHeld: input.proofWallMs > 0 && input.proofWallMs <= input.budgets.maxProofWallMs,
  };
  const failed = Object.entries(assertions)
    .filter(([, value]) => !value)
    .map(([name]) => name);

  return {
    assertions,
    failed,
    residents: analyses,
    lifecycle: { act: actLifecycle, resume: resumeLifecycle },
    metrics: {
      usage,
      maxConcurrentModelCalls,
      maxResidentJournalBytes,
      maxResidentLoomBytes,
      proofWallMs: input.proofWallMs,
    },
    budgets: input.budgets,
  };
}

export function hasResidentCacheMilestone(
  events: readonly RunJournalEvent[],
  ownItem: string,
  peerItem: string,
  peerId: string,
) {
  const turns = eventData(events, 'entity_turn');
  const depositIndex = turns.findIndex((turn) => successfulDeposit(turn, ownItem));
  const chatIndex = turns.findIndex(
    (turn, index) => index > depositIndex && successfulOwnChat(turn, ownItem),
  );
  const peerChatIndex = turns.findIndex((turn) =>
    observationsOfTurn(turn).some((observation) =>
      observationHasEvent(observation, 'chat_received', (event) =>
        peerChatMatches(event, peerId, peerItem),
      ),
    ),
  );
  const inspectIndex = turns.findIndex(
    (turn, index) =>
      index > depositIndex && successfulCompletedInspection(turn, [ownItem, peerItem]),
  );
  const evidenceIndex = Math.max(chatIndex, peerChatIndex, inspectIndex);
  return (
    depositIndex >= 0 &&
    chatIndex > depositIndex &&
    peerChatIndex >= 0 &&
    inspectIndex > depositIndex &&
    turns.findIndex(
      (turn, index) => index > evidenceIndex && turn?.action?.name === 'wait_for_event',
    ) > evidenceIndex
  );
}

function analyzeResident(
  resident: CacheResidentEvidence,
  peer: CacheResidentEvidence | null,
  input: CacheEvidenceInput,
) {
  const actTurns = eventData(resident.actEvents, 'entity_turn');
  const modelTurns = eventData(resident.actEvents, 'model_turn');
  const pickupIndex = actTurns.findIndex((turn) => successfulPickup(turn, resident.targetItem));
  const pickupTurn = pickupIndex >= 0 ? actTurns[pickupIndex] : null;
  const pickupDecision = pickupTurn
    ? modelTurns.find((turn) => decisionMatchesEntityTurn(turn, pickupTurn))
    : null;
  const depositIndex = actTurns.findIndex(
    (turn, index) => index > pickupIndex && successfulDeposit(turn, resident.targetItem),
  );
  const depositTurn = depositIndex >= 0 ? actTurns[depositIndex] : null;
  const depositDecision = depositTurn
    ? modelTurns.find((turn) => decisionMatchesEntityTurn(turn, depositTurn))
    : null;
  const chatIndex = actTurns.findIndex(
    (turn, index) => index > depositIndex && successfulOwnChat(turn, resident.targetItem),
  );
  const chatTurn = chatIndex >= 0 ? actTurns[chatIndex] : null;
  const peerChatIndex = peer
    ? actTurns.findIndex((turn) =>
        observationsOfTurn(turn).some((observation) =>
          observationHasEvent(observation, 'chat_received', (event) =>
            peerChatMatches(event, peer.entityId, peer.targetItem),
          ),
        ),
      )
    : -1;
  const inspectIndex = peer
    ? actTurns.findIndex(
        (turn, index) =>
          index > depositIndex &&
          successfulCompletedInspection(turn, [resident.targetItem, peer.targetItem]),
      )
    : -1;
  const inspectTurn = inspectIndex >= 0 ? actTurns[inspectIndex] : null;
  const finalEvidenceIndex = Math.max(chatIndex, peerChatIndex, inspectIndex);
  const yieldIndex = actTurns.findIndex(
    (turn, index) => index > finalEvidenceIndex && turn?.action?.name === 'wait_for_event',
  );
  const pickupResult = terminalMinecraftResult(pickupTurn);
  const depositResult = terminalMinecraftResult(depositTurn);
  const resume = restartAnalysis(resident, input);

  return {
    entityId: resident.entityId,
    targetItem: resident.targetItem,
    pickupDecision,
    pickupTurn,
    depositDecision,
    depositTurn,
    chatTurn,
    inspectTurn,
    peerChatTurn: peerChatIndex >= 0 ? actTurns[peerChatIndex] : null,
    yieldTurn: yieldIndex >= 0 ? actTurns[yieldIndex] : null,
    freelyChosePickup:
      pickupDecision?.intent?.source === 'llm' &&
      pickupDecision?.intent?.tool === 'collect_nearby_item' &&
      pickupDecision?.call?.request?.toolChoice === 'auto',
    minecraftConfirmedPickup:
      pickupIndex >= 0 &&
      pickupResult?.confirmation === 'mineflayer:playerCollect' &&
      observationInventoryCount(pickupTurn?.observation, resident.targetItem) === 0 &&
      observationInventoryCount(pickupTurn?.nextObservation, resident.targetItem) === 1,
    freelyChoseDeposit:
      depositDecision?.intent?.source === 'llm' &&
      depositDecision?.intent?.tool === 'deposit_in_container' &&
      depositDecision?.call?.request?.toolChoice === 'auto',
    minecraftConfirmedDeposit:
      depositIndex > pickupIndex &&
      depositResult?.confirmation === 'mineflayer:container_inventory_delta' &&
      depositResult?.item === resident.targetItem &&
      Number(depositResult?.bodyRemoved) === 1 &&
      Number(depositResult?.containerAdded) === 1 &&
      samePosition(depositResult?.container?.position, input.containerPosition),
    spokeAfterDeposit: chatIndex > depositIndex,
    observedPeerChat: peerChatIndex >= 0,
    inspectedCompletedCache: inspectIndex > depositIndex,
    yieldedAfterJointEvidence:
      chatIndex > depositIndex &&
      peerChatIndex >= 0 &&
      inspectIndex > depositIndex &&
      yieldIndex > finalEvidenceIndex,
    ...resume,
  };
}

function restartAnalysis(resident: CacheResidentEvidence, input: CacheEvidenceInput) {
  const started = eventData(resident.resumeEvents, 'run_started')[0] ?? null;
  const modelTurns = eventData(resident.resumeEvents, 'model_turn');
  const entityTurns = eventData(resident.resumeEvents, 'entity_turn');
  const firstTurn = entityTurns[0] ?? null;
  const firstDecision = firstTurn
    ? modelTurns.find((turn) => decisionMatchesEntityTurn(turn, firstTurn))
    : (modelTurns[0] ?? null);
  const prompt = promptedObservation(firstDecision?.call?.request?.body);
  const action = String(firstDecision?.intent?.tool || firstTurn?.action?.name || '');
  const requestText = JSON.stringify(firstDecision?.call?.request?.body ?? null);
  const repeated = new Set([
    'collect_nearby_item',
    'deposit_in_container',
    'withdraw_from_container',
  ]);
  return {
    restartFirstDecision: firstDecision,
    restartFirstTurn: firstTurn,
    restartPrompt: prompt,
    restartPreservedOwnExperience:
      started?.runId === input.resumeRunId &&
      started?.model === resident.model &&
      started?.task === resident.task &&
      Number(started?.priorEntityTurns) >= 1 &&
      prompt?.circle?.id === input.worldId &&
      prompt?.circle?.managedRunId === input.resumeRunId &&
      prompt?.self?.identity === resident.entityId &&
      observationInventoryCount(prompt, resident.targetItem) === 0 &&
      requestText.includes('mineflayer:container_inventory_delta') &&
      requestText.includes('mineflayer:openContainer') &&
      requestText.includes('chat_received'),
    restartDidNotRepeatOrUndo:
      firstDecision?.call?.request?.toolChoice === 'auto' &&
      ['wait_for_event', 'inspect_container'].includes(action) &&
      entityTurns.every((turn) => !repeated.has(String(turn?.action?.name || ''))),
  };
}

function successfulPickup(turn: any, item: string) {
  const result = terminalMinecraftResult(turn);
  return (
    turn?.action?.source === 'llm' &&
    turn?.action?.name === 'collect_nearby_item' &&
    turn?.outcome?.ok === true &&
    result?.ok === true &&
    result?.item === item &&
    result?.confirmation === 'mineflayer:playerCollect'
  );
}

function successfulDeposit(turn: any, item: string) {
  const result = terminalMinecraftResult(turn);
  return (
    turn?.action?.source === 'llm' &&
    turn?.action?.name === 'deposit_in_container' &&
    turn?.outcome?.ok === true &&
    result?.ok === true &&
    result?.item === item &&
    Number(result?.bodyRemoved) === 1 &&
    Number(result?.containerAdded) === 1 &&
    result?.confirmation === 'mineflayer:container_inventory_delta'
  );
}

function successfulOwnChat(turn: any, item: string) {
  const result = terminalMinecraftResult(turn);
  const message = String(result?.message || '');
  return (
    turn?.action?.source === 'llm' &&
    turn?.action?.name === 'chat' &&
    turn?.outcome?.ok === true &&
    result?.ok === true &&
    message.toLowerCase().includes(item.toLowerCase()) &&
    /(?:chest|cache|stor|inside|put)/i.test(message)
  );
}

function successfulCompletedInspection(turn: any, items: readonly string[]) {
  const result = terminalMinecraftResult(turn);
  return (
    turn?.action?.source === 'llm' &&
    turn?.action?.name === 'inspect_container' &&
    turn?.outcome?.ok === true &&
    result?.ok === true &&
    result?.confirmation === 'mineflayer:openContainer' &&
    exactContributions(result?.contents, items)
  );
}

function peerChatMatches(event: any, peerId: string, peerItem: string) {
  return (
    canonicalIdentity(String(event?.data?.from || '')) === canonicalIdentity(peerId) &&
    String(event?.data?.text || '')
      .toLowerCase()
      .includes(peerItem.toLowerCase())
  );
}

function exactContributions(contents: any, items: readonly string[]) {
  if (!Array.isArray(contents)) return false;
  const expected = new Set(items);
  return (
    contents.length === expected.size &&
    [...expected].every(
      (item) =>
        contents.filter((entry: any) => String(entry?.name) === item).length === 1 &&
        contents
          .filter((entry: any) => String(entry?.name) === item)
          .reduce((sum: number, entry: any) => sum + Number(entry?.count || 0), 0) === 1,
    )
  );
}

function observationsOfTurn(turn: any) {
  return [turn?.observation, turn?.nextObservation].filter(Boolean);
}

function observationInventoryCount(observation: any, name: string) {
  return (Array.isArray(observation?.self?.inventory) ? observation.self.inventory : [])
    .filter((item: any) => String(item?.name) === name)
    .reduce((sum: number, item: any) => sum + Math.max(0, Number(item?.count) || 0), 0);
}

function observationHasEvent(
  observation: any,
  type: string,
  predicate: (event: any) => boolean = () => true,
) {
  return (Array.isArray(observation?.events) ? observation.events : []).some(
    (event: any) => event?.type === type && predicate(event),
  );
}

function samePosition(left: any, right: Readonly<{ x: number; y: number; z: number }>) {
  return (
    Number(left?.x) === Number(right.x) &&
    Number(left?.y) === Number(right.y) &&
    Number(left?.z) === Number(right.z)
  );
}
