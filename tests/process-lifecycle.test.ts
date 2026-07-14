import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PROCESS_EXIT_PROTOCOL, successfulProcessExitRecord } from '../src/cli/process-lifecycle';

test('successful process exit records active resources deterministically', () => {
  const record = successfulProcessExitRecord(new Date('2026-07-14T00:00:00.000Z'), () => [
    'Timeout',
    'PipeWrap',
    'Timeout',
  ]);
  assert.deepEqual(record, {
    protocol: PROCESS_EXIT_PROTOCOL,
    status: 'cleanup_completed',
    at: '2026-07-14T00:00:00.000Z',
    pid: process.pid,
    activeResources: { PipeWrap: 1, Timeout: 2 },
    resourceInspectionError: null,
  });
});

test('owned CLI exits promptly after durable cleanup despite a referenced dependency timer', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-process-exit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cleanupMarker = path.join(root, 'cleanup-completed');
  const lifecycleModule = path.resolve(__dirname, '../src/cli/process-lifecycle.js');
  const script = `
    const fs = require('node:fs');
    const lifecycle = require(process.argv[1]);
    const marker = process.argv[2];
    setTimeout(() => {}, 20_000);
    fs.writeFileSync(marker, 'durable cleanup complete\\n');
    lifecycle.completeSuccessfulCliExit();
  `;
  const startedAt = Date.now();
  const child = spawn(process.execPath, ['-e', script, lifecycleModule, cleanupMarker], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    },
  );
  const elapsedMs = Date.now() - startedAt;

  assert.deepEqual(exit, { code: 0, signal: null }, stderr);
  assert.ok(elapsedMs < 2_000, `expected exit in under 2s, observed ${elapsedMs}ms`);
  assert.equal(fs.readFileSync(cleanupMarker, 'utf8'), 'durable cleanup complete\n');
  const line = stderr.split('\n').find((candidate) => candidate.startsWith('[behold] {'));
  assert.ok(line, `missing process-exit record in stderr: ${stderr}`);
  const record = JSON.parse(line!.slice('[behold] '.length));
  assert.equal(record.protocol, PROCESS_EXIT_PROTOCOL);
  assert.equal(record.status, 'cleanup_completed');
  assert.ok(record.activeResources.Timeout >= 1, JSON.stringify(record));
});
