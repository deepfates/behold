import { Vec3 } from 'vec3';
import { isAir } from './inspection-core.mjs';
import { sleep, waitUntil } from './minecraft-harness.mjs';

export function standableSurface(bot, x, z) {
  const minimumY = bot.game.minY ?? -64;
  const maximumY = minimumY + (bot.game.height ?? 384) - 1;
  for (let y = maximumY; y >= minimumY; y -= 1) {
    const block = bot.blockAt(new Vec3(x, y, z), false);
    if (!block || isAir(block.name)) continue;
    const above = bot.blockAt(new Vec3(x, y + 1, z), false);
    const aboveTwo = bot.blockAt(new Vec3(x, y + 2, z), false);
    if (
      above &&
      aboveTwo &&
      isAir(above.name) &&
      isAir(aboveTwo.name) &&
      !/(water|lava)/.test(block.name)
    )
      return { x, y, z, block: block.name };
  }
  return null;
}

export function chooseMedianSurface(candidates, checkpoint) {
  if (!candidates.length) return null;
  const heights = candidates.map((candidate) => candidate.y).sort((left, right) => left - right);
  const medianY = heights[Math.floor(heights.length / 2)];
  return [...candidates].sort(
    (left, right) =>
      Math.abs(left.y - medianY) - Math.abs(right.y - medianY) ||
      Math.hypot(left.x - checkpoint.x, left.z - checkpoint.z) -
        Math.hypot(right.x - checkpoint.x, right.z - checkpoint.z),
  )[0];
}

export async function prepareObservationSite({
  server,
  bot,
  checkpoint,
  gameMode,
  label = 'observation site',
}) {
  const highY = Math.min((bot.game.minY ?? -64) + (bot.game.height ?? 384) - 16, 384);
  server.command(`gamemode spectator ${bot.username}`);
  server.command(`tp ${bot.username} ${checkpoint.x + 0.5} ${highY} ${checkpoint.z + 0.5}`);
  await waitUntil(
    () =>
      Math.abs(bot.entity.position.x - (checkpoint.x + 0.5)) < 2 &&
      Math.abs(bot.entity.position.z - (checkpoint.z + 0.5)) < 2 &&
      bot.world.getColumn(Math.floor(checkpoint.x / 16), Math.floor(checkpoint.z / 16)),
    20_000,
    label,
  );
  await sleep(250);
  const candidates = [];
  for (let dx = -8; dx <= 8; dx += 4)
    for (let dz = -8; dz <= 8; dz += 4) {
      const surface = standableSurface(bot, checkpoint.x + dx, checkpoint.z + dz);
      if (surface) candidates.push(surface);
    }
  const site = chooseMedianSurface(candidates, checkpoint);
  if (!site) throw new Error(`No standable site near ${checkpoint.id}`);
  server.command(`tp ${bot.username} ${site.x + 0.5} ${site.y + 1} ${site.z + 0.5}`);
  server.command(`spawnpoint ${bot.username} ${site.x} ${site.y + 1} ${site.z}`);
  server.command(`gamemode ${gameMode} ${bot.username}`);
  await waitUntil(
    () => Math.abs(bot.entity.position.y - (site.y + 1)) < 2,
    10_000,
    `${label} placement`,
  );
  return { checkpointId: checkpoint.id, ...site };
}
