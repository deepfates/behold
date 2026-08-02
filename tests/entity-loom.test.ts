import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertEntityTurnPublicCommitment,
  assertEntityConnectionCapability,
  historyMessages,
  openEntityLoom,
  resolveEntityLifeRange,
  validateEntityLifeRangeReference,
  type EntityTurn,
} from '../src/entity/loom';
import {
  createEntityTurnObservationPresentation,
  decodeEntityTurnFromLync,
} from '../src/entity/turn-observation-binding';
import { projectMinecraftCurrentObservation } from '../src/mind/minecraft-body';
import { residentTurnMayReplay } from '../src/mind/resident-visibility';
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

function legibleTurn(): EntityTurn {
  const publicCommitment = {
    protocol: 'behold.resident-public-action-commitment.v1' as const,
    policyProfile: 'legible-resident-v1' as const,
    intention: 'Approach the visible tree to continue learning this place',
    expectedObservableConsequence: 'The tree should appear nearer in the next view',
  };
  const value = turn(1, null, 'LegibleScout');
  value.profiles = {
    policy: 'legible-resident-v1',
    body: 'minecraft-human-semantic-v1',
    actions: 'minecraft-human-semantic-v1',
    safety: 'vanilla-player-v1',
  };
  value.utterance = {
    assistant: {
      role: 'assistant',
      content:
        'Intention: Approach the visible tree to continue learning this place\nExpected observable consequence: The tree should appear nearer in the next view',
      tool_calls: value.utterance.assistant.tool_calls,
    },
    publicCommitment,
  };
  return value;
}

