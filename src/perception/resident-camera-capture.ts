import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import type { Bot } from 'mineflayer';
import {
  createResidentCameraFrame,
  createResidentCameraRenderer,
  type ResidentCameraFrame,
} from './resident-camera-frame';

export const RESIDENT_CAMERA_CAPTURE_PROTOCOL =
  'behold.prismarine-resident-camera-capture.v1' as const;
export const RESIDENT_CAMERA_OBSERVATION_CHANGED = 'resident_camera_observation_changed' as const;

export class ResidentCameraObservationChangedError extends Error {
  readonly code = RESIDENT_CAMERA_OBSERVATION_CHANGED;

  constructor(message: string) {
    super(message);
    this.name = 'ResidentCameraObservationChangedError';
  }
}

export function isResidentCameraObservationChangedError(
  value: unknown,
): value is ResidentCameraObservationChangedError {
  return (
    value instanceof ResidentCameraObservationChangedError ||
    (typeof value === 'object' &&
      value != null &&
      (value as { code?: unknown }).code === RESIDENT_CAMERA_OBSERVATION_CHANGED)
  );
}

export type ResidentCameraCaptureSocket = EventEmitter & {
  handshake?: { auth?: Record<string, unknown> };
  emit(event: string, ...args: any[]): boolean;
  disconnect(close?: boolean): void;
};

export type ResidentCameraCapture = Readonly<{
  protocol: typeof RESIDENT_CAMERA_CAPTURE_PROTOCOL;
  attach(socket: ResidentCameraCaptureSocket): boolean;
  detach(socket: ResidentCameraCaptureSocket): void;
  captureFrame(
    observation: unknown,
    options?: Readonly<{ executablePath?: string; timeoutMs?: number; signal?: AbortSignal }>,
  ): Promise<ResidentCameraFrame>;
  close(): Promise<void>;
}>;

/**
 * One lazily started, capture-only browser renderer. It can read the existing
 * Prismarine viewer stream and return pixels, but receives no Mineflayer or
 * Behold control bridge. The owning viewer authenticates its one socket with
 * an unguessable process-local token.
 */
