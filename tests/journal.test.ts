import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRunJournal } from '../src/observability/journal';

test('run journal preserves append order and the engine event timestamp', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-journal-'));
  try {
    const journal = createRunJournal('Scout', directory);
    assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
    assert.equal(fs.statSync(journal.file).mode & 0o777, 0o600);
    journal.append('run_started', { runId: journal.id });
    journal.append('action_started', { intent: { id: 'move-1' } }, { engineAt: 1234 });

    const events = fs
      .readFileSync(journal.file, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      events.map((event) => event.sequence),
      [1, 2],
    );
    assert.equal(events[0].engineAt, undefined);
    assert.equal(events[1].engineAt, 1234);
    assert.equal(events[1].type, 'action_started');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('run journal refuses a symlink substituted for its private append target', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-journal-link-'));
  const elsewhere = path.join(directory, 'elsewhere.jsonl');
  try {
    const journal = createRunJournal('Scout', directory);
    fs.writeFileSync(elsewhere, 'untouched\n');
    fs.rmSync(journal.file);
    fs.symlinkSync(elsewhere, journal.file);
    assert.throws(() => journal.append('model_turn', { private: true }));
    assert.equal(fs.readFileSync(elsewhere, 'utf8'), 'untouched\n');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
