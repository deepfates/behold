import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { Vec3 } from 'vec3';
import { startResidentLensServer } from '../src/observability/resident-lens-server';
import { startResidentViewer } from '../src/observability/resident-viewer';
import {
  createResidentCameraFrame,
  createResidentCameraRenderer,
} from '../src/perception/resident-camera-frame';

test('resident lens server follows journals over GET and SSE and closes its listener', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-resident-lens-'));
  fs.writeFileSync(
    path.join(directory, '2026-07-01T00-00-00-000Z-Scout.jsonl'),
    line(1, 'run_started', { runId: 'older-run', body: { username: 'Body' } }),
  );
  const journal = path.join(directory, '2026-07-02T00-00-00-000Z-Scout.jsonl');
  fs.writeFileSync(journal, line(1, 'run_started', { runId: 'run-1', body: { username: 'Body' } }));
  const lifecycle = path.join(directory, 'lifecycle.log');
  fs.writeFileSync(
    lifecycle,
    `${JSON.stringify({
      sequence: 1,
      at: new Date(1_000).toISOString(),
      type: 'run_configured',
      data: {
        runId: 'world-1-1',
        world: { id: 'world-1' },
        population: { residents: [{ entityId: 'Scout' }] },
      },
    })}\n${JSON.stringify({
      sequence: 2,
      at: new Date(2_000).toISOString(),
      type: 'run_ready',
      data: { serverPid: 99 },
    })}\n`,
  );
  const server = await startResidentLensServer({
    residents: [
      {
        entityId: 'Scout',
        bodyUsername: 'Body',
        journalDirectory: directory,
        viewerEndpoint: 'http://127.0.0.1:3007',
        staleAfterMs: 500,
      },
    ],
    pollMs: 10,
    lifecycleFile: lifecycle,
    now: () => 3_000,
  });
  try {
    assert.equal(server.host, '127.0.0.1');
    assert.equal(server.readOnly, true);
    const initial = await fetch(`${server.endpoint}/api/residents`).then((response) =>
      response.json(),
    );
    assert.equal(initial[0].state.runId, 'run-1');
    assert.equal(initial[0].state.cursor.journalSequence, 1);
    assert.equal(initial[0].source.file, journal);
    assert.equal(initial[0].source.ageMs, 2_000);
    assert.equal(initial[0].source.stale, true);
    assert.equal(initial[0].viewerEndpoint, 'http://127.0.0.1:3007');
    assert.equal(initial[0].camera.status, 'not_configured');

    const habitat = await fetch(`${server.endpoint}/api/habitat`).then((response) =>
      response.json(),
    );
    assert.equal(habitat.state.worldId, 'world-1');
    assert.equal(habitat.state.runId, 'world-1-1');
    assert.equal(habitat.state.phase, 'running');
    assert.equal(habitat.source.file, lifecycle);
    assert.equal(habitat.residents[0].entityId, 'Scout');

    const page = await fetch(server.endpoint);
    assert.match(
      page.headers.get('content-security-policy') ?? '',
      /img-src 'self' http:\/\/127\.0\.0\.1:\*/,
    );
    const html = await page.text();
    assert.match(html, /new EventSource\('\/api\/events'\)/);
    assert.match(html, /\/api\/habitat/);
    assert.match(html, /event=>renderHabitat/);
    assert.match(html, /\['experience',view\.state\.sees\]/);
    assert.match(html, /\['choice',choice\(view\.state\.chooses\)\]/);
    assert.match(html, /\['attempt',view\.state\.doing\]/);
    assert.match(html, /optional narration/);
    assert.match(html, /controller ·/);
    assert.match(html, /observed ethogram/);
    assert.match(html, /Lync progress/);
    assert.match(html, /latest admitted camera frame/);
    assert.match(html, /canonical detail/);
    assert.match(html, /STALE/);
    assert.doesNotMatch(html, /<iframe/);
    assert.doesNotMatch(html, /\['decision',view\.state\.decision\]/);
    const inlineScript = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
    assert.ok(inlineScript);
    assert.doesNotThrow(() => new vm.Script(inlineScript));

    const stream = await fetch(`${server.endpoint}/api/events`);
    assert.equal(stream.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    const reader = stream.body!.getReader();
    await readSseUntil(reader, (event) => event.name === 'residents');

    fs.appendFileSync(
      journal,
      line(2, 'resident_decision_opportunity', {
        opportunityId: 'opp-1',
        phase: 'scheduled',
        at: 100,
      }),
    );
    await waitFor(async () => {
      const views = await fetch(`${server.endpoint}/api/residents`).then((response) =>
        response.json(),
      );
      return views[0].state.phase === 'deciding';
    });
    const update = await readSseUntil(
      reader,
      (event) => event.name === 'residents' && event.data.includes('"phase":"deciding"'),
    );
    assert.equal(update.name, 'residents');
    assert.match(update.data, /"phase":"deciding"/);
    await reader.cancel();

    const rejected = await fetch(`${server.endpoint}/api/residents`, { method: 'POST' });
    assert.equal(rejected.status, 405);
    assert.deepEqual(await rejected.json(), { error: 'read_only' });
  } finally {
    await server.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
  await assert.rejects(fetch(`${server.endpoint}/api/residents`));
});

test('resident lens displays the exact latest admitted frame and rejects foreign binding', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-resident-camera-lens-'));
  fs.writeFileSync(
    path.join(directory, 'resident.jsonl'),
    line(1, 'run_started', { runId: 'run-camera', body: { username: 'Body' } }),
  );
  const bot = cameraBot('Body');
  const viewer = await startResidentViewer(bot as any, {
    host: '127.0.0.1',
    port: 0,
    firstPerson: true,
    viewDistance: 2,
  });
  viewer.retainAdmittedFrame(cameraFrame('Scout', 'Body', 4, 1_000));
  const lens = await startResidentLensServer({
    residents: [
      {
        entityId: 'Scout',
        bodyUsername: 'Body',
        journalDirectory: directory,
        viewerEndpoint: viewer.endpoint,
        admittedFrameEndpoint: viewer.admittedFrameEndpoint,
        staleAfterMs: 500,
      },
    ],
    pollMs: 10,
    now: () => 3_000,
  });
  try {
    const [view] = await fetch(`${lens.endpoint}/api/residents`).then((response) =>
      response.json(),
    );
    assert.equal(view.camera.status, 'available');
    assert.equal(view.camera.ageMs, 2_000);
    assert.equal(view.camera.staleAfterMs, 500);
    assert.equal(view.camera.stale, true);
    assert.equal(view.camera.error, null);
    assert.equal(view.camera.frame.binding.entityId, 'Scout');
    assert.equal(view.camera.frame.binding.body.username, 'Body');
    assert.equal(view.camera.frame.binding.observationSequence, 4);
    assert.match(view.camera.frame.digest, /^[0-9a-f]{64}$/);
    assert.match(view.camera.frame.bindingSha256, /^[0-9a-f]{64}$/);
    assert.equal(view.camera.frame.content.data, undefined);
    assert.equal((await fetch(view.camera.frame.imageEndpoint)).status, 200);

    viewer.retainAdmittedFrame(cameraFrame('Intruder', 'Body', 5, 2_000));
    await waitFor(async () => {
      const [next] = await fetch(`${lens.endpoint}/api/residents`).then((response) =>
        response.json(),
      );
      return next.camera.status === 'unavailable';
    });
    const [rejected] = await fetch(`${lens.endpoint}/api/residents`).then((response) =>
      response.json(),
    );
    assert.match(rejected.camera.error, /another resident or body/);
    assert.equal(rejected.camera.frame, null);
  } finally {
    await lens.close();
    await viewer.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('resident lens server reports a missing journal without creating storage', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-resident-lens-missing-'));
  const missing = path.join(parent, 'does-not-exist');
  const server = await startResidentLensServer({
    residents: [
      {
        entityId: 'Scout',
        bodyUsername: 'Body',
        journalDirectory: missing,
        viewerEndpoint: null,
      },
    ],
    pollMs: 10,
  });
  try {
    const views = await fetch(`${server.endpoint}/api/residents`).then((response) =>
      response.json(),
    );
    assert.equal(views[0].source.status, 'unavailable');
    assert.match(views[0].source.error, /ENOENT/);
    assert.equal(fs.existsSync(missing), false);
  } finally {
    await server.close();
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('resident lens control capability authenticates pause resume and stop separately from projections', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-resident-control-'));
  fs.writeFileSync(
    path.join(directory, 'resident.jsonl'),
    line(1, 'run_started', { runId: 'run-control', body: { username: 'Body' } }),
  );
  const actions: string[] = [];
  const server = await startResidentLensServer({
    residents: [
      {
        entityId: 'Scout',
        bodyUsername: 'Body',
        journalDirectory: directory,
        viewerEndpoint: null,
      },
    ],
    control: {
      pause: () => {
        actions.push('pause');
      },
      resume: () => {
        actions.push('resume');
      },
      stop: () => {
        actions.push('stop');
      },
    },
  });
  try {
    assert.equal(server.controls.available, true);
    const endpoint = new URL(server.endpoint);
    const token = new URLSearchParams(endpoint.hash.slice(1)).get('control');
    assert.ok(token);
    const base = endpoint.origin;

    const rejected = await fetch(`${base}/api/control`, {
      method: 'POST',
      body: JSON.stringify({ action: 'pause' }),
    });
    assert.equal(rejected.status, 403);

    for (const action of ['pause', 'resume', 'stop']) {
      const response = await fetch(`${base}/api/control`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action }),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { acknowledged: true, action });
    }
    assert.deepEqual(actions, ['pause', 'resume', 'stop']);
  } finally {
    await server.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function line(sequence: number, type: string, data: any) {
  return `${JSON.stringify({
    sequence,
    at: new Date(sequence * 1_000).toISOString(),
    agent: 'Scout',
    type,
    data,
  })}\n`;
}

async function waitFor(predicate: () => Promise<boolean>) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for resident lens update');
}

async function readSseUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (event: { name: string; data: string }) => boolean,
) {
  const decoder = new TextDecoder();
  let pending = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) throw new Error('resident lens SSE closed before the expected event');
    pending += decoder.decode(value, { stream: true });
    const frames = pending.split(/\r?\n\r?\n/);
    pending = frames.pop() ?? '';
    for (const frame of frames) {
      let name = 'message';
      const data: string[] = [];
      for (const field of frame.split(/\r?\n/)) {
        if (field.startsWith('event:')) name = field.slice('event:'.length).trimStart();
        if (field.startsWith('data:')) data.push(field.slice('data:'.length).trimStart());
      }
      const event = { name, data: data.join('\n') };
      if (predicate(event)) return event;
    }
  }
}

function cameraBot(username: string) {
  const bot: any = new EventEmitter();
  bot.username = username;
  bot.player = { uuid: '00000000-0000-4000-8000-000000000001' };
  bot.version = '1.21.4';
  bot.entity = {
    position: new Vec3(2, 64, 1),
    yaw: 0,
    pitch: 0,
    eyeHeight: 1.62,
  };
  bot.entities = {};
  bot.world = { getColumnAt: async () => null, raycast: () => null };
  return bot;
}

function cameraFrame(entityId: string, bodyUsername: string, sequence: number, capturedAt: number) {
  const observation = {
    protocol: 'behold.inhabitant.v2',
    circle: { id: 'minecraft:camera-lens', substrate: 'minecraft', managedRunId: 'run-camera' },
    sequence,
    observedAt: capturedAt - 10,
    self: {
      identity: entityId,
      body: {
        substrate: 'minecraft',
        username: bodyUsername,
        uuid: '00000000-0000-4000-8000-000000000001',
      },
      pose: {
        position: { x: 2, y: 64, z: 1 },
        yaw: 0,
        pitch: 0,
        velocity: { x: 0, y: 0, z: 0 },
        onGround: true,
      },
      condition: { dimension: 'minecraft:overworld' },
    },
    events: [],
  };
  return createResidentCameraFrame({
    bytes: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC',
      'base64',
    ),
    mediaType: 'image/png',
    observation,
    renderedCamera: { position: { x: 2, y: 65.62, z: 1 }, yaw: 0, pitch: 0 },
    renderer: createResidentCameraRenderer({
      name: 'lens-fixture',
      version: '1',
      implementationSha256: '56'.repeat(32),
      verticalFovDegrees: 75,
      width: 10,
      height: 10,
      viewDistanceChunks: 2,
    }),
    captureStartedAt: capturedAt - 2,
    captureCompletedAt: capturedAt,
  });
}
