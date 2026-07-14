import type { EntityTurn } from './loom';
import type { ProjectEvidence } from './projects';
import type { InhabitantProject } from './projects';

const DEFAULT_PLACE_LIMIT = 8;
const SPATIAL_PROJECT_EVIDENCE = new Set<ProjectEvidence>([
  'space_enclosed',
  'place_reached',
  'world_change',
]);

export type PlaceAnchor = {
  dimension: string | null;
  x: number;
  y: number;
  z: number;
};

export type RememberedEntrance = {
  name: string;
  lower: { x: number; y: number; z: number };
  upper: { x: number; y: number; z: number } | null;
  insideFeet: { x: number; y: number; z: number } | null;
  outsideFeet: { x: number; y: number; z: number } | null;
  rememberedState: string | null;
};

/**
 * A bounded, actionable memory of a place witnessed in one inhabitant's life.
 *
 * This is not current server truth. The anchor and affordances describe what
 * the inhabitant previously proved, and must be re-observed when current state
 * matters. The complete immutable turn remains the evidence.
 */
export type InhabitantPlace = {
  id: string;
  label: string;
  purpose: string | null;
  anchor: PlaceAnchor;
  affordances: string[];
  protectedBodyCells: Array<{ x: number; y: number; z: number }>;
  entrances: RememberedEntrance[];
  evidence: Extract<ProjectEvidence, 'space_enclosed' | 'place_reached' | 'world_change'>;
  learnedAtSequence: number;
  lastConfirmedAtSequence: number;
  provenance: {
    source: 'own_entity_loom';
    projectId: string;
    completionTurnSequence: number;
    witnessTurnSequence: number | null;
    witnessAction: string | null;
  };
};

export type SituatedInhabitantPlace = InhabitantPlace & {
  source: 'memory';
  sameDimension: boolean | null;
  distance: number | null;
  note: string;
};

export type PlaceMemory = {
  snapshot: () => InhabitantPlace[];
  validate: (turn: EntityTurn) => void;
  record: (turn: EntityTurn) => void;
};

export type ProjectPlaceConflict = {
  projectId: string;
  placeId: string;
  distance: number;
  reason: string;
  requiredResolution: string;
};

/**
 * Rebuild durable place affordances exclusively from an inhabitant's own loom.
 *
 * A place enters the projection only after a project with spatial evidence is
 * completed against a real witness. Nearby improvements coalesce into one
 * place instead of producing a new "home" for every repaired door or wall.
 */
export function createPlaceMemory(
  entityId: string,
  history: EntityTurn[] = [],
  limit = DEFAULT_PLACE_LIMIT,
): PlaceMemory {
  const places = new Map<string, InhabitantPlace>();
  const boundedLimit = Math.max(1, Math.min(32, Math.floor(Number(limit) || DEFAULT_PLACE_LIMIT)));

  const validate = (turn: EntityTurn) => {
    if (turn.entityId !== entityId) {
      throw new Error(`place memory expected ${entityId}, received ${turn.entityId}`);
    }
  };

  const record = (turn: EntityTurn) => {
    validate(turn);
    const candidate = placeFromCompletedProject(turn);
    if (candidate) upsertPlace(places, candidate);
    refreshFromInspection(places, turn);
  };

  for (const turn of history) record(turn);

  return {
    snapshot: () =>
      [...places.values()]
        .sort(
          (a, b) =>
            evidencePriority(b.evidence) - evidencePriority(a.evidence) ||
            b.lastConfirmedAtSequence - a.lastConfirmedAtSequence ||
            a.id.localeCompare(b.id),
        )
        .slice(0, boundedLimit)
        .map(clonePlace),
    validate,
    record,
  };
}

export function situatePlaces(
  places: InhabitantPlace[],
  position: { x: number; y: number; z: number } | null,
  dimension: string | null,
): SituatedInhabitantPlace[] {
  return places
    .map((place) => {
      const sameDimension =
        place.anchor.dimension == null || dimension == null
          ? null
          : place.anchor.dimension === dimension;
      const distance =
        position && sameDimension !== false
          ? round(
              Math.hypot(
                position.x - place.anchor.x,
                position.y - place.anchor.y,
                position.z - place.anchor.z,
              ),
            )
          : null;
      return {
        ...clonePlace(place),
        source: 'memory' as const,
        sameDimension,
        distance,
        note: 'Remembered from an earlier witness; current conditions require observation on arrival.',
      };
    })
    .sort(
      (a, b) =>
        Number(b.sameDimension === true) - Number(a.sameDimension === true) ||
        finiteDistance(a.distance) - finiteDistance(b.distance) ||
        b.lastConfirmedAtSequence - a.lastConfirmedAtSequence,
    );
}

