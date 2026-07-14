import type { createBot } from '../src/bot';

export async function waitForLocalWorld(
  bot: ReturnType<typeof createBot>,
  timeoutMs: number,
  label = 'native conformance local world',
) {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let chunkLoadStarted = false;
    let timer: NodeJS.Timeout | null = null;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      bot.removeListener('spawn', onSpawn);
      bot.removeListener('error', onError);
      bot.removeListener('kicked', onKicked);
      bot.removeListener('end', onEnd);
    };
    const pass = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const onError = (error: unknown) => fail(error);
    const onKicked = (reason: unknown) =>
      fail(new Error(`${label} was kicked: ${safeReason(reason)}`));
    const onEnd = (reason: unknown) =>
      fail(new Error(`${label} disconnected before readiness: ${String(reason)}`));
    const onSpawn = () => {
      if (chunkLoadStarted) return;
      chunkLoadStarted = true;
      void bot.waitForChunksToLoad().then(pass, fail);
    };
    bot.once('spawn', onSpawn);
    bot.once('error', onError);
    bot.once('kicked', onKicked);
    bot.once('end', onEnd);
    timer = setTimeout(() => fail(new Error(`${label} timed out`)), timeoutMs);
    if ((bot as any).entity) onSpawn();
  });
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

export function disconnectMinecraftBot(bot: ReturnType<typeof createBot>, timeoutMs = 5_000) {
  if (!(bot as any)._client) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | null = null;
    const onEnd = () => finish();
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      bot.removeListener('end', onEnd);
      resolve();
    };
    bot.once('end', onEnd);
    timer = setTimeout(finish, timeoutMs);
    try {
      (bot as any).end();
    } catch {
      finish();
    }
  });
}

function safeReason(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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
