import { createHash } from 'node:crypto';

export const ENTITY_TURN_OBSERVATION_PRESENTATION_PROTOCOL =
  'behold.entity-turn-observation-presentation.v1' as const;
export const ENTITY_TURN_PRIVATE_CAUSAL_FRAMES_PROTOCOL =
  'behold.entity-turn-private-causal-frames.v1' as const;
export const ENTITY_TURN_OBSERVATION_BINDING_PROTOCOL =
  'behold.entity-turn-observation-binding.v1' as const;
export const HUMAN_SEMANTIC_OBSERVATION_PROTOCOL =
  'behold.minecraft-human-semantic-observation.v1' as const;
export const HUMAN_SEMANTIC_BODY_PROFILE = 'minecraft-human-semantic-v1' as const;

export type EntityTurnObservationPresentation = Readonly<{
  protocol: typeof ENTITY_TURN_OBSERVATION_PRESENTATION_PROTOCOL;
  bodyProfile: typeof HUMAN_SEMANTIC_BODY_PROFILE;
  /** Hash of the complete admitted resident mind request containing observation. */
  requestSha256: string;
  /** Exact observation object admitted to the resident mind request. */
  observation: any;
  /** Same versioned body projection applied at the authenticated terminal frame. */
  nextObservation: any;
}>;

type TurnLike = {
  protocol: 'behold.entity-turn.v1';
  circleId?: string;
  id: string;
  entityId: string;
  sequence: number;
  profiles?: {
    policy: string;
    body: string;
    actions: string;
    safety: string;
  };
  experimentRelease?: {
    protocol: string;
    releaseId: string;
    releaseDigest: string;
  };
  observation: any;
  nextObservation: any;
  observationPresentation?: EntityTurnObservationPresentation;
  [key: string]: any;
};

type PrivateCausalFrames = Readonly<{
  protocol: typeof ENTITY_TURN_PRIVATE_CAUSAL_FRAMES_PROTOCOL;
  observation: any;
  nextObservation: any;
}>;

type ObservationBinding = Readonly<{
  protocol: typeof ENTITY_TURN_OBSERVATION_BINDING_PROTOCOL;
  turn: Readonly<{
    id: string;
    entityId: string;
    sequence: number;
    circleId: string | null;
  }>;
  profiles: Readonly<{ body: string; actions: string }>;
  experimentRelease: Readonly<{
    protocol: string;
    releaseId: string;
    releaseDigest: string;
  }> | null;
  requestSha256: string;
  observation: Readonly<{
    source: 'admitted_resident_mind_request';
    protocol: typeof HUMAN_SEMANTIC_OBSERVATION_PROTOCOL;
    projectionSha256: string;
    privateCausalFrameSha256: string;
  }>;
  nextObservation: Readonly<{
    source: 'authenticated_terminal_projection';
    protocol: typeof HUMAN_SEMANTIC_OBSERVATION_PROTOCOL;
    projectionSha256: string;
    privateCausalFrameSha256: string;
  }>;
  digest: string;
}>;

/**
 * Keep the exact safe observation sent to the mind distinct from the private
 * causal frame used by Behold's controller and evaluators.
 */
export function createEntityTurnObservationPresentation(input: {
  requestSha256: string;
  observation: any;
  nextObservation: any;
}): EntityTurnObservationPresentation {
  const requestSha256 = sha256Digest(input.requestSha256, 'resident mind request');
  assertHumanSemanticObservation(input.observation, 'admitted observation');
  assertHumanSemanticObservation(input.nextObservation, 'terminal observation projection');
  return deepFreeze({
    protocol: ENTITY_TURN_OBSERVATION_PRESENTATION_PROTOCOL,
    bodyProfile: HUMAN_SEMANTIC_BODY_PROFILE,
    requestSha256,
    observation: cloneJson(input.observation),
    nextObservation: cloneJson(input.nextObservation),
  });
}

/**
 * Lync's public turn paths contain only the versioned human-semantic body.
 * Raw frames remain byte-for-byte JSON values in a named private evidence
 * field. Textile's profile presenter reads the public paths and never recurses
 * into the private field.
 */
export function encodeEntityTurnForLync<T extends TurnLike>(turn: T): any {
  const presentation = turn.observationPresentation;
  if (!presentation) return turn;
  assertTurnPresentationIdentity(turn, presentation);

  const privateCausalFrames: PrivateCausalFrames = {
    protocol: ENTITY_TURN_PRIVATE_CAUSAL_FRAMES_PROTOCOL,
    observation: cloneJson(turn.observation),
    nextObservation: cloneJson(turn.nextObservation),
  };
  const binding = observationBinding(turn, presentation, privateCausalFrames);
  const { observationPresentation: _presentation, ...base } = turn;
  return {
    ...base,
    observation: cloneJson(presentation.observation),
    nextObservation: cloneJson(presentation.nextObservation),
    privateCausalFrames,
    observationBinding: binding,
  };
}