/**
 * Expose a commitment contradiction instead of hoping a model notices it in
 * prose: a later shelter project is suspicious when an earlier, nearby shelter
 * already witnessed every required physical affordance. Returns, repairs,
 * improvements, and explicitly separate outposts are not contradictions.
 */
export function findProjectPlaceConflicts(
  projects: InhabitantProject[],
  places: SituatedInhabitantPlace[],
): ProjectPlaceConflict[] {
  const conflicts: ProjectPlaceConflict[] = [];
  for (const project of projects) {
    if (project.evidence !== 'space_enclosed') continue;
    if (namesExistingOrAdditionalPlace(project)) continue;
    const place = places.find(
      (candidate) =>
        candidate.evidence === 'space_enclosed' &&
        candidate.sameDimension !== false &&
        candidate.distance != null &&
        candidate.distance > 8 &&
        candidate.distance <= 64 &&
        candidate.learnedAtSequence < project.startedAtSequence &&
        ['sealed-space', 'covered-space', 'shared-capacity', 'closable-entrance'].every(
          (affordance) => candidate.affordances.includes(affordance),
        ),
    );
    if (!place || place.distance == null) continue;
    conflicts.push({
      projectId: project.id,
      placeId: place.id,
      distance: place.distance,
      reason:
        'This project seeks an enclosed shared shelter, but your own earlier witness remembers one nearby with sealed, covered, shared, and closable-entrance affordances.',
      requiredResolution:
        'Abandon the duplicate project, or update it to explicitly name returning to, repairing, improving, or deliberately establishing a separate place.',
    });
  }
  return conflicts;
}

function placeFromCompletedProject(turn: EntityTurn): InhabitantPlace | null {
  if (
    !turn.outcome.ok ||
    turn.action.name !== 'manage_project' ||
    String(turn.action.input?.operation || '') !== 'complete'
  ) {
    return null;
  }
  const result = turn.outcome.result;
  const evidence = String(result?.evidence?.expected || result?.project?.evidence || '');
  if (!SPATIAL_PROJECT_EVIDENCE.has(evidence as ProjectEvidence)) return null;
  if (result?.evidence?.satisfied !== true) return null;

  const anchor = witnessAnchor(result?.evidence?.witness, turn, evidence as ProjectEvidence);
  if (!anchor) return null;
  const projectId = boundedText(result?.project?.id || turn.action.input?.id, 96);
  const label = boundedText(
    result?.project?.title || turn.action.input?.title || projectId || 'Remembered place',
    120,
  );
  const witnessSequence = finiteInteger(result?.evidence?.witness?.sequence);

  return {
    id: placeId(anchor),
    label,
    purpose: boundedText(result?.project?.doneWhen || turn.action.input?.doneWhen, 240) || null,
    anchor,
    affordances: witnessedAffordances(evidence as ProjectEvidence, result?.evidence?.witness, turn),
    protectedBodyCells: witnessedProtectedBodyCells(result?.evidence?.witness),
    entrances: witnessedEntrances(result?.evidence?.witness),
    evidence: evidence as InhabitantPlace['evidence'],
    learnedAtSequence: turn.sequence,
    lastConfirmedAtSequence: witnessSequence ?? turn.sequence,
    provenance: {
      source: 'own_entity_loom',
      projectId: projectId || String(turn.sequence),
      completionTurnSequence: turn.sequence,
      witnessTurnSequence: witnessSequence,
      witnessAction: boundedText(result?.evidence?.witness?.action, 64) || null,
    },
  };
}

function witnessAnchor(
  witness: any,
  turn: EntityTurn,
  evidence: ProjectEvidence,
): PlaceAnchor | null {
  const position =
    (evidence === 'space_enclosed' && witness?.result?.seedFeet) ||
    (evidence === 'place_reached' && witness?.after) ||
    turn.nextObservation?.self?.pose?.position ||
    turn.observation?.self?.pose?.position ||
    spatialInput(witness?.input) ||
    spatialInput(witness?.result);
  if (!isPosition(position)) return null;
  const dimension =
    stringOrNull(turn.nextObservation?.self?.condition?.dimension) ??
    stringOrNull(turn.observation?.self?.condition?.dimension);
  return {
    dimension,
    x: round(Number(position.x)),
    y: round(Number(position.y)),
    z: round(Number(position.z)),
  };
}

