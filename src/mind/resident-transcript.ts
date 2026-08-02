import { createHash } from 'node:crypto';
import type { EntityTurn, EntityTurnCanonicalBinding } from '../entity/loom';

export const RESIDENT_CONTINUOUS_TRANSCRIPT_PROTOCOL =
  'behold.resident-continuous-transcript.v1' as const;
export const RESIDENT_CONTEXT_EPOCH_PROTOCOL = 'behold.resident-context-epoch.v1' as const;
export const RESIDENT_PRIVATE_LIFE_PAGE_PROTOCOL = 'behold.resident-private-life-page.v1' as const;
/** Resident-v4 treatment constant, selected from the retained Qwen camera latency curve. */
export const DEFAULT_RESIDENT_CONTEXT_EPOCH_TURNS = 8;

export type ResidentTranscriptMessage = Readonly<{
  role: 'user' | 'assistant';
  content: string;
}>;

export type ResidentTranscriptProjection = Readonly<{
  protocol: typeof RESIDENT_CONTINUOUS_TRANSCRIPT_PROTOCOL;
  entityId: string;
  throughTurn: number;
  messages: readonly ResidentTranscriptMessage[];
}>;

export type ResidentContextEpoch = Readonly<{
  protocol: typeof RESIDENT_CONTEXT_EPOCH_PROTOCOL;
  entityId: string;
  epoch: number;
  epochTurns: number;
  /** Canonical turn immediately before this finite-context treatment began. */
  originArchivedThroughTurn: number;
  activeFromTurn: number | null;
  activeThroughTurn: number | null;
  archivedThroughTurn: number;
  archivedBoundary: Readonly<{
    throughTurn: number;
    source: EntityTurnCanonicalBinding;
  }> | null;
  reason: 'operational_context_latency';
  messages: readonly ResidentTranscriptMessage[];
}>;

export function residentCurrentExperienceMessage(observation: unknown): ResidentTranscriptMessage {
  return deepFreeze({
    role: 'user',
    content: `What you experience:\n${stableJson(observation)}`,
  });
}

export function residentContextEpochBoundaryMessage(
  epoch: Omit<ResidentContextEpoch, 'messages'>,
): ResidentTranscriptMessage {
  return deepFreeze({
    role: 'user',
    content: [
      'Your active inference context has entered a new explicit epoch.',
      stableJson({
        protocol: epoch.protocol,
        entityId: epoch.entityId,
        epoch: epoch.epoch,
        epochTurns: epoch.epochTurns,
        originArchivedThroughTurn: epoch.originArchivedThroughTurn,
        activeBeginsAtTurn: epoch.activeFromTurn ?? epoch.archivedThroughTurn + 1,
        immediateHandoffTurn:
          epoch.archivedThroughTurn > epoch.originArchivedThroughTurn ? epoch.activeFromTurn : null,
        archivedThroughTurn: epoch.archivedThroughTurn,
        reason: epoch.reason,
        completePrivateLife: {
          canonical: true,
          archivedBoundary: epoch.archivedBoundary,
          availableTurns:
            epoch.archivedThroughTurn > 0 ? { start: 1, end: epoch.archivedThroughTurn } : null,
          access: 'read_private_life',
          representation: 'exact chronological pages; no summary or relevance selection',
        },
      }),
    ].join('\n'),
  });
}

/**
 * Project the active suffix of a deterministic resident-visible context epoch.
 * `turns` must be the complete active suffix, never a selected subset.
 */
