import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { projectResidentVisibleValue, residentTurnMayReplay } from '../mind/resident-visibility';
import type { EntityTurn } from './loom';
import { projectHistoricalModelObservation } from '../mind/observation-context';

const FOLD_EVENT_BATCH = 24;

export type LoomFoldRecord = {
  protocol: 'behold.loom-fold.v3' | 'behold.loom-fold.v4';
  entityId: string;
  source: {
    fromSequence: number;
    toSequence: number;
    tipId: string;
    turnCount: number;
    /** v4 cursor-authenticated digest of the exact canonical chain at this tip. */
    canonicalChainDigest?: string;
    canonicalChainProtocol?: string;
  };
  summary: string;
  generatedAt: number;
  model: string;
  /** Projection identity prevents a cache from crossing embodied input contracts. */
  projectionProfile?: string;
  /** Summarizer identity prevents a disposable cache from crossing generation contracts. */
  summarizerProtocol?: string;
  generation:
    | {
        kind: 'model';
        source: 'configured_summarizer';
        sourceSha256: string;
        summarySha256: string;
      }
    | {
        kind: 'canonical_index';
        source: 'deterministic-canonical-anchors-v1' | 'deterministic-canonical-anchors-v2';
        sourceSha256: string;
        summarySha256: string;
      }
    | {
        kind: 'fallback';
        source: 'deterministic-source-anchors-v1' | 'deterministic-canonical-anchors-v1';
        reason: 'summarizer_error' | 'empty_summary';
        sourceSha256: string;
        summarySha256: string;
        failure: { name: string; message: string };
      };
  /** Bounded, disposable reducer state used only by the canonical v4 fold. */
  canonicalIndex?: CanonicalAnchorIndex;
};

export type CanonicalAnchorIndex = Readonly<{
  protocol: 'behold.canonical-anchor-index.v2';
  throughSequence: number;
  tipId: string;
  /** Rolling digest of the resident-visible projection, distinct from canonical source identity. */
  projectionChainSha256: string;
  sourceChainProtocol: string;
  sourceChainDigest: string;
  dialogue: readonly string[];
  consequences: readonly string[];
  boundaries: readonly string[];
  dialogueKeys: readonly string[];
}>;

export type CanonicalTurnBinding = Readonly<{
  /** `lync.file-loom-chain.v1` for cursor-backed ordinary life. */
  protocol: string;
  digest: string;
}>;

export type BoundedCanonicalTurn = Readonly<{
  turn: EntityTurn;
  source: CanonicalTurnBinding;
}>;

export type BoundedLoomContextState = Readonly<{
  protocol: 'behold.bounded-loom-context.v1';
  entityId: string;
  totalTurns: number;
  /** Exact canonical suffix. It must end at totalTurns and is retained verbatim. */
  recentTurns: readonly EntityTurn[];
  /** Canonical bindings aligned one-for-one with recentTurns. */
  recentSources: readonly CanonicalTurnBinding[];
  /** Disposable fold candidate. v3 is read for compatibility but rebuilt as v4. */
  fold: LoomFoldRecord | null;
  /** Cursor-authenticated canonical turn and chain digest at fold.source.toSequence. */
  foldSource: Readonly<{
    tipTurn: EntityTurn;
    source: CanonicalTurnBinding;
  }> | null;
  /** Open canonical turns in order. Used only when the fold is missing or invalid. */
  rebuild: () => AsyncIterable<BoundedCanonicalTurn>;
}>;

export type LoomContextIntervention = Readonly<{
  protocol: 'behold.context-intervention.v1';
  kind: 'loom_fold_fallback';
  entityId: string;
  model: string;
  at: number;
  projectionProfile: string | null;
  source: LoomFoldRecord['source'];
  generation: Extract<LoomFoldRecord['generation'], { kind: 'fallback' }>;
}>;

export type LoomFoldRequest = {
  entityId: string;
  previousSummary: string | null;
  turns: Array<ReturnType<typeof projectTurnForFolding>>;
  fromSequence: number;
  toSequence: number;
};

export type LoomFoldSummarizer = (
  request: LoomFoldRequest,
  signal?: AbortSignal,
) => Promise<string>;

export type LoomContextView = {
  /**
   * Refresh the disposable folded view. Cancellation leaves the last
   * completed fold intact and never substitutes a synthetic summary.
   */
  prepare: (signal?: AbortSignal) => Promise<boolean>;
  append: (turn: EntityTurn, source?: CanonicalTurnBinding) => void;
  view: () => { fold: LoomFoldRecord | null; turns: EntityTurn[] };
  state: () => {
    totalTurns: number;
    foldedThrough: number;
    visibleTurns: number;
    needsFold: boolean;
  };
};

type LoomContextOptions = {
  entityId: string;
  model: string;
  summarize: LoomFoldSummarizer;
  cacheFile?: string | null;
  /** Refuse to synthesize or write a missing fold. Useful for evidence replay. */
  readOnly?: boolean;
  recentTurns?: number;
  foldBatchTurns?: number;
  foldTriggerTurns?: number;
  summaryMaxChars?: number;
  now?: () => number;
  projectionProfile?: string;
  summarizerProtocol?: string;
  /** Build only the literal canonical anchor index; never call a model summarizer. */
  canonicalOnly?: boolean;
  /** Durable operator evidence written before a fallback context can be used. */
  onContextIntervention?: (intervention: LoomContextIntervention) => void;
  projectTurn?: (
    turn: EntityTurn,
    previousTurn?: EntityTurn,
  ) => ReturnType<typeof projectTurnForFolding>;
};