function spatialInput(value: any) {
  if (isPosition(value)) return value;
  for (const key of ['feet', 'position', 'target', 'on', 'before', 'after']) {
    if (isPosition(value?.[key])) return value[key];
  }
  const change = Array.isArray(value?.changes) ? value.changes[0] : null;
  if (isPosition(change?.position)) return change.position;
  return null;
}

function witnessedAffordances(evidence: ProjectEvidence, witness: any, turn: EntityTurn) {
  const result = witness?.result || {};
  const affordances = new Set<string>();
  if (evidence === 'space_enclosed') {
    if (result.sealed === true) affordances.add('sealed-space');
    if (result.fullyCovered === true) affordances.add('covered-space');
    if (result.sharedCapacity === true) affordances.add('shared-capacity');
    if (Number(result.closableEntranceCount) >= 1) affordances.add('closable-entrance');
  } else if (evidence === 'place_reached') {
    affordances.add('reached-destination');
  } else if (evidence === 'world_change') {
    affordances.add('built-or-modified-site');
  }

  const materials = turn.nextObservation?.scene?.terrain?.materials;
  const names = new Set(
    (Array.isArray(materials) ? materials : []).map((item: any) => String(item?.name || '')),
  );
  if (names.has('crafting_table')) affordances.add('crafting-nearby');
  if ([...names].some((name) => name === 'chest' || name.endsWith('_chest') || name === 'barrel')) {
    affordances.add('storage-nearby');
  }
  if ([...names].some((name) => name.endsWith('_bed'))) affordances.add('sleep-nearby');
  if ([...names].some((name) => name.includes('torch') || name.includes('lantern'))) {
    affordances.add('light-nearby');
  }
  return [...affordances];
}

function refreshFromInspection(places: Map<string, InhabitantPlace>, turn: EntityTurn) {
  if (!turn.outcome.ok || turn.action.name !== 'inspect_reachable_space') return;
  const result = turn.outcome.result;
  if (!isPosition(result?.seedFeet)) return;
  const dimension =
    stringOrNull(turn.nextObservation?.self?.condition?.dimension) ??
    stringOrNull(turn.observation?.self?.condition?.dimension);
  const candidate = [...places.values()].find(
    (place) =>
      sameDimension(place.anchor.dimension, dimension) &&
      distance(place.anchor, result.seedFeet) <= 4,
  );
  if (!candidate || candidate.evidence !== 'space_enclosed') return;
  if (
    result.sealed === true &&
    result.fullyCovered === true &&
    result.sharedCapacity === true &&
    Number(result.closableEntranceCount) >= 1
  ) {
    candidate.lastConfirmedAtSequence = turn.sequence;
    candidate.affordances = witnessedAffordances('space_enclosed', { result }, turn);
    candidate.protectedBodyCells = uniquePositions([
      ...candidate.protectedBodyCells,
      ...witnessedProtectedBodyCells({ result }),
    ]);
    candidate.entrances = mergeEntrances(candidate.entrances, witnessedEntrances({ result }));
  }
}

function upsertPlace(places: Map<string, InhabitantPlace>, candidate: InhabitantPlace) {
  const nearby = [...places.values()].find(
    (place) =>
      sameDimension(place.anchor.dimension, candidate.anchor.dimension) &&
      distance(place.anchor, candidate.anchor) <= 4,
  );
  if (!nearby) {
    places.set(candidate.id, candidate);
    return;
  }
  const nearbyPriority = evidencePriority(nearby.evidence);
  const candidatePriority = evidencePriority(candidate.evidence);
  // One place record has one evidence/provenance chain. Never let a weaker,
  // later completion relabel stronger legacy geometry or advance its witness.
  if (candidatePriority < nearbyPriority) return;
  if (candidatePriority > nearbyPriority) {
    places.delete(nearby.id);
    places.set(candidate.id, candidate);
    return;
  }
  const id = nearby.id;
  places.set(id, {
    ...nearby,
    ...candidate,
    id,
    affordances: [...new Set([...nearby.affordances, ...candidate.affordances])],
    protectedBodyCells: uniquePositions([
      ...nearby.protectedBodyCells,
      ...candidate.protectedBodyCells,
    ]),
    entrances: mergeEntrances(nearby.entrances, candidate.entrances),
    learnedAtSequence: Math.min(nearby.learnedAtSequence, candidate.learnedAtSequence),
    lastConfirmedAtSequence: Math.max(
      nearby.lastConfirmedAtSequence,
      candidate.lastConfirmedAtSequence,
    ),
  });
}

