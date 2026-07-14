import type { createBot } from '../src/bot';

export async function waitForLocalWorld(
  bot: ReturnType<typeof createBot>,
  timeoutMs: number,
  label = 'native conformance local world',
) {
  const ready = (async () => {
    if (!(bot as any).entity) {
      await new Promise<void>((resolve, reject) => {
        bot.once('spawn', resolve);
        bot.once('error', reject);
      });
    }
    await bot.waitForChunksToLoad();
  })();
  let timer: NodeJS.Timeout | null = null;
  try {
    await Promise.race([
      ready,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function waitForManagerStop(
  bot: ReturnType<typeof createBot>,
  label = 'native conformance',
) {
  process.stdin.resume();
  return new Promise<void>((resolve, reject) => {
    process.stdin.once('end', resolve);
    bot.once('end', (reason) =>
      reject(new Error(`Minecraft ended before ${label} manager stop: ${reason}`)),
    );
  });
}

export function disconnectMinecraftBot(bot: ReturnType<typeof createBot>) {
  if (!(bot as any)._client) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 5_000);
    bot.once('end', () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      (bot as any).end();
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

export function requiredEnvironment(name: string) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function positionDistance(before: any, after: any) {
  if (!before || !after) return Infinity;
  return Math.hypot(
    Number(after.x) - Number(before.x),
    Number(after.y) - Number(before.y),
    Number(after.z) - Number(before.z),
  );
}
