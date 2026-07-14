import fs from 'node:fs';
import path from 'node:path';
import type { EntityTurn } from './loom';
import { projectHistoricalModelObservation } from '../mind/observation-context';

const FOLD_EVENT_BATCH = 24;

export type LoomFoldRecord = {
  protocol: 'behold.loom-fold.v1';
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
};

export type LoomFoldRequest = {
  entityId: string;
  previousSummary: string | null;
  turns: Array<ReturnType<typeof projectTurnForFolding>>;
  fromSequence: number;
  toSequence: number;
};

export type LoomFoldSummarizer = (request: LoomFoldRequest) => Promise<string>;

export type LoomContextView = {
  prepare: () => Promise<boolean>;
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
  let fold = loadValidFold(options.cacheFile, turns, options.entityId);
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

  async function prepare() {
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
    preparing = performFold().finally(() => {
      preparing = null;
    });
    return preparing;
  }

  async function performFold() {
    const target = foldTarget();
    let cursor = foldedThrough();
    let summary = fold?.summary ?? null;
    let changed = false;

    while (cursor < target) {
      const end = Math.min(target, cursor + foldBatchTurns);
      const batch = turns.slice(cursor, end);
      if (!batch.length) break;
      let nextSummary: string;
      try {
        nextSummary = boundedText(
          await options.summarize({
            entityId: options.entityId,
            previousSummary: summary,
            turns: batch.map((turn, index) => projectTurnForFolding(turn, batch[index - 1])),
            fromSequence: batch[0].sequence,
            toSequence: batch.at(-1)!.sequence,
          }),
          summaryMaxChars,
        );
      } catch {
        nextSummary = fallbackSummary(summary, batch, summaryMaxChars);
      }
      if (!nextSummary) nextSummary = fallbackSummary(summary, batch, summaryMaxChars);

      const tip = batch.at(-1)!;
      fold = {
        protocol: 'behold.loom-fold.v1',
        entityId: options.entityId,
        source: {
          fromSequence: 1,
          toSequence: tip.sequence,
          tipId: tip.id,
          turnCount: tip.sequence,
        },
        summary: nextSummary,
        generatedAt: now(),
        model: options.model,
      };
      summary = nextSummary;
      cursor = end;
      changed = true;
      saveFold(options.cacheFile, fold);
    }
    return changed;
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

export function projectTurnForFolding(turn: EntityTurn, previousTurn?: EntityTurn) {
  return {
    anchor: `t${turn.sequence}`,
    id: turn.id,
    parentId: turn.parentId,
    startedAt: turn.startedAt,
    completedAt: turn.completedAt,
    observation: projectHistoricalModelObservation(
      turn.observation,
      previousTurn?.nextObservation,
      'previous_turn_next_observation',
      FOLD_EVENT_BATCH,
    ),
    action: compactValue(turn.action),
    outcome: compactValue(turn.outcome),
    nextObservation: projectHistoricalModelObservation(
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
) {
  if (!cacheFile || !fs.existsSync(cacheFile)) return null;
  try {
    const candidate = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as LoomFoldRecord;
    if (candidate?.protocol !== 'behold.loom-fold.v1') return null;
    if (candidate.entityId !== entityId) return null;
    const index = Number(candidate.source?.toSequence) - 1;
    if (index < 0 || index >= turns.length) return null;
    if (turns[index]?.id !== candidate.source.tipId) return null;
    if (!candidate.summary?.trim()) return null;
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

function fallbackSummary(previous: string | null, batch: EntityTurn[], limit: number) {
  const from = batch[0]?.sequence;
  const to = batch.at(-1)?.sequence;
  return boundedText(
    [
      previous,
      `[t${from}-t${to}: automatic fold summary unavailable; consult this entity's loom for the original evidence.]`,
    ]
      .filter(Boolean)
      .join('\n'),
    limit,
  );
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
