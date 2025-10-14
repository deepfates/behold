import 'dotenv/config';
import readline from 'node:readline';
import { getConfig } from '../config';
import { createBot } from '../bot';
import { buildInterpreter } from '../agent/interpreter';
import { buildFrame, renderFrame } from './render';
import { parseLine } from './parse';
import { createEngine } from '../loop/engine';
import { startLLMPolicy } from '../policy/llm';

export type ConsoleOptions = {
  agentName?: string;
  model?: string;
  tickMs?: number;
  paused?: boolean;
  allowTools?: string[] | null;
};

export async function runConsole(opts: ConsoleOptions = {}) {
  if (opts.agentName) process.env.MINECRAFT_USERNAME = opts.agentName;
  if (opts.model) process.env.LLM_MODEL = opts.model;
  if (opts.tickMs) process.env.AGENT_TICK_MS = String(opts.tickMs);

  const cfg = getConfig();
  const name = cfg.auth.username || 'Agent';
  console.error(`[console] connecting to ${cfg.server.host}:${cfg.server.port} as ${name}`);
  const bot = createBot(cfg);

  const cache: any = { chatTail: [], nearby: [], cursor: null, last: null };
  bot.on('chat', (user: string, text: string) => {
    if (user === (bot as any).username) return;
    cache.chatTail.push({ user, text });
    cache.chatTail = cache.chatTail.slice(-3);
  });

  const updateSense = () => {
    try {
      const bc: any = (bot as any).blockAtCursor?.(6);
      const ec: any = (bot as any).entityAtCursor?.(3.5);
      if (bc) cache.cursor = { kind: 'block', name: bc?.name, x: bc?.position?.x, y: bc?.position?.y, z: bc?.position?.z };
      else if (ec) {
        const me = (bot as any).entity?.position;
        const pos = ec?.position; const dist = me && pos ? me.distanceTo(pos) : null;
        cache.cursor = { kind: 'entity', name: ec?.name, username: ec?.username, dist: dist ?? undefined };
      } else cache.cursor = null;
    } catch {}
    const me: any = (bot as any).entity?.position;
    const ents = Object.values((bot as any).entities || {})
      .filter((e: any) => e?.type && e?.position && me)
      .map((e: any) => ({ kind: e.type, name: e.name, username: e.username, dist: me.distanceTo(e.position) }))
      .sort((a: any, b: any) => (a.dist ?? 0) - (b.dist ?? 0))
      .slice(0, 5)
      .map((e: any, i: number) => ({ idx: i + 1, ...e }));
    cache.nearby = ents;
  };

  const interp = buildInterpreter(bot as any);
  const registry = {
    run: (tool: string, args?: any) => interp.run(tool, args),
    list: () => interp.list(),
  };

  const engine = createEngine(bot as any, registry, { tickMs: Number(process.env.AGENT_TICK_MS || 3000), log: (s) => console.error(s) });
  engine.start();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const prompt = () => rl.setPrompt('» ');
  const show = () => {
    try {
      updateSense();
      const text = renderFrame(name, buildFrame(bot as any, cache));
      process.stdout.write(`\x1b[2K\r${text.split('\n').join('\n')}\n`);
      prompt(); rl.prompt();
    } catch {}
  };

  bot.once('spawn', () => {
    show();
    setInterval(() => { if (!rl.line) show(); }, 1500);
  });

  // Optional LLM policy
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.LLM_MODEL || 'openai/gpt-4o-mini';
  let policy: { start(): void; stop(): void } | null = null;
  if (apiKey && !opts.paused) {
    const toolSpecs = interp.list().map((s: any) => ({ type: 'function', function: { name: s.name, description: s.description || '', parameters: s.parameters || { type: 'object', properties: {} } } }));
    policy = startLLMPolicy(bot as any, toolSpecs as any, (i) => engine.arbiter.enqueue(i), {
      apiKey,
      model,
      tickMs: Number(process.env.AGENT_TICK_MS || 3000),
      allowTools: opts.allowTools ?? null,
      log: (s) => console.error(s),
    });
    policy.start();
    console.error(`[console] LLM policy enabled (model ${model})`);
  } else if (!apiKey) {
    console.error('[console] No OPENROUTER_API_KEY; LLM autopilot disabled.');
  } else {
    console.error('[console] Starting paused (no LLM).');
  }

  rl.on('line', async (line) => {
    const p = parseLine(line);
    if ((p as any).meta === 'help') {
      console.error('Commands: say, status, nearby, cursor, look <x y z|@cursor>, move to <x y z|@cursor> [near=n], stop, dig <x y z|@cursor>, place @cursor, equip <name>, eat [name]');
      prompt(); rl.prompt(); return;
    }
    if ((p as any).meta === 'json') {
      cache.last = `json ${(p as any).args?.on ? 'on' : 'off'} (not yet)`;
      show(); return;
    }
    if (!(p as any).tool) { cache.last = 'unknown command'; show(); return; }
    const intent = { tool: (p as any).tool, input: (p as any).args, preempt: (p as any).preempt, kind: (p as any).kind } as any;
    // Resolve @cursor
    if (intent.input) {
      const cur = cache.cursor;
      if (cur && cur.kind === 'block') {
        for (const k of Object.keys(intent.input)) {
          if (intent.input[k] === '@cursor_x') intent.input[k] = cur.x;
          if (intent.input[k] === '@cursor_y') intent.input[k] = cur.y;
          if (intent.input[k] === '@cursor_z') intent.input[k] = cur.z;
        }
        if (intent.input.on) {
          if (intent.input.on.x === '@cursor_x') intent.input.on.x = cur.x;
          if (intent.input.on.y === '@cursor_y') intent.input.on.y = cur.y;
          if (intent.input.on.z === '@cursor_z') intent.input.on.z = cur.z;
        }
      }
    }
    engine.enqueueHumanIntent({ tool: intent.tool, input: intent.input, preempt: intent.preempt, kind: intent.kind });
    cache.last = `${intent.tool}`;
    show();
  });

  rl.on('close', () => {
    try { engine.stop(); } catch {}
    try { policy?.stop(); } catch {}
    try { (bot as any).end(); } catch {}
    process.exit(0);
  });
}

