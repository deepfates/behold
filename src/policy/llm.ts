import type { Bot } from 'mineflayer';
import type { Intent } from '../loop/arbiter';

type ToolSpec = { type: 'function'; function: { name: string; description?: string; parameters?: any } };

type Options = {
  apiKey: string;
  model: string;
  endpoint?: string;
  tickMs?: number;
  allowTools?: string[] | null;
  log?: (s: string) => void;
};

const DEFAULT_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const EXCLUSIVE_TOOLS = new Set<string>(['move_to', 'dig_block', 'place_against']);

export function startLLMPolicy(bot: Bot, specs: ToolSpec[], enqueue: (i: Intent) => void, opts: Options) {
  const log = (s: string) => (opts.log ? opts.log(s) : void 0);
  const tickMs = Math.max(500, Number(opts.tickMs ?? 3000));
  const allow = Array.isArray(opts.allowTools) ? new Set(opts.allowTools) : null;

  let timer: NodeJS.Timeout | null = null;

  let lastTool: string | null = null;

  async function decideOnce() {
    try {
      const frame = getFrame(bot);
      const intent = await callLLM(specs, frame, opts, lastTool);
      if (!intent) return;
      if (allow && !allow.has(intent.tool)) return;
      log(`[policy] propose: ${intent.tool} ${fmtArgs(intent.input)}`);
      enqueue(intent);
      lastTool = intent.tool;
    } catch (e: any) {
      log(`[policy] error: ${e?.message || String(e)}`);
    }
  }

  function start() { if (!timer) timer = setInterval(decideOnce, tickMs); }
  function stop() { if (timer) clearInterval(timer); timer = null; }

  return { start, stop, tick: decideOnce };
}

function getFrame(bot: any) {
  const pos = bot?.entity?.position;
  const position = pos ? { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) } : null;
  const time = bot?.time?.time;
  const isDay = bot?.time?.isDay;
  const dim = bot?.game?.dimension;
  const lastChat = null;
  // cursor + nearby (lightweight hints)
  let cursor: any = null;
  try {
    const bc = bot.blockAtCursor?.(6);
    if (bc) cursor = { kind: 'block', name: bc?.name, x: bc?.position?.x, y: bc?.position?.y, z: bc?.position?.z };
    else {
      const ec = bot.entityAtCursor?.(3.5);
      if (ec) cursor = { kind: 'entity', name: ec?.name || ec?.username };
    }
  } catch {}
  let nearest: string | null = null;
  try {
    const me = bot?.entity?.position;
    const ents = Object.values(bot?.entities || {}) as any[];
    const best = ents
      .filter((e: any) => e?.position && e?.type && me && (e.username ? e.username !== bot.username : true))
      .map((e: any) => ({ name: e.username || e.name || e.type, dist: me.distanceTo(e.position) }))
      .sort((a: any, b: any) => a.dist - b.dist)[0];
    nearest = best ? `${best.name} @ ${Math.round(best.dist * 10) / 10}m` : null;
  } catch {}
  return { position, health: bot?.health, food: bot?.food, time, isDay, dimension: dim, lastChat, cursor, nearest };
}

async function callLLM(specs: any[], frame: any, opts: Options, lastTool: string | null): Promise<Intent | null> {
  const system = [
    'You control a Minecraft bot by calling exactly one tool per turn (or sending a short chat message).',
    'Prefer: observe (status/nearest_entity/entity_at_cursor) → look_at/move_to → act (dig/place/equip/eat).',
    'Avoid calling the same tool twice in a row unless necessary.',
    'If nothing is appropriate, do nothing.',
  ].join('\n');

  const user = `Now: pos ${fmt(frame?.position?.x)},${fmt(frame?.position?.y)},${fmt(frame?.position?.z)} | hp ${fmt(frame?.health)}/20 food ${fmt(frame?.food)}/20 | ${frame?.dimension ?? ''} ${frame?.isDay ? 'day' : 'night'}\nlastChat: ${frame?.lastChat ? JSON.stringify(frame?.lastChat) : 'none'}\ncursor: ${frame?.cursor ? JSON.stringify(frame?.cursor) : 'none'}\nnearest: ${frame?.nearest ?? 'none'}\nlastTool: ${lastTool ?? 'none'}`;

  const body = {
    model: opts.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    tools: specs,
    tool_choice: 'auto',
    temperature: 0.2,
  } as any;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${opts.apiKey}`,
  };
  if (process.env.OPENROUTER_REFERER) headers['HTTP-Referer'] = String(process.env.OPENROUTER_REFERER);
  if (process.env.OPENROUTER_TITLE) headers['X-Title'] = String(process.env.OPENROUTER_TITLE);

  const endpoint = opts.endpoint || DEFAULT_ENDPOINT;
  const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) { const t = await res.text(); throw new Error(`llm ${res.status}: ${t.slice(0, 200)}`); }
  const data: any = await res.json();
  const choice = data?.choices?.[0]?.message;

  const tc = choice?.tool_calls?.[0];
  if (tc && tc.function?.name) {
    let args: any = {};
    try { args = choice?.tool_calls?.[0]?.function?.arguments ? JSON.parse(choice.tool_calls[0].function.arguments) : {}; } catch {}
    const name = String(tc.function.name);
    return toIntent(name, args);
  }

  const text: string | undefined = choice?.content;
  if (text && text.trim()) {
    return { id: rid('llm'), source: 'llm', tool: 'chat', input: { text: text.slice(0, 200) }, kind: 'parallel' };
  }
  return null;
}

function toIntent(name: string, args: any): Intent {
  return { id: rid('llm'), source: 'llm', tool: name, input: args, kind: EXCLUSIVE_TOOLS.has(name) ? 'exclusive' : 'parallel' };
}

function fmt(n: any) { const x = Number(n); return Number.isFinite(x) ? x : '?'; }
function rid(prefix: string) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }
function fmtArgs(a: any) { try { const s = JSON.stringify(a); return s.length > 120 ? s.slice(0, 117) + '...' : s; } catch { return ''; } }
