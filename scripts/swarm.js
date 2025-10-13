#!/usr/bin/env node
/*
  Simple multi-bot launcher for local/offline servers.
  - Reads bots from bots.json (or --config <file>)
  - Spawns each as a child process: `node src/index.js`
  - Disables keyboard input for children (KEYBOARD=0)
*/

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

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
  // Allow CLI override: --delay 2000
  const delayFlag = args.indexOf('--delay');
  if (delayFlag >= 0 && args[delayFlag + 1]) cfg.spawnDelayMs = Number(args[delayFlag + 1]);
  return cfg;
}

function spawnBot(botCfg, idx) {
  const env = { ...process.env };
  if (botCfg.username) env.MINECRAFT_USERNAME = botCfg.username;
  if (botCfg.password != null) env.MINECRAFT_PASSWORD = botCfg.password;
  if (botCfg.auth) env.MINECRAFT_AUTH = botCfg.auth;
  if (botCfg.tickMs) env.AGENT_TICK_MS = String(botCfg.tickMs);
  if (botCfg.model) env.LLM_MODEL = botCfg.model;
  if (botCfg.server?.host) env.SERVER_HOST = botCfg.server.host;
  if (botCfg.server?.port) env.SERVER_PORT = String(botCfg.server.port);
  env.KEYBOARD = '0';

  const child = spawn(process.execPath, ['src/index.js'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const prefix = `[bot:${idx}${botCfg.username ? ':' + botCfg.username : ''}]`;
  child.stdout.on('data', (d) => process.stdout.write(`${prefix} ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`${prefix} ${d}`));
  child.on('exit', (code) => {
    console.log(`${prefix} exited with code ${code}`);
  });
  return child;
}

function main() {
  const cfg = loadBotsConfig();
  if (!Array.isArray(cfg?.bots) || cfg.bots.length === 0) {
    console.error('[swarm] No bots found in config. Expected { bots: [...] }');
    process.exit(1);
  }
  const delay = Number.isFinite(cfg.spawnDelayMs) ? Math.max(0, cfg.spawnDelayMs) : 1500;
  console.log(`[swarm] launching ${cfg.bots.length} bot(s) with ${delay}ms delay`);
  const children = [];
  cfg.bots.forEach((b, i) => {
    setTimeout(() => {
      const child = spawnBot(b, i + 1);
      children.push(child);
    }, i * delay);
  });

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
