import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createEntityLoom,
  historyMessages,
  openEntityLoom,
  type EntityTurn,
} from '../src/entity/loom';

function turn(sequence: number, parentId: string | null, entityId = 'Scout'): EntityTurn {
  return {
    protocol: 'behold.entity-turn.v1',
    id: `${entityId}:turn:${sequence}`,
    entityId,
    sequence,
    parentId,
    model: 'test/model',
    startedAt: sequence * 10,
    completedAt: sequence * 10 + 1,
    observation: { sequence, self: { position: { x: sequence, y: 1, z: 0 } } },
    utterance: {
      assistant: {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: `call-${sequence}`,
            type: 'function',
            function: { name: 'status', arguments: '{}' },
          },
        ],
      },
    },
    action: {
      id: `action-${sequence}`,
      name: 'status',
      input: {},
      source: 'llm',
      kind: 'parallel',
      toolCallId: `call-${sequence}`,
    },
    outcome: { ok: true, eventType: 'action_completed', result: { ok: true } },
    nextObservation: { sequence: sequence + 1 },
  };
}

test('entity loom survives reopening and enforces a linked append-only trajectory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-loom-'));
  const first = createEntityLoom('Scout', root);
  first.append(turn(1, null));
  first.append(turn(2, 'Scout:turn:1'));

  const reopened = createEntityLoom('Scout', root);
  assert.equal(reopened.turns().length, 2);
  assert.equal(reopened.turns()[1]?.parentId, 'Scout:turn:1');
  assert.throws(() => reopened.append(turn(4, 'Scout:turn:2')), /does not follow/);
});

test('entity history projects prior actions and their observations back into model context', () => {
  const messages = historyMessages([turn(1, null)]);
  assert.equal(messages[0]?.role, 'user');
  assert.equal(messages[1]?.role, 'assistant');
  assert.equal(messages[2]?.role, 'tool');
  assert.equal(messages[2]?.tool_call_id, 'call-1');
  assert.match(messages[2]?.content, /action_completed/);
});

test('Lync becomes authoritative without rewriting the legacy autobiography', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-lync-migration-'));
  const legacy = createEntityLoom('Scout', root);
  legacy.append(turn(1, null));
  legacy.append(turn(2, 'Scout:turn:1'));
  const legacyBytes = fs.readFileSync(legacy.file, 'utf8');

  const migrated = await openEntityLoom('Scout', root);
  assert.equal(migrated.backend, 'lync');
  assert.equal(migrated.turns().length, 2);
  assert.match(migrated.file, /\.lync$/);
  assert.ok(fs.existsSync(migrated.file));
  assert.equal(fs.readFileSync(legacy.file, 'utf8'), legacyBytes);

  await migrated.append(turn(3, 'Scout:turn:2'));
  assert.equal(migrated.turns().length, 3);
  assert.equal(fs.readFileSync(legacy.file, 'utf8'), legacyBytes);
  await migrated.close();

  const reopened = await openEntityLoom('Scout', root);
  assert.equal(reopened.turns().length, 3);
  assert.equal(reopened.turns()[2]?.id, 'Scout:turn:3');
  assert.equal(fs.readFileSync(legacy.file, 'utf8'), legacyBytes);
  await reopened.close();
});

test('Lync recovers a committed turn after a stale tip manifest and keeps inhabitants separate', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-lync-recovery-'));
  const scout = await openEntityLoom('Scout', root);
  const manifestFile = path.join(root, 'Scout', 'lync', 'manifest.json');
  const staleManifest = fs.readFileSync(manifestFile, 'utf8');

  await scout.append(turn(1, null));
  fs.writeFileSync(manifestFile, staleManifest, 'utf8');
  await scout.close();

  const recoveredScout = await openEntityLoom('Scout', root);
  assert.equal(recoveredScout.turns().length, 1);
  assert.ok(recoveredScout.warnings.some((warning) => warning.includes('recovered 1 committed')));

  const builder = await openEntityLoom('Builder', root);
  await builder.append(turn(1, null, 'Builder'));
  assert.deepEqual(
    recoveredScout.turns().map((item) => item.entityId),
    ['Scout'],
  );
  assert.deepEqual(
    builder.turns().map((item) => item.entityId),
    ['Builder'],
  );
  assert.notEqual(recoveredScout.file, builder.file);
  await recoveredScout.close();
  await builder.close();
});

test('Lync recovers from an interrupted derived snapshot without discarding its log', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-lync-snapshot-recovery-'));
  const first = await openEntityLoom('Scout', root);
  await first.append(turn(1, null));
  await first.close();

  const lyncDirectory = path.join(root, 'Scout', 'lync');
  const snapshotFile = path.join(lyncDirectory, 'events.json');
  const lyncFile = fs
    .readdirSync(lyncDirectory)
    .map((name) => path.join(lyncDirectory, name))
    .find((file) => file.endsWith('.lync'))!;
  const durableBytes = fs.readFileSync(lyncFile, 'utf8');
  fs.writeFileSync(snapshotFile, '', 'utf8');

  const recovered = await openEntityLoom('Scout', root);
  assert.equal(recovered.turns().length, 1);
  assert.equal(recovered.turns()[0]?.id, 'Scout:turn:1');
  assert.equal(fs.readFileSync(lyncFile, 'utf8'), durableBytes);
  assert.ok(
    recovered.warnings.some((warning) =>
      warning.includes('recovered from authoritative .lync bytes'),
    ),
  );
  assert.equal(
    fs.readdirSync(lyncDirectory).filter((name) => name.startsWith('events.invalid-')).length,
    1,
  );

  await recovered.append(turn(2, 'Scout:turn:1'));
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(snapshotFile, 'utf8')));
  assert.equal(recovered.turns().length, 2);
  await recovered.close();
});

test('Lync runtime lease permits one incarnation per entity and independent inhabitants', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-lync-lease-'));
  const scout = await openEntityLoom('Scout', root);

  await assert.rejects(openEntityLoom('Scout', root), /Scout is already running in pid/);

  const builder = await openEntityLoom('Builder', root);
  assert.equal(builder.turns().length, 0);
  await builder.close();
  await scout.close();

  const resumedScout = await openEntityLoom('Scout', root);
  assert.equal(resumedScout.turns().length, 0);
  await resumedScout.close();
});

test('Lync runtime lease recovers only a demonstrably dead same-host holder', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-lync-stale-'));
  const directory = path.join(root, 'Scout');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, 'runtime.lock'),
    `${JSON.stringify({
      protocol: 'behold.entity-runtime-lease.v1',
      entityId: 'Scout',
      pid: 2_147_483_647,
      hostname: os.hostname(),
      startedAt: 1,
      token: 'dead-holder',
    })}\n`,
    'utf8',
  );

  const recovered = await openEntityLoom('Scout', root);
  assert.equal(recovered.turns().length, 0);
  await recovered.close();
  assert.equal(fs.existsSync(path.join(directory, 'runtime.lock')), false);
});

test('an entity loom is bound to one circle and refuses cross-world memory leakage', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-circle-binding-'));
  const first = await openEntityLoom('Scout', root, 'minecraft://world-one');
  assert.equal(first.circleId, 'minecraft://world-one');
  await first.close();

  await assert.rejects(
    openEntityLoom('Scout', root, 'minecraft://world-two'),
    /bound to circle minecraft:\/\/world-one, not minecraft:\/\/world-two/,
  );

  const resumed = await openEntityLoom('Scout', root, 'minecraft://world-one');
  assert.equal(resumed.circleId, 'minecraft://world-one');
  await resumed.close();
});
