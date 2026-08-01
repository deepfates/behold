import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { Vec3 } from 'vec3';
import { io as connectViewer } from 'socket.io-client';
import {
  RESIDENT_CAMERA_CAPTURE_PROTOCOL,
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

test('patched Prismarine renderer retains visible terrain below Y=0', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Chunk = require('prismarine-chunk')('1.21.4');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { World } = require('prismarine-viewer/viewer/lib/world');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getSectionGeometry } = require('prismarine-viewer/viewer/lib/models');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const blockStates = require('prismarine-viewer/public/blocksStates/1.21.4.json');
  const column = new Chunk();
  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) {
      column.setBlockStateId(new Vec3(x, -64, z), 85); // bedrock
      column.setBlockStateId(new Vec3(x, -63, z), 10); // dirt
      column.setBlockStateId(new Vec3(x, -62, z), 10); // dirt
      column.setBlockStateId(new Vec3(x, -61, z), 9); // grass_block
    }
  }
  const world = new World('1.21.4');
  world.addColumn(0, 0, column.toJson());

  const geometry = getSectionGeometry(0, -64, 0, world, blockStates);
  assert.ok(geometry.positions.length > 0, 'negative-Y terrain produced no visible vertices');
  assert.ok(geometry.indices.length > 0, 'negative-Y terrain produced no visible faces');
});

test('an aborted camera request starts no renderer and returns no frame', async () => {
  const bot = fakeBot('AbortBody');
  const viewer = await startResidentViewer(bot as any, {
    host: '127.0.0.1',
    port: 0,
    firstPerson: true,
    viewDistance: 2,
  });
  try {
    const abort = new AbortController();
    abort.abort(new Error('decision opportunity ended'));
    await assert.rejects(
      viewer.captureFrame(residentObservation(bot), { signal: abort.signal }),
      /decision opportunity ended/,
    );
  } finally {
    await viewer.close();
  }
});

test('capture renderer returns one frame bound to the exact current resident pose', async (t) => {
  const executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (!require('node:fs').existsSync(executablePath)) {
    t.skip('installed Chrome is unavailable');
    return;
  }
  const bot = fakeBot('CameraBody');
  const viewer = await startResidentViewer(bot as any, {
    host: '127.0.0.1',
    port: 0,
    firstPerson: true,
    viewDistance: 2,
  });
  try {
    const observation = residentObservation(bot);
    const mismatched = structuredClone(observation);
    mismatched.self.pose.yaw += 0.1;
    await assert.rejects(
      viewer.captureFrame(mismatched, { executablePath }),
      /differs from the current body pose/,
    );

    const frame = await viewer.captureFrame(observation, { executablePath, timeoutMs: 15_000 });
    assert.equal(viewer.cameraCaptureProtocol, RESIDENT_CAMERA_CAPTURE_PROTOCOL);
    assert.equal(frame.content.mediaType, 'image/jpeg');
    assert.equal(frame.content.width, 512);
    assert.equal(frame.content.height, 512);
    assert.ok(frame.content.bytes > 100);
    assert.equal(frame.binding.body.username, 'CameraBody');
    assert.deepEqual(frame.binding.pose, {
      position: { x: 2, y: 64, z: 1 },
      yaw: 0,
      pitch: 0,
    });
    assert.deepEqual(frame.binding.camera, {
      position: { x: 2, y: 65.62, z: 1 },
      yaw: 0,
      pitch: 0,
    });
    assert.equal(frame.renderer.name, 'prismarine-viewer-browser');
    assert.equal(frame.renderer.firstPerson, true);
    assert.equal(frame.renderer.readOnly, true);
  } finally {
    await viewer.close();
  }
});

function socketOnce(socket: ReturnType<typeof connectViewer>, event: string): Promise<any> {
  return new Promise((resolve) => socket.once(event, resolve));
}

function fakeBot(username: string) {
  const bot: any = new EventEmitter();
  bot.username = username;
  bot.player = { uuid: '00000000-0000-4000-8000-000000000001' };
  bot.version = '1.21.4';
  bot.entity = {
    position: new Vec3(username === 'Aster' ? 1 : 2, 64, 1),
    yaw: 0,
    pitch: 0,
    eyeHeight: 1.62,
    uuid: '00000000-0000-4000-8000-000000000001',
  };
  bot.entities = {};
  bot.world = {
    getColumnAt: async () => null,
    raycast: () => null,
  };
  return bot;
}

function residentObservation(bot: any) {
  return {
    protocol: 'behold.inhabitant.v2',
    circle: { id: 'minecraft:camera-test', substrate: 'minecraft', managedRunId: 'run-camera' },
    sequence: 1,
    observedAt: Date.now(),
    self: {
      identity: 'CameraResident',
      body: { substrate: 'minecraft', username: bot.username, uuid: bot.player.uuid },
      pose: {
        position: { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z },
        yaw: bot.entity.yaw,
        pitch: bot.entity.pitch,
        velocity: { x: 0, y: 0, z: 0 },
        onGround: true,
      },
      condition: { dimension: 'minecraft:overworld' },
    },
    events: [],
  };
}
