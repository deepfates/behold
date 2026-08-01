import { EventEmitter } from 'node:events';
import { createServer, type Server as HttpServer } from 'node:http';
import path from 'node:path';
import type { Bot } from 'mineflayer';
import {
  createResidentCameraCapture,
  RESIDENT_CAMERA_CAPTURE_PROTOCOL,
  type ResidentCameraCaptureSocket,
} from '../perception/resident-camera-capture';
import {
  parseResidentCameraFrame,
  type ResidentCameraFrame,
} from '../perception/resident-camera-frame';

export const RESIDENT_VIEWER_PROTOCOL = 'behold.prismarine-resident-viewer.v1' as const;
export const RESIDENT_ADMITTED_CAMERA_FRAME_PROTOCOL =
  'behold.resident-admitted-camera-frame.v1' as const;
export const RESIDENT_ADMITTED_CAMERA_FRAME_PATH = '/behold/admitted-camera-frame' as const;
export { RESIDENT_CAMERA_CAPTURE_PROTOCOL };

export type ResidentAdmittedCameraFrameView =
  | Readonly<{
      protocol: typeof RESIDENT_ADMITTED_CAMERA_FRAME_PROTOCOL;
      status: 'unavailable';
      reason: 'no_admitted_frame';
    }>
  | Readonly<{
      protocol: typeof RESIDENT_ADMITTED_CAMERA_FRAME_PROTOCOL;
      status: 'available';
      digest: string;
      bindingSha256: string;
      content: Omit<ResidentCameraFrame['content'], 'data' | 'encoding'>;
      renderer: ResidentCameraFrame['renderer'];
      binding: ResidentCameraFrame['binding'];
      imagePath: string;
    }>;

export type ResidentViewerOptions = Readonly<{
  host: '127.0.0.1';
  port: number;
  viewDistance: number;
  firstPerson: boolean;
}>;

export type ResidentViewerHandle = Readonly<{
  protocol: typeof RESIDENT_VIEWER_PROTOCOL;
  endpoint: string;
  host: '127.0.0.1';
  port: number;
  viewDistance: number;
  firstPerson: boolean;
  readOnly: true;
  cameraCaptureProtocol: typeof RESIDENT_CAMERA_CAPTURE_PROTOCOL;
  admittedFrameEndpoint: string;
  captureFrame(
    observation: unknown,
    options?: Readonly<{ executablePath?: string; timeoutMs?: number; signal?: AbortSignal }>,
  ): Promise<ResidentCameraFrame>;
  /** Retain only a frame that the resident policy has already admitted. */
  retainAdmittedFrame(frame: ResidentCameraFrame): void;
  close(): Promise<void>;
}>;

type ViewerSocket = ResidentCameraCaptureSocket;

type WorldView = EventEmitter & {
  init(position: any): Promise<void>;
  listenToBot(bot: Bot): void;
  removeListenersFromBot(bot: Bot): void;
  updatePosition(position: any): Promise<void>;
};

/**
 * A Behold-owned, presentation-only Prismarine Viewer adapter. It deliberately
 * exposes no Behold control handlers: renderer-local mouse raycasts and any
 * browser keyboard events cannot become a bot intent, controller action, or
 * world mutation through this endpoint.
 */