/**
 * A bounded, rebuildable view over one entity's append-only loom.
 *
 * The fold is never authoritative and never mutates the source turns. A cache
 * is accepted only when its source tip still exists at the claimed sequence;
 * deleting the cache merely makes the next prepare call rebuild the view.
 */
export function createLoomContextView(
  initialTurns: EntityTurn[] | BoundedLoomContextState,
  options: LoomContextOptions,
): LoomContextView {
  if (!Array.isArray(initialTurns)) {
    return createBoundedLoomContextView(initialTurns, options);
  }
  return createArrayLoomContextView(initialTurns, options);
}

function createArrayLoomContextView(
  initialTurns: EntityTurn[],
  options: LoomContextOptions,
): LoomContextView {
  const recentTurns = integerInRange(options.recentTurns ?? 8, 1, 64);
  const foldBatchTurns = integerInRange(options.foldBatchTurns ?? 8, 1, 64);
  const foldTriggerTurns = integerInRange(
    options.foldTriggerTurns ?? Math.min(4, foldBatchTurns),
    1,
    foldBatchTurns,
  );
  const summaryMaxChars = integerInRange(options.summaryMaxChars ?? 8_000, 500, 40_000);
  const now = options.now ?? Date.now;
  validateTrajectory(initialTurns, options.entityId);
  const turns = [...initialTurns];
  let fold = loadValidFold(
    options.cacheFile,
    turns,
    options.entityId,
    options.projectionProfile,
    options.summarizerProtocol,
    options.canonicalOnly === true,
    summaryMaxChars,
  );
  let preparing: Promise<boolean> | null = null;

  function foldTarget() {
    return Math.max(0, turns.length - recentTurns);
  }

  function foldedThrough() {
    return fold?.source.toSequence ?? 0;
  }

  function shouldPrepare() {
    const pending = foldTarget() - foldedThrough();
    if (pending <= 0) return false;
    if (!fold && turns.length > recentTurns + foldTriggerTurns - 1) return true;
    return pending >= foldTriggerTurns;
  }

  async function prepare(signal?: AbortSignal) {
    throwIfAborted(signal);
    if (!shouldPrepare()) return false;
    if (options.readOnly) {
      const state = {
        totalTurns: turns.length,
        foldedThrough: foldedThrough(),
        foldTarget: foldTarget(),
      };
      throw new Error(`read-only loom context requires a current fold (${JSON.stringify(state)})`);
    }
    if (preparing) return preparing;
    preparing = performFold(signal).finally(() => {
      preparing = null;
    });
    return preparing;
  }

  async function performFold(signal?: AbortSignal) {
    const target = foldTarget();
    const cursor = foldedThrough();
    if (cursor >= target) return false;
    throwIfAborted(signal);

    // A resident can return after a long life or a changed projection contract
    // with far more canonical history than one timely model request should
    // consume. Build a truthful local index over that prefix in one pass. It is
    // deliberately less interpretive than a model summary, but it preserves
    // dialogue and material consequences instead of blocking the body or
    // manufacturing "summary unavailable" progress. Later small increments
    // can be folded by the configured summarizer from this grounded base.
    if (options.canonicalOnly || target - cursor > foldBatchTurns) {
      const projectTurn = options.projectTurn ?? projectTurnForFolding;
      const existingIndex = validCanonicalIndex(fold, cursor) ? fold!.canonicalIndex! : null;
      const indexed = existingIndex
        ? extendCanonicalAnchorIndex(
            existingIndex,
            turns.slice(cursor, target),
            turns[cursor - 1],
            summaryMaxChars,
            projectTurn,
          )
        : buildCanonicalAnchorIndex(turns.slice(0, target), summaryMaxChars, projectTurn);
      const tip = turns[target - 1];
      fold = {
        protocol: 'behold.loom-fold.v4',
        entityId: options.entityId,
        source: {
          fromSequence: 1,
          toSequence: tip.sequence,
          tipId: tip.id,
          turnCount: tip.sequence,
          canonicalChainDigest: indexed.index.sourceChainDigest,
          canonicalChainProtocol: indexed.index.sourceChainProtocol,
        },
        summary: indexed.summary,
        generatedAt: now(),
        model: options.model,
        generation: {
          kind: 'canonical_index',
          source: 'deterministic-canonical-anchors-v2',
          sourceSha256: indexed.index.projectionChainSha256,
          summarySha256: sha256(indexed.summary),
        },
        canonicalIndex: indexed.index,
        ...(options.projectionProfile ? { projectionProfile: options.projectionProfile } : {}),
        ...(options.summarizerProtocol ? { summarizerProtocol: options.summarizerProtocol } : {}),
      };
      saveFold(options.cacheFile, fold);
      return true;
    }

    const end = Math.min(target, cursor + foldBatchTurns);
    const batch = turns.slice(cursor, end);
    if (!batch.length) return false;
    const summary = fold?.summary ?? null;
    const request: LoomFoldRequest = {
      entityId: options.entityId,
      previousSummary: summary,
      turns: batch.map((turn, index) =>
        (options.projectTurn ?? projectTurnForFolding)(turn, batch[index - 1]),
      ),
      fromSequence: batch[0].sequence,
      toSequence: batch.at(-1)!.sequence,
    };
    const sourceSha256 = sha256(stableJson(request));
    let nextSummary: string;
    let generation: LoomFoldRecord['generation'];
    try {
      nextSummary = boundedText(await options.summarize(request, signal), summaryMaxChars);
      if (nextSummary) {
        generation = {
          kind: 'model',
          source: 'configured_summarizer',
          sourceSha256,
          summarySha256: sha256(nextSummary),
        };
      } else {
        nextSummary = canonicalAnchorSummary(
          turns.slice(0, end),
          summaryMaxChars,
          options.projectTurn ?? projectTurnForFolding,
        ).summary;
        generation = fallbackGeneration(
          'empty_summary',
          new Error('configured loom summarizer returned no summary text'),
          sourceSha256,
          nextSummary,
        );
      }
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      nextSummary = canonicalAnchorSummary(
        turns.slice(0, end),
        summaryMaxChars,
        options.projectTurn ?? projectTurnForFolding,
      ).summary;
      generation = fallbackGeneration('summarizer_error', error, sourceSha256, nextSummary);
    }
    throwIfAborted(signal);

    const tip = batch.at(-1)!;
    const generatedAt = now();
    const source = {
      fromSequence: 1,
      toSequence: tip.sequence,
      tipId: tip.id,
      turnCount: tip.sequence,
    };
    if (generation.kind === 'fallback') {
      options.onContextIntervention?.({
        protocol: 'behold.context-intervention.v1',
        kind: 'loom_fold_fallback',
        entityId: options.entityId,
        model: options.model,
        at: generatedAt,
        projectionProfile: options.projectionProfile ?? null,
        source,
        generation,
      });
    }
    fold = {
      protocol: 'behold.loom-fold.v3',
      entityId: options.entityId,
      source,
      summary: nextSummary,
      generatedAt,
      model: options.model,
      generation,
      ...(options.projectionProfile ? { projectionProfile: options.projectionProfile } : {}),
      ...(options.summarizerProtocol ? { summarizerProtocol: options.summarizerProtocol } : {}),
    };
    saveFold(options.cacheFile, fold);
    return true;
  }

  return {
    prepare,
    append(turn) {
      if (turn.entityId !== options.entityId) {
        throw new Error(
          `loom context for ${options.entityId} cannot append turn owned by ${turn.entityId}`,
        );
      }
      const previous = turns.at(-1);
      if (previous && (turn.sequence !== previous.sequence + 1 || turn.parentId !== previous.id)) {
        throw new Error('loom context append does not continue the current entity trajectory');
      }
      if (!previous && turn.sequence !== 1) {
        throw new Error('loom context first turn must have sequence 1');
      }
      turns.push(turn);
    },
    view() {
      return {
        fold,
        turns: turns.slice(foldedThrough()),
      };
    },
    state() {
      return {
        totalTurns: turns.length,
        foldedThrough: foldedThrough(),
        visibleTurns: turns.length - foldedThrough(),
        needsFold: shouldPrepare(),
      };
    },
  };
}