export function projectResidentContextEpoch(
  entityId: string,
  totalTurns: number,
  turns: readonly EntityTurn[],
  options: ProjectionOptions &
    Readonly<{
      epochTurns?: number;
      originArchivedThroughTurn?: number;
      archivedBoundary?: Readonly<{
        throughTurn: number;
        source: EntityTurnCanonicalBinding;
      }> | null;
    }> = {},
): ResidentContextEpoch {
  const epochTurns = boundedEpochTurns(options.epochTurns);
  if (!Number.isSafeInteger(totalTurns) || totalTurns < 0) {
    throw new Error('resident context epoch totalTurns must be a non-negative integer');
  }
  const originArchivedThroughTurn = options.originArchivedThroughTurn ?? 0;
  if (
    !Number.isSafeInteger(originArchivedThroughTurn) ||
    originArchivedThroughTurn < 0 ||
    originArchivedThroughTurn > totalTurns
  ) {
    throw new Error('resident context epoch origin must be a canonical turn in this life');
  }
  const turnsAfterOrigin = totalTurns - originArchivedThroughTurn;
  const archivedThroughTurn =
    originArchivedThroughTurn + Math.floor(turnsAfterOrigin / epochTurns) * epochTurns;
  const archivedBoundary = options.archivedBoundary ?? null;
  if (archivedThroughTurn === 0 && archivedBoundary !== null) {
    throw new Error('resident context epoch has no archived boundary before its first epoch');
  }
  if (
    archivedThroughTurn > 0 &&
    (archivedBoundary?.throughTurn !== archivedThroughTurn ||
      archivedBoundary.source.protocol !== 'lync.file-loom-chain.v1' ||
      !/^[a-f0-9]{64}$/.test(archivedBoundary.source.digest))
  ) {
    throw new Error(
      `resident context epoch requires the canonical binding at archived turn ${archivedThroughTurn}`,
    );
  }
  // The last archived turn remains as an exact causal handoff. Otherwise a
  // boundary immediately after an action would hide that action's result from
  // the very next decision. Requests still carry at most `epochTurns` prior
  // turns: one handoff plus at most epochTurns - 1 newly committed turns.
  const activeFromTurn =
    turnsAfterOrigin === 0
      ? null
      : archivedThroughTurn > originArchivedThroughTurn
        ? archivedThroughTurn
        : originArchivedThroughTurn + 1;
  const expectedCount = activeFromTurn == null ? 0 : totalTurns - activeFromTurn + 1;
  if (turns.length !== expectedCount) {
    throw new Error(
      `resident context epoch requires ${expectedCount} active turns, received ${turns.length}`,
    );
  }
  const messages: ResidentTranscriptMessage[] = [];
  let previousId =
    activeFromTurn == null || activeFromTurn === 1
      ? null
      : `${entityId}:turn:${activeFromTurn - 1}`;
  for (let index = 0; index < turns.length; index += 1) {
    const expectedSequence = activeFromTurn! + index;
    assertTranscriptTurn(turns[index], entityId, expectedSequence, previousId);
    messages.push(...projectResidentTranscriptTurn(turns[index], options));
    previousId = turns[index].id;
  }
  const base = {
    protocol: RESIDENT_CONTEXT_EPOCH_PROTOCOL,
    entityId,
    epoch: Math.floor(turnsAfterOrigin / epochTurns) + 1,
    epochTurns,
    originArchivedThroughTurn,
    activeFromTurn,
    activeThroughTurn: turnsAfterOrigin === 0 ? null : totalTurns,
    archivedThroughTurn,
    archivedBoundary,
    reason: 'operational_context_latency' as const,
  };
  return deepFreeze({
    ...base,
    messages:
      archivedThroughTurn > 0 ? [residentContextEpochBoundaryMessage(base), ...messages] : messages,
  });
}

export function residentPrivateLifePageMessage(page: unknown): ResidentTranscriptMessage {
  return deepFreeze({
    role: 'user',
    content: `What your private life returned:\n${stableJson(page)}`,
  });
}

