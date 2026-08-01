import { createHash } from 'node:crypto';

export const RESIDENT_CAMERA_FRAME_PROTOCOL = 'behold.resident-camera-frame.v1' as const;
export const RESIDENT_CAMERA_MAX_AGE_MS = 5_000;
export const RESIDENT_CAMERA_MAX_CAPTURE_DURATION_MS = 15_000;
export const RESIDENT_CAMERA_BINDING_PROTOCOL = 'behold.resident-camera-binding.v1' as const;
export const RESIDENT_CAMERA_RENDERER_PROTOCOL = 'behold.resident-camera-renderer.v1' as const;
export const MAX_RESIDENT_CAMERA_FRAME_BYTES = 2 * 1024 * 1024;

export type ResidentCameraRenderer = Readonly<{
  protocol: typeof RESIDENT_CAMERA_RENDERER_PROTOCOL;
  name: string;
  version: string;
  implementationSha256: string;
  projection: 'perspective';
  firstPerson: true;
  readOnly: true;
  verticalFovDegrees: number;
  horizontalFovDegrees: number;
  viewDistanceChunks: number;
}>;

export type ResidentCameraFrame = Readonly<{
  protocol: typeof RESIDENT_CAMERA_FRAME_PROTOCOL;
  content: Readonly<{
    mediaType: 'image/png' | 'image/jpeg';
    encoding: 'base64';
    bytes: number;
    sha256: string;
    width: number;
    height: number;
    data: string;
  }>;
  renderer: ResidentCameraRenderer;
  binding: Readonly<{
    protocol: typeof RESIDENT_CAMERA_BINDING_PROTOCOL;
    circleId: string;
    managedRunId: string | null;
    observationProtocol: 'behold.inhabitant.v2';
    observationSequence: number;
    observedAt: number;
    observationSha256: string;
    entityId: string;
    body: Readonly<{
      username: string;
      uuid: string | null;
      dimension: string;
    }>;
    pose: Readonly<{
      position: Readonly<{ x: number; y: number; z: number }>;
      yaw: number;
      pitch: number;
    }>;
    camera: Readonly<{
      position: Readonly<{ x: number; y: number; z: number }>;
      yaw: number;
      pitch: number;
    }>;
    captureStartedAt: number;
    captureCompletedAt: number;
  }>;
  bindingSha256: string;
  digest: string;
}>;

export type ResidentCameraFrameErrorCode =
  | 'resident_camera_invalid'
  | 'resident_camera_content_mismatch'
  | 'resident_camera_observation_mismatch'
  | 'resident_camera_stale';

/** Pure renderer identity; horizontal FOV is derived from the exact viewport. */
export function createResidentCameraRenderer(input: {
  name: string;
  version: string;
  implementationSha256: string;
  verticalFovDegrees: number;
  width: number;
  height: number;
  viewDistanceChunks: number;
}): ResidentCameraRenderer {
  const width = boundedInteger(input.width, 'camera viewport width', 1, 8_192);
  const height = boundedInteger(input.height, 'camera viewport height', 1, 8_192);
  const verticalFovDegrees = boundedFov(input.verticalFovDegrees, 'vertical camera FOV');
  return deepFreeze({
    protocol: RESIDENT_CAMERA_RENDERER_PROTOCOL,
    name: nonEmpty(input.name, 'camera renderer name'),
    version: nonEmpty(input.version, 'camera renderer version'),
    implementationSha256: digest(input.implementationSha256, 'camera renderer implementation'),
    projection: 'perspective' as const,
    firstPerson: true as const,
    readOnly: true as const,
    verticalFovDegrees,
    horizontalFovDegrees: perspectiveHorizontalFovDegrees(verticalFovDegrees, width, height),
    viewDistanceChunks: boundedInteger(input.viewDistanceChunks, 'camera view distance', 1, 64),
  });
}