function createBoundedLoomContextView(
  source: BoundedLoomContextState,
  options: LoomContextOptions,
): LoomContextView {
  if (!options.canonicalOnly) {
    throw new Error('bounded loom context currently requires canonical-only folding');
  }
  if (source.entityId !== options.entityId) {
    throw new Error(`bounded loom context belongs to ${source.entityId}, not ${options.entityId}`);
  }
  const recentLimit = integerInRange(options.recentTurns ?? 8, 1, 64);
  const summaryMaxChars = integerInRange(options.summaryMaxChars ?? 8_000, 500, 40_000);
  const now = options.now ?? Date.now;
  const projectTurn = options.projectTurn ?? projectTurnForFolding;
  let totalTurns = source.totalTurns;
  if (!Number.isSafeInteger(totalTurns) || totalTurns < 0) {
    throw new Error('bounded loom context total turn count is invalid');
  }
  let recent = [...source.recentTurns];
  validateBoundedSuffix(recent, options.entityId, totalTurns, recentLimit);
  let recentSources = [...source.recentSources];
  if (
    recentSources.length !== recent.length ||
    recentSources.some((item) => !isCanonicalTurnBinding(item))
  ) {
    throw new Error('bounded loom context recent canonical bindings are invalid');
  }
  let fold: LoomFoldRecord | null = null;
  let boundaryTurn: EntityTurn | null = null;
  let ready = totalTurns <= recent.length;
  if (source.fold && source.foldSource) {
    const candidate = source.fold;
    const expectedThrough = totalTurns - recent.length;
    const authenticated = source.foldSource;
    if (
      candidate.entityId === options.entityId &&
      candidate.projectionProfile === options.projectionProfile &&
      (!options.summarizerProtocol ||
        candidate.summarizerProtocol === options.summarizerProtocol) &&
      candidate.source.toSequence === expectedThrough &&
      candidate.source.tipId === authenticated.tipTurn.id &&
      authenticated.tipTurn.sequence === expectedThrough &&
      candidate.source.canonicalChainDigest === authenticated.source.digest &&
      candidate.source.canonicalChainProtocol === authenticated.source.protocol &&
      validCanonicalIndex(candidate, expectedThrough) &&
      candidate.canonicalIndex!.sourceChainDigest === authenticated.source.digest &&
      candidate.canonicalIndex!.sourceChainProtocol === authenticated.source.protocol &&
      candidate.summary ===
        renderCanonicalAnchorSummary(candidate.canonicalIndex!, summaryMaxChars) &&
      candidate.generation.summarySha256 === sha256(candidate.summary) &&
      recent[0]?.parentId === authenticated.tipTurn.id
    ) {
      fold = candidate;
      boundaryTurn = authenticated.tipTurn;
      ready = true;
    }
  }
  let preparing: Promise<boolean> | null = null;

  async function rebuild(signal?: AbortSignal) {
    const index = emptyCanonicalAnchorIndex();
    const ring: EntityTurn[] = [];
    const ringSources: CanonicalTurnBinding[] = [];
    let reduced = index;
    let previous: EntityTurn | null = null;
    let reducedBoundary: EntityTurn | null = null;
    let count = 0;
    for await (const entry of source.rebuild()) {
      throwIfAborted(signal);
      const { turn } = entry;
      if (!isCanonicalTurnBinding(entry.source)) {
        throw new Error('bounded loom rebuild produced an invalid canonical binding');
      }
      validateTrajectoryStep(turn, previous, options.entityId);
      count += 1;
      ring.push(turn);
      ringSources.push(entry.source);
      if (ring.length > recentLimit) {
        const leaving = ring.shift()!;
        const leavingSource = ringSources.shift()!;
        reduced = reduceCanonicalAnchorIndex(
          reduced,
          leaving,
          reducedBoundary ?? undefined,
          summaryMaxChars,
          projectTurn,
          leavingSource,
        );
        reducedBoundary = leaving;
      }
      previous = turn;
    }
    if (count !== totalTurns) {
      throw new Error(`bounded loom rebuild read ${count} turns, expected ${totalTurns}`);
    }
    throwIfAborted(signal);
    if (!sameTurnSuffix(ring, recent) || !sameCanonicalBindings(ringSources, recentSources)) {
      throw new Error('bounded loom recent suffix differs from its canonical rebuild source');
    }
    recent = ring;
    recentSources = ringSources;
    boundaryTurn = reducedBoundary;
    fold = reducedBoundary ? canonicalFoldRecord(reduced, options, summaryMaxChars, now()) : null;
    if (fold) saveFold(options.cacheFile, fold);
    ready = true;
    return true;
  }

  async function prepare(signal?: AbortSignal) {
    throwIfAborted(signal);
    if (ready) return false;
    if (options.readOnly) {
      throw new Error(
        `read-only bounded loom context requires an authenticated current fold (${JSON.stringify({ totalTurns, recentTurns: recent.length })})`,
      );
    }
    if (preparing) return preparing;
    preparing = rebuild(signal).finally(() => {
      preparing = null;
    });
    return preparing;
  }

  return {
    prepare,
    append(turn, canonicalSource) {
      if (!ready) {
        throw new Error('bounded loom context must rebuild before appending');
      }
      const previous = recent.at(-1) ?? boundaryTurn;
      validateTrajectoryStep(turn, previous ?? null, options.entityId);
      if (turn.sequence !== totalTurns + 1) {
        throw new Error('bounded loom context append does not continue its total turn count');
      }
      if (!isCanonicalTurnBinding(canonicalSource)) {
        throw new Error('bounded loom context append requires an authenticated canonical binding');
      }
      recent.push(turn);
      recentSources.push(canonicalSource);
      totalTurns += 1;
      let index = fold?.canonicalIndex ?? emptyCanonicalAnchorIndex();
      while (recent.length > recentLimit) {
        const leaving = recent.shift()!;
        const leavingSource = recentSources.shift()!;
        index = reduceCanonicalAnchorIndex(
          index,
          leaving,
          boundaryTurn ?? undefined,
          summaryMaxChars,
          projectTurn,
          leavingSource,
        );
        boundaryTurn = leaving;
      }
      fold = boundaryTurn ? canonicalFoldRecord(index, options, summaryMaxChars, now()) : null;
      if (fold) saveFold(options.cacheFile, fold);
    },
    view() {
      if (!ready) {
        throw new Error('bounded loom context must prepare before materializing continuity');
      }
      return { fold, turns: [...recent] };
    },
    state() {
      const folded = ready ? (fold?.source.toSequence ?? 0) : 0;
      return {
        totalTurns,
        foldedThrough: folded,
        visibleTurns: ready ? recent.length : 0,
        needsFold: !ready,
      };
    },
  };
}

