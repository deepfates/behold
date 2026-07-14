import type { InhabitantActionSpec } from '../entity/interface';

export const MINECRAFT_ACTION_PROFILES = ['resident-v1', 'minecraft-player-v1'] as const;
export type MinecraftActionProfile = (typeof MINECRAFT_ACTION_PROFILES)[number];

export const MINECRAFT_SAFETY_PROFILES = ['resident-safe-v1', 'vanilla-player-v1'] as const;
export type MinecraftSafetyProfile = (typeof MINECRAFT_SAFETY_PROFILES)[number];

export type MinecraftActionClass =
  'player-intention' | 'disclosed-composite-skill' | 'resident-memory-utility' | 'unclassified';

// This is intentionally an allowlist. minecraft-player-v1 is a frozen benchmark
// surface: adding a new controller action must not silently widen it.
const PLAYER_ACTION_DESCRIPTIONS = new Map<string, string>([
  ['chat', 'Send one public Minecraft chat message.'],
  ['whisper', 'Send one private Minecraft chat message to an online player.'],
  ['look_direction', 'Turn the body toward one named egocentric direction.'],
  ['face_visible_target', 'Turn to face one exact target in the current visual observation.'],
  ['move_to', 'Walk one bounded leg toward a world position and report the observed result.'],
  ['move_direction', 'Walk one short bounded distance relative to the current first-person view.'],
  ['approach_entity', 'Walk toward one exact entity in the current visual observation.'],
  ['attack_entity', 'Pursue and attack one exact currently perceived entity for a bounded time.'],
  [
    'collect_nearby_item',
    'Pick up one exact currently perceived dropped-item stack with this body.',
  ],
  ['drop_item', 'Drop an owned inventory item into the Minecraft world.'],
  ['stop', 'Stop the body’s current movement.'],
  ['dig_block', 'Break one exact currently visible block target.'],
  ['place_against', 'Place the held block against one chosen face of a visible solid block.'],
  ['toggle_block', 'Use one exact currently visible toggleable block.'],
  ['equip_item', 'Hold or wear one owned inventory item.'],
  ['inspect_container', 'Open one exact visible container and observe its contents.'],
  ['deposit_in_container', 'Move owned inventory items into one exact visible container.'],
  ['withdraw_from_container', 'Move items from one exact visible container into inventory.'],
  ['sleep_in_bed', 'Use one exact visible bed.'],
  ['wake_up', 'Leave the bed while this body is sleeping.'],
  ['consume', 'Consume one owned inventory item.'],
]);

const ACTION_CLASS = new Map<string, MinecraftActionClass>([
  ['manage_project', 'resident-memory-utility'],
  ['cross_place_door', 'resident-memory-utility'],
  ['cross_visible_door', 'disclosed-composite-skill'],
  ['descend_step', 'disclosed-composite-skill'],
  ['ascend_step', 'disclosed-composite-skill'],
  ['place_block', 'disclosed-composite-skill'],
  ['craft_item', 'disclosed-composite-skill'],
]);

/**
 * Select a named inhabitant action surface without changing any action schema.
 *
 * The player profile retains culturally intelligible Minecraft intentions and
 * removes only Behold memory utilities and explicitly compound body skills.
 * Observation-bound target/schema narrowing still happens later, from the
 * body's current first-person frame.
 */
export function minecraftActionsForProfile(
  specs: readonly InhabitantActionSpec[],
  profile: MinecraftActionProfile,
): InhabitantActionSpec[] {
  if (profile === 'resident-v1') return [...specs];
  return specs.flatMap((spec) => {
    const description = PLAYER_ACTION_DESCRIPTIONS.get(spec.function.name);
    return description ? [{ ...spec, function: { ...spec.function, description } }] : [];
  });
}

export function minecraftActionClass(name: string): MinecraftActionClass {
  return (
    ACTION_CLASS.get(name) ??
    (PLAYER_ACTION_DESCRIPTIONS.has(name) ? 'player-intention' : 'unclassified')
  );
}

export function minecraftActionProfile(value: unknown): MinecraftActionProfile {
  const normalized = String(value || 'resident-v1').trim();
  if (MINECRAFT_ACTION_PROFILES.includes(normalized as MinecraftActionProfile)) {
    return normalized as MinecraftActionProfile;
  }
  throw new Error(
    `Unsupported Minecraft action profile ${JSON.stringify(value)}; expected ${MINECRAFT_ACTION_PROFILES.join(' or ')}`,
  );
}

export function minecraftSafetyProfile(value: unknown): MinecraftSafetyProfile {
  const normalized = String(value || 'resident-safe-v1').trim();
  if (MINECRAFT_SAFETY_PROFILES.includes(normalized as MinecraftSafetyProfile)) {
    return normalized as MinecraftSafetyProfile;
  }
  throw new Error(
    `Unsupported Minecraft safety profile ${JSON.stringify(value)}; expected ${MINECRAFT_SAFETY_PROFILES.join(' or ')}`,
  );
}

export function usesResidentSafety(profile: MinecraftSafetyProfile) {
  return profile === 'resident-safe-v1';
}