function oxfordPilotShapedTurn(): EntityTurn {
  const release = {
    protocol: 'behold.experiment-release-reference.v1' as const,
    releaseId: 'a'.repeat(64),
    releaseDigest: 'b'.repeat(64),
    lifecycleSequence: 23,
    lifecycleDigest: 'c'.repeat(64),
    residentObservedOrder: 2,
    residentObservedAt: '2026-07-26T05:47:16.869Z',
  };
  const rawObservation: any = {
    protocol: 'behold.inhabitant.v2',
    circle: {
      id: 'oxford-pilot-fixture',
      substrate: 'minecraft',
      managedRunId: 'private-managed-run',
    },
    sequence: 14,
    observedAt: 1_785_044_929_081,
    eventWindow: {
      requestedAfterSequence: 7,
      oldestAvailableSequence: 1,
      newestAvailableSequence: 14,
      missingBeforeOldest: 0,
      complete: true,
    },
    task: null,
    self: {
      identity: 'OxfordLlamaP1',
      body: { substrate: 'minecraft', username: 'LlamaPilot', uuid: 'private-body-id' },
      pose: {
        position: { x: 1968.5, y: -48, z: 1404.5 },
        yaw: 0,
        pitch: 0,
        velocity: { x: 0, y: -0.1, z: 0 },
        onGround: true,
      },
      condition: {
        health: 20,
        food: 20,
        oxygen: null,
        sleeping: false,
        dimension: 'overworld',
        isDay: true,
      },
      heldItem: null,
      inventory: [],
      projects: [],
      places: [],
      placeConflicts: [],
      currentAction: null,
    },
    scene: {
      social: { source: 'server_roster', playersOnline: ['PhiPilot'] },
      focus: null,
      entities: [
        {
          id: 'player:PhiPilot',
          name: 'PhiPilot',
          kind: 'player',
          position: { x: 1980.5, y: -48, z: 1399.5 },
          distance: 13,
          source: 'vision',
          visibility: 'visible',
        },
      ],
      terrain: {
        source: 'vision',
        visualField: {
          protocol: 'behold.visual-field.v1',
          available: true,
          dimensions: { rows: 1, columns: 2 },
          rowOrder: 'top_to_bottom',
          columnOrder: 'left_to_right',
          materialRows: ['ab'],
          depthRows: ['12'],
          materialLegend: [
            { symbol: 'a', name: 'polished_andesite' },
            { symbol: 'b', name: 'oak_leaves' },
          ],
          depthLegend: [
            { symbol: '1', label: 'interaction', maxDistance: 4.5 },
            { symbol: '2', label: 'near', maxDistance: 8 },
          ],
          noHitSymbol: '.',
          unavailableSymbol: '?',
          center: { row: 0, column: 0, alignedWith: 'current_view' },
        },
      },
    },
    events: [
      {
        sequence: 14,
        at: 1_785_044_929_081,
        type: 'entity_became_visible',
        salience: 'high',
        source: 'vision',
        data: {
          id: 'player:PhiPilot',
          name: 'PhiPilot',
          kind: 'player',
          position: { x: 1980.5, y: -48, z: 1399.5 },
          distance: 13,
        },
        isNew: true,
      },
    ],
  };
  const rawNextObservation = structuredClone(rawObservation);
  rawNextObservation.sequence = 20;
  rawNextObservation.observedAt += 500;
  rawNextObservation.self.pose.yaw = -Math.PI / 2;
  rawNextObservation.scene.entities = [];
  rawNextObservation.events = [
    {
      sequence: 20,
      at: rawNextObservation.observedAt,
      type: 'entity_left_view',
      salience: 'ambient',
      source: 'vision',
      data: {
        id: 'player:PhiPilot',
        name: 'PhiPilot',
        kind: 'player',
        lastSeenDistance: 13,
      },
      isNew: true,
    },
  ];
  return {
    protocol: 'behold.entity-turn.v1',
    circleId: 'oxford-pilot-fixture',
    id: 'OxfordLlamaP1:turn:1',
    entityId: 'OxfordLlamaP1',
    sequence: 1,
    parentId: null,
    model: 'llama3.2:3b',
    profiles: {
      policy: 'neutral-benchmark-v1',
      body: 'minecraft-human-semantic-v1',
      actions: 'minecraft-human-semantic-v1',
      safety: 'vanilla-player-v1',
    },
    experimentRelease: release,
    startedAt: 1_785_044_929_081,
    completedAt: 1_785_044_929_581,
    observation: rawObservation,
    observationPresentation: createEntityTurnObservationPresentation({
      requestSha256: 'd'.repeat(64),
      observation: projectMinecraftCurrentObservation(
        rawObservation,
        'minecraft-human-semantic-v1',
      ),
      nextObservation: projectMinecraftCurrentObservation(
        rawNextObservation,
        'minecraft-human-semantic-v1',
      ),
    }),
    utterance: {
      assistant: {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'pilot-look-1',
            type: 'function',
            function: {
              name: 'look_direction',
              arguments: '{"horizontal":"right","vertical":"same"}',
            },
          },
        ],
      },
    },
    action: {
      id: 'pilot-look-1',
      name: 'look_direction',
      input: { horizontal: 'right', vertical: 'same' },
      source: 'llm',
      kind: 'exclusive',
      toolCallId: 'pilot-look-1',
    },
    outcome: {
      ok: true,
      eventType: 'action_completed',
      result: {
        ok: true,
        horizontal: 'right',
        vertical: 'same',
        from: { facing: 'east', vertical: 'level' },
        orientation: { facing: 'south', vertical: 'level' },
        confirmation: 'mineflayer:body_orientation',
      },
    },
    nextObservation: rawNextObservation,
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

