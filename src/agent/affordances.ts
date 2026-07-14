import type { InhabitantActionSpec } from '../entity/interface';

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
  const perceivedEntities = visibleEntities(frame);
  const droppedItems = perceivedEntities.filter(
    (entity: any) => String(entity?.kind || entity?.type || '').toLowerCase() === 'item',
  );
  const embodiedEntities = perceivedEntities.filter(
    (entity: any) => String(entity?.kind || entity?.type || '').toLowerCase() !== 'item',
  );
  const targetIds = (entities: any[]) => entities.map((entity) => String(entity.id));
  const visibleBlocks = visibleBlockTargets(frame);

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
      const focus = frame?.scene?.focus;
      const blockName = String(focus?.name || '').toLowerCase();
      return focus?.kind === 'block' &&
        focus?.source === 'cursor' &&
        focus?.reachable === true &&
        typeof focus?.id === 'string' &&
        isPlayerOperableDoor(blockName)
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
      return inventory.some(
        (item: any) => Number(item?.count) > 0 && String(item?.name || '').length > 0,
      )
        ? [spec]
        : [];
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
  const current = properties[property] || { type: 'string' };
  copy.function.parameters = {
    ...parameters,
    properties: {
      ...properties,
      [property]: { ...current, type: 'string', enum: [...values] },
    },
  };
  return copy;
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

function isPlayerOperableDoor(name: string) {
  return name.endsWith('_door') && !name.startsWith('iron_');
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