function validateBoundedSuffix(
  turns: EntityTurn[],
  entityId: string,
  totalTurns: number,
  limit: number,
) {
  if (turns.length > limit || turns.length > totalTurns) {
    throw new Error('bounded loom context recent suffix exceeds its declared bound');
  }
  const expectedStart = totalTurns - turns.length + 1;
  let previous: EntityTurn | null = null;
  for (const turn of turns) {
    if (turn.entityId !== entityId) {
      throw new Error(
        `bounded loom context for ${entityId} contains turn owned by ${turn.entityId}`,
      );
    }
    const expectedSequence = previous ? previous.sequence + 1 : expectedStart;
    if (turn.sequence !== expectedSequence || (previous && turn.parentId !== previous.id)) {
      throw new Error(`bounded loom context for ${entityId} has a non-contiguous recent suffix`);
    }
    previous = turn;
  }
  if (turns.length > 0 && turns.at(-1)?.sequence !== totalTurns) {
    throw new Error(`bounded loom context for ${entityId} recent suffix does not reach its tip`);
  }
}

function validateTrajectoryStep(turn: EntityTurn, previous: EntityTurn | null, entityId: string) {
  if (turn.entityId !== entityId) {
    throw new Error(`loom context for ${entityId} contains turn owned by ${turn.entityId}`);
  }
  const expectedSequence = previous ? previous.sequence + 1 : 1;
  const expectedParent = previous?.id ?? null;
  if (turn.sequence !== expectedSequence || turn.parentId !== expectedParent) {
    throw new Error(`loom context for ${entityId} is not one continuous trajectory`);
  }
}

