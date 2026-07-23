import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createEvaluationEpisode,
  openEvaluationEpisode,
  parseEvaluationEpisodeDefinition,
  type EvaluationEpisodeDefinition,
} from '../src/evaluation/episode';
import { openEntityLoom, resolveEntityLifeRange, type EntityTurn } from '../src/entity/loom';

test('an evaluator episode references a closed life without copying or mutating it', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-evaluation-episode-'));
  const entityRoot = path.join(root, 'entities');
  const episodeRoot = path.join(root, 'episodes');
  const life = await openEntityLoom('Scout', entityRoot, 'minecraft://episode-world');
  await life.append(entityTurn(1, null));
  await life.append(entityTurn(2, 'Scout:turn:1'));
  await life.close();
  const range = await resolveEntityLifeRange('Scout', 1, 2, entityRoot);
  const definition = episodeDefinition(range);
  const lifeDirectory = path.join(entityRoot, 'Scout', 'lync');
  const lifeBefore = directoryBytes(lifeDirectory);

  const episode = await createEvaluationEpisode(
    episodeRoot,
    entityRoot,
    definition,
    'benchmark-runner',
  );
  assert.ok(fs.existsSync(episode.file));
  assert.equal(episode.definitionReference.loomId, episode.loomReference.loomId);
  assert.notEqual(episode.loomReference.loomId, range.life.loomId);
  episode.close();

  assert.deepEqual(directoryBytes(lifeDirectory), lifeBefore);
  const episodeBytes = fs.readFileSync(episode.file, 'utf8');
  assert.doesNotMatch(episodeBytes, /"utterance"|"nextObservation"|"outcome"/);
  assert.match(episodeBytes, new RegExp(range.start.turnId));

  const continuing = await openEntityLoom('Scout', entityRoot, 'minecraft://episode-world');
  await continuing.append(entityTurn(3, 'Scout:turn:2'));
  const continuedBefore = directoryBytes(lifeDirectory);
  const reopened = await openEvaluationEpisode(
    episodeRoot,
    entityRoot,
    episode.loomReference,
    'second-evaluator',
  );
  assert.deepEqual(reopened.definition, definition);
  reopened.close();
  assert.deepEqual(directoryBytes(lifeDirectory), continuedBefore);
  await continuing.close();

  await selectSiblingLifeTip(entityRoot, range);
  const branchedBefore = directoryBytes(lifeDirectory);
  const afterBranchSelection = await openEvaluationEpisode(
    episodeRoot,
    entityRoot,
    episode.loomReference,
    'branch-stability-check',
  );
  assert.deepEqual(afterBranchSelection.definition.life, range);
  afterBranchSelection.close();
  assert.deepEqual(directoryBytes(lifeDirectory), branchedBefore);
});

test('episode admission rejects forged ranges and copied private trajectory fields', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-evaluation-forgery-'));
  const entityRoot = path.join(root, 'entities');
  const life = await openEntityLoom('Scout', entityRoot, 'minecraft://episode-world');
  await life.append(entityTurn(1, null));
  await life.close();
  const range = await resolveEntityLifeRange('Scout', 1, 1, entityRoot);
  const definition = episodeDefinition(range);
  const lifeDirectory = path.join(entityRoot, 'Scout', 'lync');
  const lifeBefore = directoryBytes(lifeDirectory);

  await assert.rejects(
    createEvaluationEpisode(
      path.join(lifeDirectory, 'evaluations'),
      entityRoot,
      definition,
      'benchmark-runner',
    ),
    /storage must be separate/,
  );
  assert.deepEqual(directoryBytes(lifeDirectory), lifeBefore);

  assert.throws(
    () => parseEvaluationEpisodeDefinition({ ...definition, turns: [entityTurn(1, null)] }),
    /unknown field turns/,
  );
  await assert.rejects(
    createEvaluationEpisode(
      path.join(root, 'episodes'),
      entityRoot,
      {
        ...definition,
        life: {
          ...definition.life,
          end: { ...definition.life.end, turnId: 'forged-turn' },
        },
      },
      'benchmark-runner',
    ),
    /does not match the selected Lync life/,
  );
});

function episodeDefinition(
  life: Awaited<ReturnType<typeof resolveEntityLifeRange>>,
): EvaluationEpisodeDefinition {
  return {
    protocol: 'behold.evaluation-episode.v1',
    suite: {
      id: 'minecraft-player-competence',
      version: '1',
      caseId: 'ordinary-action-consequence',
      specificationSha256: '1'.repeat(64),
    },
    life,
  };
}

function entityTurn(sequence: number, parentId: string | null): EntityTurn {
  return {
    protocol: 'behold.entity-turn.v1',
    id: `Scout:turn:${sequence}`,
    entityId: 'Scout',
    sequence,
    parentId,
    model: 'test/model',
    startedAt: sequence * 10,
    completedAt: sequence * 10 + 1,
    observation: { sequence, self: { position: { x: sequence, y: 64, z: 0 } } },
    utterance: { assistant: { role: 'assistant', content: 'I will look.' } },
    action: {
      id: `action-${sequence}`,
      name: 'look',
      input: {},
      source: 'llm',
      kind: 'exclusive',
      toolCallId: `call-${sequence}`,
    },
    outcome: { ok: true, eventType: 'action_completed', result: { ok: true } },
    nextObservation: { sequence: sequence + 1 },
  };
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

async function selectSiblingLifeTip(
  entityRoot: string,
  range: Awaited<ReturnType<typeof resolveEntityLifeRange>>,
) {
  const directory = path.join(entityRoot, range.entityId, 'lync');
  const [{ createFileEventStore }, { createLyncLooms }] = await Promise.all([
    import('@deepfates/lync/file-log'),
    import('@deepfates/lync/looms'),
  ]);
  const looms = createLyncLooms<EntityTurn, any, any>({
    store: createFileEventStore(directory),
    author: { actor: 'branch-test' },
  });
  const loom = await looms.open(range.life.loomId);
  const alternate = entityTurn(2, 'Scout:turn:1');
  alternate.observation = { branch: 'alternate' };
  const appended = await loom.appendTurn(range.start.turnId, alternate, {
    protocol: 'behold.entity-turn-link.v1',
    entityId: 'Scout',
    sequence: 2,
    legacyId: alternate.id,
  });
  const manifestFile = path.join(directory, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  fs.writeFileSync(
    manifestFile,
    `${JSON.stringify({ ...manifest, tipTurnId: appended.id }, null, 2)}\n`,
    'utf8',
  );
  loom.close();
}