export async function startResidentViewer(
  bot: Bot,
  rawOptions: ResidentViewerOptions,
): Promise<ResidentViewerHandle> {
  const options = parseResidentViewerOptions(rawOptions);
  // These are runtime dependencies of the pinned prismarine-viewer package.
  // Reusing its renderer keeps this adapter narrow while Behold owns the HTTP
  // bind, one-way socket surface, and close lifecycle.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const express = require('express');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Server: SocketServer } = require('socket.io');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { WorldView: PrismarineWorldView } = require('prismarine-viewer/viewer');
  const viewerPackageRoot = path.dirname(require.resolve('prismarine-viewer/package.json'));

  const app = express();
  const server = createServer(app);
  const sockets = new Set<ViewerSocket>();
  const views = new Map<ViewerSocket, WorldView>();
  const io = new SocketServer(server, { path: '/socket.io' });
  let closed = false;
  let endpoint: string | null = null;
  let latestAdmittedFrame: ResidentCameraFrame | null = null;
  const cameraCapture = createResidentCameraCapture({
    bot,
    firstPerson: options.firstPerson,
    viewDistance: options.viewDistance,
    viewerPackageRoot,
    endpoint: () => endpoint,
  });

  app.get(RESIDENT_ADMITTED_CAMERA_FRAME_PATH, (_request: any, response: any) => {
    response.set('Cache-Control', 'no-store');
    response.set('X-Content-Type-Options', 'nosniff');
    response.json(admittedFrameView(latestAdmittedFrame));
  });
  app.get(`${RESIDENT_ADMITTED_CAMERA_FRAME_PATH}/image`, (request: any, response: any) => {
    response.set('Cache-Control', 'no-store');
    response.set('X-Content-Type-Options', 'nosniff');
    const requestedDigest = typeof request.query?.digest === 'string' ? request.query.digest : null;
    const frame = latestAdmittedFrame;
    if (!frame) return response.status(404).json({ error: 'admitted_camera_frame_unavailable' });
    if (requestedDigest !== frame.digest) {
      return response.status(409).json({
        error: 'admitted_camera_frame_replaced',
        requestedDigest,
        latestDigest: frame.digest,
      });
    }
    const bytes = Buffer.from(frame.content.data, 'base64');
    response.set('Content-Type', frame.content.mediaType);
    response.set('Content-Length', String(bytes.byteLength));
    response.set('ETag', `"${frame.digest}"`);
    return response.send(bytes);
  });
  app.use('/', express.static(path.join(viewerPackageRoot, 'public')));

  io.on('connection', (socket: ViewerSocket) => {
    if (closed) {
      socket.disconnect(true);
      return;
    }
    sockets.add(socket);
    cameraCapture.attach(socket);
    socket.emit('version', bot.version);
    const worldView = new PrismarineWorldView(
      bot.world,
      options.viewDistance,
      bot.entity.position,
      socket,
    ) as WorldView;
    views.set(socket, worldView);
    // Viewer initialization only reads Mineflayer's already-loaded world.
    void worldView.init(bot.entity.position).catch(() => socket.disconnect(true));
    worldView.listenToBot(bot);

    const sendPosition = () => {
      socket.emit('position', {
        pos: bot.entity.position,
        yaw: bot.entity.yaw,
        ...(options.firstPerson ? { pitch: bot.entity.pitch } : {}),
        addMesh: true,
      });
      void worldView.updatePosition(bot.entity.position).catch(() => socket.disconnect(true));
    };
    bot.on('move', sendPosition);
    sendPosition();

    socket.once('disconnect', () => {
      bot.removeListener('move', sendPosition);
      worldView.removeListenersFromBot(bot);
      views.delete(socket);
      sockets.delete(socket);
      cameraCapture.detach(socket);
    });

    // Intentionally no bridge from renderer mouseClick, keyboard, chat,
    // command, or control messages into the Mineflayer bot or controller.
  });

  try {
    await listenLoopback(server, options.host, options.port);
  } catch (error) {
    await closeSocketServer(io);
    await closeHttpServer(server);
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('viewer listener has no TCP address');
  const port = address.port;
  endpoint = `http://${options.host}:${port}`;
  const admittedFrameEndpoint = `${endpoint}${RESIDENT_ADMITTED_CAMERA_FRAME_PATH}`;

  const retainAdmittedFrame = (value: ResidentCameraFrame) => {
    if (closed) return;
    const frame = parseResidentCameraFrame(value);
    if (frame.binding.body.username !== bot.username) {
      throw new Error('admitted camera frame belongs to another resident viewer body');
    }
    latestAdmittedFrame = frame;
  };

  let closePromise: Promise<void> | null = null;
  const close = () => {
    if (closePromise) return closePromise;
    closed = true;
    closePromise = (async () => {
      await cameraCapture.close();
      latestAdmittedFrame = null;
      for (const socket of sockets) socket.disconnect(true);
      for (const [socket, worldView] of views) {
        worldView.removeListenersFromBot(bot);
        views.delete(socket);
      }
      await closeSocketServer(io);
      await closeHttpServer(server);
    })();
    return closePromise;
  };

  return Object.freeze({
    protocol: RESIDENT_VIEWER_PROTOCOL,
    endpoint: endpoint!,
    host: options.host,
    port,
    viewDistance: options.viewDistance,
    firstPerson: options.firstPerson,
    readOnly: true as const,
    cameraCaptureProtocol: RESIDENT_CAMERA_CAPTURE_PROTOCOL,
    admittedFrameEndpoint,
    captureFrame: cameraCapture.captureFrame,
    retainAdmittedFrame,
    close,
  });
}

function admittedFrameView(frame: ResidentCameraFrame | null): ResidentAdmittedCameraFrameView {
  if (!frame) {
    return Object.freeze({
      protocol: RESIDENT_ADMITTED_CAMERA_FRAME_PROTOCOL,
      status: 'unavailable' as const,
      reason: 'no_admitted_frame' as const,
    });
  }
  const imagePath = `${RESIDENT_ADMITTED_CAMERA_FRAME_PATH}/image?digest=${encodeURIComponent(frame.digest)}`;
  return Object.freeze({
    protocol: RESIDENT_ADMITTED_CAMERA_FRAME_PROTOCOL,
    status: 'available' as const,
    digest: frame.digest,
    bindingSha256: frame.bindingSha256,
    content: Object.freeze({
      mediaType: frame.content.mediaType,
      bytes: frame.content.bytes,
      sha256: frame.content.sha256,
      width: frame.content.width,
      height: frame.content.height,
    }),
    renderer: frame.renderer,
    binding: frame.binding,
    imagePath,
  });
}

function parseResidentViewerOptions(value: ResidentViewerOptions): ResidentViewerOptions {
  if (value.host !== '127.0.0.1') throw new Error('resident viewer must bind to 127.0.0.1');
  if (!Number.isSafeInteger(value.port) || value.port < 0 || value.port > 65_535) {
    throw new Error('resident viewer port must be an integer from 0 through 65535');
  }
  if (
    !Number.isSafeInteger(value.viewDistance) ||
    value.viewDistance < 2 ||
    value.viewDistance > 16
  ) {
    throw new Error('resident viewer distance must be an integer from 2 through 16 chunks');
  }
  if (typeof value.firstPerson !== 'boolean') {
    throw new Error('resident viewer firstPerson must be boolean');
  }
  return Object.freeze({ ...value });
}

function listenLoopback(server: HttpServer, host: string, port: number) {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.removeListener('error', onError);
      resolve();
    });
  });
}

function closeSocketServer(io: any) {
  return new Promise<void>((resolve) => {
    try {
      io.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

function closeHttpServer(server: HttpServer) {
  if (!server.listening) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections?.();
  });
}