function sameTurnSuffix(left: EntityTurn[], right: EntityTurn[]) {
  return (
    left.length === right.length &&
    left.every(
      (turn, index) =>
        turn.sequence === right[index]?.sequence &&
        turn.id === right[index]?.id &&
        turn.parentId === right[index]?.parentId,
    )
  );
}

export function isCanonicalTurnBinding(value: unknown): value is CanonicalTurnBinding {
  const candidate = value as Partial<CanonicalTurnBinding> | null;
  return Boolean(
    candidate &&
    typeof candidate.protocol === 'string' &&
    /^[a-z0-9][a-z0-9._/-]{0,99}$/i.test(candidate.protocol) &&
    typeof candidate.digest === 'string' &&
    /^[a-f0-9]{64}$/.test(candidate.digest),
  );
}

function sameCanonicalBindings(left: CanonicalTurnBinding[], right: CanonicalTurnBinding[]) {
  return (
    left.length === right.length &&
    left.every(
      (binding, index) =>
        binding.protocol === right[index]?.protocol && binding.digest === right[index]?.digest,
    )
  );
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  throw signal.reason ?? new DOMException('loom fold aborted', 'AbortError');
}

export function foldMessage(record: LoomFoldRecord) {
  return {
    role: 'system',
    content: [
      `Folded view of your own loom, turns ${record.source.fromSequence}-${record.source.toSequence}.`,
      'This is a non-authoritative projection; the original lived turns remain the evidence.',
      record.summary,
    ].join('\n'),
  };
}

export function projectTurnForFolding(
  turn: EntityTurn,
  previousTurn?: EntityTurn,
  options: {
    projectObservation?: (
      frame: any,
      previousFrame: any,
      previousSource: 'previous_turn_next_observation' | 'same_turn_observation',
      eventBatchLimit: number,
    ) => any;
    projectValue?: (value: any) => any;
    mayReplayAction?: (turn: EntityTurn) => boolean;
    includePublicCommitment?: boolean;
    factsOnly?: boolean;
  } = {},
) {
  const projectObservation = options.projectObservation ?? projectHistoricalModelObservation;
  const projectValue = options.projectValue ?? projectResidentVisibleValue;
  const residentVisible = (options.mayReplayAction ?? residentTurnMayReplay)(turn);
  return {
    anchor: `t${turn.sequence}`,
    id: turn.id,
    parentId: turn.parentId,
    startedAt: turn.startedAt,
    completedAt: turn.completedAt,
    observation: projectObservation(
      turn.observation,
      previousTurn?.nextObservation,
      'previous_turn_next_observation',
      FOLD_EVENT_BATCH,
    ),
    publicCommitment:
      options.includePublicCommitment !== false &&
      residentVisible &&
      turn.utterance?.publicCommitment
        ? compactValue(projectValue(turn.utterance.publicCommitment))
        : null,
    action: residentVisible
      ? compactValue(projectValue(turn.action))
      : {
          name: turn.action.name,
          source: turn.action.source,
          inputOmitted: true,
          reason: 'not_resident_observable',
        },
    outcome: residentVisible
      ? options.factsOnly
        ? factualFoldOutcome(turn)
        : compactValue(projectValue(turn.outcome))
      : {
          ok: turn.outcome.ok,
          eventType: turn.outcome.eventType,
          resultOmitted: true,
          reason: 'not_resident_observable',
        },
    nextObservation: projectObservation(
      turn.nextObservation,
      turn.observation,
      'same_turn_observation',
      FOLD_EVENT_BATCH,
    ),
  };
}

function factualFoldOutcome(turn: EntityTurn) {
  const token = (value: unknown) => {
    const text = String(value ?? '');
    return /^[a-z0-9_:-]{1,80}$/i.test(text) ? text : null;
  };
  const result =
    turn.outcome.result && typeof turn.outcome.result === 'object'
      ? (turn.outcome.result as Record<string, unknown>)
      : null;
  return {
    ok: turn.outcome.ok,
    eventType: token(turn.outcome.eventType) ?? 'unknown',
    ...(token(turn.outcome.error) ? { error: token(turn.outcome.error) } : {}),
    ...(typeof result?.bodyMoved === 'boolean'
      ? { result: { bodyMoved: result.bodyMoved } }
      : token(result?.status)
        ? { result: { status: token(result?.status) } }
        : {}),
  };
}

function compactValue(value: any, depth = 0): any {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return boundedText(value, 600);
  if (depth >= 7) return '[depth bounded]';
  if (Array.isArray(value)) {
    const bounded = value.length > 32 ? value.slice(-32) : value;
    return bounded.map((item) => compactValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, compactValue(item, depth + 1)]),
    );
  }
  return boundedText(String(value), 600);
}

function loadValidFold(
  cacheFile: string | null | undefined,
  turns: EntityTurn[],
  entityId: string,
  projectionProfile?: string,
  summarizerProtocol?: string,
  canonicalOnly = false,
  summaryMaxChars = 8_000,
) {
  if (!cacheFile) return null;
  try {
    const candidate = readLoomFoldCache(cacheFile);
    if (!candidate) return null;
    if (
      (canonicalOnly || candidate.protocol === 'behold.loom-fold.v4') &&
      !validCanonicalIndex(candidate, candidate.source?.toSequence)
    )
      return null;
    if (candidate.entityId !== entityId) return null;
    if (projectionProfile && candidate.projectionProfile !== projectionProfile) return null;
    if (summarizerProtocol && candidate.summarizerProtocol !== summarizerProtocol) return null;
    const index = Number(candidate.source?.toSequence) - 1;
    if (index < 0 || index >= turns.length) return null;
    if (turns[index]?.id !== candidate.source.tipId) return null;
    if (
      candidate.protocol === 'behold.loom-fold.v4' &&
      (candidate.summary !==
        renderCanonicalAnchorSummary(candidate.canonicalIndex!, summaryMaxChars) ||
        candidate.source.canonicalChainProtocol !== 'behold.entity-turn-chain.v1' ||
        candidate.source.canonicalChainDigest !== localEntityTurnChain(turns.slice(0, index + 1)))
    ) {
      return null;
    }
    if (!candidate.summary?.trim()) return null;
    if (candidate.generation?.summarySha256 !== sha256(candidate.summary)) return null;
    if (!/^[a-f0-9]{64}$/.test(candidate.generation?.sourceSha256 ?? '')) return null;
    return candidate;
  } catch {
    return null;
  }
}

