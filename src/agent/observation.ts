import type { Bot } from 'mineflayer';

export type ChatLine = { username: string; message: string; at: number } | null;

export function collectObservation(bot: Bot, lastChat: ChatLine) {
  const pos = (bot as any).entity?.position;
  const position = pos ? { x: pos.x, y: pos.y, z: pos.z } : null;
  const time = (bot as any).time?.time;
  const dimension = (bot as any).game?.dimension;
  return {
    time: Date.now(),
    username: (bot as any).username,
    position,
    health: (bot as any).health,
    food: (bot as any).food,
    mcTime: time,
    dimension,
    lastChat,
  };
}

