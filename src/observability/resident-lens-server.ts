import fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import http, { type ServerResponse } from 'node:http';
import path from 'node:path';
import {
  applyResidentLensEvent,
  createResidentLensState,
  type ResidentLensState,
  type RunJournalEvent,
} from './resident-lens';
import {
  applyHabitatLensEvent,
  createHabitatLensState,
  HABITAT_LENS_PROTOCOL,
  type HabitatLensState,
  type HabitatLifecycleEvent,
} from './habitat-lens';
import {
  RESIDENT_ADMITTED_CAMERA_FRAME_PROTOCOL,
  RESIDENT_ADMITTED_CAMERA_FRAME_PATH,
  type ResidentAdmittedCameraFrameView,
} from './resident-viewer';

export const RESIDENT_LENS_SERVER_PROTOCOL = 'behold.resident-lens-server.v2' as const;
type AvailableAdmittedCameraFrame = Extract<
  ResidentAdmittedCameraFrameView,
  { status: 'available' }
>;

export type ResidentLensSource = Readonly<{
  entityId: string;
  bodyUsername: string;
  journalDirectory: string;
  viewerEndpoint: string | null;
  /** Present only when this resident actually admits camera perception. */
  admittedFrameEndpoint?: string | null;
  staleAfterMs?: number;
}>;

export type ResidentLensCameraView = Readonly<{
  status: 'not_configured' | 'unavailable' | 'available';
  sourceEndpoint: string | null;
  error: string | null;
  ageMs: number | null;
  staleAfterMs: number | null;
  stale: boolean;
  frame: null | Readonly<{
    digest: string;
    bindingSha256: string;
    content: AvailableAdmittedCameraFrame['content'];
    renderer: AvailableAdmittedCameraFrame['renderer'];
    binding: AvailableAdmittedCameraFrame['binding'];
    imageEndpoint: string;
  }>;
}>;

export type ResidentLensView = Readonly<{
  entityId: string;
  bodyUsername: string;
  viewerEndpoint: string | null;
  camera: ResidentLensCameraView;
  state: ResidentLensState;
  source: Readonly<{
    status: 'waiting_for_journal' | 'following' | 'unavailable';
    file: string | null;
    error: string | null;
    lastEventAt: string | null;
    ageMs: number | null;
    staleAfterMs: number | null;
    stale: boolean;
  }>;
}>;

export type HabitatLensView = Readonly<{
  protocol: typeof HABITAT_LENS_PROTOCOL;
  state: HabitatLensState;
  source: Readonly<{
    status: 'not_configured' | 'following' | 'unavailable';
    file: string | null;
    error: string | null;
  }>;
  residents: readonly ResidentLensView[];
}>;

export type ResidentLensServerHandle = Readonly<{
  protocol: typeof RESIDENT_LENS_SERVER_PROTOCOL;
  endpoint: string;
  host: '127.0.0.1';
  port: number;
  readOnly: true;
  controls: Readonly<{ available: boolean }>;
  snapshot(): readonly ResidentLensView[];
  habitat(): HabitatLensView;
  close(): Promise<void>;
}>;

type Tail = {
  source: ResidentLensSource;
  activeFile: string | null;
  offset: number;
  partial: string;
  state: ResidentLensState;
  sourceStatus: ResidentLensView['source']['status'];
  sourceError: string | null;
  cameraStatus: ResidentLensCameraView['status'];
  cameraError: string | null;
  cameraFrame: ResidentLensCameraView['frame'];
  cameraStale: boolean;
};

type LifecycleTail = {
  file: string;
  offset: number;
  partial: string;
  state: HabitatLensState;
  sourceStatus: 'following' | 'unavailable';
  sourceError: string | null;
};

