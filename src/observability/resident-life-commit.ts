import type { EntityTurn, EntityTurnCommitReceipt } from '../entity/loom';
import { HUMAN_SEMANTIC_OBSERVATION_PROTOCOL } from '../mind/minecraft-body';
import { projectResidentVisibleValue } from '../mind/resident-visibility';

export const RESIDENT_LIFE_COMMIT_PROTOCOL = 'behold.resident-life-commit.v1' as const;
export const RESIDENT_LIFE_COMMIT_EVENT = 'resident_life_commit' as const;
export const OPERATIONAL_BODY_OBSERVATION_PROTOCOL =
  'behold.operational-body-observation.v1' as const;

/**
 * Bounded public following data for one canonical private resident turn.
 *
 * Lync remains the only complete life record. This projection deliberately
 * cannot be decoded into an EntityTurn: it excludes the raw causal frames,
 * model/controller configuration, and provider request/response content.
 */
export type ResidentLifeCommit = Readonly<{
  protocol: typeof RESIDENT_LIFE_COMMIT_PROTOCOL;
  entity: Readonly<{
    id: string;
    turnId: string;
    sequence: number;
    parentTurnId: string | null;
    startedAt: number;
    completedAt: number;
  }>;
  experience: Readonly<{
    protocol: 'behold.entity-turn-observation-presentation.v1';
    bodyProfile: 'minecraft-human-semantic-v1';
    requestSha256: string;
    before: unknown;
    after: unknown;
  }> | null;
  choice: Readonly<{
    utterance: string | null;
    publicCommitment: unknown | null;
    action: Readonly<{
      id: string;
      name: string;
      input: unknown;
      source: string;
      kind: string;
      toolCallId: string | null;
    }>;
  }>;
  consequence: Readonly<{
    ok: boolean;
    eventType: string;
    result: unknown;
    error: string | null;
    cancellation: unknown | null;
  }>;
  lync: EntityTurnCommitReceipt;
}>;

export function createResidentLifeCommit(
  turn: EntityTurn,
  receipt: EntityTurnCommitReceipt,
): ResidentLifeCommit {
  assertReceiptMatchesTurn(receipt, turn);
  const presentation = safePresentation(turn.observationPresentation);
  return deepFreeze({
    protocol: RESIDENT_LIFE_COMMIT_PROTOCOL,
    entity: {
      id: turn.entityId,
      turnId: turn.id,
      sequence: turn.sequence,
      parentTurnId: turn.parentId,
      startedAt: turn.startedAt,
      completedAt: turn.completedAt,
    },
    experience: presentation
      ? {
          protocol: presentation.protocol,
          bodyProfile: presentation.bodyProfile,
          requestSha256: presentation.requestSha256,
          before: clone(presentation.observation),
          after: clone(presentation.nextObservation),
        }
      : null,
    choice: {
      utterance: text(turn.utterance?.assistant?.content),
      publicCommitment: project(turn.utterance?.publicCommitment ?? null),
      action: {
        id: turn.action.id,
        name: turn.action.name,
        input: project(turn.action.input),
        source: turn.action.source,
        kind: turn.action.kind,
        toolCallId: turn.action.toolCallId,
      },
    },
    consequence: {
      ok: turn.outcome.ok,
      eventType: turn.outcome.eventType,
      result: project(turn.outcome.result),
      error: text(turn.outcome.error),
      cancellation: project(turn.outcome.cancellation ?? null),
    },
    lync: clone(receipt),
  });
}

/**
 * Keep operational decision timing and identities in the run journal while
 * leaving exact cognition content in the separately named transport capture.
 */
export function projectOperationalModelTurn(turn: any): any {
  const observation = safeObservation(turn?.observation);
  const call = publicModelCall(turn?.call);
  return deepFreeze({
    at: finite(turn?.at),
    model: text(turn?.model),
    mind: text(turn?.mind),
    policyProfile: text(turn?.policyProfile),
    bodyProfile: text(turn?.bodyProfile),
    actionProfile: text(turn?.actionProfile),
    safetyProfile: text(turn?.safetyProfile),
    perceptionProfile: text(turn?.perceptionProfile),
    perception: project(turn?.perception ?? null),
    experimentRelease: project(turn?.experimentRelease ?? null),
    observation,
    assistant: { content: text(turn?.assistant?.content) },
    intent: project(turn?.intent ?? null),
    call,
    attention: project(turn?.attention ?? null),
  });
}

/**
 * Keep enough of a raw body sample to diagnose readiness and liveness without
 * copying the resident's exact private view into the operational journal.
 * Model-facing semantic experience is recorded only in the bounded public
 * model/commit projections; complete private experience remains canonical in
 * Lync.
 */
