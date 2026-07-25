import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openQuotaLedger, verifyQuotaLedger } from '../src/observability/quota-ledger';

const ACCOUNT = 'a'.repeat(64);

test('durable per-purpose charges survive restart without refill or double count', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-quota-ledger-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'quota.jsonl');
  const options = {
    file,
    scopeId: 'experiment-1',
    worldId: 'world-1',
    accountId: ACCOUNT,
    layer: 'provider',
    limits: { resident_decision: 2, loom_fold: 1 },
  };
  const first = openQuotaLedger(options);
  const decision = first.charge('resident_decision', 'request-1', { bodySha256: 'b'.repeat(64) });
  assert.equal(decision.ok, true);
  assert.equal(decision.ordinal, 1);
  first.settle('request-1', {
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, cost: 0.01 },
  });
  assert.equal(first.charge('loom_fold', 'fold-1').ok, true);
  first.close();

  const resumed = openQuotaLedger(options);
  assert.deepEqual(resumed.snapshot().used, { loom_fold: 1, resident_decision: 1 });
  assert.deepEqual(resumed.snapshot().remaining, { loom_fold: 0, resident_decision: 1 });
  assert.equal(resumed.snapshot().usage.resident_decision.totalTokens, 12);
  assert.equal(resumed.snapshot().usage.resident_decision.costUsd, 0.01);
  assert.equal(resumed.snapshot().usage.resident_decision.totalTokenReports, 1);
  assert.equal(resumed.snapshot().usage.resident_decision.costReports, 1);
  const replay = resumed.charge('resident_decision', 'request-1', {
    bodySha256: 'b'.repeat(64),
  });
  assert.equal(replay.ok, true);
  assert.equal(replay.ordinal, 1);
  assert.equal(resumed.snapshot().used.resident_decision, 1);
  assert.equal(resumed.charge('resident_decision', 'request-2').ok, true);
  assert.equal(resumed.charge('resident_decision', 'request-3').ok, false);
  assert.equal(resumed.charge('loom_fold', 'fold-2').ok, false);
  resumed.close();

  const verified = verifyQuotaLedger(file);
  assert.equal(verified.snapshot.used.resident_decision, 2);
  assert.equal(verified.snapshot.used.loom_fold, 1);
  assert.equal(verified.snapshot.unsettled, 2);
});

test('provider usage accounts each reported metric without treating missing cost as zero evidence', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-quota-partial-usage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ledger = openQuotaLedger({
    file: path.join(root, 'quota.jsonl'),
    scopeId: 'experiment-1',
    worldId: 'world-1',
    accountId: ACCOUNT,
    layer: 'provider',
    limits: { resident_decision: 2 },
  });
  ledger.charge('resident_decision', 'request-1');
  ledger.settle('request-1', {
    usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
  });
  ledger.charge('resident_decision', 'request-2');
  ledger.settle('request-2', { outcome: 'upstream_failure', usage: null });
  const usage = ledger.snapshot().usage.resident_decision;
  assert.equal(usage.promptTokens, 7);
  assert.equal(usage.totalTokens, 10);
  assert.equal(usage.costUsd, 0);
  assert.equal(usage.promptTokenReports, 1);
  assert.equal(usage.totalTokenReports, 1);
  assert.equal(usage.costReports, 0);
  assert.equal(usage.settlementsWithAnyUsage, 1);
  assert.equal(usage.settlementsWithoutUsage, 1);
  ledger.close();
});

test('quota restart rejects scope or limit drift and the chain detects edits', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-quota-drift-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'quota.jsonl');
  const ledger = openQuotaLedger({
    file,
    scopeId: 'experiment-1',
    worldId: 'world-1',
    accountId: ACCOUNT,
    layer: 'provider',
    limits: { resident_decision: 1 },
  });
  ledger.charge('resident_decision', 'request-1');
  ledger.close();

  assert.throws(
    () =>
      openQuotaLedger({
        file,
        scopeId: 'experiment-1',
        worldId: 'world-1',
        accountId: ACCOUNT,
        layer: 'provider',
        limits: { resident_decision: 2 },
      }),
    /configuration differs/,
  );
  const edited = path.join(root, 'edited.jsonl');
  fs.copyFileSync(file, edited);
  fs.writeFileSync(edited, fs.readFileSync(edited, 'utf8').replace('request-1', 'request-2'));
  assert.throws(() => verifyQuotaLedger(edited), /invalid quota ledger chain/);
});
