import type { EntityTurn } from '../src/entity/loom';
import type { WorldLifecycleEvent } from '../src/runtime/world-control';
import {
  decisionMatchesEntityTurn,
  eventData,
  promptedObservation,
  summarizeUsage,
  terminalMinecraftResult,
  type IndependentWorldWitness,
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
} from './owned-world-population-evidence';

export const HANDOFF_PROOF_PROTOCOL = 'behold.owned-world-handoff-proof.v1' as const;
export const HANDOFF_TRAJECTORY_PROTOCOL = 'behold.handoff-resident-trajectory.v1' as const;

export type HandoffResidentEvidence = Readonly<{
  role: 'giver' | 'recipient';
  entityId: string;
  model: string;
  task: string;
  actEvents: readonly RunJournalEvent[];
  resumeEvents: readonly RunJournalEvent[];
  trajectory: readonly EntityTurn[];
  bodyWitness: PopulationBodyWitness;
  files: Readonly<{
    actJournal: Readonly<{ file: string; bytes: number }>;
    resumeJournal: Readonly<{ file: string; bytes: number }>;
    loom: Readonly<{ file: string; bytes: number }>;
  }>;
}>;

export type HandoffEvidenceInput = Readonly<{
  worldId: string;
  item: string;
  actRunId: string;
  resumeRunId: string;
  actLifecycle: readonly WorldLifecycleEvent[];
  resumeLifecycle: readonly WorldLifecycleEvent[];
  independentWitness: IndependentWorldWitness;
  residents: readonly HandoffResidentEvidence[];
  budgets: PopulationProofBudgets;
  proofWallMs: number;
}>;

