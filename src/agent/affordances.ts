import type { InhabitantActionSpec } from '../entity/interface';
import { digPositionIssueForBody } from './body-geometry';

/**
 * Publish Minecraft actions supported by one exact lived observation.
 *
 * This is deliberately world-adapter code, not controller policy. It binds
 * ordinary capabilities to first-person entities, cursor targets, inventory,
 * roster presence, and own remembered routes. It never scans loaded chunks,
 * selects a goal, ranks an action, or claims that execution will succeed.
 */
export function minecraftInhabitantActionsFor(
  specs: readonly InhabitantActionSpec[],
  frame: any,
): InhabitantActionSpec[] {
  const roster = frame?.scene?.social?.playersOnline;
  const inventory = Array.isArray(frame?.self?.inventory) ? frame.self.inventory : [];
  const inventoryNames = inventory
    .filter((item: any) => Number(item?.count) > 0 && String(item?.name || '').length > 0)
    .map((item: any) => String(item.name));
  const placementNames = inventoryNamesForUse(inventory, 'place');
  const consumableNames = inventoryNamesForUse(inventory, 'consume').filter(
    (name) => !finiteAtLeast(frame?.self?.condition?.food, 20) || isAlwaysConsumableItem(name),
  );
  const perceivedEntities = visibleEntities(frame);
  const droppedItems = perceivedEntities.filter(
    (entity: any) => String(entity?.kind || entity?.type || '').toLowerCase() === 'item',
  );
  const embodiedEntities = perceivedEntities.filter(
    (entity: any) => String(entity?.kind || entity?.type || '').toLowerCase() !== 'item',
  );
  const targetIds = (entities: any[]) => entities.map((entity) => String(entity.id));
  const visibleBlocks = visibleBlockTargets(frame);
  const focus = currentReachableBlockFocus(frame);
  const focusName = String(focus?.name || '').toLowerCase();

  return specs.flatMap((spec) => {
    const name = spec.function.name;
    if (name === 'chat' || name === 'whisper') {
      return !Array.isArray(roster) || roster.length > 0 ? [spec] : [];
    }
    if (name === 'face_visible_target') {
      if (visibleBlocks.length === 0) return [];
      return [
        withExactStringEnum(
          withExactStringEnum(
            spec,
            'target',
            visibleBlocks.map((target: any) => String(target.id)),
          ),
          'expectedName',
          [...new Set<string>(visibleBlocks.map((target: any) => String(target.name)))],
        ),
      ];
    }
    if (name === 'cross_visible_door') {
      return focus && isPlayerOperableDoor(focusName)
        ? [withExactStringEnum(spec, 'focus', [focus.id])]
        : [];
    }
    if (name === 'cross_place_door') {
      const position = frame?.self?.pose?.position;
      const dimension = String(frame?.self?.condition?.dimension || '');
      const circleId = String(frame?.circle?.id || '');
      const eligible = (Array.isArray(frame?.self?.places) ? frame.self.places : []).filter(
        (place: any) =>
          place?.evidence === 'doorway_crossed' &&
          place?.circleId === circleId &&
          place?.anchor?.dimension === dimension &&
          Array.isArray(place?.doorways) &&
          place.doorways.some(
            (doorway: any) =>
              sameFeetCell(position, doorway?.sideAFeet) ||
              sameFeetCell(position, doorway?.sideBFeet),
          ),
      );
      return eligible.length > 0
        ? [
            withExactStringEnum(
              spec,
              'id',
              eligible.map((place: any) => String(place.id)),
            ),
          ]
        : [];
    }
    if (name === 'collect_nearby_item') {
      return droppedItems.length > 0
        ? [withExactStringEnum(spec, 'target', targetIds(droppedItems))]
        : [];
    }
    if (name === 'approach_entity' || name === 'attack_entity') {
      return embodiedEntities.length > 0
        ? [withExactStringEnum(spec, 'target', targetIds(embodiedEntities))]
        : [];
    }
    if (name === 'drop_item') {
      return inventoryNames.length > 0 ? [withExactStringEnum(spec, 'name', inventoryNames)] : [];
    }
    if (name === 'equip_item') {
      return inventoryNames.length > 0 ? [withExactStringEnum(spec, 'name', inventoryNames)] : [];
    }
    if (name === 'consume') {
      return consumableNames.length > 0 ? [withExactStringEnum(spec, 'name', consumableNames)] : [];
    }
    if (name === 'craft_item') {
      // Every vanilla recipe consumes at least one ingredient. The exact
      // recipe menu remains an honest future observation surface; an empty
      // body has no crafting affordance at all.
      return inventoryNames.length > 0 ? [spec] : [];
    }
    if (name === 'place_against') {
      const heldItem = String(frame?.self?.heldItem || '');
      return placementNames.includes(heldItem) && focus?.position
        ? [withExactNestedBlockPosition(spec, 'on', focus.position)]
        : [];
    }
    if (name === 'place_block') {
      // Placement cells are not opaque visible surfaces, so the existing
      // coordinate skill cannot yet be narrowed to one exact air cell. Do not
      // claim even that coarse capability when the body carries nothing.
      return placementNames.length > 0 && visibleBlocks.length > 0
        ? [withExactStringEnum(spec, 'name', placementNames)]
        : [];
    }
    if (name === 'dig_block') {
      const targets = visibleBlocks.filter(
        (target: any) =>
          Number.isFinite(Number(target?.distance)) &&
          Number(target.distance) <= 16 &&
          currentBodyCanDigTarget(frame, target),
      );
      return targets.length > 0
        ? [
            withExactStringEnum(
              spec,
              'target',
              targets.map((target: any) => String(target.id)),
            ),
          ]
        : [];
    }
    if (name === 'toggle_block') {
      return focus?.position && isPlayerToggle(focusName)
        ? [withExactBlockPosition(spec, focus.position)]
        : [];
    }
    if (
      name === 'inspect_container' ||
      name === 'deposit_in_container' ||
      name === 'withdraw_from_container'
    ) {
      if (!focus?.position || !isPlayerContainer(focusName)) return [];
      if (name === 'deposit_in_container' && inventoryNames.length === 0) return [];
      const exact = withExactBlockPosition(spec, focus.position);
      return name === 'deposit_in_container'
        ? [withExactStringEnum(exact, 'name', inventoryNames)]
        : [exact];
    }
    if (name === 'sleep_in_bed') {
      return focus?.position &&
        focusName.endsWith('_bed') &&
        frame?.self?.condition?.isDay === false
        ? [withExactBlockPosition(spec, focus.position)]
        : [];
    }
    if (name === 'wake_up') {
      return frame?.self?.condition?.sleeping === true ? [spec] : [];
    }
    return [spec];
  });
}

