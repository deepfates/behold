import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertPrivateActionRecordReferences,
  assertPrivateProofFile,
  assertPrivateProofTree,
  proofEvidenceFile,
} from '../scripts/private-proof-evidence';

test('private proof evidence rejects permissive modes, links, and paths outside its root', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-private-proof-'));
  const root = path.join(parent, 'proof');
  const evidence = path.join(root, 'evidence');
  const file = path.join(evidence, 'private.json');
  const outside = path.join(parent, 'outside.json');
  fs.mkdirSync(evidence, { recursive: true, mode: 0o700 });
  fs.chmodSync(root, 0o700);
  fs.chmodSync(evidence, 0o700);
  fs.writeFileSync(file, '{}\n', { mode: 0o600 });
  fs.writeFileSync(outside, '{}\n', { mode: 0o600 });
  try {
    assert.equal(proofEvidenceFile(root, file, 'fixture'), file);
    assert.doesNotThrow(() => assertPrivateProofFile(root, file, 'fixture'));
    assert.doesNotThrow(() => assertPrivateProofTree(root, evidence, 'fixture tree'));

    fs.chmodSync(file, 0o644);
    assert.throws(() => assertPrivateProofFile(root, file, 'fixture'), /mode 0600/);
    fs.chmodSync(file, 0o600);

    assert.throws(() => proofEvidenceFile(root, outside, 'outside'), /inside the proof root/);
    const link = path.join(evidence, 'linked.json');
    fs.symlinkSync(file, link);
    assert.throws(() => proofEvidenceFile(root, link, 'link'), /plain file/);
    assert.throws(() => assertPrivateProofTree(root, evidence, 'fixture tree'), /symbolic link/);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('private action records require every filesystem reference to remain private', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-private-record-'));
  const file = path.join(root, 'private.json');
  fs.chmodSync(root, 0o700);
  fs.writeFileSync(file, '{}\n', { mode: 0o600 });
  const access = {
    visibility: 'private',
    audience: ['inhabitant:Scout'],
    projection: 'private-reference',
  };
  const bundle = {
    records: [
      { stage: 'observation', access, payload: { dataRef: `${file}#observation` } },
      {
        stage: 'check',
        access,
        payload: {
          evidence: [{ kind: 'private', ref: file, sha256: 'a'.repeat(64), access }],
        },
      },
    ],
  };
  try {
    assert.doesNotThrow(() => assertPrivateActionRecordReferences(root, bundle));
    fs.chmodSync(file, 0o644);
    assert.throws(() => assertPrivateActionRecordReferences(root, bundle), /mode 0600/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
