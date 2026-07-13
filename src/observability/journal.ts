import fs from 'node:fs';
import path from 'node:path';

export type Journal = {
  file: string;
  append: (type: string, data?: unknown) => void;
};

export function createRunJournal(
  agentName: string,
  directory = process.env.BEHOLD_RUN_DIR || path.resolve(process.cwd(), '.behold-runs'),
): Journal {
  fs.mkdirSync(directory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeName = sanitizeName(agentName);
  const file = path.join(directory, `${stamp}-${safeName}.jsonl`);

  function append(type: string, data: unknown = {}) {
    const event = { at: new Date().toISOString(), agent: agentName, type, data };
    fs.appendFileSync(file, `${JSON.stringify(event)}\n`, 'utf8');
  }

  return { file, append };
}

export function sanitizeName(value: string) {
  const cleaned = String(value || 'agent')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'agent';
}
