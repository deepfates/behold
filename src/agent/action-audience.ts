export type ActionAudience = 'inhabitant' | 'operator' | 'privileged';

const NON_RESIDENT_ACTION_AUDIENCE = new Map<string, Exclude<ActionAudience, 'inhabitant'>>([
  ['look', 'operator'],
  ['set_control', 'operator'],
  ['clear_controls', 'operator'],
  ['stop_digging', 'operator'],
  ['find_blocks', 'privileged'],
  ['inspect_volume', 'privileged'],
  ['inspect_reachable_space', 'privileged'],
  ['nearest_entity', 'privileged'],
  ['get_nearby', 'privileged'],
  ['survey_area', 'privileged'],
]);

export function declaredNonResidentAudience(name: string) {
  return NON_RESIDENT_ACTION_AUDIENCE.get(name) ?? null;
}

export function residentMayReplayAction(name: string) {
  return !NON_RESIDENT_ACTION_AUDIENCE.has(name);
}
