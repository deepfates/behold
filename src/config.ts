const REQUIRED_FOR_MINECRAFT = ['SERVER_HOST', 'SERVER_PORT', 'MINECRAFT_USERNAME'] as const;
export const DEFAULT_LLM_MODEL = 'google/gemini-3.5-flash';

export interface Config {
  server: { host: string; port: number };
  circle: { id: string; source: 'explicit' | 'endpoint-fallback' };
  auth: { username: string; password?: string; mode: 'offline' | 'microsoft' };
  agent: { tickMs: number };
  viewer: {
    enabled: boolean;
    required: boolean;
    host: '127.0.0.1';
    port: number;
    firstPerson: boolean;
    viewDistance: number;
  };
  input: { mode: 'hold' | 'toggle' };
  llm: { apiKey?: string; model: string };
}

export type ConfigEnvironment = Readonly<Record<string, string | undefined>>;

export type ConfigOverrides = Readonly<{
  serverHost?: string;
  serverPort?: number;
  circleId?: string;
  bodyUsername?: string;
  model?: string;
  tickMs?: number;
}>;

function envInt(environment: ConfigEnvironment, name: string, def: number) {
  const raw = environment[name];
  if (raw == null || raw === '') return def;
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
}

function envBool(environment: ConfigEnvironment, name: string, def: boolean) {
  const raw = environment[name];
  if (raw == null || raw === '') return def;
  const s = String(raw).toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  return def;
}

export function getConfig(
  environment: ConfigEnvironment = process.env,
  overrides: ConfigOverrides = {},
): Config {
  const host = overrides.serverHost?.trim() || environment.SERVER_HOST || 'localhost';
  const port = overrides.serverPort ?? envInt(environment, 'SERVER_PORT', 25565);
  const explicitCircle = String(overrides.circleId ?? environment.BEHOLD_WORLD_ID ?? '').trim();
  const cfg: Config = {
    server: {
      host,
      port,
    },
    circle: explicitCircle
      ? { id: explicitCircle, source: 'explicit' }
      : { id: endpointCircleId(host, port), source: 'endpoint-fallback' },
    auth: {
      username: overrides.bodyUsername?.trim() || environment.MINECRAFT_USERNAME || 'BeholdBot',
      password: environment.MINECRAFT_PASSWORD || undefined,
      mode: (environment.MINECRAFT_AUTH || 'offline').toLowerCase() as 'offline' | 'microsoft',
    },
    agent: {
      tickMs: overrides.tickMs ?? envInt(environment, 'AGENT_TICK_MS', 4000),
    },
    viewer: {
      enabled: envBool(environment, 'VIEWER_ENABLED', true),
      required: envBool(environment, 'VIEWER_REQUIRED', false),
      host: '127.0.0.1',
      port: envInt(environment, 'VIEWER_PORT', 3007),
      firstPerson: envBool(environment, 'VIEWER_FIRST_PERSON', true),
      viewDistance: envInt(environment, 'VIEWER_DISTANCE', 8),
    },
    input: {
      mode: (environment.KEY_MODE || 'hold').toLowerCase() === 'toggle' ? 'toggle' : 'hold',
    },
    llm: {
      apiKey: environment.OPENROUTER_API_KEY || undefined,
      model: overrides.model?.trim() || environment.LLM_MODEL || DEFAULT_LLM_MODEL,
    },
  };

  for (const key of REQUIRED_FOR_MINECRAFT) {
    if (!environment[key] && !providedByOverride(key, overrides)) {
      console.warn(`[config] ${key} not set; using defaults if available.`);
    }
  }
  return cfg;
}

function providedByOverride(
  key: (typeof REQUIRED_FOR_MINECRAFT)[number],
  overrides: ConfigOverrides,
) {
  if (key === 'SERVER_HOST') return Boolean(overrides.serverHost?.trim());
  if (key === 'SERVER_PORT') return overrides.serverPort != null;
  return Boolean(overrides.bodyUsername?.trim());
}

function endpointCircleId(host: string, port: number) {
  const normalizedHost = ['localhost', '::1', '0:0:0:0:0:0:0:1'].includes(
    String(host).toLowerCase(),
  )
    ? '127.0.0.1'
    : String(host).toLowerCase();
  return `minecraft://${normalizedHost}:${port}`;
}
