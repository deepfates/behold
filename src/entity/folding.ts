import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { projectResidentVisibleValue, residentTurnMayReplay } from '../mind/resident-visibility';
import type { EntityTurn } from './loom';
import { projectHistoricalModelObservation } from '../mind/observation-context';

const FOLD_EVENT_BATCH = 24;

export type LoomFoldRecord = {
  protocol: 'behold.loom-fold.v3';
  entityId: string;
  source: {
    fromSequence: number;
    toSequence: number;
    tipId: string;
    turnCount: number;
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
        source: 'deterministic-canonical-anchors-v1';
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
};

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
  append: (turn: EntityTurn) => void;
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
    if (target - cursor > foldBatchTurns) {
      const indexed = canonicalAnchorSummary(
        turns.slice(0, target),
        summaryMaxChars,
        options.projectTurn ?? projectTurnForFolding,
      );
      const tip = turns[target - 1];
      fold = {
        protocol: 'behold.loom-fold.v3',
        entityId: options.entityId,
        source: {
          fromSequence: 1,
          toSequence: tip.sequence,
          tipId: tip.id,
          turnCount: tip.sequence,
        },
        summary: indexed.summary,
        generatedAt: now(),
        model: options.model,
        generation: {
          kind: 'canonical_index',
          source: 'deterministic-canonical-anchors-v1',
          sourceSha256: indexed.sourceSha256,
          summarySha256: sha256(indexed.summary),
        },
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
      residentVisible && turn.utterance?.publicCommitment
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
      ? compactValue(projectValue(turn.outcome))
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
) {
  if (!cacheFile || !fs.existsSync(cacheFile)) return null;
  try {
    const candidate = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as LoomFoldRecord;
    if (candidate?.protocol !== 'behold.loom-fold.v3') return null;
    if (candidate.entityId !== entityId) return null;
    if (projectionProfile && candidate.projectionProfile !== projectionProfile) return null;
    if (summarizerProtocol && candidate.summarizerProtocol !== summarizerProtocol) return null;
    const index = Number(candidate.source?.toSequence) - 1;
    if (index < 0 || index >= turns.length) return null;
    if (turns[index]?.id !== candidate.source.tipId) return null;
    if (!candidate.summary?.trim()) return null;
    if (candidate.generation?.summarySha256 !== sha256(candidate.summary)) return null;
    if (!/^[a-f0-9]{64}$/.test(candidate.generation?.sourceSha256 ?? '')) return null;
    return candidate;
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