/** Fail closed when any explicit epoch/page identity on a chronological wire is foreign. */
export function assertResidentChronologicalWireOwner(
  messagesValue: unknown,
  residentIdentity: string,
  allowCompactPrivatePages = false,
) {
  if (!Array.isArray(messagesValue)) throw new Error('resident chronological wire is not an array');
  for (const message of messagesValue) {
    const content = (message as any)?.content;
    if (typeof content !== 'string') continue;
    if (content.startsWith('Your active inference context has entered a new explicit epoch.\n')) {
      const epoch = parseMessageJson(content, 'resident context epoch');
      assertContextEpochBoundary(epoch, residentIdentity);
    } else if (content.startsWith('What your private life returned:\n')) {
      const outcome = parseMessageJson(content, 'resident private-life page');
      const page = outcome?.result;
      assertPrivateLifePage(outcome, page, residentIdentity, allowCompactPrivatePages);
      if (Array.isArray(page?.messages)) {
        assertResidentChronologicalWireOwner(page.messages, residentIdentity, true);
      }
    } else if (content.startsWith('What you experience:\n')) {
      const observation = parseMessageJson(content, 'resident experience');
      if (observation?.self?.identity != null && observation.self.identity !== residentIdentity) {
        throw new Error('resident experience belongs to another resident');
      }
    }
  }
}

function assertContextEpochBoundary(epoch: any, residentIdentity: string) {
  assertExactKeys(
    epoch,
    [
      'protocol',
      'entityId',
      'epoch',
      'epochTurns',
      'originArchivedThroughTurn',
      'activeBeginsAtTurn',
      'immediateHandoffTurn',
      'archivedThroughTurn',
      'reason',
      'completePrivateLife',
    ],
    'resident context epoch',
  );
  if (epoch?.protocol !== RESIDENT_CONTEXT_EPOCH_PROTOCOL || epoch?.entityId !== residentIdentity) {
    throw new Error('resident context epoch belongs to another resident');
  }
  for (const [label, value, minimum] of [
    ['epoch', epoch.epoch, 1],
    ['epochTurns', epoch.epochTurns, 1],
    ['originArchivedThroughTurn', epoch.originArchivedThroughTurn, 0],
    ['archivedThroughTurn', epoch.archivedThroughTurn, 0],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < minimum) {
      throw new Error(`resident context epoch has invalid ${label}`);
    }
  }
  if (
    epoch.archivedThroughTurn < epoch.originArchivedThroughTurn ||
    epoch.reason !== 'operational_context_latency' ||
    (epoch.archivedThroughTurn - epoch.originArchivedThroughTurn) % epoch.epochTurns !== 0 ||
    epoch.epoch !==
      (epoch.archivedThroughTurn - epoch.originArchivedThroughTurn) / epoch.epochTurns + 1
  ) {
    throw new Error('resident context epoch has inconsistent bounds');
  }
  const expectedActive =
    epoch.archivedThroughTurn > epoch.originArchivedThroughTurn
      ? epoch.archivedThroughTurn
      : epoch.archivedThroughTurn + 1;
  if (
    epoch.activeBeginsAtTurn !== expectedActive ||
    epoch.immediateHandoffTurn !==
      (epoch.archivedThroughTurn > epoch.originArchivedThroughTurn ? expectedActive : null)
  ) {
    throw new Error('resident context epoch has inconsistent active handoff');
  }
  const life = epoch.completePrivateLife;
  assertExactKeys(
    life,
    ['canonical', 'archivedBoundary', 'availableTurns', 'access', 'representation'],
    'resident context epoch private life',
  );
  const expectedAvailable =
    epoch.archivedThroughTurn > 0 ? { start: 1, end: epoch.archivedThroughTurn } : null;
  if (
    life?.canonical !== true ||
    life?.access !== 'read_private_life' ||
    life?.representation !== 'exact chronological pages; no summary or relevance selection' ||
    stableJson(life?.availableTurns ?? null) !== stableJson(expectedAvailable)
  ) {
    throw new Error('resident context epoch has an invalid private-life catalog');
  }
  const boundary = life.archivedBoundary;
  if (epoch.archivedThroughTurn > 0) {
    assertExactKeys(boundary, ['throughTurn', 'source'], 'resident context epoch boundary');
    assertExactKeys(
      boundary?.source,
      ['protocol', 'digest'],
      'resident context epoch boundary source',
    );
    if (
      boundary?.throughTurn !== epoch.archivedThroughTurn ||
      boundary?.source?.protocol !== 'lync.file-loom-chain.v1' ||
      !isSha256(boundary?.source?.digest)
    ) {
      throw new Error('resident context epoch has an invalid canonical boundary');
    }
  } else if (boundary !== null) {
    throw new Error('resident context epoch has an unexpected canonical boundary');
  }
  if (expectedAvailable !== null) {
    assertExactKeys(
      life.availableTurns,
      ['start', 'end'],
      'resident context epoch available range',
    );
  }
}

