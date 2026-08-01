import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  RESIDENT_CAMERA_BINDING_PROTOCOL,
  RESIDENT_CAMERA_FRAME_PROTOCOL,
  RESIDENT_CAMERA_RENDERER_PROTOCOL,
  admitResidentCameraFrame,
  admitResidentCameraFrameFreshness,
  createResidentCameraFrame,
  createResidentCameraRenderer,
  parseResidentCameraFrame,
  perspectiveHorizontalFovDegrees,
} from '../src/perception/resident-camera-frame';

// The same deterministic 10x10 red PNG used by LM Studio's documented image fixture.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC',
  'base64',
);
const IMPLEMENTATION_SHA256 = '12'.repeat(32);

test('camera frame binds exact bytes, viewport, renderer, body pose, and observation', () => {
  const observation = residentObservation();
  const beforeObservation = structuredClone(observation);
  const beforeBytes = Buffer.from(PNG);
  const renderer = fixtureRenderer();

  const frame = createResidentCameraFrame({
    bytes: PNG,
    mediaType: 'image/png',
    observation,
    renderer,
    renderedCamera: fixtureCamera(),
    captureStartedAt: 1_010,
    captureCompletedAt: 1_014,
  });
  const parsed = parseResidentCameraFrame(structuredClone(frame));

  assert.equal(parsed.protocol, RESIDENT_CAMERA_FRAME_PROTOCOL);
  assert.deepEqual(parsed, frame);
  assert.equal(parsed.content.sha256, createHash('sha256').update(PNG).digest('hex'));
  assert.equal(parsed.content.bytes, PNG.byteLength);
  assert.equal(parsed.content.width, 10);
  assert.equal(parsed.content.height, 10);
  assert.equal(parsed.renderer.protocol, RESIDENT_CAMERA_RENDERER_PROTOCOL);
  assert.equal(parsed.renderer.name, 'deterministic-fixture');
  assert.equal(parsed.renderer.implementationSha256, IMPLEMENTATION_SHA256);
  assert.equal(parsed.renderer.verticalFovDegrees, 75);
  assert.equal(parsed.renderer.horizontalFovDegrees, 75);
  assert.equal(parsed.renderer.viewDistanceChunks, 6);
  assert.equal(parsed.renderer.firstPerson, true);
  assert.equal(parsed.renderer.readOnly, true);
  assert.equal(parsed.binding.protocol, RESIDENT_CAMERA_BINDING_PROTOCOL);
  assert.equal(parsed.binding.circleId, 'minecraft:test-circle');
  assert.equal(parsed.binding.managedRunId, 'run-1');
  assert.equal(parsed.binding.observationSequence, 7);
  assert.equal(parsed.binding.entityId, 'Aster');
  assert.deepEqual(parsed.binding.body, {
    username: 'AsterBot',
    uuid: '00000000-0000-4000-8000-000000000001',
    dimension: 'minecraft:overworld',
  });
  assert.deepEqual(parsed.binding.pose, {
    position: { x: 12.25, y: 64, z: -3.5 },
    yaw: 0.5,
    pitch: -0.25,
  });
  assert.deepEqual(parsed.binding.camera, fixtureCamera());
  assert.match(parsed.binding.observationSha256, /^[0-9a-f]{64}$/);
  assert.match(parsed.bindingSha256, /^[0-9a-f]{64}$/);
  assert.match(parsed.digest, /^[0-9a-f]{64}$/);
  assert.ok(Object.isFrozen(parsed));
  assert.ok(Object.isFrozen(parsed.binding.pose.position));

  assert.deepEqual(observation, beforeObservation, 'camera binding mutated the body observation');
  assert.deepEqual(PNG, beforeBytes, 'camera binding mutated captured bytes');
});

test('camera frame creation is deterministic and rejects content or renderer drift', () => {
  const input = {
    bytes: PNG,
    mediaType: 'image/png' as const,
    observation: residentObservation(),
    renderer: fixtureRenderer(),
    renderedCamera: fixtureCamera(),
    captureStartedAt: 1_010,
    captureCompletedAt: 1_014,
  };
  const first = createResidentCameraFrame(input);
  const second = createResidentCameraFrame(input);
  assert.deepEqual(second, first);

  const changedBytes: any = structuredClone(first);
  const decoded = Buffer.from(changedBytes.content.data, 'base64');
  decoded[decoded.length - 1] ^= 1;
  changedBytes.content.data = decoded.toString('base64');
  throwsCode(() => parseResidentCameraFrame(changedBytes), 'resident_camera_content_mismatch');

  const falseDimensions: any = structuredClone(first);
  falseDimensions.content.width = 11;
  throwsCode(() => parseResidentCameraFrame(falseDimensions), 'resident_camera_content_mismatch');

  const falseProjection: any = structuredClone(first);
  falseProjection.renderer.horizontalFovDegrees = 90;
  throwsCode(() => parseResidentCameraFrame(falseProjection), 'resident_camera_invalid');

  const falseCamera: any = structuredClone(first);
  falseCamera.binding.camera.position.x += 1;
  throwsCode(() => parseResidentCameraFrame(falseCamera), 'resident_camera_observation_mismatch');
});