export function projectOperationalBodyObservation(observation: any): any {
  return deepFreeze({
    protocol: OPERATIONAL_BODY_OBSERVATION_PROTOCOL,
    sourceProtocol: text(observation?.protocol),
    sequence: nonNegativeInteger(observation?.sequence),
    observedAt: nullableFinite(observation?.observedAt),
    eventWindow: {
      complete: observation?.eventWindow?.complete === true,
      missingBeforeOldest: nonNegativeInteger(observation?.eventWindow?.missingBeforeOldest),
      oldestAvailableSequence: nonNegativeInteger(
        observation?.eventWindow?.oldestAvailableSequence,
      ),
      newestAvailableSequence: nonNegativeInteger(
        observation?.eventWindow?.newestAvailableSequence,
      ),
    },
    body: {
      identity: text(observation?.self?.identity),
      username: text(observation?.self?.body?.username),
      uuid: text(observation?.self?.body?.uuid),
      condition: {
        health: nullableFinite(observation?.self?.condition?.health),
        food: nullableFinite(observation?.self?.condition?.food),
        oxygen: nullableFinite(observation?.self?.condition?.oxygen),
        sleeping: observation?.self?.condition?.sleeping === true,
        dimension: text(observation?.self?.condition?.dimension),
      },
      pose: {
        onGround: observation?.self?.pose?.onGround === true,
        moving:
          Math.hypot(
            finite(observation?.self?.pose?.velocity?.x) ?? 0,
            finite(observation?.self?.pose?.velocity?.y) ?? 0,
            finite(observation?.self?.pose?.velocity?.z) ?? 0,
          ) >= 0.01,
      },
      currentAction: observation?.self?.currentAction
        ? {
            id: text(observation.self.currentAction.id),
            tool: text(observation.self.currentAction.tool),
            status: text(observation.self.currentAction.status),
          }
        : null,
    },
  });
}

function publicModelCall(value: any) {
  if (!value || typeof value !== 'object') return null;
  const call = clone(value);
  if (call.request && typeof call.request === 'object') {
    delete call.request.mindRequest;
    delete call.request.body;
  }
  if (call.response && typeof call.response === 'object') delete call.response.raw;
  return call;
}

function safePresentation(value: any) {
  if (
    value?.protocol !== 'behold.entity-turn-observation-presentation.v1' ||
    value?.bodyProfile !== 'minecraft-human-semantic-v1'
  ) {
    return null;
  }
  const observation = safeObservation(value.observation);
  const nextObservation = safeObservation(value.nextObservation);
  if (!observation || !nextObservation) return null;
  return {
    ...value,
    observation,
    nextObservation,
  } as Readonly<{
    protocol: 'behold.entity-turn-observation-presentation.v1';
    bodyProfile: 'minecraft-human-semantic-v1';
    requestSha256: string;
    observation: unknown;
    nextObservation: unknown;
  }>;
}

function safeObservation(value: any) {
  if (
    !value ||
    typeof value !== 'object' ||
    value.protocol !== HUMAN_SEMANTIC_OBSERVATION_PROTOCOL ||
    value.bodyContract?.profile !== 'minecraft-human-semantic-v1'
  ) {
    return null;
  }
  return stripPrivateObservationContent(value);
}

// Human-semantic observations are constructed independently of camera
// capture. Keep that separation true at this final public journal boundary
// even if a malformed or future producer adds a private-shaped nested field.
const PRIVATE_OBSERVATION_KEYS = new Set([
  'camera',
  'image',
  'pixels',
  'dataUrl',
  'privateCausalFrames',
  'observationBinding',
  'privateObservation',
  'rawFrame',
]);

function stripPrivateObservationContent(value: any, depth = 0): any {
  if (value == null || typeof value !== 'object') return value;
  if (depth >= 16) return '[detail omitted]';
  if (Array.isArray(value)) {
    return value.map((item) => stripPrivateObservationContent(item, depth + 1));
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) =>
      PRIVATE_OBSERVATION_KEYS.has(key)
        ? []
        : [[key, stripPrivateObservationContent(item, depth + 1)]],
    ),
  );
}

function assertReceiptMatchesTurn(receipt: EntityTurnCommitReceipt, turn: EntityTurn) {
  if (
    receipt?.protocol !== 'behold.entity-turn-commit-receipt.v1' ||
    receipt.entityId !== turn.entityId ||
    receipt.sequence !== turn.sequence ||
    receipt.legacyTurnId !== turn.id
  ) {
    throw new Error('resident life commit receipt does not match its canonical entity turn');
  }
}

function project(value: any) {
  return clone(projectResidentVisibleValue(value));
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonNegativeInteger(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function nullableFinite(value: unknown): number | null {
  if (value == null || value === '') return null;
  return finite(value);
}

function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value as object)) return value;
  seen.add(value as object);
  for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item, seen);
  return Object.freeze(value);
}