export async function startResidentLensServer(options: {
  residents: readonly ResidentLensSource[];
  host?: '127.0.0.1';
  port?: number;
  pollMs?: number;
  lifecycleFile?: string;
  now?: () => number;
  control?: Readonly<{
    pause(): void | Promise<void>;
    resume(): void | Promise<void>;
    stop(): void | Promise<void>;
  }>;
}): Promise<ResidentLensServerHandle> {
  const host = options.host ?? '127.0.0.1';
  if (host !== '127.0.0.1') throw new Error('resident lens must bind to 127.0.0.1');
  const port = options.port ?? 0;
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error('resident lens port must be an integer from 0 through 65535');
  }
  const pollMs = options.pollMs ?? 250;
  const now = options.now ?? Date.now;
  if (!Number.isSafeInteger(pollMs) || pollMs < 10) {
    throw new Error('resident lens poll interval must be an integer of at least 10ms');
  }
  const identities = new Set<string>();
  const tails = options.residents.map((source) => {
    if (!source.entityId.trim()) throw new Error('resident lens entityId must not be empty');
    if (identities.has(source.entityId)) {
      throw new Error(`resident lens entityId is duplicated: ${source.entityId}`);
    }
    identities.add(source.entityId);
    return {
      source: {
        ...source,
        journalDirectory: path.resolve(source.journalDirectory),
        admittedFrameEndpoint: source.admittedFrameEndpoint
          ? loopbackFrameEndpoint(source.admittedFrameEndpoint)
          : null,
      },
      activeFile: null,
      offset: 0,
      partial: '',
      state: createResidentLensState(),
      sourceStatus: 'waiting_for_journal' as const,
      sourceError: null,
      cameraStatus: source.admittedFrameEndpoint
        ? ('unavailable' as const)
        : ('not_configured' as const),
      cameraError: source.admittedFrameEndpoint
        ? 'no admitted camera frame has been observed'
        : null,
      cameraFrame: null,
      cameraStale: false,
    };
  });
  const clients = new Set<ServerResponse>();
  const controlToken = options.control ? randomBytes(24).toString('base64url') : null;
  const lifecycle: LifecycleTail | null = options.lifecycleFile
    ? {
        file: path.resolve(options.lifecycleFile),
        offset: 0,
        partial: '',
        state: createHabitatLensState(),
        sourceStatus: 'following',
        sourceError: null,
      }
    : null;
  let closed = false;
  let polling = false;

  const poll = async () => {
    if (closed || polling) return;
    polling = true;
    try {
      let changed = false;
      if (lifecycle) changed = (await pollLifecycle(lifecycle)) || changed;
      for (const tail of tails) {
        changed = (await pollTail(tail)) || changed;
        changed = (await pollAdmittedCameraFrame(tail)) || changed;
        changed = updateCameraStaleness(tail, now()) || changed;
      }
      if (changed) broadcast(clients, habitatSnapshot(lifecycle, tails, now()));
    } finally {
      polling = false;
    }
  };
  await poll();

  const server = http.createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const pathname = new URL(request.url ?? '/', `http://${host}`).pathname;
    if (request.method === 'POST' && pathname === '/api/control') {
      void handleControlRequest(request, response, options.control ?? null, controlToken);
      return;
    }
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      return sendJson(response, 405, { error: 'read_only' });
    }
    if (pathname === '/') return sendHtml(response, residentLensHtml());
    if (pathname === '/api/residents') return sendJson(response, 200, snapshot(tails, now()));
    if (pathname === '/api/habitat') {
      return sendJson(response, 200, habitatSnapshot(lifecycle, tails, now()));
    }
    if (pathname !== '/api/events') return sendJson(response, 404, { error: 'not_found' });

    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      Connection: 'keep-alive',
      'Cache-Control': 'no-store',
    });
    clients.add(response);
    writeSse(response, habitatSnapshot(lifecycle, tails, now()));
    request.once('close', () => clients.delete(response));
  });
  await listen(server, host, port);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('resident lens has no TCP address');
  const baseEndpoint = `http://${host}:${address.port}`;
  const endpoint = controlToken
    ? `${baseEndpoint}/#control=${encodeURIComponent(controlToken)}`
    : baseEndpoint;
  const timer = setInterval(() => void poll(), pollMs);
  timer.unref();

  let closePromise: Promise<void> | null = null;
  const close = () => {
    if (closePromise) return closePromise;
    closed = true;
    clearInterval(timer);
    for (const client of clients) client.end();
    clients.clear();
    closePromise = new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
    return closePromise;
  };

  return Object.freeze({
    protocol: RESIDENT_LENS_SERVER_PROTOCOL,
    endpoint,
    host,
    port: address.port,
    readOnly: true as const,
    controls: Object.freeze({ available: options.control != null }),
    snapshot: () => snapshot(tails, now()),
    habitat: () => habitatSnapshot(lifecycle, tails, now()),
    close,
  });
}