export function perspectiveHorizontalFovDegrees(
  verticalFovDegrees: number,
  width: number,
  height: number,
) {
  const vertical = (boundedFov(verticalFovDegrees, 'vertical camera FOV') * Math.PI) / 180;
  const aspect =
    boundedInteger(width, 'camera viewport width', 1, 8_192) /
    boundedInteger(height, 'camera viewport height', 1, 8_192);
  const horizontal = (2 * Math.atan(Math.tan(vertical / 2) * aspect) * 180) / Math.PI;
  return Math.round(horizontal * 1e12) / 1e12;
}

/**
 * Create content-addressed, authority-free evidence from already captured bytes.
 * This function receives no Bot, world, controller, or action surface.
 */
export function createResidentCameraFrame(input: {
  bytes: Uint8Array;
  mediaType: 'image/png' | 'image/jpeg';
  observation: unknown;
  renderer: ResidentCameraRenderer;
  renderedCamera: Readonly<{
    position: Readonly<{ x: number; y: number; z: number }>;
    yaw: number;
    pitch: number;
  }>;
  captureStartedAt: number;
  captureCompletedAt: number;
}): ResidentCameraFrame {
  const bytes = Buffer.from(input.bytes);
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_RESIDENT_CAMERA_FRAME_BYTES) {
    fail(
      'resident_camera_invalid',
      `camera frame bytes must be between 1 and ${MAX_RESIDENT_CAMERA_FRAME_BYTES}`,
    );
  }
  const dimensions = imageDimensions(bytes, input.mediaType);
  const renderer = parseResidentCameraRenderer(input.renderer, dimensions);
  const captureStartedAt = timestamp(input.captureStartedAt, 'camera capture start');
  const captureCompletedAt = timestamp(input.captureCompletedAt, 'camera capture completion');
  if (captureCompletedAt < captureStartedAt) {
    fail('resident_camera_invalid', 'camera capture completed before it started');
  }
  const binding = observationBinding(
    input.observation,
    input.renderedCamera,
    captureStartedAt,
    captureCompletedAt,
  );
  const content = deepFreeze({
    mediaType: input.mediaType,
    encoding: 'base64' as const,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    width: dimensions.width,
    height: dimensions.height,
    data: bytes.toString('base64'),
  });
  const bindingSha256 = valueSha256(binding);
  const base = {
    protocol: RESIDENT_CAMERA_FRAME_PROTOCOL,
    content,
    renderer,
    binding,
    bindingSha256,
  };
  return deepFreeze({ ...base, digest: descriptorDigest(base) });
}

/** Parse and verify the complete artifact without consulting mutable runtime state. */
export function parseResidentCameraFrame(value: unknown): ResidentCameraFrame {
  const frame = exactRecord(
    value,
    ['protocol', 'content', 'renderer', 'binding', 'bindingSha256', 'digest'],
    'resident camera frame',
  );
  if (frame.protocol !== RESIDENT_CAMERA_FRAME_PROTOCOL) {
    fail('resident_camera_invalid', 'unsupported resident camera frame protocol');
  }
  const contentValue = exactRecord(
    frame.content,
    ['mediaType', 'encoding', 'bytes', 'sha256', 'width', 'height', 'data'],
    'resident camera content',
  );
  if (
    !['image/png', 'image/jpeg'].includes(contentValue.mediaType) ||
    contentValue.encoding !== 'base64' ||
    typeof contentValue.data !== 'string'
  ) {
    fail('resident_camera_invalid', 'resident camera content encoding is unsupported');
  }
  const data = Buffer.from(contentValue.data, 'base64');
  if (data.toString('base64') !== contentValue.data) {
    fail('resident_camera_content_mismatch', 'resident camera content is not canonical base64');
  }
  const dimensions = imageDimensions(data, contentValue.mediaType);
  if (
    data.byteLength !== contentValue.bytes ||
    data.byteLength < 1 ||
    data.byteLength > MAX_RESIDENT_CAMERA_FRAME_BYTES ||
    sha256(data) !== contentValue.sha256 ||
    dimensions.width !== contentValue.width ||
    dimensions.height !== contentValue.height
  ) {
    fail(
      'resident_camera_content_mismatch',
      'resident camera content metadata does not match bytes',
    );
  }
  const renderer = parseResidentCameraRenderer(frame.renderer, dimensions);
  const binding = parseBinding(frame.binding);
  const bindingSha256 = digest(frame.bindingSha256, 'resident camera binding');
  if (bindingSha256 !== valueSha256(binding)) {
    fail('resident_camera_content_mismatch', 'resident camera binding digest does not match');
  }
  const content = deepFreeze({
    mediaType: contentValue.mediaType as 'image/png' | 'image/jpeg',
    encoding: 'base64' as const,
    bytes: data.byteLength,
    sha256: digest(contentValue.sha256, 'resident camera content'),
    width: dimensions.width,
    height: dimensions.height,
    data: contentValue.data,
  });
  const base = {
    protocol: RESIDENT_CAMERA_FRAME_PROTOCOL,
    content,
    renderer,
    binding,
    bindingSha256,
  };
  if (digest(frame.digest, 'resident camera frame') !== descriptorDigest(base)) {
    fail('resident_camera_content_mismatch', 'resident camera frame digest does not match');
  }
  return deepFreeze({ ...base, digest: descriptorDigest(base) });
}