test('camera admission fails closed for another observation, resident body, or pose', () => {
  const observation = residentObservation();
  const frame = createResidentCameraFrame({
    bytes: PNG,
    mediaType: 'image/png',
    observation,
    renderer: fixtureRenderer(),
    renderedCamera: fixtureCamera(),
    captureStartedAt: 1_010,
    captureCompletedAt: 1_014,
  });
  const admit = (candidate: unknown) =>
    admitResidentCameraFrame({
      frame,
      observation: candidate,
      now: 1_020,
      maxAgeMs: 20,
      maxCaptureDurationMs: 10,
    });

  assert.deepEqual(admit(observation), frame);
  for (const mutate of [
    (value: any) => value.sequence++,
    (value: any) => (value.self.identity = 'Birch'),
    (value: any) => (value.self.body.uuid = '00000000-0000-4000-8000-000000000002'),
    (value: any) => (value.self.condition.dimension = 'minecraft:the_nether'),
    (value: any) => (value.self.pose.position.x += 0.01),
    (value: any) => (value.self.pose.yaw += 0.01),
    (value: any) => value.events.push({ sequence: 8, type: 'self_hurt' }),
  ]) {
    const changed = structuredClone(observation);
    mutate(changed);
    throwsCode(() => admit(changed), 'resident_camera_observation_mismatch');
  }
});

test('camera admission rejects aged, future, and overlong captures', () => {
  const observation = residentObservation();
  const frame = createResidentCameraFrame({
    bytes: PNG,
    mediaType: 'image/png',
    observation,
    renderer: fixtureRenderer(),
    renderedCamera: fixtureCamera(),
    captureStartedAt: 1_010,
    captureCompletedAt: 1_014,
  });
  const admitAt = (now: number, maxAgeMs = 20, maxCaptureDurationMs = 10) =>
    admitResidentCameraFrame({ frame, observation, now, maxAgeMs, maxCaptureDurationMs });

  assert.deepEqual(admitAt(1_034), frame);
  throwsCode(() => admitAt(1_035), 'resident_camera_stale');
  throwsCode(() => admitAt(1_013), 'resident_camera_stale');
  throwsCode(() => admitAt(1_020, 20, 3), 'resident_camera_stale');

  assert.deepEqual(
    admitResidentCameraFrameFreshness({
      frame,
      now: 1_034,
      maxAgeMs: 20,
      maxCaptureDurationMs: 10,
    }),
    frame,
  );
  throwsCode(
    () =>
      admitResidentCameraFrameFreshness({
        frame,
        now: 1_035,
        maxAgeMs: 20,
        maxCaptureDurationMs: 10,
      }),
    'resident_camera_stale',
  );
});

test('perspective camera metadata derives horizontal FOV from the exact viewport', () => {
  const horizontal = perspectiveHorizontalFovDegrees(70, 544, 320);
  assert.ok(horizontal > 99 && horizontal < 101);
  const renderer = createResidentCameraRenderer({
    name: 'prismarine-viewer',
    version: '1.33.0',
    implementationSha256: 'ab'.repeat(32),
    verticalFovDegrees: 70,
    width: 544,
    height: 320,
    viewDistanceChunks: 6,
  });
  assert.equal(renderer.horizontalFovDegrees, horizontal);
});

function fixtureRenderer() {
  return createResidentCameraRenderer({
    name: 'deterministic-fixture',
    version: '1',
    implementationSha256: IMPLEMENTATION_SHA256,
    verticalFovDegrees: 75,
    width: 10,
    height: 10,
    viewDistanceChunks: 6,
  });
}

function fixtureCamera() {
  return {
    position: { x: 12.25, y: 65.62, z: -3.5 },
    yaw: 0.5,
    pitch: -0.25,
  };
}

function residentObservation() {
  return {
    protocol: 'behold.inhabitant.v2',
    circle: {
      id: 'minecraft:test-circle',
      substrate: 'minecraft',
      managedRunId: 'run-1',
    },
    sequence: 7,
    observedAt: 1_000,
    eventWindow: {
      requestedAfterSequence: 4,
      oldestAvailableSequence: 5,
      newestAvailableSequence: 7,
      missingBeforeOldest: 0,
      complete: true,
    },
    task: null,
    self: {
      identity: 'Aster',
      body: {
        substrate: 'minecraft',
        username: 'AsterBot',
        uuid: '00000000-0000-4000-8000-000000000001',
      },
      pose: {
        position: { x: 12.25, y: 64, z: -3.5 },
        yaw: 0.5,
        pitch: -0.25,
        velocity: { x: 0, y: 0, z: 0 },
        onGround: true,
      },
      condition: {
        health: 20,
        food: 20,
        oxygen: 20,
        sleeping: false,
        dimension: 'minecraft:overworld',
        isDay: true,
      },
      heldItem: null,
      inventory: [],
      projects: [],
      places: [],
      placeConflicts: [],
      currentAction: null,
    },
    scene: {
      social: { source: 'server_roster', playersOnline: ['AsterBot'], note: '' },
      focus: null,
      entities: [],
      terrain: {
        source: 'vision',
        horizontalFovDegrees: 100,
        verticalFovDegrees: 70,
        maxDistance: 24,
        raysCast: 1,
        raysHit: 0,
        failedRays: 0,
        materials: [],
        targets: [],
        visualField: { rows: [] },
        note: '',
      },
    },
    events: [],
  };
}

function throwsCode(action: () => unknown, code: string) {
  assert.throws(action, (error: any) => error?.code === code);
}