export function createResidentCameraCapture(options: {
  bot: Bot;
  firstPerson: boolean;
  viewDistance: number;
  viewerPackageRoot: string;
  endpoint(): string | null;
}): ResidentCameraCapture {
  const viewerBundle = path.join(options.viewerPackageRoot, 'public', 'index.js');
  const rendererImplementationSha256 = sha256(fs.readFileSync(viewerBundle));
  const captureToken = randomBytes(32).toString('hex');
  let closed = false;
  let captureSocket: ResidentCameraCaptureSocket | null = null;
  let rendererReady = false;
  let browser: any = null;
  let browserStarting: Promise<void> | null = null;
  const readyWaiters = new Set<() => void>();
  const pending = new Map<
    string,
    {
      socket: ResidentCameraCaptureSocket;
      resolve(value: unknown): void;
      reject(error: Error): void;
    }
  >();

  const attach = (socket: ResidentCameraCaptureSocket) => {
    if (socket.handshake?.auth?.beholdCaptureToken !== captureToken) return false;
    captureSocket?.disconnect(true);
    captureSocket = socket;
    rendererReady = false;
    socket.on('behold_capture_ready', () => {
      if (captureSocket !== socket) return;
      rendererReady = true;
      for (const wake of readyWaiters) wake();
      readyWaiters.clear();
    });
    socket.on('behold_capture_frame_ready', (value: unknown) => {
      const id = text((value as any)?.id);
      const request = id ? pending.get(id) : null;
      if (!id || !request || request.socket !== socket) return;
      pending.delete(id);
      request.resolve(value);
    });
    return true;
  };

  const detach = (socket: ResidentCameraCaptureSocket) => {
    if (captureSocket !== socket) return;
    captureSocket = null;
    rendererReady = false;
    const error = new Error('resident camera renderer disconnected');
    for (const [id, request] of pending) {
      if (request.socket !== socket) continue;
      pending.delete(id);
      request.reject(error);
    }
  };

  const captureFrame = async (
    observation: unknown,
    captureOptions: Readonly<{
      executablePath?: string;
      timeoutMs?: number;
      signal?: AbortSignal;
    }> = {},
  ) => {
    if (closed) throw new Error('resident camera capture is closed');
    if (!options.firstPerson) throw new Error('resident camera requires a first-person viewer');
    const timeoutMs = boundedTimeout(captureOptions.timeoutMs ?? 10_000);
    const camera = liveCameraForObservation(options.bot, observation);
    throwIfAborted(captureOptions.signal);
    await withTimeout(
      ensureBrowser(captureOptions.executablePath, timeoutMs),
      timeoutMs,
      'resident camera browser did not start',
      captureOptions.signal,
    );
    await waitUntilReady(timeoutMs, captureOptions.signal);
    const socket = captureSocket;
    if (!socket || !rendererReady) throw new Error('resident camera renderer is unavailable');

    const captureStartedAt = Date.now();
    const id = `resident-camera-${randomUUID()}`;
    const response = await withTimeout(
      new Promise<any>((resolve, reject) => {
        pending.set(id, { socket, resolve, reject });
        socket.emit('behold_capture_frame', { id, camera });
      }),
      timeoutMs,
      'resident camera render timed out',
      captureOptions.signal,
    ).finally(() => pending.delete(id));
    const captureCompletedAt = Date.now();
    if (response?.error) throw new Error(`resident camera render failed: ${response.error}`);
    if (stableJson(response?.camera) !== stableJson(camera)) {
      throw new Error('resident camera renderer acknowledged a different body pose');
    }
    const bytes = cameraJpeg(response?.data);
    liveCameraForObservation(options.bot, observation, camera);
    const viewerVersion = JSON.parse(
      fs.readFileSync(path.join(options.viewerPackageRoot, 'package.json'), 'utf8'),
    ).version;
    return createResidentCameraFrame({
      bytes,
      mediaType: 'image/jpeg',
      observation,
      renderedCamera: camera,
      renderer: createResidentCameraRenderer({
        name: 'prismarine-viewer-browser',
        version: `prismarine-viewer@${viewerVersion}`,
        implementationSha256: rendererImplementationSha256,
        verticalFovDegrees: 75,
        width: 512,
        height: 512,
        viewDistanceChunks: options.viewDistance,
      }),
      captureStartedAt,
      captureCompletedAt,
    });
  };

  const close = async () => {
    if (closed) return;
    closed = true;
    const error = new Error('resident camera capture closed while rendering');
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    await browserStarting?.catch(() => {});
    await browser?.close().catch(() => {});
    browser = null;
  };

  return Object.freeze({
    protocol: RESIDENT_CAMERA_CAPTURE_PROTOCOL,
    attach,
    detach,
    captureFrame,
    close,
  });

  async function ensureBrowser(executablePathValue: string | undefined, timeoutMs: number) {
    if (browser?.connected) return;
    if (browserStarting) return await browserStarting;
    browserStarting = (async () => {
      const endpoint = options.endpoint();
      if (!endpoint) throw new Error('resident camera viewer endpoint is not listening');
      const executablePath = resolveChromeExecutable(executablePathValue);
      const puppeteer = await import('puppeteer-core');
      const launched = await puppeteer.launch({
        executablePath,
        headless: true,
        defaultViewport: { width: 512, height: 512, deviceScaleFactor: 1 },
        args: ['--no-first-run', '--no-default-browser-check', '--disable-background-networking'],
      });
      try {
        if (closed) throw new Error('resident camera capture closed while renderer was starting');
        const page = await launched.newPage();
        await page.evaluateOnNewDocument((token) => {
          (globalThis as any).__BEHOLD_CAPTURE_TOKEN = token;
        }, captureToken);
        await page.goto(endpoint, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        if (closed) throw new Error('resident camera capture closed while renderer was starting');
        browser = launched;
      } catch (error) {
        await launched.close().catch(() => {});
        throw error;
      }
    })();
    try {
      await browserStarting;
    } finally {
      browserStarting = null;
    }
  }

  async function waitUntilReady(timeoutMs: number, signal?: AbortSignal) {
    if (rendererReady && captureSocket) return;
    let wake: () => void = () => {};
    try {
      await withTimeout(
        new Promise<void>((resolve) => {
          wake = resolve;
          readyWaiters.add(resolve);
        }),
        timeoutMs,
        'resident camera renderer did not become ready',
        signal,
      );
    } finally {
      readyWaiters.delete(wake);
    }
  }
}

function liveCameraForObservation(bot: Bot, observationValue: any, expected?: unknown) {
  const body = observationValue?.self?.body;
  const pose = observationValue?.self?.pose;
  const position = pose?.position;
  const live = bot.entity;
  if (
    observationValue?.protocol !== 'behold.inhabitant.v2' ||
    body?.substrate !== 'minecraft' ||
    body?.username !== bot.username ||
    !live?.position ||
    !finite(position?.x) ||
    !finite(position?.y) ||
    !finite(position?.z) ||
    !finite(pose?.yaw) ||
    !finite(pose?.pitch)
  ) {
    throw new Error('resident camera observation has no exact current Minecraft body pose');
  }
  if (
    position.x !== live.position.x ||
    position.y !== live.position.y ||
    position.z !== live.position.z ||
    pose.yaw !== live.yaw ||
    pose.pitch !== live.pitch
  ) {
    throw new ResidentCameraObservationChangedError(
      'resident camera observation differs from the current body pose',
    );
  }
  const liveUuid = text((bot as any).player?.uuid ?? (bot.entity as any).uuid);
  if (body.uuid != null && liveUuid != null && body.uuid !== liveUuid) {
    throw new Error('resident camera observation differs from the current body UUID');
  }
  const eyeHeight = finite((bot.entity as any).eyeHeight)
    ? Number((bot.entity as any).eyeHeight)
    : 1.62;
  if (eyeHeight < 0.1 || eyeHeight > 3) {
    throw new Error('resident camera body eye height is invalid');
  }
  const camera = Object.freeze({
    position: Object.freeze({
      x: Number(position.x),
      y: Number(position.y) + eyeHeight,
      z: Number(position.z),
    }),
    yaw: Number(pose.yaw),
    pitch: Number(pose.pitch),
  });
  if (expected != null && stableJson(camera) !== stableJson(expected)) {
    throw new ResidentCameraObservationChangedError(
      'resident camera body moved while its frame was rendering',
    );
  }
  return camera;
}

function cameraJpeg(value: unknown) {
  if (typeof value !== 'string' || !value.startsWith('data:image/jpeg;base64,')) {
    throw new Error('resident camera renderer returned no JPEG frame');
  }
  const encoded = value.slice('data:image/jpeg;base64,'.length);
  const bytes = Buffer.from(encoded, 'base64');
  if (!encoded || bytes.toString('base64') !== encoded) {
    throw new Error('resident camera renderer returned noncanonical JPEG bytes');
  }
  return bytes;
}

function resolveChromeExecutable(value?: string) {
  const candidates = [
    value,
    process.env.BEHOLD_CHROME_EXECUTABLE,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ].filter((candidate): candidate is string => Boolean(candidate));
  const executable = candidates.find((candidate) => fs.existsSync(candidate));
  if (!executable) {
    throw new Error(
      'resident camera capture needs Chrome, Chromium, Edge, or BEHOLD_CHROME_EXECUTABLE',
    );
  }
  return executable;
}

function boundedTimeout(value: unknown) {
  const timeout = Number(value);
  if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 60_000) {
    throw new Error('resident camera timeout must be an integer from 100 through 60000ms');
  }
  return timeout;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    throwIfAborted(signal);
    let settled = false;
    let timeout: NodeJS.Timeout;
    const settle = <V>(callback: (value: V) => void, value: V) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      callback(value);
    };
    const onAbort = () =>
      settle(reject, signal?.reason ?? new Error('resident camera capture aborted'));
    timeout = setTimeout(() => settle(reject, new Error(message)), timeoutMs);
    timeout.unref();
    signal?.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => settle(resolve, value),
      (error) => settle(reject, error),
    );
  });
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason ?? new Error('resident camera capture aborted');
}

function finite(value: unknown) {
  return Number.isFinite(Number(value));
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null;
}

function stableJson(value: unknown) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string | Uint8Array) {
  return createHash('sha256').update(value).digest('hex');
}
