export type RunJournalEvent = Readonly<{
  sequence: number;
  at: string;
  agent: string;
  type: string;
  data: any;
}>;

export type OwnedWorldModelEvidenceExpectation = Readonly<{
  worldId: string;
  entityId: string;
  model: string;
  task: string;
  actRunId: string;
  resumeRunId: string;
}>;

export type IndependentWorldWitness = Readonly<{
  entityId: string;
  worldId: string;
  managedRunId: string;
  source: 'fresh_minecraft_connection';
  observedAt: number;
  droppedItems: readonly Readonly<{ name: string; count: number }>[];
}>;

export function assessOwnedWorldModelEvidence(
  actEvents: readonly RunJournalEvent[],
  resumeEvents: readonly RunJournalEvent[],
  witness: IndependentWorldWitness,
  expected: OwnedWorldModelEvidenceExpectation,
) {
  const actStarted = eventData(actEvents, 'run_started')[0] ?? null;
  const resumeStarted = eventData(resumeEvents, 'run_started')[0] ?? null;
  const actModelTurns = eventData(actEvents, 'model_turn');
  const resumeModelTurns = eventData(resumeEvents, 'model_turn');
  const actEntityTurns = eventData(actEvents, 'entity_turn');
  const resumeEntityTurns = eventData(resumeEvents, 'entity_turn');
  const actFailures = eventData(actEvents, 'model_call_failed');
  const resumeFailures = eventData(resumeEvents, 'model_call_failed');
  const collectionTurn = actEntityTurns.find(
    (turn) => turn?.action?.name === 'collect_nearby_item' && turn?.action?.source === 'llm',
  );
  const collectionDecision = collectionTurn
    ? actModelTurns.find((turn) => decisionMatchesEntityTurn(turn, collectionTurn))
    : null;
  const collectionIndex = actEntityTurns.indexOf(collectionTurn);
  const actYieldTurn = collectionIndex >= 0 ? (actEntityTurns[collectionIndex + 1] ?? null) : null;
  const actYieldDecision = actYieldTurn
    ? actModelTurns.find((turn) => decisionMatchesEntityTurn(turn, actYieldTurn))
    : null;
  const resumeFirstTurn = resumeEntityTurns[0] ?? null;
  const resumeFirstDecision = resumeFirstTurn
    ? resumeModelTurns.find((turn) => decisionMatchesEntityTurn(turn, resumeFirstTurn))
    : (resumeModelTurns[0] ?? null);
  const resumeActionName = decisionActionName(resumeFirstDecision) ?? resumeFirstTurn?.action?.name;
  const collectionResult = terminalMinecraftResult(collectionTurn);
  const actPromptObservation = promptedObservation(collectionDecision?.call?.request?.body);
  const resumePromptObservation = promptedObservation(resumeFirstDecision?.call?.request?.body);
  const resumeRequestBody = resumeFirstDecision?.call?.request?.body;
  const resumeRequestText = JSON.stringify(resumeRequestBody ?? null);
  const calls = [...actModelTurns, ...resumeModelTurns]
    .map((turn) => turn?.call)
    .filter((call) => call?.protocol === 'behold.model-call.v1');
  const usage = summarizeUsage(calls);

  const assertions = {
    productionModelRan:
      calls.length >= 2 &&
      calls.every(
        (call) =>
          call?.request?.model === expected.model &&
          typeof call?.response?.id === 'string' &&
          call.response.id.length > 0,
      ),
    firstLifeStartedWithoutPriorTurns:
      actStarted?.runId === expected.actRunId &&
      actStarted?.model === expected.model &&
      actStarted?.task === expected.task &&
      Number(actStarted?.priorEntityTurns) === 0,
    modelReceivedBoundedOwnedObservation:
      actPromptObservation?.protocol === 'behold.inhabitant.v1' &&
      actPromptObservation?.circle?.id === expected.worldId &&
      actPromptObservation?.circle?.managedRunId === expected.actRunId &&
      actPromptObservation?.self?.identity === expected.entityId &&
      Array.isArray(actPromptObservation?.events) &&
      actPromptObservation.events.length <= 12 &&
      Number(actPromptObservation?.eventWindow?.omittedNewEvents ?? 0) >= 0,
    modelFreelyChoseCollection:
      collectionDecision?.intent?.source === 'llm' &&
      collectionDecision?.intent?.tool === 'collect_nearby_item' &&
      collectionDecision?.call?.request?.toolChoice === 'auto',
    minecraftConfirmedCollection:
      collectionTurn?.outcome?.ok === true &&
      collectionTurn?.outcome?.eventType === 'action_completed' &&
      collectionResult?.ok === true &&
      collectionResult?.item === 'apple' &&
      collectionResult?.confirmation === 'mineflayer:playerCollect',
    firstLifeYieldedAfterConsequence:
      actYieldTurn?.action?.name === 'wait_for_event' &&
      decisionActionName(actYieldDecision) === 'wait_for_event' &&
      actYieldDecision?.call?.request?.toolChoice === 'auto',
    independentMinecraftBodySawConsequence:
      witness.source === 'fresh_minecraft_connection' &&
      witness.worldId === expected.worldId &&
      witness.managedRunId === expected.actRunId &&
      !witness.droppedItems.some((item) => item.name === 'apple'),
    restartedAsSamePersistentEntity:
      resumeStarted?.runId === expected.resumeRunId &&
      resumeStarted?.model === expected.model &&
      resumeStarted?.task === expected.task &&
      Number(resumeStarted?.priorEntityTurns) >= 1 &&
      resumePromptObservation?.circle?.id === expected.worldId &&
      resumePromptObservation?.circle?.managedRunId === expected.resumeRunId &&
      resumePromptObservation?.self?.identity === expected.entityId,
    restartObservedPersistedConsequence:
      inventoryCount(resumePromptObservation, 'apple') === 1 &&
      !sceneHasItem(resumePromptObservation, 'apple'),
    collectionRemainedInActionSpace:
      requestToolNames(resumeRequestBody).includes('collect_nearby_item'),
    restartFreelyChoseNotToRepeat:
      resumeFirstDecision?.call?.request?.toolChoice === 'auto' &&
      ['inspect_volume', 'wait_for_event'].includes(String(resumeActionName)) &&
      resumeActionName !== 'collect_nearby_item',
    restartPromptCarriedOwnConsequences:
      resumeRequestBody != null &&
      resumeRequestText.includes('collect_nearby_item') &&
      resumeRequestText.includes('mineflayer:playerCollect') &&
      resumeRequestText.includes('apple'),
    noModelCallFailed: actFailures.length === 0 && resumeFailures.length === 0,
    usageRecorded: usage.callCount >= 2 && usage.totalTokens > 0 && usage.totalLatencyMs >= 0,
  };
  const failed = Object.entries(assertions)
    .filter(([, value]) => !value)
    .map(([name]) => name);

  return {
    assertions,
    failed,
    act: {
      runStarted: actStarted,
      modelTurns: actModelTurns,
      entityTurns: actEntityTurns,
      collectionDecision,
      collectionTurn,
      promptObservation: actPromptObservation,
      yieldDecision: actYieldDecision,
      yieldTurn: actYieldTurn,
      modelFailures: actFailures,
    },
    resume: {
      runStarted: resumeStarted,
      modelTurns: resumeModelTurns,
      entityTurns: resumeEntityTurns,
      firstDecision: resumeFirstDecision,
      firstTurn: resumeFirstTurn,
      firstActionName: resumeActionName ?? null,
      promptObservation: resumePromptObservation,
      modelFailures: resumeFailures,
    },
    usage,
  };
}

