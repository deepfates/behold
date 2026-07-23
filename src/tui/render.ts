import type { Bot } from 'mineflayer';
import { collectObservation } from '../agent/observation';

export type Frame = {
  position?: { x: number; y: number; z: number } | null;
  health?: number;
  food?: number;
  dimension?: string | null;
  isDay?: boolean | null;
  heldItem?: string | null;
  cursor?: {
    kind: 'block' | 'entity';
    name?: string;
    username?: string;
    x?: number;
    y?: number;
    z?: number;
    dist?: number;
  } | null;
  nearby?: Array<{ idx: number; kind: string; name?: string; username?: string; dist?: number }>;
  chatTail?: Array<{ user: string; text: string }>;
  last?: string | null;
  inventory?: Array<{ name: string; count: number }>;
  nearbyBlocks?: Array<{ name: string; count: number }>;
};

export function buildFrame(bot: Bot, cache: any): Frame {
  const observation = collectObservation(bot, null);
  const pos = (bot as any).entity?.position;
  const position = pos ? { x: pos.x, y: pos.y, z: pos.z } : null;
  const held: any = (bot as any).heldItem;
  const time = (bot as any).time;
  const isDay = time ? !!time.isDay : null;

  return {
    position,
    health: (bot as any).health,
    food: (bot as any).food,
    heldItem: held?.name || held?.displayName || null,
    dimension: (bot as any).game?.dimension ?? null,
    isDay,
    cursor: cache.cursor || null,
    nearby: cache.nearby || [],
    chatTail: cache.chatTail || [],
    last: cache.last || null,
    inventory: observation.inventory,
    nearbyBlocks: observation.nearbyBlocks,
  };
}

export function renderFrame(name: string, f: Frame) {
  const lines: string[] = [];
  const pos = f.position
    ? `${fmt(f.position.x)},${fmt(f.position.y)},${fmt(f.position.z)}`
    : '?, ?, ?';
  const hp = f.health != null ? `${Math.round(f.health)}/20` : '?/20';
  const food = f.food != null ? `${Math.round(f.food)}/20` : '?/20';
  const day = f.isDay == null ? '' : f.isDay ? 'day' : 'night';
  const held = f.heldItem ? ` | held ${f.heldItem}` : '';
  lines.push(
    `[${name}] pos ${pos} | hp ${hp} food ${food} | ${f.dimension ?? ''} ${day}${held}`.trim(),
  );

  let focus = 'none';
  if (f.cursor) {
    if (f.cursor.kind === 'block')
      focus = `block ${f.cursor.name ?? ''} @ ${fmt(f.cursor.x)},${fmt(f.cursor.y)},${fmt(f.cursor.z)}`;
    if (f.cursor.kind === 'entity')
      focus = `entity ${f.cursor.username ?? f.cursor.name ?? ''} @ ${fmt(f.cursor.dist)}m`;
  }
  lines.push(`[${name}] focus ${focus}`);

  if (f.nearby && f.nearby.length) {
    const items = f.nearby
      .slice(0, 5)
      .map((n) => `#${n.idx} ${n.username ?? n.name ?? n.kind} ${fmt(n.dist)}m`)
      .join('  ');
    lines.push(`[${name}] nearby: ${items}`);
  }

  if (f.inventory && f.inventory.length) {
    lines.push(
      `[${name}] inventory: ${f.inventory
        .slice(0, 6)
        .map((item) => `${item.name}×${item.count}`)
        .join(', ')}`,
    );
  }

  if (f.nearbyBlocks && f.nearbyBlocks.length) {
    lines.push(
      `[${name}] terrain: ${f.nearbyBlocks
        .slice(0, 5)
        .map((block) => `${block.name}×${block.count}`)
        .join(', ')}`,
    );
  }

  if (f.chatTail && f.chatTail.length) {
    const last = f.chatTail[f.chatTail.length - 1];
    lines.push(`[${name}] chat <${last.user}> ${last.text}`);
  }

  if (f.last) lines.push(`[${name}] last: ${f.last}`);

  return lines.join('\n');
}

function fmt(n: any) {
  const x = Number(n);
  if (!Number.isFinite(x)) return String(n);
  return Math.abs(x) >= 100 ? Math.round(x) : Math.round(x * 10) / 10;
}
