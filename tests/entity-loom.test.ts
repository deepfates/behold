import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertEntityConnectionCapability,
  historyMessages,
  openEntityLoom,
  type EntityTurn,
} from '../src/entity/loom';
import { acquireWorldControl } from '../src/runtime/world-control';

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

test('entity history projects prior actions and their observations back into model context', () => {
  const messages = historyMessages([turn(1, null)]);
  assert.equal(messages[0]?.role, 'user');
  assert.equal(messages[1]?.role, 'assistant');
  assert.equal(messages[2]?.role, 'tool');
  assert.equal(messages[2]?.tool_call_id, 'call-1');
  assert.match(messages[2]?.content, /action_completed/);
});

test('model replay keeps the visible decision but not provider-private reasoning', () => {
  const remembered = turn(1, null);
  remembered.utterance.assistant = {
    ...remembered.utterance.assistant,
    content: 'I will inspect the area.',
    reasoning: 'long provider-private deliberation',
    reasoning_details: [{ type: 'reasoning.text', text: 'duplicate hidden chain' }],
    refusal: null,
    provider_extension: { opaque: true },
  };

  const assistant = historyMessages([remembered])[1];
  assert.deepEqual(Object.keys(assistant).sort(), ['content', 'role', 'tool_calls']);
  assert.equal(assistant.content, 'I will inspect the area.');
  assert.equal(assistant.tool_calls[0].function.name, 'status');
  assert.equal(JSON.stringify(assistant).includes('provider-private'), false);
  assert.equal(JSON.stringify(assistant).includes('duplicate hidden chain'), false);
});

test('a replaceable scripted controller is remembered without impersonating the LLM', () => {
  const scripted = turn(1, null);
  scripted.action.source = 'script';
  scripted.action.toolCallId = null;
  scripted.utterance.assistant = null;
  const messages = historyMessages([scripted]);
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.role, 'user');
  assert.match(messages[0]?.content, /Historical script controller turn/);
  assert.match(messages[0]?.content, /action_completed/);
});

test('history replay preserves an audit marker but omits non-resident action knowledge', () => {
  const privileged = turn(1, null);
  privileged.action.name = 'inspect_reachable_space';
  privileged.action.input = { feet: { x: 91, y: 64, z: -37 }, secret: 'private-input' };
  privileged.outcome.result = { sealed: true, topology: 'private-result' };
  privileged.utterance.assistant.content = 'I will use the private scan.';

  const messages = historyMessages([privileged], undefined, () => false);
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.role, 'user');
  assert.match(messages[0]?.content, /inspect_reachable_space/);
  assert.match(messages[0]?.content, /not_resident_observable/);
  assert.doesNotMatch(messages[0]?.content, /private-input|private-result|private scan/);
});