test('closing an entity life closes its Lync handle before releasing the runtime lease', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-lync-close-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const life = await openEntityLoom('Scout', root);
  const receipt = await life.append(turn(1, null));
  assert.equal(life.length(), 1);
  assert.equal(receipt.protocol, 'behold.entity-turn-commit-receipt.v1');
  assert.equal(receipt.entityId, 'Scout');
  assert.equal(receipt.sequence, 1);
  assert.equal(receipt.depth, 1);
  assert.equal(receipt.turn.loomId, receipt.life.loomId);
  assert.equal(receipt.turn.turnId, life.tip());
  assert.match(receipt.bodyDigest, /^[a-f0-9]{64}$/);
  assert.match(receipt.chainDigest, /^[a-f0-9]{64}$/);
  assert.match(receipt.canonical.rawSha256, /^[a-f0-9]{64}$/);
  assert.equal(path.isAbsolute(receipt.canonical.source), false);

  await life.close();
  await life.close();

  await assert.rejects(life.readAll(), /entity loom Scout is closed/);
  await assert.rejects(life.tail(), /entity loom Scout is closed/);
  await assert.rejects(life.append(turn(2, 'Scout:turn:1')), /entity loom Scout is closed/);

  const resumed = await openEntityLoom('Scout', root);
  assert.equal(resumed.length(), 1);
  assert.equal((await resumed.tail(1))[0]?.id, 'Scout:turn:1');
  assert.deepEqual((await resumed.tailBound(1))[0]?.source, {
    protocol: 'lync.file-loom-chain.v1',
    digest: receipt.chainDigest,
  });
  const streamed: EntityTurn[] = [];
  for await (const item of resumed.scan()) streamed.push(item);
  assert.deepEqual(streamed, await resumed.readAll());
  const boundStream = [];
  for await (const item of resumed.scanBound()) boundStream.push(item);
  assert.equal(boundStream[0]?.turn.id, 'Scout:turn:1');
  assert.equal(boundStream[0]?.source.digest, receipt.chainDigest);
  await resumed.close();
});

test('one resident recalls an exact selected-life range in whole-turn byte pages across restart', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-lync-recall-range-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scout = await openEntityLoom('Scout', root, 'minecraft://recall-world');
  const builder = await openEntityLoom('Builder', root, 'minecraft://recall-world');
  for (let sequence = 1; sequence <= 4; sequence += 1) {
    await scout.append(turn(sequence, sequence === 1 ? null : `Scout:turn:${sequence - 1}`));
    await builder.append(
      turn(sequence, sequence === 1 ? null : `Builder:turn:${sequence - 1}`, 'Builder'),
    );
  }

  const full = await scout.recallRange(2, 4, 1_000_000);
  assert.equal(full.protocol, 'behold.entity-life-recall-page.v1');
  assert.equal(full.entityId, 'Scout');
  assert.equal(full.circleId, 'minecraft://recall-world');
  assert.equal(full.selectedTip.sequence, 4);
  assert.equal(full.selectedTip.turn.loomId, full.life.loomId);
  assert.match(full.selectedTip.chainDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    full.turns.map((item) => item.turn.sequence),
    [2, 3, 4],
  );
  assert.ok(full.turns.every((item) => item.turn.entityId === 'Scout'));
  assert.ok(full.turns.every((item) => /^[a-f0-9]{64}$/.test(item.source.digest)));
  assert.equal(full.bytes, Buffer.byteLength(JSON.stringify(full.turns), 'utf8'));
  assert.equal(full.complete, true);
  assert.equal(full.nextSequence, null);

  const twoTurnBudget = Buffer.byteLength(JSON.stringify(full.turns.slice(0, 2)), 'utf8');
  const firstPage = await scout.recallRange(2, 4, twoTurnBudget);
  assert.deepEqual(
    firstPage.turns.map((item) => item.turn.sequence),
    [2, 3],
  );
  assert.equal(firstPage.bytes, twoTurnBudget);
  assert.equal(firstPage.complete, false);
  assert.equal(firstPage.nextSequence, 4);
  const secondPage = await scout.recallRange(firstPage.nextSequence!, 4, twoTurnBudget);
  assert.deepEqual(
    secondPage.turns.map((item) => item.turn.sequence),
    [4],
  );
  assert.equal(secondPage.complete, true);

  await assert.rejects(scout.recallRange(0, 1, 1000), /positive inclusive sequences/);
  await assert.rejects(scout.recallRange(3, 2, 1000), /positive inclusive sequences/);
  await assert.rejects(scout.recallRange(1, 5, 1000), /ends at turn 4/);
  await assert.rejects(scout.recallRange(2, 2, 2), /exceeding maxBytes 2/);

  const builderPage = await builder.recallRange(2, 4, 1_000_000);
  assert.ok(builderPage.turns.every((item) => item.turn.entityId === 'Builder'));
  assert.notEqual(builderPage.life.loomId, full.life.loomId);
  assert.notEqual(builderPage.selectedTip.chainDigest, full.selectedTip.chainDigest);

  await scout.close();
  await builder.close();
  const resumed = await openEntityLoom('Scout', root, 'minecraft://recall-world');
  const afterRestart = await resumed.recallRange(2, 4, 1_000_000);
  assert.deepEqual(afterRestart, full);
  await resumed.close();
});