function clonePlace(place: InhabitantPlace): InhabitantPlace {
  return {
    ...place,
    anchor: { ...place.anchor },
    affordances: [...place.affordances],
    protectedBodyCells: place.protectedBodyCells.map((position) => ({ ...position })),
    entrances: place.entrances.map((entrance) => ({
      ...entrance,
      lower: { ...entrance.lower },
      upper: entrance.upper ? { ...entrance.upper } : null,
      insideFeet: entrance.insideFeet ? { ...entrance.insideFeet } : null,
      outsideFeet: entrance.outsideFeet ? { ...entrance.outsideFeet } : null,
    })),
    provenance: { ...place.provenance },
  };
}

function evidencePriority(evidence: InhabitantPlace['evidence']) {
  if (evidence === 'space_enclosed') return 3;
  if (evidence === 'world_change') return 2;
  return 1;
}

function isPosition(value: any) {
  return [value?.x, value?.y, value?.z].every((part) => Number.isFinite(Number(part)));
}

function sameDimension(a: string | null, b: string | null) {
  return a == null || b == null || a === b;
}

function distance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return Math.hypot(a.x - Number(b.x), a.y - Number(b.y), a.z - Number(b.z));
}

function finiteDistance(value: number | null) {
  return value == null || !Number.isFinite(value) ? Number.POSITIVE_INFINITY : value;
}

function finiteInteger(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function stringOrNull(value: unknown) {
  const text = boundedText(value, 96);
  return text || null;
}

function boundedText(value: unknown, limit: number) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function placeId(anchor: PlaceAnchor) {
  const dimension = boundedText(anchor.dimension || 'unknown', 96).replace(/[^a-zA-Z0-9_-]+/g, '-');
  return `place:${dimension}:${anchor.x}:${anchor.y}:${anchor.z}`;
}

function namesExistingOrAdditionalPlace(project: InhabitantProject) {
  const language = `${project.title} ${project.nextStep} ${project.doneWhen || ''}`.toLowerCase();
  return /\b(?:return|repair|improve|expand|renovate|existing|known|second|another|additional|separate|outpost|remote|distant)\b/.test(
    language,
  );
}

function witnessedProtectedBodyCells(witness: any) {
  const cells = Array.isArray(witness?.result?.protectedCells)
    ? witness.result.protectedCells
        .map((cell: any) => cell?.feet)
        .filter(isPosition)
        .map((position: any) => ({
          x: Math.floor(Number(position.x)),
          y: Math.floor(Number(position.y)),
          z: Math.floor(Number(position.z)),
        }))
    : [];
  return uniquePositions(cells);
}

function uniquePositions(positions: Array<{ x: number; y: number; z: number }>) {
  const unique = new Map<string, { x: number; y: number; z: number }>();
  for (const position of positions) {
    unique.set(`${position.x}:${position.y}:${position.z}`, { ...position });
  }
  return [...unique.values()].slice(0, 32);
}

function witnessedEntrances(witness: any): RememberedEntrance[] {
  const entrances = Array.isArray(witness?.result?.closableEntrances)
    ? witness.result.closableEntrances
    : [];
  return entrances
    .filter((entrance: any) => isPosition(entrance?.lower))
    .map((entrance: any) => ({
      name: boundedText(entrance.name || 'door', 64),
      lower: integerPosition(entrance.lower)!,
      upper: integerPosition(entrance.upper),
      insideFeet: integerPosition(entrance.fromProtectedFeet),
      outsideFeet: integerPosition(entrance.outsideFeet),
      rememberedState: boundedText(entrance.state, 32) || null,
    }))
    .slice(0, 8);
}

function mergeEntrances(previous: RememberedEntrance[], current: RememberedEntrance[]) {
  const merged = new Map<string, RememberedEntrance>();
  for (const entrance of [...previous, ...current]) {
    merged.set(`${entrance.lower.x}:${entrance.lower.y}:${entrance.lower.z}`, entrance);
  }
  return [...merged.values()].slice(0, 8);
}

function integerPosition(value: any) {
  if (!isPosition(value)) return null;
  return {
    x: Math.floor(Number(value.x)),
    y: Math.floor(Number(value.y)),
    z: Math.floor(Number(value.z)),
  };
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}