export function parseRunJournal(text: string): RunJournalEvent[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        throw new Error(`run journal line ${index + 1} is not JSON`);
      }
      if (
        !Number.isSafeInteger(event?.sequence) ||
        event.sequence !== index + 1 ||
        typeof event?.type !== 'string' ||
        typeof event?.agent !== 'string'
      ) {
        throw new Error(`run journal line ${index + 1} has an invalid envelope`);
      }
      return event as RunJournalEvent;
    });
}

export function hasSuccessfulModelCollection(events: readonly RunJournalEvent[]) {
  return eventData(events, 'entity_turn').some((turn) => {
    const result = terminalMinecraftResult(turn);
    return (
      turn?.action?.source === 'llm' &&
      turn?.action?.name === 'collect_nearby_item' &&
      turn?.outcome?.ok === true &&
      result?.ok === true &&
      result?.confirmation === 'mineflayer:playerCollect'
    );
  });
}

export function hasCollectionFollowedByYield(events: readonly RunJournalEvent[]) {
  const turns = eventData(events, 'entity_turn');
  const index = turns.findIndex((turn) => {
    const result = terminalMinecraftResult(turn);
    return (
      turn?.action?.source === 'llm' &&
      turn?.action?.name === 'collect_nearby_item' &&
      turn?.outcome?.ok === true &&
      result?.ok === true &&
      result?.confirmation === 'mineflayer:playerCollect'
    );
  });
  return index >= 0 && turns[index + 1]?.action?.name === 'wait_for_event';
}