/** Fail closed unless this exact frame still belongs to the supplied raw observation. */
export function admitResidentCameraFrame(input: {
  frame: unknown;
  observation: unknown;
  now: number;
  maxAgeMs: number;
  maxCaptureDurationMs: number;
}): ResidentCameraFrame {
  const frame = parseResidentCameraFrame(input.frame);
  const expected = observationBinding(
    input.observation,
    frame.binding.camera,
    frame.binding.captureStartedAt,
    frame.binding.captureCompletedAt,
  );
  if (valueSha256(expected) !== frame.bindingSha256) {
    fail(
      'resident_camera_observation_mismatch',
      'resident camera frame belongs to another observation, resident body, or pose',
    );
  }
  return admitResidentCameraFrameFreshness(input);
}

/** Recheck the already-bound frame immediately before an upstream model admission. */
export function admitResidentCameraFrameFreshness(input: {
  frame: unknown;
  now: number;
  maxAgeMs: number;
  maxCaptureDurationMs: number;
}): ResidentCameraFrame {
  const frame = parseResidentCameraFrame(input.frame);
  const now = timestamp(input.now, 'camera admission time');
  const maxAgeMs = boundedInteger(input.maxAgeMs, 'camera maximum age', 0, 60_000);
  const maxCaptureDurationMs = boundedInteger(
    input.maxCaptureDurationMs,
    'camera maximum capture duration',
    0,
    60_000,
  );
  if (
    now < frame.binding.captureCompletedAt ||
    now - frame.binding.captureCompletedAt > maxAgeMs ||
    frame.binding.captureCompletedAt - frame.binding.captureStartedAt > maxCaptureDurationMs
  ) {
    fail('resident_camera_stale', 'resident camera frame is outside its admitted time horizon');
  }
  return frame;
}