function assertPrivateLifePage(
  outcome: any,
  page: any,
  residentIdentity: string,
  allowCompact: boolean,
) {
  assertExactKeys(
    outcome,
    outcome?.ok === true ? ['ok', 'eventType', 'result'] : ['ok', 'eventType', 'result', 'error'],
    'resident private-life outcome',
  );
  if (
    page?.protocol !== RESIDENT_PRIVATE_LIFE_PAGE_PROTOCOL ||
    page?.entityId !== residentIdentity
  ) {
    throw new Error('resident private-life page belongs to another resident');
  }
  if (
    !Number.isSafeInteger(page?.requested?.startSequence) ||
    !Number.isSafeInteger(page?.requested?.endSequence) ||
    page.requested.startSequence < 1 ||
    page.requested.endSequence < page.requested.startSequence
  ) {
    throw new Error('resident private-life page has an invalid requested range');
  }
  if (outcome?.ok !== true || outcome?.eventType !== 'private_life_page_returned') {
    assertExactKeys(
      page,
      ['protocol', 'entityId', 'requested', 'complete', 'messages'],
      'failed resident private-life page',
    );
    assertExactKeys(page?.requested, ['startSequence', 'endSequence'], 'private-life request');
    if (
      outcome?.ok !== false ||
      outcome?.eventType !== 'private_life_page_failed' ||
      !Array.isArray(page.messages) ||
      page.messages.length !== 0
    ) {
      throw new Error('resident private-life page has an invalid terminal');
    }
    return;
  }
  assertExactKeys(
    page,
    [
      'protocol',
      'entityId',
      'life',
      'selectedTip',
      'requested',
      'returned',
      'sources',
      'sourceBytes',
      'projectedBytes',
      'messageCount',
      'messagesSha256',
      'complete',
      'nextSequence',
      ...(Object.hasOwn(page, 'messages') ? ['messages'] : []),
    ],
    'resident private-life page',
  );
  assertExactKeys(page.life, ['v', 'kind', 'loomId'], 'resident private-life reference');
  assertExactKeys(
    page.selectedTip,
    ['turn', 'sequence', 'chainDigest'],
    'resident private-life selected tip',
  );
  assertExactKeys(
    page.selectedTip?.turn,
    ['v', 'kind', 'loomId', 'turnId'],
    'resident private-life selected turn',
  );
  assertExactKeys(page.requested, ['startSequence', 'endSequence'], 'private-life request');
  assertExactKeys(page.returned, ['startSequence', 'endSequence'], 'private-life returned range');
  if (
    page?.life?.v !== 1 ||
    page?.life?.kind !== 'loom' ||
    typeof page?.life?.loomId !== 'string' ||
    page?.selectedTip?.turn?.v !== 1 ||
    page?.selectedTip?.turn?.kind !== 'turn' ||
    page?.selectedTip?.turn?.loomId !== page.life.loomId ||
    typeof page?.selectedTip?.turn?.turnId !== 'string' ||
    !Number.isSafeInteger(page?.selectedTip?.sequence) ||
    page.selectedTip.sequence < page.requested.endSequence ||
    !isSha256(page?.selectedTip?.chainDigest)
  ) {
    throw new Error('resident private-life page has an invalid selected life');
  }
  const sources = page.sources;
  if (!Array.isArray(sources) || sources.length < 1) {
    throw new Error('resident private-life page has no canonical sources');
  }
  for (let index = 0; index < sources.length; index += 1) {
    assertExactKeys(sources[index], ['sequence', 'source'], 'private-life source');
    assertExactKeys(
      sources[index]?.source,
      ['protocol', 'digest'],
      'private-life canonical source',
    );
    const expected = page.returned?.startSequence + index;
    if (
      sources[index]?.sequence !== expected ||
      sources[index]?.source?.protocol !== 'lync.file-loom-chain.v1' ||
      !isSha256(sources[index]?.source?.digest)
    ) {
      throw new Error('resident private-life page has inconsistent canonical sources');
    }
  }
  if (
    page.returned?.startSequence !== sources[0].sequence ||
    page.returned?.endSequence !== sources.at(-1).sequence ||
    page.returned.startSequence < page.requested.startSequence ||
    page.returned.endSequence > page.requested.endSequence ||
    !Number.isSafeInteger(page.sourceBytes) ||
    page.sourceBytes < 2 ||
    !Number.isSafeInteger(page.projectedBytes) ||
    page.projectedBytes < 2 ||
    !Number.isSafeInteger(page.messageCount) ||
    page.messageCount < 1 ||
    !isSha256(page.messagesSha256) ||
    typeof page.complete !== 'boolean' ||
    (page.complete
      ? page.nextSequence !== null || page.returned.endSequence !== page.requested.endSequence
      : page.nextSequence !== page.returned.endSequence + 1)
  ) {
    throw new Error('resident private-life page has inconsistent coverage');
  }
  if (!Array.isArray(page.messages)) {
    if (!allowCompact) throw new Error('resident private-life page omitted its bound messages');
    return;
  }
  if (
    page.messages.length !== page.messageCount ||
    Buffer.byteLength(JSON.stringify(page.messages), 'utf8') !== page.projectedBytes ||
    sha256(stableJson(page.messages)) !== page.messagesSha256
  ) {
    throw new Error('resident private-life page content binding changed');
  }
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function assertExactKeys(value: unknown, expected: readonly string[], label: string) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  const actual = Object.keys(value as Record<string, unknown>).sort();
  const wanted = [...expected].sort();
  if (stableJson(actual) !== stableJson(wanted)) {
    throw new Error(`${label} fields differ from the versioned schema`);
  }
}

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function parseMessageJson(content: string, label: string): any {
  const newline = content.indexOf('\n');
  if (newline < 0) throw new Error(`${label} is missing JSON`);
  try {
    return JSON.parse(content.slice(newline + 1));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

type ProjectionOptions = Readonly<{
  projectObservation?: (observation: any, turn: EntityTurn) => any;
  projectValue?: (value: any) => any;
  /** Rehydrate a controller-owned cognitive outcome without changing canonical bytes. */
  projectOutcome?: (turn: EntityTurn) => EntityTurn['outcome'];
  mayReplayTurn?: (turn: EntityTurn) => boolean;
}>;

/**
 * Reconstruct one resident's chronological model conversation from canonical
 * turns. Provider syntax and controller bookkeeping remain outside this seam.
 */
export function projectResidentTranscript(
  entityId: string,
  turns: readonly EntityTurn[],
  options: ProjectionOptions = {},
): ResidentTranscriptProjection {
  const messages: ResidentTranscriptMessage[] = [];
  let expectedSequence = 1;
  let parentId: string | null = null;

  for (const turn of turns) {
    assertTranscriptTurn(turn, entityId, expectedSequence, parentId);
    messages.push(...projectResidentTranscriptTurn(turn, options));
    expectedSequence += 1;
    parentId = turn.id;
  }

  return deepFreeze({
    protocol: RESIDENT_CONTINUOUS_TRANSCRIPT_PROTOCOL,
    entityId,
    throughTurn: expectedSequence - 1,
    messages,
  });
}

export function projectResidentTranscriptTurn(
  turn: EntityTurn,
  options: ProjectionOptions = {},
): readonly ResidentTranscriptMessage[] {
  const projectValue = options.projectValue ?? cloneJson;
  const projectedOutcome = options.projectOutcome?.(turn) ?? turn.outcome;
  const admittedObservation = turn.observationPresentation?.observation;
  const observation = admittedObservation
    ? cloneJson(admittedObservation)
    : (options.projectObservation ?? ((value) => cloneJson(value)))(turn.observation, turn);
  const experience: ResidentTranscriptMessage = {
    role: 'user',
    content: `What you experience:\n${stableJson(observation)}`,
  };

  if (options.mayReplayTurn?.(turn) === false || turn.action.source !== 'llm') {
    return deepFreeze([
      experience,
      {
        role: 'user',
        content: `What happened through ${turn.action.source} control:\n${stableJson({
          action: {
            name: turn.action.name,
            ...(options.mayReplayTurn?.(turn) === false
              ? { inputUnavailable: true }
              : { arguments: projectValue(turn.action.input) }),
          },
          outcome: projectValue(projectedOutcome),
        })}`,
      },
    ]);
  }

  const canonicalChoice = stableJson({
    action: turn.action.name,
    arguments: projectValue(turn.action.input),
  });
  const retainedContent = turn.utterance?.assistant?.content;
  const assistantContent =
    typeof retainedContent === 'string' && retainedContent.length > 0
      ? exactResidentChoice(
          retainedContent,
          stableJson({ action: turn.action.name, arguments: turn.action.input }),
          turn.sequence,
        )
      : canonicalChoice;

  return deepFreeze([
    experience,
    {
      role: 'assistant',
      content: assistantContent,
    },
    {
      role: 'user',
      content:
        turn.action.name === 'read_private_life'
          ? `What your private life returned:\n${stableJson(cloneJson(projectedOutcome))}`
          : `What Minecraft returned after your ${turn.action.name} attempt:\n${stableJson(
              projectValue(projectedOutcome),
            )}`,
    },
  ]);
}

function boundedEpochTurns(value: unknown) {
  const turns = Number(value ?? DEFAULT_RESIDENT_CONTEXT_EPOCH_TURNS);
  if (!Number.isSafeInteger(turns) || turns < 1 || turns > 256) {
    throw new Error('resident context epoch turns must be an integer from 1 through 256');
  }
  return turns;
}

function exactResidentChoice(content: string, canonicalChoice: string, sequence: number) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`continuous resident transcript turn ${sequence} retained malformed response`);
  }
  if (stableJson(parsed) !== canonicalChoice) {
    throw new Error(
      `continuous resident transcript turn ${sequence} response differs from committed action`,
    );
  }
  return content;
}

function assertTranscriptTurn(
  turn: EntityTurn,
  entityId: string,
  expectedSequence: number,
  parentId: string | null,
) {
  if (turn.protocol !== 'behold.entity-turn.v1') {
    throw new Error('continuous resident transcript requires entity-turn v1');
  }
  if (turn.entityId !== entityId) {
    throw new Error(
      `continuous resident transcript expected ${entityId}, received ${turn.entityId}`,
    );
  }
  if (turn.sequence !== expectedSequence || turn.id !== `${entityId}:turn:${expectedSequence}`) {
    throw new Error(`continuous resident transcript is not contiguous at turn ${expectedSequence}`);
  }
  if (turn.parentId !== parentId) {
    throw new Error(`continuous resident transcript parent mismatch at turn ${expectedSequence}`);
  }
}

function stableJson(value: unknown) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: any): any {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortValue(value[key])]),
  );
}

function cloneJson(value: any): any {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}