async function pollTail(tail: Tail): Promise<boolean> {
  let entries;
  try {
    entries = await fs.readdir(tail.source.journalDirectory, { withFileTypes: true });
  } catch (error: any) {
    return updateSource(tail, 'unavailable', error?.message || String(error));
  }
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => path.join(tail.source.journalDirectory, entry.name))
    .sort();
  const activeFile = files.at(-1) ?? null;
  if (!activeFile) return updateSource(tail, 'waiting_for_journal', null);

  let changed = false;
  if (activeFile !== tail.activeFile) {
    tail.activeFile = activeFile;
    tail.offset = 0;
    tail.partial = '';
    tail.state = createResidentLensState();
    changed = true;
  }
  let bytes: Buffer;
  try {
    const handle = await fs.open(activeFile, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) return updateSource(tail, 'unavailable', 'journal is not a regular file');
      if (stat.size < tail.offset) {
        tail.offset = 0;
        tail.partial = '';
        tail.state = createResidentLensState();
        changed = true;
      }
      const length = stat.size - tail.offset;
      bytes = Buffer.alloc(length);
      if (length > 0) await handle.read(bytes, 0, length, tail.offset);
      tail.offset = stat.size;
    } finally {
      await handle.close();
    }
  } catch (error: any) {
    return updateSource(tail, 'unavailable', error?.message || String(error)) || changed;
  }
  if (bytes.length === 0) {
    if (tail.sourceStatus === 'unavailable') return changed;
    return updateSource(tail, 'following', null) || changed;
  }

  const text = tail.partial + bytes.toString('utf8');
  const lines = text.split('\n');
  tail.partial = lines.pop() ?? '';
  let invalidLine: string | null = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as RunJournalEvent;
      const next = applyResidentLensEvent(tail.state, parsed);
      if (next === tail.state && Number(parsed?.sequence) > tail.state.cursor.journalSequence) {
        throw new Error('invalid run-journal envelope');
      }
      changed = next !== tail.state || changed;
      tail.state = next;
    } catch (error: any) {
      invalidLine = `malformed journal line: ${error?.message || String(error)}`;
    }
  }
  changed = updateSource(tail, invalidLine ? 'unavailable' : 'following', invalidLine) || changed;
  return changed;
}

async function pollAdmittedCameraFrame(tail: Tail): Promise<boolean> {
  const endpoint = tail.source.admittedFrameEndpoint;
  if (!endpoint) return false;
  try {
    const response = await fetch(endpoint, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) throw new Error(`camera projection returned HTTP ${response.status}`);
    const value = (await response.json()) as ResidentAdmittedCameraFrameView;
    if (
      value?.protocol !== RESIDENT_ADMITTED_CAMERA_FRAME_PROTOCOL ||
      !['available', 'unavailable'].includes(value?.status)
    ) {
      throw new Error('camera projection returned an unsupported envelope');
    }
    if (value.status === 'unavailable') {
      return updateCamera(tail, 'unavailable', 'no admitted camera frame is available', null);
    }
    const frame = admittedCameraFrame(tail, endpoint, value);
    return updateCamera(tail, 'available', null, frame);
  } catch (error: any) {
    return updateCamera(tail, 'unavailable', error?.message || String(error), null);
  }
}

async function pollLifecycle(tail: LifecycleTail): Promise<boolean> {
  let bytes: Buffer;
  let changed = false;
  try {
    const handle = await fs.open(tail.file, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile())
        return updateLifecycleSource(tail, 'unavailable', 'lifecycle is not a regular file');
      if (stat.size < tail.offset) {
        tail.offset = 0;
        tail.partial = '';
        tail.state = createHabitatLensState();
        changed = true;
      }
      const length = stat.size - tail.offset;
      bytes = Buffer.alloc(length);
      if (length > 0) await handle.read(bytes, 0, length, tail.offset);
      tail.offset = stat.size;
    } finally {
      await handle.close();
    }
  } catch (error: any) {
    return updateLifecycleSource(tail, 'unavailable', error?.message || String(error)) || changed;
  }
  if (bytes.length === 0) {
    return updateLifecycleSource(tail, 'following', null) || changed;
  }
  const text = tail.partial + bytes.toString('utf8');
  const lines = text.split('\n');
  tail.partial = lines.pop() ?? '';
  let invalidLine: string | null = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as HabitatLifecycleEvent;
      const next = applyHabitatLensEvent(tail.state, parsed);
      if (next === tail.state && Number(parsed?.sequence) > tail.state.cursor.lifecycleSequence) {
        throw new Error('invalid lifecycle envelope');
      }
      changed = next !== tail.state || changed;
      tail.state = next;
    } catch (error: any) {
      invalidLine = `malformed lifecycle line: ${error?.message || String(error)}`;
    }
  }
  changed =
    updateLifecycleSource(tail, invalidLine ? 'unavailable' : 'following', invalidLine) || changed;
  return changed;
}