test('Lync becomes authoritative without rewriting the legacy autobiography', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-lync-migration-'));
  const legacyFile = path.join(root, 'Scout', 'loom.jsonl');
  fs.mkdirSync(path.dirname(legacyFile), { recursive: true });
  const legacyBytes = `${[turn(1, null), turn(2, 'Scout:turn:1')]
    .map((item) => JSON.stringify(item))
    .join('\n')}\n`;
  fs.writeFileSync(legacyFile, legacyBytes, 'utf8');

  const migrated = await openEntityLoom('Scout', root);
  assert.equal(migrated.backend, 'lync');
  assert.equal(migrated.turns().length, 2);
  assert.match(migrated.file, /\.lync$/);
  assert.ok(fs.existsSync(migrated.file));
  assert.equal(fs.readFileSync(legacyFile, 'utf8'), legacyBytes);

  await migrated.append(turn(3, 'Scout:turn:2'));
  assert.equal(migrated.turns().length, 3);
  assert.equal(fs.readFileSync(legacyFile, 'utf8'), legacyBytes);
  await migrated.close();

  const reopened = await openEntityLoom('Scout', root);
  assert.equal(reopened.turns().length, 3);
  assert.equal(reopened.turns()[2]?.id, 'Scout:turn:3');
  assert.equal(fs.readFileSync(legacyFile, 'utf8'), legacyBytes);
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

test('a Minecraft connection capability is exact, unforgeable, and dies with the entity lease', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-entity-connection-'));
  const scout = await openEntityLoom('Scout', root, 'fixture-circle');
  assert.equal(
    assertEntityConnectionCapability(scout.connectionCapability, 'Scout', 'fixture-circle'),
    scout.connectionCapability,
  );
  assert.throws(
    () =>
      assertEntityConnectionCapability(
        { ...scout.connectionCapability },
        'Scout',
        'fixture-circle',
      ),
    /active runtime lease/,
  );
  assert.throws(
    () => assertEntityConnectionCapability(scout.connectionCapability, 'Builder', 'fixture-circle'),
    /active runtime lease/,
  );
  assert.throws(
    () => assertEntityConnectionCapability(scout.connectionCapability, 'Scout', 'other-circle'),
    /active runtime lease/,
  );
  await scout.close();
  assert.throws(
    () => assertEntityConnectionCapability(scout.connectionCapability, 'Scout', 'fixture-circle'),
    /active runtime lease/,
  );
  fs.rmSync(root, { recursive: true, force: true });
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

test('managed entity admission is checked before and after its durable runtime lease', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-managed-entity-'));
  const runtime = path.join(root, 'runtime');
  const entityRoot = path.join(root, 'entities');
  fs.mkdirSync(runtime);
  fs.mkdirSync(entityRoot);
  const control = acquireWorldControl({
    controlRoot: path.join(root, 'control'),
    world: 'fixture',
    runtimePath: runtime,
  });
  control.update('starting', { server: { pid: 44, jarSha256: 'abc' } });
  const previous = {
    file: process.env.BEHOLD_WORLD_CONTROL_FILE,
    world: process.env.BEHOLD_WORLD_ID,
    run: process.env.BEHOLD_RUN_ID,
  };
  process.env.BEHOLD_WORLD_CONTROL_FILE = control.file;
  process.env.BEHOLD_WORLD_ID = 'fixture';
  process.env.BEHOLD_RUN_ID = 'fixture-1';
  t.after(() => {
    restoreEnvironment('BEHOLD_WORLD_CONTROL_FILE', previous.file);
    restoreEnvironment('BEHOLD_WORLD_ID', previous.world);
    restoreEnvironment('BEHOLD_RUN_ID', previous.run);
    fs.rmSync(root, { recursive: true, force: true });
  });

  const managed = await openEntityLoom('Managed', entityRoot, 'fixture');
  assert.equal(fs.existsSync(path.join(entityRoot, 'Managed', 'runtime.lock')), true);
  await managed.close();

  control.update('stopping');
  await assert.rejects(
    openEntityLoom('Late', entityRoot, 'fixture'),
    /blocked while world is stopping/,
  );
  assert.equal(fs.existsSync(path.join(entityRoot, 'Late', 'runtime.lock')), false);
  control.update('stopped_verified', { server: null });
  control.release();
});

test('an unmanaged entity cannot open while any repository world lifecycle is active', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-unmanaged-entity-'));
  const runtime = path.join(root, 'runtime');
  const entityRoot = path.join(root, 'entities');
  const controlRoot = path.join(root, 'control');
  fs.mkdirSync(runtime);
  fs.mkdirSync(entityRoot);
  const previous = process.env.BEHOLD_WORLD_CONTROL_ROOT;
  process.env.BEHOLD_WORLD_CONTROL_ROOT = controlRoot;
  t.after(() => {
    restoreEnvironment('BEHOLD_WORLD_CONTROL_ROOT', previous);
    fs.rmSync(root, { recursive: true, force: true });
  });

  const control = acquireWorldControl({ controlRoot, world: 'fixture', runtimePath: runtime });
  await assert.rejects(
    openEntityLoom('Unmanaged', entityRoot, 'fixture'),
    /Unmanaged controller admission is blocked/,
  );
  assert.equal(fs.existsSync(path.join(entityRoot, 'Unmanaged', 'runtime.lock')), false);
  control.release();

  const admitted = await openEntityLoom('Unmanaged', entityRoot, 'fixture');
  await admitted.close();
});

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
