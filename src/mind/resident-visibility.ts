import { residentMayReplayAction } from '../agent/action-audience';
import type { EntityTurn } from '../entity/loom';

const EXTERNAL_PLACE_AFFORDANCES = new Set([
  'sealed-space',
  'covered-space',
  'shared-capacity',
  'closable-entrance',
]);

/** Remove knowledge that was produced only by a non-resident instrument. */
export function projectResidentVisibleValue(value: any, depth = 0): any {
  if (value == null || typeof value !== 'object') return value;
  if (depth >= 12) return '[depth bounded]';
  if (Array.isArray(value)) {
    return value.map((item) => projectResidentVisibleValue(item, depth + 1));
  }
  if (isNonResidentWitness(value)) {
    return {
      ...(Number.isSafeInteger(Number(value.sequence)) ? { sequence: Number(value.sequence) } : {}),
      action: String(value.action),
      ...(value.world ? { world: projectResidentVisibleValue(value.world, depth + 1) } : {}),
      evidenceOmitted: true,
      reason: 'not_resident_observable',
    };
  }
  if (isLegacyExternalPlace(value)) {
    return {
      ...Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          projectResidentVisibleValue(item, depth + 1),
        ]),
      ),
      affordances: [
        ...(Array.isArray(value.affordances)
          ? value.affordances.filter(
              (affordance: any) => !EXTERNAL_PLACE_AFFORDANCES.has(String(affordance)),
            )
          : []),
        'legacy-external-place-record',
      ],
      protectedBodyCells: [],
      entrances: [],
      note: 'Legacy evaluator-derived geometry is withheld; relearn usable routes through ordinary embodied evidence.',
    };
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, projectResidentVisibleValue(item, depth + 1)]),
  );
}

export function containsNonResidentEvidence(value: any, depth = 0): boolean {
  if (value == null || typeof value !== 'object' || depth >= 12) return false;
  if (Array.isArray(value)) {
    return value.some((item) => containsNonResidentEvidence(item, depth + 1));
  }
  if (isNonResidentWitness(value) || isLegacyExternalPlace(value)) return true;
  return Object.values(value).some((item) => containsNonResidentEvidence(item, depth + 1));
}

export function residentTurnMayReplay(turn: EntityTurn) {
  return (
    residentMayReplayAction(turn.action.name) && !containsNonResidentEvidence(turn.outcome.result)
  );
}

function isNonResidentWitness(value: any) {
  return typeof value?.action === 'string' && !residentMayReplayAction(value.action);
}

function isLegacyExternalPlace(value: any) {
  return (
    value?.evidence === 'space_enclosed' &&
    (Array.isArray(value?.protectedBodyCells) || Array.isArray(value?.entrances))
  );
}