function updateSource(
  tail: Tail,
  status: ResidentLensView['source']['status'],
  error: string | null,
) {
  const changed = tail.sourceStatus !== status || tail.sourceError !== error;
  tail.sourceStatus = status;
  tail.sourceError = error;
  return changed;
}

function updateLifecycleSource(
  tail: LifecycleTail,
  status: LifecycleTail['sourceStatus'],
  error: string | null,
) {
  const changed = tail.sourceStatus !== status || tail.sourceError !== error;
  tail.sourceStatus = status;
  tail.sourceError = error;
  return changed;
}

function updateCamera(
  tail: Tail,
  status: ResidentLensCameraView['status'],
  error: string | null,
  frame: ResidentLensCameraView['frame'],
) {
  const changed =
    tail.cameraStatus !== status ||
    tail.cameraError !== error ||
    JSON.stringify(tail.cameraFrame) !== JSON.stringify(frame);
  tail.cameraStatus = status;
  tail.cameraError = error;
  tail.cameraFrame = frame;
  return changed;
}

function updateCameraStaleness(tail: Tail, now: number) {
  const completedAt = tail.cameraFrame?.binding.captureCompletedAt ?? null;
  const staleAfterMs = tail.source.staleAfterMs ?? null;
  const stale =
    tail.cameraStatus === 'available' &&
    completedAt !== null &&
    staleAfterMs !== null &&
    Math.max(0, now - completedAt) > staleAfterMs;
  const changed = tail.cameraStale !== stale;
  tail.cameraStale = stale;
  return changed;
}

function snapshot(tails: readonly Tail[], now: number): readonly ResidentLensView[] {
  return structuredClone(
    tails.map((tail) => {
      const eventAt = Date.parse(tail.state.cursor.at ?? '');
      const ageMs = Number.isFinite(eventAt) ? Math.max(0, now - eventAt) : null;
      const staleAfterMs = tail.source.staleAfterMs ?? null;
      return {
        entityId: tail.source.entityId,
        bodyUsername: tail.source.bodyUsername,
        viewerEndpoint: tail.source.viewerEndpoint,
        camera: cameraSnapshot(tail, now),
        state: tail.state,
        source: {
          status: tail.sourceStatus,
          file: tail.activeFile,
          error: tail.sourceError,
          lastEventAt: tail.state.cursor.at,
          ageMs,
          staleAfterMs,
          stale:
            tail.sourceStatus === 'following' &&
            tail.state.phase !== 'stopped' &&
            ageMs !== null &&
            staleAfterMs !== null &&
            ageMs > staleAfterMs,
        },
      };
    }),
  );
}

function cameraSnapshot(tail: Tail, now: number): ResidentLensCameraView {
  const completedAt = tail.cameraFrame?.binding.captureCompletedAt ?? null;
  const ageMs = completedAt === null ? null : Math.max(0, now - completedAt);
  const staleAfterMs = tail.source.staleAfterMs ?? null;
  return {
    status: tail.cameraStatus,
    sourceEndpoint: tail.source.admittedFrameEndpoint ?? null,
    error: tail.cameraError,
    ageMs,
    staleAfterMs,
    stale: tail.cameraStale,
    frame: tail.cameraFrame,
  };
}

