import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { Vec3 } from 'vec3';
import { io as connectViewer } from 'socket.io-client';
import {
  RESIDENT_VIEWER_PROTOCOL,
  startResidentViewer,
} from '../src/observability/resident-viewer';
import { managedResidentViewerEndpoints } from '../scripts/world-runner';

test('managed viewers assign one symmetric loopback endpoint per resident', () => {
  const viewers = managedResidentViewerEndpoints(
    { protocol: RESIDENT_VIEWER_PROTOCOL, basePort: 30_070, viewDistance: 6 },
    [{ entityId: 'Aster' }, { entityId: 'Birch' }],
  );
  assert.deepEqual(viewers, [
    {
      protocol: RESIDENT_VIEWER_PROTOCOL,
      endpoint: 'http://127.0.0.1:30070',
      host: '127.0.0.1',
      port: 30_070,
      firstPerson: true,
      readOnly: true,
      viewDistance: 6,
    },
    {
      protocol: RESIDENT_VIEWER_PROTOCOL,
      endpoint: 'http://127.0.0.1:30071',
      host: '127.0.0.1',
      port: 30_071,
      firstPerson: true,
      readOnly: true,
      viewDistance: 6,
    },
  ]);
  assert.throws(
    () =>
      managedResidentViewerEndpoints(
        { protocol: RESIDENT_VIEWER_PROTOCOL, basePort: 65_535, viewDistance: 6 },
        [{ entityId: 'Aster' }, { entityId: 'Birch' }],
      ),
    (error: any) => error?.code === 'resident_viewer_port_invalid',
  );
});

test('two read-only resident viewers stream independently and close every listener', async () => {
  const aster = fakeBot('Aster');
  const birch = fakeBot('Birch');
  const first = await startResidentViewer(aster as any, {
    host: '127.0.0.1',
    port: 0,
    firstPerson: true,
    viewDistance: 2,
  });
  const second = await startResidentViewer(birch as any, {
    host: '127.0.0.1',
    port: 0,
    firstPerson: true,
    viewDistance: 2,
  });
  try {
    assert.notEqual(first.port, second.port);
    const firstClient = connectViewer(first.endpoint, {
      path: '/socket.io',
      transports: ['websocket'],
      forceNew: true,
    });
    const secondClient = connectViewer(second.endpoint, {
      path: '/socket.io',
      transports: ['websocket'],
      forceNew: true,
    });
    await Promise.all([socketOnce(firstClient, 'connect'), socketOnce(secondClient, 'connect')]);
    const firstPosition = socketOnce(firstClient, 'position');
    const secondPosition = socketOnce(secondClient, 'position');
    aster.emit('move');
    birch.emit('move');
    assert.equal((await firstPosition).pos.x, 1);
    assert.equal((await secondPosition).pos.x, 2);

    let residentInput = 0;
    aster.on('viewer_input', () => residentInput++);
    firstClient.emit('mouseClick', {
      origin: { x: 1, y: 64, z: 1 },
      direction: { x: 0, y: 0, z: 1 },
      button: 0,
    });
    firstClient.emit('chat', 'not admitted');
    firstClient.emit('control', { forward: true });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(residentInput, 0);

    firstClient.disconnect();
    secondClient.disconnect();
  } finally {
    await Promise.all([first.close(), first.close(), second.close(), second.close()]);
  }
  for (const bot of [aster, birch]) {
    for (const event of ['move', 'entitySpawn', 'entityMoved', 'entityGone', 'chunkColumnLoad']) {
      assert.equal(bot.listenerCount(event), 0, `${bot.username} retained ${event}`);
    }
  }
  await assert.rejects(fetch(first.endpoint), /fetch failed/);
  await assert.rejects(fetch(second.endpoint), /fetch failed/);
});

function socketOnce(socket: ReturnType<typeof connectViewer>, event: string): Promise<any> {
  return new Promise((resolve) => socket.once(event, resolve));
}

function fakeBot(username: string) {
  const bot: any = new EventEmitter();
  bot.username = username;
  bot.version = '1.21.4';
  bot.entity = {
    position: new Vec3(username === 'Aster' ? 1 : 2, 64, 1),
    yaw: 0,
    pitch: 0,
  };
  bot.entities = {};
  bot.world = {
    getColumnAt: async () => null,
    raycast: () => null,
  };
  return bot;
}