export function assessOwnedWorldHandoffEvidence(input: HandoffEvidenceInput) {
  const giver = input.residents.find((resident) => resident.role === 'giver');
  const recipient = input.residents.find((resident) => resident.role === 'recipient');
  const residentIds = input.residents.map((resident) => resident.entityId);
  const allCalls = input.residents.flatMap((resident) =>
    populationModelCalls([...resident.actEvents, ...resident.resumeEvents]),
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
  const giverAnalysis = giver ? analyzeGiver(giver, recipient?.entityId || '', input) : null;
  const recipientAnalysis = recipient
    ? analyzeRecipient(recipient, giver?.entityId || '', input)
    : null;
  const allTurnIds = new Map(
    input.residents.map((resident) => [
      resident.entityId,
      resident.trajectory.map((turn) => turn.id).filter(Boolean),
    ]),
  );

  const assertions = {
    exactDistinctRoles:
      input.residents.length === 2 &&
      !!giver &&
      !!recipient &&
      canonicalIdentity(giver.entityId) !== canonicalIdentity(recipient.entityId),
    sharedActEpoch:
      input.actRunId !== input.resumeRunId &&
      input.residents.every(
        (resident) => eventData(resident.actEvents, 'run_started')[0]?.runId === input.actRunId,
      ),
    sharedResumeEpoch: input.residents.every(
      (resident) => eventData(resident.resumeEvents, 'run_started')[0]?.runId === input.resumeRunId,
    ),
    giverAcquiredThroughLocomotion: giverAnalysis?.acquiredThroughMove === true,
    giverFreelyChoseNativeDrop: giverAnalysis?.freelyChoseDrop === true,
    dropClaimsOnlyOwnInventoryChange: giverAnalysis?.dropClaimsOnlyOwnBody === true,
    giverIndependentlyObservedRecipientCollection:
      giverAnalysis?.observedRecipientCollection === true,
    recipientFreelyWalkedToItem: recipientAnalysis?.freelyChoseMove === true,
    recipientIndependentlyObservedCollection: recipientAnalysis?.observedOwnCollection === true,
    bothYieldedAfterHandoff:
      giverAnalysis?.yieldedAfterConsequence === true &&
      recipientAnalysis?.yieldedAfterConsequence === true,
    noPrivilegedOfferVerb: input.residents.every((resident) =>
      [...resident.actEvents, ...resident.resumeEvents].every(
        (event) => !JSON.stringify(event).includes('offer_item_to_player'),
      ),
    ),
    independentMinecraftBodySawNoDroppedItem:
      input.independentWitness.source === 'fresh_minecraft_connection' &&
      input.independentWitness.worldId === input.worldId &&
      input.independentWitness.managedRunId === input.actRunId &&
      !input.independentWitness.droppedItems.some((item) => item.name === input.item),
    freshBodiesConfirmTransfer:
      !!giver &&
      !!recipient &&
      populationInventoryCount(giver.bodyWitness.inventory, input.item) === 0 &&
      populationInventoryCount(recipient.bodyWitness.inventory, input.item) === 1 &&
      [giver, recipient].every(
        (resident) =>
          resident.bodyWitness.source === 'fresh_minecraft_connection' &&
          resident.bodyWitness.entityId === resident.entityId &&
          resident.bodyWitness.worldId === input.worldId &&
          resident.bodyWitness.managedRunId === input.actRunId,
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
    restartPreservedEachSide:
      giverAnalysis?.restartPreservedOwnSide === true &&
      recipientAnalysis?.restartPreservedOwnSide === true,
    restartDidNotRepeatHandoff:
      giverAnalysis?.restartDidNotRepeat === true &&
      recipientAnalysis?.restartDidNotRepeat === true,
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
    giver: giverAnalysis,
    recipient: recipientAnalysis,
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

export function hasGiverHandoffMilestone(
  events: readonly RunJournalEvent[],
  item: string,
  recipientId: string,
) {
  const turns = eventData(events, 'entity_turn');
  const dropped = turns.some((turn) => {
    const result = terminalMinecraftResult(turn);
    return (
      turn?.action?.name === 'drop_item' &&
      turn?.action?.source === 'llm' &&
      turn?.outcome?.ok === true &&
      result?.ok === true &&
      result?.item === item &&
      Number(result?.inventoryRemoved) === 1 &&
      result?.confirmation === 'mineflayer:inventory_delta'
    );
  });
  const yieldedAfterWitness = turns.some(
    (turn) =>
      turn?.action?.name === 'wait_for_event' &&
      observationHasEvent(turn?.observation, 'nearby_player_collected_item', (event) => {
        const collector = String(event?.data?.collector || '');
        const collectedItem = String(event?.data?.item || '');
        return (
          canonicalIdentity(collector) === canonicalIdentity(recipientId) && collectedItem === item
        );
      }),
  );
  return dropped && yieldedAfterWitness;
}

export function hasRecipientHandoffMilestone(events: readonly RunJournalEvent[], item: string) {
  const turns = eventData(events, 'entity_turn');
  const collectionIndex = turns.findIndex(
    (turn) =>
      turn?.action?.name === 'move_to' &&
      turn?.action?.source === 'llm' &&
      turn?.outcome?.ok === true &&
      observationInventoryCount(turn?.observation, item) === 0 &&
      observationInventoryCount(turn?.nextObservation, item) === 1 &&
      observationHasEvent(turn?.nextObservation, 'item_collected', (event) =>
        String(event?.data?.item || '').includes(item),
      ),
  );
  return (
    collectionIndex >= 0 &&
    turns.slice(collectionIndex + 1).some((turn) => turn?.action?.name === 'wait_for_event')
  );
}

function analyzeGiver(
  resident: HandoffResidentEvidence,
  recipientId: string,
  input: HandoffEvidenceInput,
) {
  const actTurns = eventData(resident.actEvents, 'entity_turn');
  const actModelTurns = eventData(resident.actEvents, 'model_turn');
  const moveTurn = actTurns.find(
    (turn) =>
      turn?.action?.name === 'move_to' &&
      turn?.action?.source === 'llm' &&
      turn?.outcome?.ok === true &&
      observationInventoryCount(turn?.observation, input.item) === 0 &&
      observationInventoryCount(turn?.nextObservation, input.item) === 1,
  );
  const dropTurn = actTurns.find((turn) => {
    const result = terminalMinecraftResult(turn);
    return (
      turn?.action?.name === 'drop_item' &&
      turn?.action?.source === 'llm' &&
      turn?.outcome?.ok === true &&
      result?.ok === true &&
      result?.item === input.item &&
      Number(result?.inventoryRemoved) === 1 &&
      result?.confirmation === 'mineflayer:inventory_delta'
    );
  });
  const dropDecision = dropTurn
    ? actModelTurns.find((turn) => decisionMatchesEntityTurn(turn, dropTurn))
    : null;
  const collectionObservation = allObservations(resident.actEvents).find((observation) =>
    observationHasEvent(observation, 'nearby_player_collected_item', (event) => {
      const collector = String(event?.data?.collector || '');
      const item = String(event?.data?.item || '');
      return canonicalIdentity(collector) === canonicalIdentity(recipientId) && item === input.item;
    }),
  );
  const yieldTurn = actTurns.find(
    (turn) =>
      turn?.action?.name === 'wait_for_event' &&
      observationHasEvent(turn?.observation, 'nearby_player_collected_item', (event) => {
        const collector = String(event?.data?.collector || '');
        return canonicalIdentity(collector) === canonicalIdentity(recipientId);
      }),
  );
  const dropResult = terminalMinecraftResult(dropTurn);
  const resume = restartAnalysis(resident, input, 0, ['drop_item', 'move_to']);
  return {
    moveTurn,
    dropDecision,
    dropTurn,
    collectionObservation,
    yieldTurn,
    acquiredThroughMove: !!moveTurn,
    freelyChoseDrop:
      dropDecision?.intent?.source === 'llm' &&
      dropDecision?.intent?.tool === 'drop_item' &&
      dropDecision?.call?.request?.toolChoice === 'auto',
    dropClaimsOnlyOwnBody:
      dropResult?.confirmation === 'mineflayer:inventory_delta' &&
      Number(dropResult?.inventoryRemoved) === 1 &&
      dropResult?.username == null &&
      dropResult?.recipient == null &&
      dropResult?.collector == null,
    observedRecipientCollection: !!collectionObservation,
    yieldedAfterConsequence: !!yieldTurn,
    ...resume,
  };
}

function analyzeRecipient(
  resident: HandoffResidentEvidence,
  _giverId: string,
  input: HandoffEvidenceInput,
) {
  const actTurns = eventData(resident.actEvents, 'entity_turn');
  const actModelTurns = eventData(resident.actEvents, 'model_turn');
  const collectionTurn = actTurns.find(
    (turn) =>
      turn?.action?.name === 'move_to' &&
      turn?.action?.source === 'llm' &&
      turn?.outcome?.ok === true &&
      observationInventoryCount(turn?.observation, input.item) === 0 &&
      observationInventoryCount(turn?.nextObservation, input.item) === 1 &&
      observationHasEvent(turn?.nextObservation, 'item_collected', (event) =>
        String(event?.data?.item || '').includes(input.item),
      ),
  );
  const moveDecision = collectionTurn
    ? actModelTurns.find((turn) => decisionMatchesEntityTurn(turn, collectionTurn))
    : null;
  const collectionObservation = allObservations(resident.actEvents).find(
    (observation) =>
      observationInventoryCount(observation, input.item) === 1 &&
      observationHasEvent(observation, 'item_collected', (event) =>
        String(event?.data?.item || '').includes(input.item),
      ),
  );
  const yieldTurn = actTurns.find(
    (turn) =>
      turn?.action?.name === 'wait_for_event' &&
      observationInventoryCount(turn?.observation, input.item) === 1 &&
      observationHasEvent(turn?.observation, 'item_collected'),
  );
  const resume = restartAnalysis(resident, input, 1, ['move_to', 'drop_item']);
  return {
    moveDecision,
    collectionTurn,
    collectionObservation,
    yieldTurn,
    freelyChoseMove:
      moveDecision?.intent?.source === 'llm' &&
      moveDecision?.intent?.tool === 'move_to' &&
      moveDecision?.call?.request?.toolChoice === 'auto',
    observedOwnCollection: !!collectionObservation,
    yieldedAfterConsequence: !!yieldTurn,
    ...resume,
  };
}

function restartAnalysis(
  resident: HandoffResidentEvidence,
  input: HandoffEvidenceInput,
  expectedInventory: number,
  repeatedActions: readonly string[],
) {
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
  const ownMarker = resident.role === 'giver' ? 'nearby_player_collected_item' : 'item_collected';
  return {
    restartStarted: started,
    restartFirstDecision: firstDecision,
    restartFirstTurn: firstTurn,
    restartPrompt: prompt,
    restartPreservedOwnSide:
      started?.runId === input.resumeRunId &&
      started?.model === resident.model &&
      started?.task === resident.task &&
      Number(started?.priorEntityTurns) >= 1 &&
      prompt?.circle?.id === input.worldId &&
      prompt?.circle?.managedRunId === input.resumeRunId &&
      prompt?.self?.identity === resident.entityId &&
      observationInventoryCount(prompt, input.item) === expectedInventory &&
      requestText.includes(ownMarker) &&
      requestText.includes(input.item),
    restartDidNotRepeat:
      firstDecision?.call?.request?.toolChoice === 'auto' &&
      ['inspect_volume', 'wait_for_event'].includes(action) &&
      !repeatedActions.includes(action),
  };
}

function allObservations(events: readonly RunJournalEvent[]) {
  const modelObservations = eventData(events, 'model_turn').flatMap((turn) => {
    const prompted = promptedObservation(turn?.call?.request?.body);
    return [turn?.observation, prompted].filter(Boolean);
  });
  const entityObservations = eventData(events, 'entity_turn').flatMap((turn) =>
    [turn?.observation, turn?.nextObservation].filter(Boolean),
  );
  return [...modelObservations, ...entityObservations];
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