test('a manifest directory fsync failure leaves canonical life recoverable without a lease', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-lync-manifest-fsync-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const originalFsync = fs.fsyncSync;
  let directoryFsyncs = 0;
  fs.fsyncSync = ((descriptor: number) => {
    directoryFsyncs += 1;
    if (directoryFsyncs === 2) {
      fs.fsyncSync = originalFsync;
      throw new Error('injected manifest directory fsync failure');
    }
    return originalFsync(descriptor);
  }) as typeof fs.fsyncSync;
  t.after(() => {
    fs.fsyncSync = originalFsync;
  });

  await assert.rejects(openEntityLoom('Scout', root), /manifest directory fsync failure/);
  const directory = path.join(root, 'Scout');
  assert.equal(fs.existsSync(path.join(directory, 'runtime.lock')), false);
  assert.equal(fs.existsSync(path.join(directory, 'lync', 'manifest.json')), true);
  assert.deepEqual(
    fs.readdirSync(path.join(directory, 'lync')).filter((name) => name.endsWith('.tmp')),
    [],
  );

  const recovered = await openEntityLoom('Scout', root);
  assert.equal(recovered.length(), 0);
  await recovered.close();
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

test('legible-resident public commitments persist and replay exactly while tamper fails closed', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-legible-commitment-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const expected = legibleTurn();
  const life = await openEntityLoom(expected.entityId, root);
  await life.append(expected);
  await life.close();

  const reopened = await openEntityLoom(expected.entityId, root);
  const stored = (await reopened.readAll())[0];
  assert.deepEqual(stored?.utterance.publicCommitment, expected.utterance.publicCommitment);
  assert.deepEqual(assertEntityTurnPublicCommitment(stored!), expected.utterance.publicCommitment);
  const replay = historyMessages([stored!]);
  assert.equal(replay[1]?.role, 'assistant');
  assert.equal(replay[1]?.content, expected.utterance.assistant.content);
  assert.match(replay[2]?.content, /action_completed/);
  await reopened.close();

  const contentTamper = structuredClone(expected);
  contentTamper.utterance.assistant.content = 'Intention: something else';
  assert.throws(() => historyMessages([contentTamper]), /does not match its replayable utterance/);

  const commitmentTamper = structuredClone(expected);
  (commitmentTamper.utterance.publicCommitment as any).intention = 'Something else';
  assert.throws(
    () => historyMessages([commitmentTamper]),
    /does not match its replayable utterance/,
  );

  const treatmentTamper = structuredClone(expected);
  treatmentTamper.profiles!.policy = 'neutral-benchmark-v1';
  assert.throws(() => historyMessages([treatmentTamper]), /commitment under another treatment/);
});

