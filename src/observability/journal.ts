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
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeName = sanitizeName(agentName);
  const id = `${stamp}-${safeName}`;
  const file = path.join(directory, `${id}.jsonl`);
  const createDescriptor = fs.openSync(
    file,
    fs.constants.O_CREAT |
      fs.constants.O_EXCL |
      fs.constants.O_APPEND |
      fs.constants.O_WRONLY |
      fs.constants.O_NOFOLLOW,
    0o600,
  );
  fs.closeSync(createDescriptor);
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
    const descriptor = fs.openSync(
      file,
      fs.constants.O_APPEND | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW,
    );
    try {
      fs.writeFileSync(descriptor, `${JSON.stringify(event)}\n`, 'utf8');
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
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
