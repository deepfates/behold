import fs from 'node:fs';
import path from 'node:path';

export type Journal = {
  id: string;
  file: string;
  append: (type: string, data?: unknown, source?: JournalSource) => void;
};

export type JournalSource = Readonly<{
  engineAt?: number;
}>;

export function createRunJournal(
  agentName: string,
  directory = process.env.BEHOLD_RUN_DIR || path.resolve(process.cwd(), '.behold-runs'),
): Journal {
  fs.mkdirSync(directory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeName = sanitizeName(agentName);
  const id = `${stamp}-${safeName}`;
  const file = path.join(directory, `${id}.jsonl`);
  let sequence = 0;

  function append(type: string, data: unknown = {}, source: JournalSource = {}) {
    const event = {
      sequence: ++sequence,
      at: new Date().toISOString(),
      ...(Number.isFinite(source.engineAt) ? { engineAt: Number(source.engineAt) } : {}),
      agent: agentName,
      type,
      data,
    };
    fs.appendFileSync(file, `${JSON.stringify(event)}\n`, 'utf8');
  }

  return { id, file, append };
}

export function sanitizeName(value: string) {
  const cleaned = String(value || 'agent')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'agent';
}
