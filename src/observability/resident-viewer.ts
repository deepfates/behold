import { EventEmitter } from 'node:events';
import { createServer, type Server as HttpServer } from 'node:http';
import path from 'node:path';
import type { Bot } from 'mineflayer';

export const RESIDENT_VIEWER_PROTOCOL = 'behold.prismarine-resident-viewer.v1' as const;

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
  close(): Promise<void>;
}>;

type ViewerSocket = EventEmitter & {
  emit(event: string, ...args: any[]): boolean;
  disconnect(close?: boolean): void;
};

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
  app.use('/', express.static(path.join(viewerPackageRoot, 'public')));
  const server = createServer(app);
  const sockets = new Set<ViewerSocket>();
  const views = new Map<ViewerSocket, WorldView>();
  const io = new SocketServer(server, { path: '/socket.io' });
  let closed = false;

  io.on('connection', (socket: ViewerSocket) => {
    if (closed) {
      socket.disconnect(true);
      return;
    }
    sockets.add(socket);
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
  const endpoint = `http://${options.host}:${port}`;

  let closePromise: Promise<void> | null = null;
  const close = () => {
    if (closePromise) return closePromise;
    closed = true;
    closePromise = (async () => {
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
    endpoint,
    host: options.host,
    port,
    viewDistance: options.viewDistance,
    firstPerson: options.firstPerson,
    readOnly: true as const,
    close,
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
