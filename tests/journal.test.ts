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
