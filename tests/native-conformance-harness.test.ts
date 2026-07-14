import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { disconnectMinecraftBot, waitForLocalWorld } from '../scripts/native-conformance-harness';

test('local-world readiness handles an already spawned body and removes every temporary listener', async () => {
  const bot = fakeBot({ spawned: true });
  await waitForLocalWorld(bot, 100, 'ready body');
  assert.equal(bot.chunkLoads, 1);
  assertNoLifecycleListeners(bot);
});

test('local-world readiness waits for spawn exactly once', async () => {
  const bot = fakeBot();
  const ready = waitForLocalWorld(bot, 100, 'spawning body');
  bot.entity = { id: 1 };
  bot.emit('spawn');
  bot.emit('spawn');
  await ready;
  assert.equal(bot.chunkLoads, 1);
  assertNoLifecycleListeners(bot);
});

test('local-world readiness fails visibly for error, kick, disconnect, and timeout', async (t) => {
  await t.test('error', async () => {
    const bot = fakeBot();
    const failure = waitForLocalWorld(bot, 100, 'error body');
    bot.emit('error', new Error('network failed'));
    await assert.rejects(failure, /network failed/);
    assertNoLifecycleListeners(bot);
  });
  await t.test('kick', async () => {
    const bot = fakeBot();
    const failure = waitForLocalWorld(bot, 100, 'kicked body');
    bot.emit('kicked', { reason: 'nope' });
    await assert.rejects(failure, /kicked body was kicked:.*nope/);
    assertNoLifecycleListeners(bot);
  });
  await t.test('disconnect', async () => {
    const bot = fakeBot();
    const failure = waitForLocalWorld(bot, 100, 'ended body');
    bot.emit('end', 'socketClosed');
    await assert.rejects(failure, /ended body disconnected before readiness: socketClosed/);
    assertNoLifecycleListeners(bot);
  });
  await t.test('timeout', async () => {
    const bot = fakeBot();
    await assert.rejects(waitForLocalWorld(bot, 5, 'slow body'), /slow body timed out/);
    assertNoLifecycleListeners(bot);
  });
});

test('Minecraft disconnect clears its end listener on acknowledgement, fallback, and throw', async (t) => {
  await t.test('acknowledged', async () => {
    const bot = fakeBot({ connected: true, end: (body) => body.emit('end', 'clientClosed') });
    await disconnectMinecraftBot(bot, 100);
    assert.equal(bot.listenerCount('end'), 0);
  });
  await t.test('fallback', async () => {
    const bot = fakeBot({ connected: true });
    await disconnectMinecraftBot(bot, 5);
    assert.equal(bot.listenerCount('end'), 0);
  });
  await t.test('throw', async () => {
    const bot = fakeBot({
      connected: true,
      end: () => {
        throw new Error('end failed');
      },
    });
    await disconnectMinecraftBot(bot, 100);
    assert.equal(bot.listenerCount('end'), 0);
  });
});

function fakeBot(
  options: {
    spawned?: boolean;
    connected?: boolean;
    end?: (bot: any) => void;
  } = {},
) {
  const bot = new EventEmitter() as any;
  bot.entity = options.spawned ? { id: 1 } : null;
  bot._client = options.connected ? {} : null;
  bot.chunkLoads = 0;
  bot.waitForChunksToLoad = async () => {
    bot.chunkLoads += 1;
  };
  bot.end = () => options.end?.(bot);
  return bot;
}

function assertNoLifecycleListeners(bot: EventEmitter) {
  for (const event of ['spawn', 'error', 'kicked', 'end']) {
    assert.equal(bot.listenerCount(event), 0, `${event} listener leaked`);
  }
}