function admittedCameraFrame(
  tail: Tail,
  sourceEndpoint: string,
  value: AvailableAdmittedCameraFrame,
): NonNullable<ResidentLensCameraView['frame']> {
  if (!/^[0-9a-f]{64}$/.test(value.digest) || !/^[0-9a-f]{64}$/.test(value.bindingSha256)) {
    throw new Error('camera projection contains an invalid digest');
  }
  if (
    value.binding?.entityId !== tail.source.entityId ||
    value.binding?.body?.username !== tail.source.bodyUsername
  ) {
    throw new Error('camera projection belongs to another resident or body');
  }
  if (tail.state.runId && value.binding.managedRunId !== tail.state.runId) {
    throw new Error('camera projection belongs to another managed run');
  }
  if (
    !Number.isSafeInteger(value.binding?.observationSequence) ||
    !Number.isFinite(value.binding?.observedAt) ||
    !Number.isFinite(value.binding?.captureStartedAt) ||
    !Number.isFinite(value.binding?.captureCompletedAt) ||
    value.binding.captureCompletedAt < value.binding.captureStartedAt
  ) {
    throw new Error('camera projection timing or observation binding is invalid');
  }
  const source = new URL(sourceEndpoint);
  const image = new URL(value.imagePath, source);
  if (
    image.origin !== source.origin ||
    image.pathname !== `${RESIDENT_ADMITTED_CAMERA_FRAME_PATH}/image` ||
    image.searchParams.get('digest') !== value.digest
  ) {
    throw new Error('camera projection image does not bind its declared digest');
  }
  return structuredClone({
    digest: value.digest,
    bindingSha256: value.bindingSha256,
    content: value.content,
    renderer: value.renderer,
    binding: value.binding,
    imageEndpoint: image.href,
  });
}

function loopbackFrameEndpoint(value: string) {
  const endpoint = new URL(value);
  if (
    endpoint.protocol !== 'http:' ||
    endpoint.hostname !== '127.0.0.1' ||
    endpoint.pathname !== RESIDENT_ADMITTED_CAMERA_FRAME_PATH ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error('admitted camera frame source must be its exact loopback read-only endpoint');
  }
  return endpoint.href;
}

function habitatSnapshot(
  lifecycle: LifecycleTail | null,
  tails: readonly Tail[],
  now: number,
): HabitatLensView {
  return structuredClone({
    protocol: HABITAT_LENS_PROTOCOL,
    state: lifecycle?.state ?? createHabitatLensState(),
    source: lifecycle
      ? { status: lifecycle.sourceStatus, file: lifecycle.file, error: lifecycle.sourceError }
      : { status: 'not_configured' as const, file: null, error: null },
    residents: snapshot(tails, now),
  });
}

function broadcast(clients: Set<ServerResponse>, view: HabitatLensView) {
  for (const client of clients) {
    try {
      writeSse(client, view);
    } catch {
      clients.delete(client);
      client.end();
    }
  }
}

function writeSse(response: ServerResponse, view: HabitatLensView) {
  response.write(`event: habitat\ndata: ${JSON.stringify(view)}\n\n`);
  response.write(`event: residents\ndata: ${JSON.stringify(view.residents)}\n\n`);
}

function sendJson(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(`${JSON.stringify(value)}\n`);
}

async function handleControlRequest(
  request: http.IncomingMessage,
  response: ServerResponse,
  control: Readonly<{
    pause(): void | Promise<void>;
    resume(): void | Promise<void>;
    stop(): void | Promise<void>;
  }> | null,
  token: string | null,
) {
  if (!control || !token) return sendJson(response, 404, { error: 'controls_unavailable' });
  if (request.headers.authorization !== `Bearer ${token}`) {
    return sendJson(response, 403, { error: 'control_capability_required' });
  }
  try {
    let body = '';
    for await (const chunk of request) {
      body += String(chunk);
      if (body.length > 1_024) throw new Error('control request is too large');
    }
    const action = JSON.parse(body || '{}')?.action;
    if (!['pause', 'resume', 'stop'].includes(action)) {
      return sendJson(response, 400, { error: 'invalid_control_action' });
    }
    await control[action as 'pause' | 'resume' | 'stop']();
    return sendJson(response, 200, { acknowledged: true, action });
  } catch (error: any) {
    return sendJson(response, 409, {
      error: 'control_failed',
      detail: error?.message || String(error),
    });
  }
}

function sendHtml(response: ServerResponse, html: string) {
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' http://127.0.0.1:*",
  });
  response.end(html);
}