/**
 * Read a disposable fold candidate without claiming it matches any life.
 * `createLoomContextView` performs the entity/profile/tip/chain authentication.
 */
export function readLoomFoldCache(file: string): LoomFoldRecord | null {
  if (!fs.existsSync(file)) return null;
  try {
    const candidate = JSON.parse(fs.readFileSync(file, 'utf8')) as LoomFoldRecord;
    return candidate?.protocol === 'behold.loom-fold.v3' ||
      candidate?.protocol === 'behold.loom-fold.v4'
      ? candidate
      : null;
  } catch {
    return null;
  }
}

function saveFold(cacheFile: string | null | undefined, record: LoomFoldRecord) {
  if (!cacheFile) return;
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  const temporary = `${cacheFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(record)}\n`, 'utf8');
  fs.renameSync(temporary, cacheFile);
}

const MATERIAL_MEMORY_ACTIONS = new Set([
  'dig_block',
  'dig_focused_block',
  'place_block',
  'place_against',
  'craft_item',
  'consume',
  'drop_item',
  'deposit_in_focused_container',
  'withdraw_from_focused_container',
  'toggle_block',
  'sleep_in_bed',
  'attack_entity',
]);

const CANONICAL_INDEX_PROTOCOL = 'behold.canonical-anchor-index.v2' as const;
const EMPTY_PROJECTION_CHAIN_SHA256 = sha256('behold.canonical-anchor-projection-chain.v2\n');
const EMPTY_LOCAL_SOURCE_CHAIN_SHA256 = sha256('behold.entity-turn-chain.v1\n');
const MAX_DIALOGUE_KEYS = 512;

function emptyCanonicalAnchorIndex(): CanonicalAnchorIndex {
  return {
    protocol: CANONICAL_INDEX_PROTOCOL,
    throughSequence: 0,
    tipId: '',
    projectionChainSha256: EMPTY_PROJECTION_CHAIN_SHA256,
    sourceChainProtocol: 'behold.entity-turn-chain.v1',
    sourceChainDigest: EMPTY_LOCAL_SOURCE_CHAIN_SHA256,
    dialogue: [],
    consequences: [],
    boundaries: [],
    dialogueKeys: [],
  };
}

function buildCanonicalAnchorIndex(
  sourceTurns: EntityTurn[],
  limit: number,
  projectTurn: (
    turn: EntityTurn,
    previousTurn?: EntityTurn,
  ) => ReturnType<typeof projectTurnForFolding>,
) {
  let index = emptyCanonicalAnchorIndex();
  let previous: EntityTurn | undefined;
  for (const turn of sourceTurns) {
    index = reduceCanonicalAnchorIndex(index, turn, previous, limit, projectTurn);
    previous = turn;
  }
  return { index, summary: renderCanonicalAnchorSummary(index, limit) };
}

function extendCanonicalAnchorIndex(
  initial: CanonicalAnchorIndex,
  turns: EntityTurn[],
  previous: EntityTurn | undefined,
  limit: number,
  projectTurn: (
    turn: EntityTurn,
    previousTurn?: EntityTurn,
  ) => ReturnType<typeof projectTurnForFolding>,
) {
  let index = initial;
  let predecessor = previous;
  for (const turn of turns) {
    index = reduceCanonicalAnchorIndex(index, turn, predecessor, limit, projectTurn);
    predecessor = turn;
  }
  return { index, summary: renderCanonicalAnchorSummary(index, limit) };
}