function observationBinding(
  observationValue: unknown,
  renderedCameraValue: unknown,
  captureStartedAt: number,
  captureCompletedAt: number,
): ResidentCameraFrame['binding'] {
  const observation = cloneJson(observationValue, 'resident camera observation');
  if (observation?.protocol !== 'behold.inhabitant.v2') {
    fail('resident_camera_invalid', 'camera binding requires a behold.inhabitant.v2 observation');
  }
  const circle = exactRecord(
    observation.circle,
    observation.circle?.managedRunId == null
      ? ['id', 'substrate']
      : ['id', 'substrate', 'managedRunId'],
    'camera observation circle',
  );
  if (circle.substrate !== 'minecraft') {
    fail('resident_camera_invalid', 'camera binding requires a Minecraft circle');
  }
  const self = observation.self;
  const body = exactRecord(self?.body, ['substrate', 'username', 'uuid'], 'camera resident body');
  if (body.substrate !== 'minecraft') {
    fail('resident_camera_invalid', 'camera binding requires a Minecraft body');
  }
  const pose = exactRecord(
    self?.pose,
    ['position', 'yaw', 'pitch', 'velocity', 'onGround'],
    'camera resident pose',
  );
  const position = exactRecord(pose.position, ['x', 'y', 'z'], 'camera resident position');
  const condition = self?.condition;
  const renderedCamera = exactRecord(
    renderedCameraValue,
    ['position', 'yaw', 'pitch'],
    'rendered resident camera',
  );
  const cameraPosition = exactRecord(
    renderedCamera.position,
    ['x', 'y', 'z'],
    'rendered resident camera position',
  );
  const binding = {
    protocol: RESIDENT_CAMERA_BINDING_PROTOCOL,
    circleId: nonEmpty(circle.id, 'camera circle id'),
    managedRunId:
      circle.managedRunId == null ? null : nonEmpty(circle.managedRunId, 'camera managed run id'),
    observationProtocol: 'behold.inhabitant.v2' as const,
    observationSequence: boundedInteger(
      observation.sequence,
      'camera observation sequence',
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    observedAt: timestamp(observation.observedAt, 'camera observation time'),
    observationSha256: valueSha256(observation),
    entityId: nonEmpty(self?.identity, 'camera resident identity'),
    body: {
      username: nonEmpty(body.username, 'camera body username'),
      uuid: body.uuid == null ? null : nonEmpty(body.uuid, 'camera body UUID'),
      dimension: nonEmpty(condition?.dimension, 'camera body dimension'),
    },
    pose: {
      position: {
        x: finite(position.x, 'camera position x'),
        y: finite(position.y, 'camera position y'),
        z: finite(position.z, 'camera position z'),
      },
      yaw: finite(pose.yaw, 'camera yaw'),
      pitch: finite(pose.pitch, 'camera pitch'),
    },
    camera: {
      position: {
        x: finite(cameraPosition.x, 'rendered camera position x'),
        y: finite(cameraPosition.y, 'rendered camera position y'),
        z: finite(cameraPosition.z, 'rendered camera position z'),
      },
      yaw: finite(renderedCamera.yaw, 'rendered camera yaw'),
      pitch: finite(renderedCamera.pitch, 'rendered camera pitch'),
    },
    captureStartedAt: timestamp(captureStartedAt, 'camera capture start'),
    captureCompletedAt: timestamp(captureCompletedAt, 'camera capture completion'),
  };
  if (binding.captureStartedAt < binding.observedAt) {
    fail('resident_camera_invalid', 'camera capture started before its bound observation');
  }
  assertRenderedCameraMatchesPose(binding.pose, binding.camera);
  return deepFreeze(binding);
}

function parseBinding(value: unknown): ResidentCameraFrame['binding'] {
  const binding = exactRecord(
    value,
    [
      'protocol',
      'circleId',
      'managedRunId',
      'observationProtocol',
      'observationSequence',
      'observedAt',
      'observationSha256',
      'entityId',
      'body',
      'pose',
      'camera',
      'captureStartedAt',
      'captureCompletedAt',
    ],
    'resident camera binding',
  );
  if (
    binding.protocol !== RESIDENT_CAMERA_BINDING_PROTOCOL ||
    binding.observationProtocol !== 'behold.inhabitant.v2'
  ) {
    fail('resident_camera_invalid', 'unsupported resident camera binding protocol');
  }
  const body = exactRecord(binding.body, ['username', 'uuid', 'dimension'], 'camera binding body');
  const pose = exactRecord(binding.pose, ['position', 'yaw', 'pitch'], 'camera binding pose');
  const position = exactRecord(pose.position, ['x', 'y', 'z'], 'camera binding position');
  const camera = exactRecord(
    binding.camera,
    ['position', 'yaw', 'pitch'],
    'rendered camera binding',
  );
  const cameraPosition = exactRecord(
    camera.position,
    ['x', 'y', 'z'],
    'rendered camera binding position',
  );
  const parsed = {
    protocol: RESIDENT_CAMERA_BINDING_PROTOCOL,
    circleId: nonEmpty(binding.circleId, 'camera circle id'),
    managedRunId:
      binding.managedRunId == null ? null : nonEmpty(binding.managedRunId, 'camera managed run id'),
    observationProtocol: 'behold.inhabitant.v2' as const,
    observationSequence: boundedInteger(
      binding.observationSequence,
      'camera observation sequence',
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    observedAt: timestamp(binding.observedAt, 'camera observation time'),
    observationSha256: digest(binding.observationSha256, 'camera observation'),
    entityId: nonEmpty(binding.entityId, 'camera resident identity'),
    body: {
      username: nonEmpty(body.username, 'camera body username'),
      uuid: body.uuid == null ? null : nonEmpty(body.uuid, 'camera body UUID'),
      dimension: nonEmpty(body.dimension, 'camera body dimension'),
    },
    pose: {
      position: {
        x: finite(position.x, 'camera position x'),
        y: finite(position.y, 'camera position y'),
        z: finite(position.z, 'camera position z'),
      },
      yaw: finite(pose.yaw, 'camera yaw'),
      pitch: finite(pose.pitch, 'camera pitch'),
    },
    camera: {
      position: {
        x: finite(cameraPosition.x, 'rendered camera position x'),
        y: finite(cameraPosition.y, 'rendered camera position y'),
        z: finite(cameraPosition.z, 'rendered camera position z'),
      },
      yaw: finite(camera.yaw, 'rendered camera yaw'),
      pitch: finite(camera.pitch, 'rendered camera pitch'),
    },
    captureStartedAt: timestamp(binding.captureStartedAt, 'camera capture start'),
    captureCompletedAt: timestamp(binding.captureCompletedAt, 'camera capture completion'),
  };
  if (
    parsed.captureStartedAt < parsed.observedAt ||
    parsed.captureCompletedAt < parsed.captureStartedAt
  ) {
    fail('resident_camera_invalid', 'resident camera binding times are impossible');
  }
  assertRenderedCameraMatchesPose(parsed.pose, parsed.camera);
  return deepFreeze(parsed);
}

function assertRenderedCameraMatchesPose(
  pose: ResidentCameraFrame['binding']['pose'],
  camera: ResidentCameraFrame['binding']['camera'],
) {
  const eyeHeight = camera.position.y - pose.position.y;
  if (
    camera.position.x !== pose.position.x ||
    camera.position.z !== pose.position.z ||
    camera.yaw !== pose.yaw ||
    camera.pitch !== pose.pitch ||
    eyeHeight < 0.1 ||
    eyeHeight > 3
  ) {
    fail('resident_camera_observation_mismatch', 'rendered camera differs from resident body pose');
  }
}

function parseResidentCameraRenderer(
  value: unknown,
  viewport: { width: number; height: number },
): ResidentCameraRenderer {
  const renderer = exactRecord(
    value,
    [
      'protocol',
      'name',
      'version',
      'implementationSha256',
      'projection',
      'firstPerson',
      'readOnly',
      'verticalFovDegrees',
      'horizontalFovDegrees',
      'viewDistanceChunks',
    ],
    'resident camera renderer',
  );
  if (
    renderer.protocol !== RESIDENT_CAMERA_RENDERER_PROTOCOL ||
    renderer.projection !== 'perspective' ||
    renderer.firstPerson !== true ||
    renderer.readOnly !== true
  ) {
    fail('resident_camera_invalid', 'camera renderer is not read-only first-person perspective');
  }
  const verticalFovDegrees = boundedFov(renderer.verticalFovDegrees, 'vertical camera FOV');
  const expectedHorizontal = perspectiveHorizontalFovDegrees(
    verticalFovDegrees,
    viewport.width,
    viewport.height,
  );
  if (
    !Number.isFinite(renderer.horizontalFovDegrees) ||
    Math.abs(renderer.horizontalFovDegrees - expectedHorizontal) > 1e-9
  ) {
    fail('resident_camera_invalid', 'camera horizontal FOV does not match its viewport');
  }
  return deepFreeze({
    protocol: RESIDENT_CAMERA_RENDERER_PROTOCOL,
    name: nonEmpty(renderer.name, 'camera renderer name'),
    version: nonEmpty(renderer.version, 'camera renderer version'),
    implementationSha256: digest(renderer.implementationSha256, 'camera renderer implementation'),
    projection: 'perspective' as const,
    firstPerson: true as const,
    readOnly: true as const,
    verticalFovDegrees,
    horizontalFovDegrees: expectedHorizontal,
    viewDistanceChunks: boundedInteger(renderer.viewDistanceChunks, 'camera view distance', 1, 64),
  });
}

function imageDimensions(bytes: Buffer, mediaType: unknown) {
  if (mediaType === 'image/png') {
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (
      bytes.byteLength < 24 ||
      !bytes.subarray(0, 8).equals(signature) ||
      bytes.toString('ascii', 12, 16) !== 'IHDR'
    ) {
      fail('resident_camera_content_mismatch', 'camera PNG header is invalid');
    }
    return checkedDimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
  }
  if (mediaType === 'image/jpeg') {
    if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      fail('resident_camera_content_mismatch', 'camera JPEG header is invalid');
    }
    let offset = 2;
    const startOfFrame = new Set([
      0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
    ]);
    while (offset + 8 < bytes.byteLength) {
      while (offset < bytes.byteLength && bytes[offset] !== 0xff) offset += 1;
      while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda || offset + 2 > bytes.byteLength) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.byteLength) break;
      if (startOfFrame.has(marker) && length >= 7) {
        return checkedDimensions(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3));
      }
      offset += length;
    }
    fail('resident_camera_content_mismatch', 'camera JPEG has no supported size marker');
  }
  fail('resident_camera_invalid', 'unsupported resident camera media type');
}

