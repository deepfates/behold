import fsPromises from 'node:fs/promises';
import path from 'node:path';
import {
  parseEntityLifeRangeReference,
  resolveEntityLifeRange,
  validateEntityLifeRangeReference,
  type EntityLifeRangeReference,
} from '../entity/loom';

export type EvaluationEpisodeDefinition = Readonly<{
  protocol: 'behold.evaluation-episode.v1';
  suite: Readonly<{
    id: string;
    version: string;
    caseId: string;
    specificationSha256: string;
  }>;
  /** The only externally authenticated binding in v1. */
  life: EntityLifeRangeReference;
}>;

type EvaluationEpisodeLoomMeta = Readonly<{
  protocol: 'behold.evaluation-episode-loom.v1';
  suiteId: string;
  caseId: string;
}>;

type EvaluationEpisodeRoot = Readonly<{
  protocol: 'behold.evaluation-episode-root.v1';
  definition: EvaluationEpisodeDefinition;
}>;

type EvaluationEpisodeTurnMeta = Readonly<{
  protocol: 'behold.evaluation-episode-turn.v1';
  kind: 'definition';
}>;

export type EvaluationLoomReference = Readonly<{ v: 1; kind: 'loom'; loomId: string }>;
export type EvaluationTurnReference = Readonly<{
  v: 1;
  kind: 'turn';
  loomId: string;
  turnId: string;
}>;

export type EvaluationEpisode = Readonly<{
  loomReference: EvaluationLoomReference;
  definitionReference: EvaluationTurnReference;
  file: string;
  definition: EvaluationEpisodeDefinition;
  close: () => void;
}>;

/**
 * Choose an exact range from the currently selected closed life, then create a
 * physically separate evaluator loom. V1 deliberately records no judgment.
 */
export async function createEvaluationEpisode(
  directory: string,
  entityRoot: string,
  definition: EvaluationEpisodeDefinition,
  evaluatorId: string,
): Promise<EvaluationEpisode> {
  const admitted = parseEvaluationEpisodeDefinition(definition);
  await assertSeparateStores(directory, entityRoot);
  const selected = await resolveEntityLifeRange(
    admitted.life.entityId,
    admitted.life.sequences.start,
    admitted.life.sequences.end,
    entityRoot,
  );
  if (JSON.stringify(selected) !== JSON.stringify(admitted.life)) {
    throw new Error('evaluation episode life range does not match the selected Lync life');
  }
  await fsPromises.mkdir(directory, { recursive: true });
  const runtime = await openRuntime(directory, evaluatorId);
  const info = await runtime.looms.create({
    protocol: 'behold.evaluation-episode-loom.v1',
    suiteId: admitted.suite.id,
    caseId: admitted.suite.caseId,
  });
  const loom = await runtime.looms.open(info.id);
  const root = await loom.appendTurn(
    null,
    { protocol: 'behold.evaluation-episode-root.v1', definition: admitted },
    { protocol: 'behold.evaluation-episode-turn.v1', kind: 'definition' },
  );
  return episodeHandle(runtime, loom, root, admitted);
}

/** Reopen against its immutable anchors, independent of the current life tip or body lease. */
export async function openEvaluationEpisode(
  directory: string,
  entityRoot: string,
  reference: EvaluationLoomReference,
  evaluatorId: string,
): Promise<EvaluationEpisode> {
  const loomReference = parseLoomReference(reference);
  await assertSeparateStores(directory, entityRoot);
  const runtime = await openRuntime(directory, evaluatorId);
  const loom = await runtime.looms.open(loomReference.loomId);
  const info = await loom.info();
  const meta = parseLoomMeta(info.meta);
  const roots = await loom.childrenOf(null);
  if (roots.length !== 1) {
    throw new Error(`evaluation episode ${loom.id} must have exactly one definition root`);
  }
  const root = roots[0];
  if (
    root.meta?.protocol !== 'behold.evaluation-episode-turn.v1' ||
    root.meta.kind !== 'definition' ||
    root.payload?.protocol !== 'behold.evaluation-episode-root.v1'
  ) {
    throw new Error(`evaluation episode ${loom.id} has an invalid definition root`);
  }
  const definition = parseEvaluationEpisodeDefinition(root.payload.definition);
  if (meta.suiteId !== definition.suite.id || meta.caseId !== definition.suite.caseId) {
    throw new Error(`evaluation episode ${loom.id} metadata differs from its definition`);
  }
  await validateEntityLifeRangeReference(definition.life, entityRoot);
  return episodeHandle(runtime, loom, root, definition);
}

