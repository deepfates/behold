import fs from 'node:fs/promises';
import http, { type ServerResponse } from 'node:http';
import path from 'node:path';
import {
  applyResidentLensEvent,
  createResidentLensState,
  type ResidentLensState,
  type RunJournalEvent,
} from './resident-lens';

export const RESIDENT_LENS_SERVER_PROTOCOL = 'behold.resident-lens-server.v1' as const;

export type ResidentLensSource = Readonly<{
  entityId: string;
  bodyUsername: string;
  journalDirectory: string;
  viewerEndpoint: string | null;
}>;

export type ResidentLensView = Readonly<{
  entityId: string;
  bodyUsername: string;
  viewerEndpoint: string | null;
  state: ResidentLensState;
  source: Readonly<{
    status: 'waiting_for_journal' | 'following' | 'unavailable';
    file: string | null;
    error: string | null;
  }>;
}>;

export type ResidentLensServerHandle = Readonly<{
  protocol: typeof RESIDENT_LENS_SERVER_PROTOCOL;
  endpoint: string;
  host: '127.0.0.1';
  port: number;
  readOnly: true;
  snapshot(): readonly ResidentLensView[];
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
};

export async function startResidentLensServer(options: {
  residents: readonly ResidentLensSource[];
  host?: '127.0.0.1';
  port?: number;
  pollMs?: number;
}): Promise<ResidentLensServerHandle> {
  const host = options.host ?? '127.0.0.1';
  if (host !== '127.0.0.1') throw new Error('resident lens must bind to 127.0.0.1');
  const port = options.port ?? 0;
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error('resident lens port must be an integer from 0 through 65535');
  }
  const pollMs = options.pollMs ?? 250;
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
      },
      activeFile: null,
      offset: 0,
      partial: '',
      state: createResidentLensState(),
      sourceStatus: 'waiting_for_journal' as const,
      sourceError: null,
    };
  });
  const clients = new Set<ServerResponse>();
  let closed = false;
  let polling = false;

  const poll = async () => {
    if (closed || polling) return;
    polling = true;
    try {
      let changed = false;
      for (const tail of tails) changed = (await pollTail(tail)) || changed;
      if (changed) broadcast(clients, snapshot(tails));
    } finally {
      polling = false;
    }
  };
  await poll();

  const server = http.createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      return sendJson(response, 405, { error: 'read_only' });
    }
    const pathname = new URL(request.url ?? '/', `http://${host}`).pathname;
    if (pathname === '/') return sendHtml(response, residentLensHtml());
    if (pathname === '/api/residents') return sendJson(response, 200, snapshot(tails));
    if (pathname !== '/api/events') return sendJson(response, 404, { error: 'not_found' });

    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      Connection: 'keep-alive',
      'Cache-Control': 'no-store',
    });
    clients.add(response);
    writeSse(response, snapshot(tails));
    request.once('close', () => clients.delete(response));
  });
  await listen(server, host, port);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('resident lens has no TCP address');
  const endpoint = `http://${host}:${address.port}`;
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
    snapshot: () => snapshot(tails),
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

function snapshot(tails: readonly Tail[]): readonly ResidentLensView[] {
  return structuredClone(
    tails.map((tail) => ({
      entityId: tail.source.entityId,
      bodyUsername: tail.source.bodyUsername,
      viewerEndpoint: tail.source.viewerEndpoint,
      state: tail.state,
      source: {
        status: tail.sourceStatus,
        file: tail.activeFile,
        error: tail.sourceError,
      },
    })),
  );
}

function broadcast(clients: Set<ServerResponse>, views: readonly ResidentLensView[]) {
  for (const client of clients) {
    try {
      writeSse(client, views);
    } catch {
      clients.delete(client);
      client.end();
    }
  }
}

function writeSse(response: ServerResponse, views: readonly ResidentLensView[]) {
  response.write(`event: residents\ndata: ${JSON.stringify(views)}\n\n`);
}

function sendJson(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(`${JSON.stringify(value)}\n`);
}

function sendHtml(response: ServerResponse, html: string) {
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src http://127.0.0.1:*",
  });
  response.end(html);
}

function residentLensHtml() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Behold resident lens</title><style>
body{margin:0;background:#111;color:#eee;font:14px/1.4 ui-monospace,monospace}header{padding:12px 16px;border-bottom:1px solid #444}main{display:grid;gap:12px;padding:12px}.resident{display:grid;grid-template-columns:minmax(280px,1fr) minmax(360px,1.5fr);gap:12px;border:1px solid #444;padding:10px}.flow{display:grid;gap:8px}.stage{background:#1b1b1b;padding:8px;white-space:pre-wrap;overflow-wrap:anywhere}.label{color:#9ad;font-weight:bold}.muted{color:#999}iframe{width:100%;height:420px;border:0;background:#000}@media(max-width:800px){.resident{grid-template-columns:1fr}}</style>
</head><body><header>Behold · live resident lens · read only</header><main id="residents"></main>
<script>
const root=document.getElementById('residents');
const text=v=>v==null?'unavailable':typeof v==='string'?v:JSON.stringify(v,null,2);
function render(views){root.replaceChildren(...views.map(view=>{
 const card=document.createElement('section');card.className='resident';
 const flow=document.createElement('div');flow.className='flow';
 const title=document.createElement('div');title.innerHTML='<span class="label"></span> <span class="muted"></span>';
 title.children[0].textContent=view.entityId;title.children[1].textContent='('+view.bodyUsername+') · '+view.state.phase;
 flow.append(title);
 for(const [label,value] of [['decision',view.state.decision],['body condition',view.state.bodyCondition],['sees',view.state.sees],['chooses',view.state.chooses],['doing',view.state.doing],['consequence',view.state.consequence],['next experience',view.state.nextExperience]]){
   const stage=document.createElement('div');stage.className='stage';
   const heading=document.createElement('div');heading.className='label';heading.textContent=label;
   const content=document.createElement('div');content.textContent=text(value);stage.append(heading,content);flow.append(stage);
 }
 const source=document.createElement('div');source.className='muted';source.textContent='journal '+view.source.status+' · sequence '+view.state.cursor.journalSequence+(view.source.error?' · '+view.source.error:'');flow.append(source);
 card.append(flow);
 if(view.viewerEndpoint){const frame=document.createElement('iframe');frame.src=view.viewerEndpoint;frame.title=view.entityId+' point of view';card.append(frame)}
 return card;
}));}
fetch('/api/residents').then(r=>r.json()).then(render);
const events=new EventSource('/api/events');events.addEventListener('residents',event=>render(JSON.parse(event.data)));
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