function checkedDimensions(width: number, height: number) {
  return {
    width: boundedInteger(width, 'camera image width', 1, 8_192),
    height: boundedInteger(height, 'camera image height', 1, 8_192),
  };
}

function descriptorDigest(value: Omit<ResidentCameraFrame, 'digest'>) {
  return valueSha256({
    protocol: value.protocol,
    content: { ...value.content, data: undefined },
    renderer: value.renderer,
    binding: value.binding,
    bindingSha256: value.bindingSha256,
  });
}

function exactRecord(value: any, fields: readonly string[], label: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('resident_camera_invalid', `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    fail('resident_camera_invalid', `${label} fields are not exact`);
  }
  return value;
}

function cloneJson(value: any, label: string): any {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => cloneJson(item, label));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneJson(item, `${label}.${key}`)]),
    );
  }
  fail('resident_camera_invalid', `${label} must contain only JSON values`);
}

function nonEmpty(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > 1_000) {
    fail('resident_camera_invalid', `${label} must be a bounded nonempty string`);
  }
  return value;
}

function timestamp(value: unknown, label: string) {
  return boundedInteger(value, label, 0, Number.MAX_SAFE_INTEGER);
}

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    fail(
      'resident_camera_invalid',
      `${label} must be an integer from ${minimum} through ${maximum}`,
    );
  }
  return Number(value);
}

function finite(value: unknown, label: string) {
  if (!Number.isFinite(value)) fail('resident_camera_invalid', `${label} must be finite`);
  return Number(value);
}

function boundedFov(value: unknown, label: string) {
  const fov = finite(value, label);
  if (fov <= 0 || fov >= 180) fail('resident_camera_invalid', `${label} must be between 0 and 180`);
  return fov;
}

function digest(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    fail('resident_camera_invalid', `${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function sha256(value: Uint8Array | string) {
  return createHash('sha256').update(value).digest('hex');
}

function valueSha256(value: unknown) {
  return sha256(stableJson(value));
}

function stableJson(value: any): string {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function fail(code: ResidentCameraFrameErrorCode, message: string): never {
  const error: Error & { code?: ResidentCameraFrameErrorCode } = new Error(message);
  error.code = code;
  throw error;
}