export function hasFirstRestartTurn(events: readonly RunJournalEvent[]) {
  return eventData(events, 'entity_turn').length >= 1;
}

function eventData(events: readonly RunJournalEvent[], type: string) {
  return events.filter((event) => event.type === type).map((event) => event.data);
}

function decisionMatchesEntityTurn(decision: any, turn: any) {
  const intentId = String(decision?.intent?.id || '');
  const actionId = String(turn?.action?.id || '');
  if (intentId && intentId === actionId) return true;
  const callId = String(decision?.assistant?.tool_calls?.[0]?.id || '');
  const toolCallId = String(turn?.action?.toolCallId || '');
  return !!callId && callId === toolCallId;
}

function decisionActionName(decision: any) {
  return (decision?.intent?.tool ??
    decision?.assistant?.tool_calls?.[0]?.function?.name ??
    null) as string | null;
}

function terminalMinecraftResult(turn: any) {
  const result = turn?.outcome?.result;
  if (result?.result && typeof result.result === 'object') return result.result;
  return result;
}

function inventoryCount(observation: any, name: string) {
  return (Array.isArray(observation?.self?.inventory) ? observation.self.inventory : [])
    .filter((item: any) => String(item?.name) === name)
    .reduce((sum: number, item: any) => sum + Math.max(0, Number(item?.count) || 0), 0);
}

function sceneHasItem(observation: any, name: string) {
  return (Array.isArray(observation?.scene?.entities) ? observation.scene.entities : []).some(
    (entity: any) =>
      String(entity?.kind || entity?.type || '').toLowerCase() === 'item' &&
      String(entity?.name || '').toLowerCase() === name.toLowerCase(),
  );
}

function requestToolNames(body: any) {
  return (Array.isArray(body?.tools) ? body.tools : [])
    .map((tool: any) => String(tool?.function?.name || ''))
    .filter(Boolean);
}

function promptedObservation(body: any) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  for (const message of [...messages].reverse()) {
    if (message?.role !== 'user' || typeof message?.content !== 'string') continue;
    const marker = 'world experience:\n';
    const start = message.content.indexOf(marker);
    const end = message.content.lastIndexOf('\nPrevious action:');
    if (start < 0 || end <= start) continue;
    try {
      return JSON.parse(message.content.slice(start + marker.length, end));
    } catch {
      return null;
    }
  }
  return null;
}

function summarizeUsage(calls: readonly any[]) {
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let totalCost = 0;
  let callsWithCost = 0;
  let totalLatencyMs = 0;
  for (const call of calls) {
    const usage = call?.response?.usage || {};
    promptTokens += finiteNumber(usage.prompt_tokens);
    completionTokens += finiteNumber(usage.completion_tokens);
    totalTokens += finiteNumber(usage.total_tokens);
    const cost = Number(usage.cost);
    if (Number.isFinite(cost)) {
      totalCost += cost;
      callsWithCost += 1;
    }
    totalLatencyMs += finiteNumber(call?.latencyMs);
  }
  return {
    callCount: calls.length,
    promptTokens,
    completionTokens,
    totalTokens,
    totalLatencyMs,
    totalCost: callsWithCost > 0 ? totalCost : null,
    callsWithCost,
  };
}

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
