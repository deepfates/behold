import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { startResidentLensServer } from '../src/observability/resident-lens-server';

test('resident lens server follows journals over GET and SSE and closes its listener', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-resident-lens-'));
  fs.writeFileSync(
    path.join(directory, '2026-07-01T00-00-00-000Z-Scout.jsonl'),
    line(1, 'run_started', { runId: 'older-run', body: { username: 'Body' } }),
  );
  const journal = path.join(directory, '2026-07-02T00-00-00-000Z-Scout.jsonl');
  fs.writeFileSync(journal, line(1, 'run_started', { runId: 'run-1', body: { username: 'Body' } }));
  const lifecycle = path.join(directory, 'lifecycle.log');
  fs.writeFileSync(
    lifecycle,
    `${JSON.stringify({
      sequence: 1,
      at: new Date(1_000).toISOString(),
      type: 'run_configured',
      data: {
        runId: 'world-1-1',
        world: { id: 'world-1' },
        population: { residents: [{ entityId: 'Scout' }] },
      },
    })}\n${JSON.stringify({
      sequence: 2,
      at: new Date(2_000).toISOString(),
      type: 'run_ready',
      data: { serverPid: 99 },
    })}\n`,
  );
  const server = await startResidentLensServer({
    residents: [
      {
        entityId: 'Scout',
        bodyUsername: 'Body',
        journalDirectory: directory,
        viewerEndpoint: 'http://127.0.0.1:3007',
        staleAfterMs: 500,
      },
    ],
    pollMs: 10,
    lifecycleFile: lifecycle,
    now: () => 3_000,
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
    assert.equal(initial[0].source.ageMs, 2_000);
    assert.equal(initial[0].source.stale, true);

    const habitat = await fetch(`${server.endpoint}/api/habitat`).then((response) =>
      response.json(),
    );
    assert.equal(habitat.state.worldId, 'world-1');
    assert.equal(habitat.state.runId, 'world-1-1');
    assert.equal(habitat.state.phase, 'running');
    assert.equal(habitat.source.file, lifecycle);
    assert.equal(habitat.residents[0].entityId, 'Scout');

    const page = await fetch(server.endpoint);
    assert.match(
      page.headers.get('content-security-policy') ?? '',
      /frame-src http:\/\/127\.0\.0\.1:\*/,
    );
    const html = await page.text();
    assert.match(html, /new EventSource\('\/api\/events'\)/);
    assert.match(html, /\/api\/habitat/);
    assert.match(html, /event=>renderHabitat/);
    assert.match(html, /\['experience',view\.state\.sees\]/);
    assert.match(html, /\['choice',choice\(view\.state\.chooses\)\]/);
    assert.match(html, /\['attempt',view\.state\.doing\]/);
    assert.match(html, /optional narration/);
    assert.match(html, /controller ·/);
    assert.match(html, /observed ethogram/);
    assert.match(html, /Lync progress/);
    assert.doesNotMatch(html, /\['decision',view\.state\.decision\]/);
    const inlineScript = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
    assert.ok(inlineScript);
    assert.doesNotThrow(() => new vm.Script(inlineScript));

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

test('resident lens control capability authenticates pause resume and stop separately from projections', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-resident-control-'));
  fs.writeFileSync(
    path.join(directory, 'resident.jsonl'),
    line(1, 'run_started', { runId: 'run-control', body: { username: 'Body' } }),
  );
  const actions: string[] = [];
  const server = await startResidentLensServer({
    residents: [
      {
        entityId: 'Scout',
        bodyUsername: 'Body',
        journalDirectory: directory,
        viewerEndpoint: null,
      },
    ],
    control: {
      pause: () => {
        actions.push('pause');
      },
      resume: () => {
        actions.push('resume');
      },
      stop: () => {
        actions.push('stop');
      },
    },
  });
  try {
    assert.equal(server.controls.available, true);
    const endpoint = new URL(server.endpoint);
    const token = new URLSearchParams(endpoint.hash.slice(1)).get('control');
    assert.ok(token);
    const base = endpoint.origin;

    const rejected = await fetch(`${base}/api/control`, {
      method: 'POST',
      body: JSON.stringify({ action: 'pause' }),
    });
    assert.equal(rejected.status, 403);

    for (const action of ['pause', 'resume', 'stop']) {
      const response = await fetch(`${base}/api/control`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action }),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { acknowledged: true, action });
    }
    assert.deepEqual(actions, ['pause', 'resume', 'stop']);
  } finally {
    await server.close();
    fs.rmSync(directory, { recursive: true, force: true });
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
