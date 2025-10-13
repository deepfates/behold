#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function loadBotsConfig() {
  const args = process.argv.slice(2);
  const cfgFlag = args.indexOf('--config');
  let file = 'bots.json';
  if (cfgFlag >= 0 && args[cfgFlag + 1]) file = args[cfgFlag + 1];
  const full = path.resolve(process.cwd(), file);
  if (!fs.existsSync(full)) {
    console.error(`[swarm] config not found: ${full}`);
    console.error('[swarm] copy bots.example.json to bots.json and edit names');
    process.exit(1);
  }
  const cfg = JSON.parse(fs.readFileSync(full, 'utf8'));
  const delayFlag = args.indexOf('--delay');
  if (delayFlag >= 0 && args[delayFlag + 1]) cfg.spawnDelayMs = Number(args[delayFlag + 1]);
  return cfg;
}

function spawnBot(botCfg: any, idx: number, onEvent?: (e: any) => void) {
  const env = { ...process.env } as any;
  if (botCfg.username) env.MINECRAFT_USERNAME = botCfg.username;
  if (botCfg.password != null) env.MINECRAFT_PASSWORD = botCfg.password;
  if (botCfg.auth) env.MINECRAFT_AUTH = botCfg.auth;
  if (botCfg.tickMs) env.AGENT_TICK_MS = String(botCfg.tickMs);
  if (botCfg.model) env.LLM_MODEL = botCfg.model;
  if (botCfg.server?.host) env.SERVER_HOST = botCfg.server.host;
  if (botCfg.server?.port) env.SERVER_PORT = String(botCfg.server.port);
  env.KEYBOARD = '0';

  const child = spawn(process.execPath, ['dist/src/index.js'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const prefix = `[bot:${idx}${botCfg.username ? ':' + botCfg.username : ''}]`;
  let sawThrottle = false;
  const mark = (buf: any) => {
    const s = String(buf || '');
    if (s.includes('Connection throttled')) sawThrottle = true;
  };
  child.stdout.on('data', (d) => { mark(d); process.stdout.write(`${prefix} ${d}`); });
  child.stderr.on('data', (d) => { mark(d); process.stderr.write(`${prefix} ${d}`); });
  child.on('exit', (code) => {
    console.log(`${prefix} exited with code ${code}`);
    onEvent?.({ type: 'exit', code, sawThrottle });
  });
  return child;
}

function main() {
  const cfg = loadBotsConfig();
  if (!Array.isArray(cfg?.bots) || cfg.bots.length === 0) {
    console.error('[swarm] No bots found in config. Expected { bots: [...] }');
    process.exit(1);
  }
  const delay = Number.isFinite(cfg.spawnDelayMs) ? Math.max(0, cfg.spawnDelayMs) : 5000;
  console.log(`[swarm] launching ${cfg.bots.length} bot(s) with ${delay}ms delay`);
  const children: any[] = [];
  const maxRetries = Number.isFinite(cfg.maxRetries) ? cfg.maxRetries : 5;
  const baseRetryMs = Number.isFinite(cfg.retryBaseMs) ? cfg.retryBaseMs : 3000;

  function schedule(b: any, i: number, attempt = 0) {
    const waitMs = (() => {
      if (attempt === 0) return i * delay;
      const backoff = Math.round(baseRetryMs * Math.pow(1.6, attempt) + Math.random() * 500);
      console.log(`[swarm] retrying bot ${i + 1} in ${backoff}ms (attempt ${attempt}/${maxRetries})`);
      return backoff;
    })();

    setTimeout(() => {
      const startedAt = Date.now();
      const child = spawnBot(b, i + 1, ({ type, code, sawThrottle }: any) => {
        if (type !== 'exit') return;
        const lifetime = Date.now() - startedAt;
        const shouldRetry = attempt < maxRetries && (sawThrottle || lifetime < 5000);
        if (shouldRetry) schedule(b, i, attempt + 1);
      });
      children.push(child);
    }, waitMs);
  }

  cfg.bots.forEach((b: any, i: number) => schedule(b, i, 0));

  const shutdown = () => {
    console.log('\n[swarm] stopping bots...');
    for (const c of children) {
      try { c.kill('SIGINT'); } catch {}
    }
    setTimeout(() => process.exit(0), 250);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();