function reduceCanonicalAnchorIndex(
  initial: CanonicalAnchorIndex,
  turn: EntityTurn,
  previous: EntityTurn | undefined,
  limit: number,
  projectTurn: (
    turn: EntityTurn,
    previousTurn?: EntityTurn,
  ) => ReturnType<typeof projectTurnForFolding>,
  sourceBinding?: CanonicalTurnBinding,
): CanonicalAnchorIndex {
  if (turn.sequence !== initial.throughSequence + 1) {
    throw new Error('canonical anchor index does not continue its exact source sequence');
  }
  if (previous && (previous.sequence + 1 !== turn.sequence || turn.parentId !== previous.id)) {
    throw new Error('canonical anchor index does not continue its exact source chain');
  }
  const projected = projectTurn(turn, previous);
  const sourceChainProtocol = sourceBinding?.protocol ?? initial.sourceChainProtocol;
  if (initial.throughSequence > 0 && sourceChainProtocol !== initial.sourceChainProtocol) {
    throw new Error('canonical anchor index source chain protocol changed');
  }
  const sourceChainDigest =
    sourceBinding?.digest ?? sha256(`${initial.sourceChainDigest}\n${stableJson(turn)}`);
  const dialogue = [...initial.dialogue];
  const consequences = [...initial.consequences];
  const boundaries = [...initial.boundaries];
  const dialogueKeys = [...initial.dialogueKeys];
  const seenDialogue = new Set(dialogueKeys);
  for (const frame of [projected.observation, projected.nextObservation]) {
    for (const event of Array.isArray(frame?.events) ? frame.events : []) {
      const type = String(event?.type || '');
      if (type === 'chat_received') {
        const from = boundedText(event?.data?.from ?? event?.data?.user ?? 'someone', 80);
        const text = boundedText(event?.data?.text ?? '', 300);
        const key = `${event?.sequence ?? ''}\u0000${from}\u0000${text}`;
        if (text && !seenDialogue.has(key)) {
          seenDialogue.add(key);
          dialogueKeys.push(key);
          pushBoundedLine(
            dialogue,
            `[t${turn.sequence}] heard ${from}: ${JSON.stringify(text)}`,
            limit,
          );
        }
      }
      if (['died', 'spawned', 'dimension_changed'].includes(type)) {
        pushBoundedLine(boundaries, `[t${turn.sequence}] experienced ${type}`, limit);
      }
    }
  }
  while (dialogueKeys.length > MAX_DIALOGUE_KEYS) dialogueKeys.shift();
  if (projected.action?.name === 'chat' && projected.outcome?.ok) {
    const text = boundedText(projected.action?.input?.text ?? '', 300);
    if (text) {
      pushBoundedLine(dialogue, `[t${turn.sequence}] said: ${JSON.stringify(text)}`, limit);
    }
  }
  if (projected.outcome?.ok && MATERIAL_MEMORY_ACTIONS.has(String(projected.action?.name || ''))) {
    pushBoundedLine(
      consequences,
      boundedText(
        `[t${turn.sequence}] chose ${projected.action.name} ${JSON.stringify(
          projected.action.input ?? {},
        )}; observed ${JSON.stringify(projected.outcome.result ?? { ok: true })}`,
        600,
      ),
      limit,
    );
  }
  return {
    protocol: CANONICAL_INDEX_PROTOCOL,
    throughSequence: turn.sequence,
    tipId: turn.id,
    projectionChainSha256: sha256(`${initial.projectionChainSha256}\n${stableJson(projected)}`),
    sourceChainProtocol,
    sourceChainDigest,
    dialogue,
    consequences,
    boundaries,
    dialogueKeys,
  };
}

function pushBoundedLine(lines: string[], line: string, limit: number) {
  lines.push(line);
  while (lines.length > 1 && lines.reduce((sum, value) => sum + value.length + 1, 0) > limit) {
    lines.shift();
  }
}

function renderCanonicalAnchorSummary(index: CanonicalAnchorIndex, limit: number) {
  const header = [
    `Canonical own-life index through t${index.throughSequence}.`,
    'Literal selected anchors only; absence is not evidence that an event did not happen. Consult the canonical loom for full detail.',
  ].join('\n');
  const remaining = Math.max(0, limit - header.length - 4);
  const dialogueText = newestLinesWithin([...index.dialogue], Math.floor(remaining * 0.58));
  const consequenceText = newestLinesWithin([...index.consequences], Math.floor(remaining * 0.34));
  const boundaryText = newestLinesWithin([...index.boundaries], Math.floor(remaining * 0.08));
  const sections = [
    dialogueText ? `Dialogue:\n${dialogueText}` : '',
    consequenceText ? `Material consequences:\n${consequenceText}` : '',
    boundaryText ? `Life boundaries:\n${boundaryText}` : '',
  ].filter(Boolean);
  return boundedText([header, ...sections].join('\n'), limit);
}

function validCanonicalIndex(record: LoomFoldRecord | null, through: unknown) {
  const index = record?.canonicalIndex;
  return Boolean(
    record?.protocol === 'behold.loom-fold.v4' &&
    index?.protocol === CANONICAL_INDEX_PROTOCOL &&
    Number.isSafeInteger(through) &&
    index?.throughSequence === through &&
    index.tipId === record.source.tipId &&
    index.sourceChainDigest === record.source.canonicalChainDigest &&
    index.sourceChainProtocol === record.source.canonicalChainProtocol &&
    record.generation.kind === 'canonical_index' &&
    record.generation.source === 'deterministic-canonical-anchors-v2' &&
    record.generation.sourceSha256 === index.projectionChainSha256 &&
    /^[a-f0-9]{64}$/.test(index.projectionChainSha256) &&
    /^[a-f0-9]{64}$/.test(index.sourceChainDigest),
  );
}

function canonicalFoldRecord(
  index: CanonicalAnchorIndex,
  options: LoomContextOptions,
  summaryMaxChars: number,
  generatedAt: number,
): LoomFoldRecord {
  const summary = renderCanonicalAnchorSummary(index, summaryMaxChars);
  return {
    protocol: 'behold.loom-fold.v4',
    entityId: options.entityId,
    source: {
      fromSequence: 1,
      toSequence: index.throughSequence,
      tipId: index.tipId,
      turnCount: index.throughSequence,
      canonicalChainDigest: index.sourceChainDigest,
      canonicalChainProtocol: index.sourceChainProtocol,
    },
    summary,
    generatedAt,
    model: options.model,
    generation: {
      kind: 'canonical_index',
      source: 'deterministic-canonical-anchors-v2',
      sourceSha256: index.projectionChainSha256,
      summarySha256: sha256(summary),
    },
    canonicalIndex: index,
    ...(options.projectionProfile ? { projectionProfile: options.projectionProfile } : {}),
    ...(options.summarizerProtocol ? { summarizerProtocol: options.summarizerProtocol } : {}),
  };
}

