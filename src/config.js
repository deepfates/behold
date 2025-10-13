const REQUIRED_FOR_MINECRAFT = ["SERVER_HOST", "SERVER_PORT", "MINECRAFT_USERNAME"]; // password optional for offline

function envInt(name, def) {
  const raw = process.env[name];
  if (raw == null || raw === "") return def;
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
}

function envBool(name, def) {
  const raw = process.env[name];
  if (raw == null || raw === "") return def;
  const s = String(raw).toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return def;
}

function getConfig() {
  const cfg = {
    server: {
      host: process.env.SERVER_HOST || "localhost",
      port: envInt("SERVER_PORT", 25565)
    },
    auth: {
      username: process.env.MINECRAFT_USERNAME || "BeholdBot",
      password: process.env.MINECRAFT_PASSWORD || undefined,
      mode: (process.env.MINECRAFT_AUTH || "offline").toLowerCase() // "offline" | "microsoft"
    },
    agent: {
      tickMs: envInt("AGENT_TICK_MS", 4000)
    },
    viewer: {
      enabled: envBool("VIEWER_ENABLED", true),
      port: envInt("VIEWER_PORT", 3007),
      firstPerson: envBool("VIEWER_FIRST_PERSON", true)
    },
    llm: {
      // OpenRouter-only minimal setup
      apiKey: process.env.OPENROUTER_API_KEY || undefined,
      model: process.env.LLM_MODEL || 'openai/gpt-4o-mini'
    }
  };

  for (const key of REQUIRED_FOR_MINECRAFT) {
    if (!process.env[key] && key !== "MINECRAFT_PASSWORD") {
      // Non-fatal: we use defaults, but warn for visibility
      // eslint-disable-next-line no-console
      console.warn(`[config] ${key} not set; using defaults if available.`);
    }
  }
  return cfg;
}

module.exports = { getConfig };