function residentLensHtml() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Behold resident lens</title><style>
body{margin:0;background:#111;color:#eee;font:14px/1.4 ui-monospace,monospace}header{padding:12px 16px;border-bottom:1px solid #444}.habitat{padding:10px 16px;background:#171717;border-bottom:1px solid #333;white-space:pre-wrap}.controls{display:flex;gap:8px;padding:8px 16px;border-bottom:1px solid #333}.controls[hidden]{display:none}.controls button{background:#222;color:#eee;border:1px solid #666;padding:6px 12px;cursor:pointer}.controls .status{padding:6px;color:#aaa}main{display:grid;gap:12px;padding:12px}.resident{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(320px,.65fr);gap:12px;border:1px solid #444;padding:10px}.flow{display:grid;gap:8px;min-width:0}.telemetry{display:flex;flex-wrap:wrap;gap:8px 16px;padding:7px 8px;background:#171717;color:#aaa}.causal{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px}.stage{background:#1b1b1b;padding:8px;overflow-wrap:anywhere}.stage details{margin-top:7px;color:#999}.stage pre{max-height:260px;overflow:auto;white-space:pre-wrap;margin:6px 0 0}.label{color:#9ad;font-weight:bold}.muted{color:#999}.narration{margin-top:8px;padding-top:6px;border-top:1px solid #333;color:#aaa}.history{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.history .stage{max-height:300px;overflow:auto}.camera{display:grid;align-content:start;gap:8px;background:#171717;padding:8px}.camera img{display:block;width:100%;height:auto;aspect-ratio:1;background:#000;object-fit:contain}.camera .unavailable{min-height:180px;display:grid;place-items:center;border:1px dashed #555;color:#999;text-align:center;padding:12px}@media(max-width:1000px){.resident{grid-template-columns:1fr}.history{grid-template-columns:1fr}}</style>
</head><body><header>Behold · live habitat lens · canonical projections</header><div class="habitat" id="habitat">lifecycle unavailable</div><div class="controls" id="controls" hidden><button data-action="pause">pause cognition</button><button data-action="resume">resume cognition</button><button data-action="stop">save and stop</button><span class="status" id="control-status">owned controls</span></div><main id="residents"></main>
<script>
const root=document.getElementById('residents');
const habitatRoot=document.getElementById('habitat');
const controlsRoot=document.getElementById('controls');
const controlStatus=document.getElementById('control-status');
const controlToken=new URLSearchParams(location.hash.slice(1)).get('control');
if(controlToken){controlsRoot.hidden=false;for(const button of controlsRoot.querySelectorAll('button'))button.addEventListener('click',async()=>{
 const action=button.dataset.action;if(action==='stop'&&!confirm('Save the world and stop this episode?'))return;
 controlStatus.textContent=action+' requested';for(const item of controlsRoot.querySelectorAll('button'))item.disabled=true;
 try{const response=await fetch('/api/control',{method:'POST',headers:{'Authorization':'Bearer '+controlToken,'Content-Type':'application/json'},body:JSON.stringify({action})});const result=await response.json();if(!response.ok)throw new Error(result.detail||result.error);controlStatus.textContent=action+' acknowledged'}catch(error){controlStatus.textContent=action+' failed · '+error.message}finally{for(const item of controlsRoot.querySelectorAll('button'))item.disabled=false}
})}
const text=v=>v==null?'unavailable':typeof v==='string'?v:JSON.stringify(v,null,2);
const choice=v=>v==null?null:{action:v.name,input:v.input,source:v.source};
const list=v=>Array.isArray(v)?v:[];
function observationSummary(v){if(!v)return'unavailable';const condition=v.self?.condition||{};const events=list(v.events).filter(event=>event?.isNew).map(event=>event?.type).filter(Boolean);return'observation '+text(v.sequence)+' · '+text(condition.daylight)+' · health '+text(condition.health)+' · food '+text(condition.food)+' · visible '+list(v.scene?.entities).length+' · new events '+(events.length?events.join(', '):'none')}
function stageSummary(label,v){if(v==null)return'unavailable';if(label==='experience'||label==='next experience')return observationSummary(v);if(label==='choice')return text(v.action)+' · '+JSON.stringify(v.input??{});if(label==='attempt')return text(v.name)+' · '+text(v.status);if(label==='consequence')return(v.ok?'ok':'failed')+' · '+text(v.eventType)+(v.error?' · '+v.error:'');return text(v)}
function detailStage(label,value){const stage=document.createElement('div');stage.className='stage';const heading=document.createElement('div');heading.className='label';heading.textContent=label;const summary=document.createElement('div');summary.textContent=stageSummary(label,value);const details=document.createElement('details');const toggle=document.createElement('summary');toggle.textContent='canonical detail';const raw=document.createElement('pre');raw.textContent=text(value);details.append(toggle,raw);stage.append(heading,summary,details);return stage}
function renderHabitat(view){
 const s=view.state;habitatRoot.textContent='world · '+text(s.worldId)+' · run '+text(s.runId)+' · '+s.phase+' · lifecycle '+view.source.status+' @ '+s.cursor.lifecycleSequence+'\\n'+
 'population · configured '+s.population.configured.length+' · ready '+s.population.ready.length+' · released '+s.population.released.length+' · stopped '+text(s.population.stopped)+' · cognition '+text(s.cognition)+' · server '+text(s.server)+' · terminal '+text(s.terminal)+(s.unavailable.lifecycle?'\\nmissing · '+s.unavailable.lifecycle:'');
}
function render(views){root.replaceChildren(...views.map(view=>{
 const card=document.createElement('section');card.className='resident';
 const flow=document.createElement('div');flow.className='flow';
 const title=document.createElement('div');title.innerHTML='<span class="label"></span> <span class="muted"></span>';
 title.children[0].textContent=view.entityId;title.children[1].textContent='('+view.bodyUsername+')';
 flow.append(title);
 const telemetry=document.createElement('div');telemetry.className='telemetry';
 telemetry.textContent='controller · '+view.state.phase+' · decision '+text(view.state.decision)+' · body '+text(view.state.bodyCondition)+' · journal '+view.source.status+' @ '+view.state.cursor.journalSequence+' · source age '+text(view.source.ageMs)+'ms'+(view.source.stale?' · STALE':'')+(view.source.error?' · '+view.source.error:'');
 flow.append(telemetry);
 const causal=document.createElement('div');causal.className='causal';
 for(const [label,value] of [['experience',view.state.sees],['choice',choice(view.state.chooses)],['attempt',view.state.doing],['consequence',view.state.consequence],['next experience',view.state.nextExperience]]){
   const stage=detailStage(label,value);
   if(label==='choice'&&view.state.chooses?.utterance){const narration=document.createElement('div');narration.className='narration';narration.textContent='optional narration · '+view.state.chooses.utterance;stage.append(narration)}
   causal.append(stage);
 }
 flow.append(causal);
 const history=document.createElement('div');history.className='history';
 for(const [label,value] of [['Lync progress',view.state.lync],['observed ethogram',view.state.ethogram]]){
   const stage=document.createElement('div');stage.className='stage';const heading=document.createElement('div');heading.className='label';heading.textContent=label;const content=document.createElement('div');content.textContent=text(value);stage.append(heading,content);history.append(stage)
 }
 flow.append(history);
 card.append(flow);
 const camera=document.createElement('div');camera.className='camera';const cameraHeading=document.createElement('div');cameraHeading.className='label';cameraHeading.textContent='latest admitted camera frame';camera.append(cameraHeading);
 if(view.camera?.status==='available'&&view.camera.frame){const image=document.createElement('img');image.src=view.camera.frame.imageEndpoint;image.alt=view.entityId+' exact latest admitted first-person frame';const facts=document.createElement('div');facts.className=view.camera.stale?'muted stale':'muted';facts.textContent=(view.camera.stale?'STALE · ':'')+'observation '+view.camera.frame.binding.observationSequence+' · captured '+view.camera.frame.binding.captureStartedAt+'–'+view.camera.frame.binding.captureCompletedAt+' · age '+text(view.camera.ageMs)+'ms · digest '+view.camera.frame.digest;const details=document.createElement('details');const toggle=document.createElement('summary');toggle.textContent='binding and renderer';const raw=document.createElement('pre');raw.textContent=text({binding:view.camera.frame.binding,bindingSha256:view.camera.frame.bindingSha256,content:view.camera.frame.content,renderer:view.camera.frame.renderer});details.append(toggle,raw);camera.append(image,facts,details)}else{const unavailable=document.createElement('div');unavailable.className='unavailable';unavailable.textContent='camera '+text(view.camera?.status)+' · '+text(view.camera?.error)}
 card.append(camera);
 return card;
}));}
fetch('/api/habitat').then(r=>r.json()).then(view=>{renderHabitat(view);render(view.residents)});
const events=new EventSource('/api/events');events.addEventListener('residents',event=>render(JSON.parse(event.data)));
events.addEventListener('habitat',event=>renderHabitat(JSON.parse(event.data)));
</script></body></html>`;
}

function listen(server: http.Server, host: string, port: number) {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.removeListener('error', onError);
      resolve();
    });
  });
}