export function withExactStringEnum(
  spec: InhabitantActionSpec,
  property: string,
  values: readonly string[],
): InhabitantActionSpec {
  const copy = cloneJson(spec) as InhabitantActionSpec;
  const parameters: any = copy.function.parameters || {
    type: 'object',
    properties: {},
  };
  const properties = parameters.properties || {};
  const current = properties[property];
  if (!current) return copy;
  copy.function.parameters = {
    ...parameters,
    properties: {
      ...properties,
      [property]: { ...current, type: 'string', enum: [...values] },
    },
  };
  return copy;
}

export function withExactBlockPosition(
  spec: InhabitantActionSpec,
  position: { x: number; y: number; z: number },
): InhabitantActionSpec {
  return withExactNumber(
    withExactNumber(withExactNumber(spec, 'x', Number(position.x)), 'y', Number(position.y)),
    'z',
    Number(position.z),
  );
}

export function withExactNestedBlockPosition(
  spec: InhabitantActionSpec,
  property: string,
  position: { x: number; y: number; z: number },
): InhabitantActionSpec {
  const copy = cloneJson(spec) as InhabitantActionSpec;
  const nested = (copy.function.parameters as any)?.properties?.[property];
  if (!nested?.properties?.x || !nested?.properties?.y || !nested?.properties?.z) return copy;
  nested.properties.x = exactNumberSchema(nested.properties.x, Number(position.x));
  nested.properties.y = exactNumberSchema(nested.properties.y, Number(position.y));
  nested.properties.z = exactNumberSchema(nested.properties.z, Number(position.z));
  return copy;
}