/** Restore Behold's raw in-process EntityTurn while verifying the stored pair. */
export function decodeEntityTurnFromLync<T extends TurnLike>(value: T): T {
  const privateCausalFrames = value.privateCausalFrames as PrivateCausalFrames | undefined;
  const binding = value.observationBinding as ObservationBinding | undefined;
  if (!privateCausalFrames && !binding) return value;
  if (!privateCausalFrames || !binding) {
    throw new Error('entity turn observation evidence is only partially present');
  }
  if (privateCausalFrames.protocol !== ENTITY_TURN_PRIVATE_CAUSAL_FRAMES_PROTOCOL) {
    throw new Error('unsupported entity turn private causal frame protocol');
  }
  const presentation = createEntityTurnObservationPresentation({
    requestSha256: binding.requestSha256,
    observation: value.observation,
    nextObservation: value.nextObservation,
  });
  const turnForBinding = {
    ...value,
    observation: privateCausalFrames.observation,
    nextObservation: privateCausalFrames.nextObservation,
    observationPresentation: presentation,
  } as T;
  const expected = observationBinding(turnForBinding, presentation, privateCausalFrames);
  if (stableJson(binding) !== stableJson(expected)) {
    throw new Error('entity turn observation binding does not match its turn or causal frames');
  }
  const {
    privateCausalFrames: _privateCausalFrames,
    observationBinding: _observationBinding,
    ...publicTurn
  } = value;
  return {
    ...publicTurn,
    observation: cloneJson(privateCausalFrames.observation),
    nextObservation: cloneJson(privateCausalFrames.nextObservation),
    observationPresentation: presentation,
  } as T;
}

function assertTurnPresentationIdentity(
  turn: TurnLike,
  presentation: EntityTurnObservationPresentation,
) {
  if (presentation.protocol !== ENTITY_TURN_OBSERVATION_PRESENTATION_PROTOCOL) {
    throw new Error('unsupported entity turn observation presentation protocol');
  }
  if (
    presentation.bodyProfile !== HUMAN_SEMANTIC_BODY_PROFILE ||
    turn.profiles?.body !== HUMAN_SEMANTIC_BODY_PROFILE ||
    turn.profiles?.actions !== HUMAN_SEMANTIC_BODY_PROFILE
  ) {
    throw new Error('entity turn observation presentation does not match its body/action profile');
  }
  sha256Digest(presentation.requestSha256, 'resident mind request');
  assertHumanSemanticObservation(presentation.observation, 'admitted observation');
  assertHumanSemanticObservation(presentation.nextObservation, 'terminal observation projection');
}

function observationBinding(
  turn: TurnLike,
  presentation: EntityTurnObservationPresentation,
  privateCausalFrames: PrivateCausalFrames,
): ObservationBinding {
  assertTurnPresentationIdentity(turn, presentation);
  const release = turn.experimentRelease
    ? {
        protocol: experimentReleaseProtocol(turn.experimentRelease.protocol),
        releaseId: sha256Digest(turn.experimentRelease.releaseId, 'experiment release id'),
        releaseDigest: sha256Digest(
          turn.experimentRelease.releaseDigest,
          'experiment release digest',
        ),
      }
    : null;
  const base = {
    protocol: ENTITY_TURN_OBSERVATION_BINDING_PROTOCOL,
    turn: {
      id: requiredString(turn.id, 'turn id'),
      entityId: requiredString(turn.entityId, 'turn entity id'),
      sequence: positiveInteger(turn.sequence, 'turn sequence'),
      circleId: turn.circleId == null ? null : requiredString(turn.circleId, 'turn circle id'),
    },
    profiles: {
      body: requiredString(turn.profiles?.body, 'turn body profile'),
      actions: requiredString(turn.profiles?.actions, 'turn action profile'),
    },
    experimentRelease: release,
    requestSha256: sha256Digest(presentation.requestSha256, 'resident mind request'),
    observation: {
      source: 'admitted_resident_mind_request' as const,
      protocol: HUMAN_SEMANTIC_OBSERVATION_PROTOCOL,
      projectionSha256: valueSha256(presentation.observation),
      privateCausalFrameSha256: valueSha256(privateCausalFrames.observation),
    },
    nextObservation: {
      source: 'authenticated_terminal_projection' as const,
      protocol: HUMAN_SEMANTIC_OBSERVATION_PROTOCOL,
      projectionSha256: valueSha256(presentation.nextObservation),
      privateCausalFrameSha256: valueSha256(privateCausalFrames.nextObservation),
    },
  };
  return deepFreeze({ ...base, digest: valueSha256(base) });
}

function assertHumanSemanticObservation(value: any, label: string) {
  if (
    !value ||
    typeof value !== 'object' ||
    value.protocol !== HUMAN_SEMANTIC_OBSERVATION_PROTOCOL ||
    value.bodyContract?.profile !== HUMAN_SEMANTIC_BODY_PROFILE
  ) {
    throw new Error(`${label} is not a ${HUMAN_SEMANTIC_OBSERVATION_PROTOCOL} frame`);
  }
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a string`);
  return value;
}

function positiveInteger(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function sha256Digest(value: unknown, label: string) {
  const digest = String(value || '')
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`${label} must be a SHA-256 digest`);
  return digest;
}

function experimentReleaseProtocol(value: unknown) {
  if (value !== 'behold.experiment-release-reference.v1') {
    throw new Error('unsupported experiment release reference in observation binding');
  }
  return value;
}

function valueSha256(value: unknown) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function stableJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  return encoded === undefined ? 'null' : encoded;
}

function cloneJson<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}
