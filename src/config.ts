const REQUIRED_FOR_MINECRAFT = ["SERVER_HOST", "SERVER_PORT", "MINECRAFT_USERNAME"] as const;

export interface Config {
  server: { host: string; port: number };
  auth: { username: string; password?: string; mode: 'offline' | 'microsoft' };
  agent: { tickMs: number };
  viewer: { enabled: boolean; port: number; firstPerson: boolean; controlsPort: number; controlsEnabled: boolean };
  input: { mode: 'hold' | 'toggle' };
  llm: { apiKey?: string; model: string };
}

function envInt(name: string, def: number) {
  const raw = process.env[name];
  if (raw == null || raw === '') return def;
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
}

function envBool(name: string, def: boolean) {
  const raw = process.env[name];
  if (raw == null || raw === '') return def;
  const s = String(raw).toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return def;
}

export function getConfig(): Config {
  const cfg: Config = {
    server: {
      host: process.env.SERVER_HOST || 'localhost',
      port: envInt('SERVER_PORT', 25565),
    },
    auth: {
      username: process.env.MINECRAFT_USERNAME || 'BeholdBot',
      password: process.env.MINECRAFT_PASSWORD || undefined,
      mode: (process.env.MINECRAFT_AUTH || 'offline').toLowerCase() as 'offline' | 'microsoft',
    },
    agent: {
      tickMs: envInt('AGENT_TICK_MS', 4000),
    },
    viewer: {
      enabled: envBool('VIEWER_ENABLED', true),
      port: envInt('VIEWER_PORT', 3007),
      firstPerson: envBool('VIEWER_FIRST_PERSON', true),
      controlsPort: envInt('CONTROLS_PORT', (envInt('VIEWER_PORT', 3007) + 1)),
      controlsEnabled: envBool('CONTROLS_ENABLED', false),
    },
    input: { mode: ((process.env.KEY_MODE || 'hold').toLowerCase() === 'toggle') ? 'toggle' : 'hold' },
    llm: {
      apiKey: process.env.OPENROUTER_API_KEY || undefined,
      model: process.env.LLM_MODEL || 'openai/gpt-4o-mini',
    },
  };

  for (const key of REQUIRED_FOR_MINECRAFT) {
    if (!process.env[key]) {
      console.warn(`[config] ${key} not set; using defaults if available.`);
    }
  }
  return cfg;
}