function withExactNumber(
  spec: InhabitantActionSpec,
  property: string,
  value: number,
): InhabitantActionSpec {
  const copy = cloneJson(spec) as InhabitantActionSpec;
  const parameters: any = copy.function.parameters || {
    type: 'object',
    properties: {},
  };
  const properties = parameters.properties || {};
  const current = properties[property];
  if (!current) return copy;
  copy.function.parameters = {
    ...parameters,
    properties: {
      ...properties,
      [property]: exactNumberSchema(current, value),
    },
  };
  return copy;
}

function exactNumberSchema(schema: any, value: number) {
  return { ...schema, minimum: value, maximum: value };
}

function visibleEntities(frame: any) {
  return frame?.protocol === 'behold.inhabitant.v2' && Array.isArray(frame?.scene?.entities)
    ? frame.scene.entities.filter(
        (entity: any) =>
          entity?.source === 'vision' &&
          entity?.visibility === 'visible' &&
          typeof entity?.id === 'string' &&
          entity.id.length > 0,
      )
    : [];
}

function visibleBlockTargets(frame: any) {
  return frame?.protocol === 'behold.inhabitant.v2' && Array.isArray(frame?.scene?.terrain?.targets)
    ? frame.scene.terrain.targets.filter(
        (target: any) =>
          target?.kind === 'block' &&
          target?.source === 'vision' &&
          target?.visibility === 'visible' &&
          typeof target?.id === 'string' &&
          target.id.length > 0 &&
          typeof target?.name === 'string' &&
          target.name.length > 0,
      )
    : [];
}

function currentReachableBlockFocus(frame: any) {
  const focus = frame?.scene?.focus;
  return focus?.kind === 'block' &&
    focus?.source === 'cursor' &&
    focus?.reachable === true &&
    typeof focus?.id === 'string' &&
    focus.id.length > 0
    ? focus
    : null;
}

function currentBodyCanDigTarget(frame: any, target: any) {
  const body = frame?.self?.pose?.position;
  const position = target?.position;
  if (
    ![body?.x, body?.y, body?.z, position?.x, position?.y, position?.z].every((value) =>
      Number.isFinite(Number(value)),
    )
  ) {
    return false;
  }
  return digPositionIssueForBody(body, position) == null;
}

function inventoryNamesForUse(inventory: any[], use: string) {
  return inventory
    .filter((item: any) => {
      if (!(Number(item?.count) > 0) || !String(item?.name || '')) return false;
      // Older worlds and imported histories may not yet carry item-use
      // metadata. Preserve their coarse catalog rather than silently removing
      // an action; current bodies publish precise registry-derived uses.
      return !Array.isArray(item.uses) || item.uses.includes(use);
    })
    .map((item: any) => String(item.name));
}

function finiteAtLeast(value: unknown, threshold: number) {
  const numeric = Number(value);
  return value != null && Number.isFinite(numeric) && numeric >= threshold;
}

function isAlwaysConsumableItem(name: string) {
  return new Set(['potion', 'milk_bucket', 'enchanted_golden_apple', 'golden_apple']).has(name);
}

function isPlayerOperableDoor(name: string) {
  return name.endsWith('_door') && !name.startsWith('iron_');
}

function isPlayerToggle(name: string) {
  return (
    isPlayerOperableDoor(name) ||
    name.endsWith('_trapdoor') ||
    name.endsWith('_fence_gate') ||
    name === 'lever'
  );
}

function isPlayerContainer(name: string) {
  return (
    name === 'chest' ||
    name === 'trapped_chest' ||
    name === 'barrel' ||
    name.endsWith('_shulker_box')
  );
}

function sameFeetCell(first: any, second: any) {
  return (
    [first?.x, first?.y, first?.z, second?.x, second?.y, second?.z].every((value) =>
      Number.isFinite(Number(value)),
    ) &&
    Math.floor(Number(first.x)) === Math.floor(Number(second.x)) &&
    Math.floor(Number(first.y)) === Math.floor(Number(second.y)) &&
    Math.floor(Number(first.z)) === Math.floor(Number(second.z))
  );
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