export function parseEvaluationEpisodeDefinition(value: unknown): EvaluationEpisodeDefinition {
  const definition = exactObject(value, ['protocol', 'suite', 'life'], 'evaluation episode');
  if (definition.protocol !== 'behold.evaluation-episode.v1') {
    throw new Error('unsupported evaluation episode protocol');
  }
  const suite = exactObject(
    definition.suite,
    ['id', 'version', 'caseId', 'specificationSha256'],
    'evaluation suite',
  );
  return deepFreeze({
    protocol: 'behold.evaluation-episode.v1',
    suite: {
      id: nonEmpty(suite.id, 'suite id'),
      version: nonEmpty(suite.version, 'suite version'),
      caseId: nonEmpty(suite.caseId, 'case id'),
      specificationSha256: digest(suite.specificationSha256, 'suite specification'),
    },
    life: parseEntityLifeRangeReference(definition.life),
  });
}

async function openRuntime(directory: string, evaluatorId: string) {
  const [{ createFileEventStore }, { createLyncLooms, loomRootId }] = await Promise.all([
    import('@deepfates/lync/file-log'),
    import('@deepfates/lync/looms'),
  ]);
  const store = createFileEventStore(directory);
  const looms = createLyncLooms<
    EvaluationEpisodeRoot,
    EvaluationEpisodeLoomMeta,
    EvaluationEpisodeTurnMeta
  >({
    store,
    author: { actor: nonEmpty(evaluatorId, 'evaluator actor'), via: 'behold@0.1.0-alpha.0' },
  });
  return { looms, loomRootId, storeDirectory: directory };
}

function episodeHandle(
  runtime: any,
  loom: any,
  root: any,
  definition: EvaluationEpisodeDefinition,
): EvaluationEpisode {
  return deepFreeze({
    loomReference: { v: 1, kind: 'loom', loomId: loom.id },
    definitionReference: { v: 1, kind: 'turn', loomId: loom.id, turnId: root.id },
    file: path.join(
      runtime.storeDirectory,
      `${encodeURIComponent(runtime.loomRootId(loom.id))}.lync`,
    ),
    definition,
    close: () => loom.close(),
  });
}

function parseLoomMeta(value: unknown): EvaluationEpisodeLoomMeta {
  const meta = exactObject(value, ['protocol', 'suiteId', 'caseId'], 'episode loom meta');
  if (meta.protocol !== 'behold.evaluation-episode-loom.v1') {
    throw new Error('unsupported evaluation episode loom protocol');
  }
  return {
    protocol: 'behold.evaluation-episode-loom.v1',
    suiteId: nonEmpty(meta.suiteId, 'episode loom suite id'),
    caseId: nonEmpty(meta.caseId, 'episode loom case id'),
  };
}

function parseLoomReference(value: unknown): EvaluationLoomReference {
  const ref = exactObject(value, ['v', 'kind', 'loomId'], 'loom reference');
  if (ref.v !== 1 || ref.kind !== 'loom') throw new Error('invalid loom reference');
  return deepFreeze({ v: 1, kind: 'loom', loomId: nonEmpty(ref.loomId, 'loom id') });
}

async function assertSeparateStores(episodeDirectory: string, entityRoot: string) {
  const [episode, entities] = await Promise.all([
    canonicalProspectivePath(episodeDirectory),
    canonicalProspectivePath(entityRoot),
  ]);
  if (containsPath(episode, entities) || containsPath(entities, episode)) {
    throw new Error(
      'evaluation episode storage must be separate from entity autobiography storage',
    );
  }
}

async function canonicalProspectivePath(value: string): Promise<string> {
  let current = path.resolve(value);
  const missing: string[] = [];
  while (true) {
    try {
      const existing = await fsPromises.realpath(current);
      return path.join(existing, ...missing.reverse());
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

function containsPath(parent: string, candidate: string) {
  const relative = path.relative(parent, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

function exactObject(
  value: unknown,
  fields: readonly string[],
  label: string,
): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must be a plain object`);
  }
  const object = value as Record<string, unknown>;
  for (const field of Object.keys(object)) {
    if (!fields.includes(field)) throw new Error(`${label} has unknown field ${field}`);
  }
  for (const field of fields) {
    if (!(field in object)) throw new Error(`${label} is missing field ${field}`);
  }
  return object;
}

function nonEmpty(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a string`);
  return value;
}

function digest(value: unknown, label: string) {
  const admitted = nonEmpty(value, `${label} sha256`);
  if (!/^[a-f0-9]{64}$/.test(admitted)) throw new Error(`${label} sha256 is invalid`);
  return admitted;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}