test('human-semantic Lync turns bind a safe readable projection to unchanged private pilot frames', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-lync-human-presentation-'));
  const expected = oxfordPilotShapedTurn();
  const life = await openEntityLoom(expected.entityId, root, expected.circleId);
  assert.equal(life.presentationProfile, 'org.behold.inhabitant.v2');
  await life.append(expected);
  const sourceLines = fs
    .readFileSync(life.file, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const sourceTurn = sourceLines.find((event) => event.kind === 'lync/turn')?.payload?.payload;
  assert.equal(
    sourceLines.find((event) => event.kind === 'lync/loom')?.payload?.meta?.profile,
    'org.behold.inhabitant.v2',
  );
  assert.equal(sourceTurn.observation.protocol, 'behold.minecraft-human-semantic-observation.v1');
  assert.equal(
    sourceTurn.nextObservation.protocol,
    'behold.minecraft-human-semantic-observation.v1',
  );
  assert.equal(JSON.stringify(sourceTurn.observation).includes('1968.5'), false);
  assert.equal(JSON.stringify(sourceTurn.observation).includes('private-body-id'), false);
  assert.deepEqual(sourceTurn.privateCausalFrames.observation, expected.observation);
  assert.deepEqual(sourceTurn.privateCausalFrames.nextObservation, expected.nextObservation);
  assert.equal(sourceTurn.observationBinding.turn.id, expected.id);
  assert.equal(sourceTurn.observationBinding.turn.entityId, expected.entityId);
  assert.equal(sourceTurn.observationBinding.profiles.body, 'minecraft-human-semantic-v1');
  assert.equal(
    sourceTurn.observationBinding.experimentRelease.releaseId,
    expected.experimentRelease?.releaseId,
  );
  assert.match(sourceTurn.observationBinding.digest, /^[a-f0-9]{64}$/);
  await life.close();

  const reopened = await openEntityLoom(expected.entityId, root, expected.circleId);
  assert.deepEqual((await reopened.readAll())[0]?.observation, expected.observation);
  assert.deepEqual((await reopened.readAll())[0]?.nextObservation, expected.nextObservation);
  assert.deepEqual(
    (await reopened.readAll())[0]?.observationPresentation,
    expected.observationPresentation,
  );
  await reopened.close();

  const tampered = structuredClone(sourceTurn);
  tampered.observation.self.identity = 'tampered-resident';
  assert.throws(
    () => decodeEntityTurnFromLync(tampered),
    /binding does not match its turn or causal frames/,
  );
  const rawTampered = structuredClone(sourceTurn);
  rawTampered.privateCausalFrames.observation.self.pose.position.x += 1;
  assert.throws(
    () => decodeEntityTurnFromLync(rawTampered),
    /binding does not match its turn or causal frames/,
  );
  const releaseTampered = structuredClone(sourceTurn);
  releaseTampered.experimentRelease.releaseId = 'e'.repeat(64);
  assert.throws(
    () => decodeEntityTurnFromLync(releaseTampered),
    /binding does not match its turn or causal frames/,
  );
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

test('history replay omits privileged evidence nested in a resident completion', () => {
  const completion = turn(1, null);
  completion.action.name = 'manage_project';
  completion.utterance.assistant.content = 'The nested-private topology is sealed.';
  completion.outcome.result = {
    evidence: {
      satisfied: true,
      expected: 'space_enclosed',
      witness: {
        action: 'inspect_reachable_space',
        input: { secret: 'nested-private-input' },
        result: { secret: 'nested-private-result' },
      },
    },
  };

  const messages = historyMessages([completion], undefined, residentTurnMayReplay);
  const serialized = JSON.stringify(messages);
  assert.match(serialized, /not_resident_observable/);
  assert.doesNotMatch(serialized, /nested-private/);
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
  assert.equal(migrated.length(), 2);
  assert.match(migrated.file, /\.lync$/);
  assert.ok(fs.existsSync(migrated.file));
  assert.equal(fs.readFileSync(legacyFile, 'utf8'), legacyBytes);

  await migrated.append(turn(3, 'Scout:turn:2'));
  assert.equal(migrated.length(), 3);
  assert.equal(fs.readFileSync(legacyFile, 'utf8'), legacyBytes);
  await migrated.close();

  const reopened = await openEntityLoom('Scout', root);
  assert.equal(reopened.length(), 3);
  assert.equal((await reopened.readAll())[2]?.id, 'Scout:turn:3');
  assert.equal(fs.readFileSync(legacyFile, 'utf8'), legacyBytes);
  await reopened.close();
});

test('a closed life exposes stable exact ranges without evaluator mutation or body authority', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-lync-range-'));
  const life = await openEntityLoom('Scout', root, 'minecraft://range-world');
  await life.append(turn(1, null));
  await life.append(turn(2, 'Scout:turn:1'));
  await assert.rejects(
    resolveEntityLifeRange('Scout', 1, 2, root),
    /close its life before resolving/,
  );
  await life.close();

  const lyncDirectory = path.join(root, 'Scout', 'lync');
  const before = directoryBytes(lyncDirectory);
  const range = await resolveEntityLifeRange('Scout', 1, 2, root);
  assert.equal(range.entityId, 'Scout');
  assert.equal(range.circleId, 'minecraft://range-world');
  assert.equal(range.life.loomId, range.start.loomId);
  assert.equal(range.start.loomId, range.end.loomId);
  assert.notEqual(range.start.turnId, range.end.turnId);
  assert.deepEqual(range.sequences, { start: 1, end: 2 });
  assert.deepEqual(directoryBytes(lyncDirectory), before);
  await assert.rejects(
    validateEntityLifeRangeReference(
      { ...range, life: { ...range.life, v: 2 }, start: { ...range.start, v: 2 } },
      root,
    ),
    /requires Lync v1/,
  );
  await assert.rejects(
    validateEntityLifeRangeReference({ ...range, turns: [] }, root),
    /unknown field turns/,
  );

  const continued = await openEntityLoom('Scout', root, 'minecraft://range-world');
  await continued.append(turn(3, 'Scout:turn:2'));
  await continued.close();
  const oldRange = await resolveEntityLifeRange('Scout', 1, 2, root);
  assert.deepEqual(oldRange, range, 'later turns must not move earlier episode anchors');
  await assert.rejects(
    resolveEntityLifeRange('Scout', 2, 4, root),
    /does not contain committed range/,
  );
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
  assert.equal(recoveredScout.length(), 1);
  assert.ok(recoveredScout.warnings.some((warning) => warning.includes('recovered 1 committed')));

  const builder = await openEntityLoom('Builder', root);
  await builder.append(turn(1, null, 'Builder'));
  assert.deepEqual(
    (await recoveredScout.readAll()).map((item) => item.entityId),
    ['Scout'],
  );
  assert.deepEqual(
    (await builder.readAll()).map((item) => item.entityId),
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
  assert.equal(recovered.length(), 1);
  assert.equal((await recovered.readAll())[0]?.id, 'Scout:turn:1');
  assert.equal(fs.readFileSync(lyncFile, 'utf8'), durableBytes);
  assert.ok(
    recovered.warnings.some((warning) =>
      warning.includes('recovered from canonical journal bytes'),
    ),
  );
  assert.equal(
    fs.readdirSync(lyncDirectory).filter((name) => name.startsWith('events.invalid-')).length,
    1,
  );

  await recovered.append(turn(2, 'Scout:turn:1'));
  if (fs.existsSync(snapshotFile)) {
    // Legacy published Lync recreates its derived snapshot; current Lync
    // migrates away from it. Behold remains compatible across that boundary.
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(snapshotFile, 'utf8')));
  }
  assert.ok(fs.readFileSync(lyncFile, 'utf8').length > durableBytes.length);
  assert.equal(recovered.length(), 2);
  await recovered.close();
});

test('Lync runtime lease permits one incarnation per entity and independent inhabitants', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-lync-lease-'));
  const scout = await openEntityLoom('Scout', root);

  await assert.rejects(openEntityLoom('Scout', root), /Scout is already running in pid/);

  const builder = await openEntityLoom('Builder', root);
  assert.equal(builder.length(), 0);
  await builder.close();
  await scout.close();

  const resumedScout = await openEntityLoom('Scout', root);
  assert.equal(resumedScout.length(), 0);
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
  assert.equal(recovered.length(), 0);
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

function directoryBytes(directory: string): Record<string, string> {
  const snapshot: Record<string, string> = {};
  const visit = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) visit(file);
      else snapshot[path.relative(directory, file)] = fs.readFileSync(file).toString('base64');
    }
  };
  visit(directory);
  return snapshot;
}