/**
 * A compact, literal index over resident-visible canonical life. This is the
 * degraded memory path, not a behavioral interpretation: dialogue, material
 * actions, and life boundaries are copied from the resident's own safe
 * projection with turn anchors so the original Lync records remain locatable.
 */
function canonicalAnchorSummary(
  sourceTurns: EntityTurn[],
  limit: number,
  projectTurn: (
    turn: EntityTurn,
    previousTurn?: EntityTurn,
  ) => ReturnType<typeof projectTurnForFolding>,
) {
  const sourceHash = createHash('sha256');
  const dialogue: string[] = [];
  const consequences: string[] = [];
  const boundaries: string[] = [];
  const seenDialogue = new Set<string>();
  let previous: EntityTurn | undefined;

  for (const turn of sourceTurns) {
    const projected = projectTurn(turn, previous);
    sourceHash.update(stableJson(projected));
    for (const frame of [projected.observation, projected.nextObservation]) {
      for (const event of Array.isArray(frame?.events) ? frame.events : []) {
        const type = String(event?.type || '');
        if (type === 'chat_received') {
          const from = boundedText(event?.data?.from ?? event?.data?.user ?? 'someone', 80);
          const text = boundedText(event?.data?.text ?? '', 300);
          const key = `${event?.sequence ?? ''}\u0000${from}\u0000${text}`;
          if (text && !seenDialogue.has(key)) {
            seenDialogue.add(key);
            dialogue.push(`[t${turn.sequence}] heard ${from}: ${JSON.stringify(text)}`);
          }
        }
        if (['died', 'spawned', 'dimension_changed'].includes(type)) {
          boundaries.push(`[t${turn.sequence}] experienced ${type}`);
        }
      }
    }
    if (projected.action?.name === 'chat' && projected.outcome?.ok) {
      const text = boundedText(projected.action?.input?.text ?? '', 300);
      if (text) dialogue.push(`[t${turn.sequence}] said: ${JSON.stringify(text)}`);
    }
    if (
      projected.outcome?.ok &&
      MATERIAL_MEMORY_ACTIONS.has(String(projected.action?.name || ''))
    ) {
      consequences.push(
        boundedText(
          `[t${turn.sequence}] chose ${projected.action.name} ${JSON.stringify(
            projected.action.input ?? {},
          )}; observed ${JSON.stringify(projected.outcome.result ?? { ok: true })}`,
          600,
        ),
      );
    }
    previous = turn;
  }

  const through = sourceTurns.at(-1)?.sequence ?? 0;
  const header = [
    `Canonical own-life index through t${through}.`,
    'Literal selected anchors only; absence is not evidence that an event did not happen. Consult the canonical loom for full detail.',
  ].join('\n');
  const remaining = Math.max(0, limit - header.length - 4);
  const dialogueText = newestLinesWithin(dialogue, Math.floor(remaining * 0.58));
  const consequenceText = newestLinesWithin(consequences, Math.floor(remaining * 0.34));
  const boundaryText = newestLinesWithin(boundaries, Math.floor(remaining * 0.08));
  const sections = [
    dialogueText ? `Dialogue:\n${dialogueText}` : '',
    consequenceText ? `Material consequences:\n${consequenceText}` : '',
    boundaryText ? `Life boundaries:\n${boundaryText}` : '',
  ].filter(Boolean);
  return {
    summary: boundedText([header, ...sections].join('\n'), limit),
    sourceSha256: sourceHash.digest('hex'),
  };
}

function newestLinesWithin(lines: string[], limit: number) {
  const selected: string[] = [];
  let used = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const bytes = line.length + (selected.length ? 1 : 0);
    if (used + bytes > limit) continue;
    selected.push(line);
    used += bytes;
  }
  return selected.reverse().join('\n');
}

function fallbackGeneration(
  reason: 'summarizer_error' | 'empty_summary',
  error: unknown,
  sourceSha256: string,
  summary: string,
): Extract<LoomFoldRecord['generation'], { kind: 'fallback' }> {
  const value = error as any;
  return {
    kind: 'fallback',
    source: 'deterministic-canonical-anchors-v1',
    reason,
    sourceSha256,
    summarySha256: sha256(summary),
    failure: {
      name: boundedText(value?.name || 'Error', 100),
      message: boundedText(value?.message || String(error), 500),
    },
  };
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function localEntityTurnChain(turns: EntityTurn[]) {
  let digest = EMPTY_LOCAL_SOURCE_CHAIN_SHA256;
  for (const turn of turns) digest = sha256(`${digest}\n${stableJson(turn)}`);
  return digest;
}

function stableJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function boundedText(value: unknown, limit: number) {
  const text = String(value ?? '').trim();
  if (text.length <= limit) return text;
  return text.slice(text.length - limit);
}

function integerInRange(value: number, min: number, max: number) {
  const integer = Math.floor(Number(value));
  if (!Number.isFinite(integer)) return min;
  return Math.max(min, Math.min(max, integer));
}

function validateTrajectory(turns: EntityTurn[], entityId: string) {
  let previous: EntityTurn | null = null;
  for (const turn of turns) {
    if (turn.entityId !== entityId) {
      throw new Error(`loom context for ${entityId} contains turn owned by ${turn.entityId}`);
    }
    const expectedSequence = previous ? previous.sequence + 1 : 1;
    const expectedParent = previous?.id ?? null;
    if (turn.sequence !== expectedSequence || turn.parentId !== expectedParent) {
      throw new Error(`loom context for ${entityId} is not one continuous trajectory`);
    }
    previous = turn;
  }
}
