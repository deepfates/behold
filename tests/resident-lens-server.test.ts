import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startResidentLensServer } from '../src/observability/resident-lens-server';

test('resident lens server follows journals over GET and SSE and closes its listener', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-resident-lens-'));
  fs.writeFileSync(
    path.join(directory, '2026-07-01T00-00-00-000Z-Scout.jsonl'),
    line(1, 'run_started', { runId: 'older-run', body: { username: 'Body' } }),
  );
  const journal = path.join(directory, '2026-07-02T00-00-00-000Z-Scout.jsonl');
  fs.writeFileSync(journal, line(1, 'run_started', { runId: 'run-1', body: { username: 'Body' } }));
  const server = await startResidentLensServer({
    residents: [
      {
        entityId: 'Scout',
        bodyUsername: 'Body',
        journalDirectory: directory,
        viewerEndpoint: 'http://127.0.0.1:3007',
      },
    ],
    pollMs: 10,
  });
  try {
    assert.equal(server.host, '127.0.0.1');
    assert.equal(server.readOnly, true);
    const initial = await fetch(`${server.endpoint}/api/residents`).then((response) =>
      response.json(),
    );
    assert.equal(initial[0].state.runId, 'run-1');
    assert.equal(initial[0].state.cursor.journalSequence, 1);
    assert.equal(initial[0].source.file, journal);

    const page = await fetch(server.endpoint);
    assert.match(
      page.headers.get('content-security-policy') ?? '',
      /frame-src http:\/\/127\.0\.0\.1:\*/,
    );
    assert.match(await page.text(), /new EventSource\('\/api\/events'\)/);

    const stream = await fetch(`${server.endpoint}/api/events`);
    assert.equal(stream.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    const reader = stream.body!.getReader();
    await reader.read(); // initial snapshot

    fs.appendFileSync(
      journal,
      line(2, 'resident_decision_opportunity', {
        opportunityId: 'opp-1',
        phase: 'scheduled',
        at: 100,
      }),
    );
    await waitFor(async () => {
      const views = await fetch(`${server.endpoint}/api/residents`).then((response) =>
        response.json(),
      );
      return views[0].state.phase === 'deciding';
    });
    const update = new TextDecoder().decode((await reader.read()).value);
    assert.match(update, /event: residents/);
    assert.match(update, /"phase":"deciding"/);
    await reader.cancel();

    const rejected = await fetch(`${server.endpoint}/api/residents`, { method: 'POST' });
    assert.equal(rejected.status, 405);
    assert.deepEqual(await rejected.json(), { error: 'read_only' });
  } finally {
    await server.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
  await assert.rejects(fetch(`${server.endpoint}/api/residents`));
});

test('resident lens server reports a missing journal without creating storage', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-resident-lens-missing-'));
  const missing = path.join(parent, 'does-not-exist');
  const server = await startResidentLensServer({
    residents: [
      {
        entityId: 'Scout',
        bodyUsername: 'Body',
        journalDirectory: missing,
        viewerEndpoint: null,
      },
    ],
    pollMs: 10,
  });
  try {
    const views = await fetch(`${server.endpoint}/api/residents`).then((response) =>
      response.json(),
    );
    assert.equal(views[0].source.status, 'unavailable');
    assert.match(views[0].source.error, /ENOENT/);
    assert.equal(fs.existsSync(missing), false);
  } finally {
    await server.close();
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

function line(sequence: number, type: string, data: any) {
  return `${JSON.stringify({
    sequence,
    at: new Date(sequence * 1_000).toISOString(),
    agent: 'Scout',
    type,
    data,
  })}\n`;
}

async function waitFor(predicate: () => Promise<boolean>) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for resident lens update');
}
