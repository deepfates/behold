import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IntentSource } from '../loop/arbiter';
import type { ResidentAttention } from '../mind/interface';
import { projectResidentVisibleValue } from '../mind/resident-visibility';
import { sanitizeName } from '../observability/journal';
import {
  beginManagedControllerAdmission,
  beginUnmanagedControllerAdmission,
  confirmManagedControllerAdmission,
  confirmUnmanagedControllerAdmission,
  type ManagedControllerAdmissionProof,
  type UnmanagedControllerAdmissionProof,
} from '../runtime/world-control';

export type EntityTurn = {
  protocol: 'behold.entity-turn.v1';
  circleId?: string;
  id: string;
  entityId: string;
  sequence: number;
  parentId: string | null;
  model: string;
  attention?: ResidentAttention;
  startedAt: number;
  completedAt: number;
  observation: any;
  utterance: { assistant: any };
  action: {
    id: string;
    name: string;
    input: any;
    source: IntentSource;
    /** Historical turn field; all new embodied actions are serialized. */
    kind: 'exclusive' | 'parallel' | 'yield';
    toolCallId: string | null;
  };
  outcome: {
    ok: boolean;
    eventType: string;
    result: any;
    error?: string;
    /** Engine-authenticated interruption cause; distinct from adapter acknowledgement. */
    cancellation?: {
      requested: boolean;
      reason: string;
      acknowledged: boolean;
      adapter: string | null;
    };
  };
  nextObservation: any;
};

export type EntityLoom = {
  backend: 'lync';
  circleId: string | null;
  connectionCapability: EntityConnectionCapability;
  file: string;
  foldFile: string;
  warnings: string[];
  turns: () => EntityTurn[];
  tail: (limit?: number) => EntityTurn[];
  append: (turn: EntityTurn) => Promise<void>;
  close: () => Promise<void>;
};

export type EntityLifeReference = Readonly<{ v: 1; kind: 'loom'; loomId: string }>;

export type EntityLifeTurnReference = Readonly<{
  v: 1;
  kind: 'turn';
  loomId: string;
  turnId: string;
}>;

export type EntityLifeRangeReference = Readonly<{
  protocol: 'behold.entity-life-range.v1';
  entityId: string;
  circleId: string | null;
  life: EntityLifeReference;
  start: EntityLifeTurnReference;
  end: EntityLifeTurnReference;
  sequences: Readonly<{ start: number; end: number }>;
}>;

export function parseEntityLifeRangeReference(value: unknown): EntityLifeRangeReference {
  const range = exactPlainObject(
    value,
    ['protocol', 'entityId', 'circleId', 'life', 'start', 'end', 'sequences'],
    'entity life range',
  );
  if (range.protocol !== 'behold.entity-life-range.v1') {
    throw new Error('unsupported entity life range protocol');
  }
  const entityId = requiredString(range.entityId, 'entity life range entityId');
  const circleId =
    range.circleId == null ? null : requiredString(range.circleId, 'entity life range circleId');
  const life = exactPlainObject(range.life, ['v', 'kind', 'loomId'], 'entity life loom reference');
  const start = exactPlainObject(
    range.start,
    ['v', 'kind', 'loomId', 'turnId'],
    'entity life start reference',
  );
  const end = exactPlainObject(
    range.end,
    ['v', 'kind', 'loomId', 'turnId'],
    'entity life end reference',
  );
  if (
    life.v !== 1 ||
    life.kind !== 'loom' ||
    start.v !== 1 ||
    start.kind !== 'turn' ||
    end.v !== 1 ||
    end.kind !== 'turn'
  ) {
    throw new Error('entity life range requires Lync v1 loom and turn references');
  }
  const loomId = requiredString(life.loomId, 'entity life loomId');
  if (start.loomId !== loomId || end.loomId !== loomId) {
    throw new Error('entity life range references must share one loom');
  }
  const sequences = exactPlainObject(
    range.sequences,
    ['start', 'end'],
    'entity life range sequences',
  );
  if (
    !Number.isSafeInteger(sequences.start) ||
    !Number.isSafeInteger(sequences.end) ||
    sequences.start < 1 ||
    sequences.end < sequences.start
  ) {
    throw new Error('entity life range sequences must be positive integers in order');
  }
  return deepFreeze({
    protocol: 'behold.entity-life-range.v1',
    entityId,
    circleId,
    life: { v: 1, kind: 'loom', loomId },
    start: {
      v: 1,
      kind: 'turn',
      loomId,
      turnId: requiredString(start.turnId, 'entity life start turnId'),
    },
    end: {
      v: 1,
      kind: 'turn',
      loomId,
      turnId: requiredString(end.turnId, 'entity life end turnId'),
    },
    sequences: { start: Number(sequences.start), end: Number(sequences.end) },
  });
}

export type EntityConnectionCapability = Readonly<{
  kind: 'behold.entity-connection.v1';
  entityId: string;
  circleId: string | null;
}>;

type EntityRuntimeLeaseRecord = {
  protocol: 'behold.entity-runtime-lease.v1';
  entityId: string;
  pid: number;
  hostname: string;
  startedAt: number;
  token: string;
  managedRunId?: string;
};

type EntityRuntimeLease = {
  file: string;
  active: () => boolean;
  close: () => Promise<void>;
};

type ControllerAdmissionProof =
  | Readonly<{ mode: 'managed'; proof: ManagedControllerAdmissionProof }>
  | Readonly<{ mode: 'unmanaged'; proof: UnmanagedControllerAdmissionProof }>;

const issuedEntityConnectionCapabilities = new WeakMap<
  object,
  Readonly<{
    entityId: string;
    circleId: string | null;
    lease: EntityRuntimeLease;
  }>
>();

type EntityLoomMeta = {
  protocol: 'behold.entity-loom.v1';
  profile: 'org.behold.inhabitant.v1';
  entityId: string;
  circleId?: string;
};

type EntityCircleBinding = {
  protocol: 'behold.entity-circle-binding.v1';
  entityId: string;
  circleId: string;
};

type EntityTurnMeta = {
  protocol: 'behold.entity-turn-link.v1';
  entityId: string;
  sequence: number;
  legacyId: string;
};

type EntityLoomManifest = {
  protocol: 'behold.entity-loom-manifest.v1';
  entityId: string;
  loomId: string;
  tipTurnId: string | null;
};

type LyncStoredTurn = {
  id: string;
  parentId: string | null;
  payload: EntityTurn;
  meta?: EntityTurnMeta;
};

type LyncEntityLoom = {
  id: string;
  info: () => Promise<{ meta?: EntityLoomMeta }>;
  appendTurn: (
    parentId: string | null,
    payload: EntityTurn,
    meta?: EntityTurnMeta,
  ) => Promise<LyncStoredTurn>;
  hasTurn: (turnId: string) => Promise<boolean>;
  childrenOf: (parentId: string | null) => Promise<LyncStoredTurn[]>;
  threadTo: (turnId: string) => Promise<LyncStoredTurn[]>;
  leaves: () => Promise<LyncStoredTurn[]>;
};

/**
 * Open the durable runtime loom for an inhabitant.
 *
 * Lync owns the immutable event history. Behold owns the selected active tip:
 * choosing a branch is session state, not a mutation of historical events.
 * An existing loom.jsonl is imported once and kept untouched as evidence.
 */
export async function openEntityLoom(
  entityId: string,
  root = process.env.BEHOLD_ENTITY_DIR || path.resolve(process.cwd(), '.behold-entities'),
  circleId?: string,
): Promise<EntityLoom> {
  const directory = path.join(root, sanitizeName(entityId));
  await fsPromises.mkdir(directory, { recursive: true });
  const boundCircleId = await ensureEntityCircleBinding(entityId, directory, circleId);
  const admission = controllerAdmissionFromEnvironment();
  const lease = await acquireEntityRuntimeLease(entityId, directory);

  try {
    confirmControllerAdmission(admission);
    // Behold still emits CommonJS. Dynamic import is the narrow bridge to
    // Lync's ESM package; it avoids converting the rest of the runtime.
    const [{ createFileEventStore }, { createLyncLooms, loomRootId }] = await Promise.all([
      import('@deepfates/lync/file-log'),
      import('@deepfates/lync/looms'),
    ]);
    const legacyFile = path.join(directory, 'loom.jsonl');
    const foldFile = path.join(directory, 'fold.json');
    const storageDirectory = path.join(directory, 'lync');
    const manifestFile = path.join(storageDirectory, 'manifest.json');
    await fsPromises.mkdir(storageDirectory, { recursive: true });

    const legacy = readEntityLoom(legacyFile);
    validateEntityTrajectory(legacy.turns, entityId, `legacy loom ${legacyFile}`);
    const warnings = [...legacy.warnings];
    await recoverInvalidLyncSnapshot(storageDirectory, warnings);

    const store = createFileEventStore(storageDirectory);
    const looms = createLyncLooms<EntityTurn, EntityLoomMeta, EntityTurnMeta>({
      store,
      author: { actor: entityId, via: 'behold@0.1.0-alpha.0' },
    });
    let manifest = await readManifest(manifestFile, entityId);
    let lyncLoom: LyncEntityLoom;
    let tipTurnId: string | null;

    if (manifest) {
      lyncLoom = await looms.open(manifest.loomId);
      await assertLoomIdentity(lyncLoom, entityId, boundCircleId);
      tipTurnId = await recoverUniqueTip(lyncLoom, manifest.tipTurnId, warnings);
    } else {
      const roots = await store.roots('lync/loom');
      const matching = roots.filter((rootEvent) => {
        const meta = rootEvent.body.payload?.meta as Partial<EntityLoomMeta> | undefined;
        return meta?.protocol === 'behold.entity-loom.v1' && meta.entityId === entityId;
      });
      if (matching.length > 1) {
        throw new Error(
          `multiple Lync looms claim entity ${entityId}; refusing to choose silently`,
        );
      }

      const info = matching[0]
        ? await looms.get(`lync:${matching[0].body.id}`)
        : await looms.create({
            protocol: 'behold.entity-loom.v1',
            profile: 'org.behold.inhabitant.v1',
            entityId,
            ...(boundCircleId ? { circleId: boundCircleId } : {}),
          });
      if (!info) throw new Error(`could not open Lync loom for ${entityId}`);
      lyncLoom = await looms.open(info.id);
      await assertLoomIdentity(lyncLoom, entityId, boundCircleId);
      tipTurnId = await findMigrationTip(lyncLoom, legacy.turns);
    }

    const stored = await materializeThread(lyncLoom, tipTurnId, entityId);
    if (legacy.turns.length > 0) {
      assertLegacyCompatible(stored, legacy.turns);
      for (const turn of legacy.turns.slice(stored.length)) {
        const appended = await appendLyncTurn(lyncLoom, tipTurnId, turn);
        tipTurnId = appended.id;
        stored.push(turn);
      }
    }

    manifest = {
      protocol: 'behold.entity-loom-manifest.v1',
      entityId,
      loomId: lyncLoom.id,
      tipTurnId,
    };
    await writeManifest(manifestFile, manifest);

    const diagnostics = await store.diagnostics();
    if (diagnostics.conflicts || diagnostics.pending || diagnostics.garbage) {
      warnings.push(
        `Lync diagnostics: ${diagnostics.conflicts} conflicts, ${diagnostics.pending} pending, ${diagnostics.garbage} garbage`,
      );
    }
    if (legacy.turns.length > 0) {
      warnings.push(`legacy ${path.basename(legacyFile)} preserved after Lync migration`);
    }

    const lyncFile = path.join(
      storageDirectory,
      `${encodeURIComponent(loomRootId(lyncLoom.id))}.lync`,
    );

    const connectionCapability: EntityConnectionCapability = Object.freeze({
      kind: 'behold.entity-connection.v1',
      entityId,
      circleId: boundCircleId,
    });
    issuedEntityConnectionCapabilities.set(
      connectionCapability,
      Object.freeze({ entityId, circleId: boundCircleId, lease }),
    );
    return {
      backend: 'lync',
      circleId: boundCircleId,
      connectionCapability,
      file: lyncFile,
      foldFile,
      warnings,
      turns: () => [...stored],
      tail: (limit = 12) => stored.slice(-Math.max(0, Math.floor(limit))),
      append: async (turn) => {
        validateNextTurn(stored, turn, entityId);
        const appended = await appendLyncTurn(lyncLoom, tipTurnId, turn);
        const nextManifest: EntityLoomManifest = {
          protocol: 'behold.entity-loom-manifest.v1',
          entityId,
          loomId: lyncLoom.id,
          tipTurnId: appended.id,
        };
        await writeManifest(manifestFile, nextManifest);
        tipTurnId = appended.id;
        stored.push(turn);
      },
      close: async () => {
        issuedEntityConnectionCapabilities.delete(connectionCapability);
        await lease.close();
      },
    };
  } catch (error) {
    await lease.close();
    throw error;
  }
}

/**
 * Resolve an exact closed-life range for an evaluator without acquiring body
 * authority, selecting a branch, recovering files, or rewriting Lync state.
 */
export async function resolveEntityLifeRange(
  entityId: string,
  startSequence: number,
  endSequence: number,
  root = process.env.BEHOLD_ENTITY_DIR || path.resolve(process.cwd(), '.behold-entities'),
): Promise<EntityLifeRangeReference> {
  if (
    !Number.isInteger(startSequence) ||
    !Number.isInteger(endSequence) ||
    startSequence < 1 ||
    endSequence < startSequence
  ) {
    throw new Error('entity life range requires positive inclusive sequences in order');
  }
  const directory = path.join(root, sanitizeName(entityId));
  if (fs.existsSync(path.join(directory, 'runtime.lock'))) {
    throw new Error(
      `entity ${entityId} is active; close its life before resolving an episode range`,
    );
  }
  const storageDirectory = path.join(directory, 'lync');
  const manifestFile = path.join(storageDirectory, 'manifest.json');
  const manifest = await readManifest(manifestFile, entityId);
  if (!manifest?.tipTurnId) {
    throw new Error(`entity ${entityId} has no committed Lync life range`);
  }
  const { loom, info } = await openEntityLoomReadOnly(entityId, manifest.loomId, storageDirectory);
  const turns = await loom.threadTo(manifest.tipTurnId);
  validateEntityTrajectory(
    turns.map((turn) => turn.payload),
    entityId,
    `Lync loom ${manifest.loomId}`,
  );
  const start = turns.find((turn) => turn.payload.sequence === startSequence);
  const end = turns.find((turn) => turn.payload.sequence === endSequence);
  if (!start || !end) {
    throw new Error(
      `entity ${entityId} does not contain committed range ${startSequence}..${endSequence}`,
    );
  }
  for (const turn of turns.slice(turns.indexOf(start), turns.indexOf(end) + 1)) {
    validateLyncTurnMeta(turn, entityId);
  }
  return deepFreeze({
    protocol: 'behold.entity-life-range.v1',
    entityId,
    circleId: info.meta?.circleId ?? null,
    life: { v: 1, kind: 'loom', loomId: manifest.loomId },
    start: { v: 1, kind: 'turn', loomId: manifest.loomId, turnId: start.id },
    end: { v: 1, kind: 'turn', loomId: manifest.loomId, turnId: end.id },
    sequences: { start: startSequence, end: endSequence },
  });
}

/** Validate already-exact anchors without consulting the mutable selected life tip. */
export async function validateEntityLifeRangeReference(
  value: unknown,
  root = process.env.BEHOLD_ENTITY_DIR || path.resolve(process.cwd(), '.behold-entities'),
): Promise<EntityLifeRangeReference> {
  const range = parseEntityLifeRangeReference(value);
  const storageDirectory = path.join(root, sanitizeName(range.entityId), 'lync');
  const { loom, info } = await openEntityLoomReadOnly(
    range.entityId,
    range.life.loomId,
    storageDirectory,
  );
  const ancestry = await loom.threadTo(range.end.turnId);
  validateEntityTrajectory(
    ancestry.map((turn) => turn.payload),
    range.entityId,
    `Lync loom ${range.life.loomId}`,
  );
  const startIndex = ancestry.findIndex((turn) => turn.id === range.start.turnId);
  if (startIndex < 0) {
    throw new Error('entity life range start is not an ancestor of its end');
  }
  const start = ancestry[startIndex];
  const end = ancestry.at(-1)!;
  if (
    start.payload.sequence !== range.sequences.start ||
    end.payload.sequence !== range.sequences.end ||
    (info.meta?.circleId ?? null) !== range.circleId
  ) {
    throw new Error('entity life range metadata differs from its exact Lync anchors');
  }
  for (const turn of ancestry.slice(startIndex)) validateLyncTurnMeta(turn, range.entityId);
  return deepFreeze({
    protocol: 'behold.entity-life-range.v1',
    entityId: range.entityId,
    circleId: info.meta?.circleId ?? null,
    life: { v: 1, kind: 'loom', loomId: loom.id },
    start: { v: 1, kind: 'turn', loomId: loom.id, turnId: start.id },
    end: { v: 1, kind: 'turn', loomId: loom.id, turnId: end.id },
    sequences: { start: start.payload.sequence, end: end.payload.sequence },
  });
}

async function openEntityLoomReadOnly(entityId: string, loomId: string, storageDirectory: string) {
  const [{ createFileEventStore }, { createLyncLooms }] = await Promise.all([
    import('@deepfates/lync/file-log'),
    import('@deepfates/lync/looms'),
  ]);
  const store = createFileEventStore(storageDirectory);
  const looms = createLyncLooms<EntityTurn, EntityLoomMeta, EntityTurnMeta>({
    store,
    author: { actor: 'behold-evaluator', via: 'behold@0.1.0-alpha.0' },
  });
  const loom: LyncEntityLoom = await looms.open(loomId);
  const info = await loom.info();
  if (
    info.meta?.protocol !== 'behold.entity-loom.v1' ||
    info.meta.profile !== 'org.behold.inhabitant.v1' ||
    info.meta.entityId !== entityId
  ) {
    throw new Error(`Lync loom ${loomId} does not belong to ${entityId}`);
  }
  return { loom, info };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

function exactPlainObject(value: unknown, fields: readonly string[], label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must be a plain object`);
  }
  const object = value as Record<string, any>;
  for (const field of Object.keys(object)) {
    if (!fields.includes(field)) throw new Error(`${label} has unknown field ${field}`);
  }
  for (const field of fields) {
    if (!(field in object)) throw new Error(`${label} is missing field ${field}`);
  }
  return object;
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a string`);
  return value;
}

/** A Mineflayer body may connect only while its own durable entity lease is held. */
export function assertEntityConnectionCapability(
  capability: EntityConnectionCapability,
  entityId: string,
  circleId: string | null,
) {
  const issued = issuedEntityConnectionCapabilities.get(capability);
  if (
    !issued ||
    !issued.lease.active() ||
    issued.entityId !== entityId ||
    issued.circleId !== circleId ||
    capability.kind !== 'behold.entity-connection.v1' ||
    capability.entityId !== entityId ||
    capability.circleId !== circleId
  ) {
    throw new Error('Minecraft connection requires this entity’s active runtime lease');
  }
  return capability;
}

function controllerAdmissionFromEnvironment(): ControllerAdmissionProof {
  const controlFile = String(process.env.BEHOLD_WORLD_CONTROL_FILE || '').trim();
  const world = String(process.env.BEHOLD_WORLD_ID || '').trim();
  const runId = String(process.env.BEHOLD_RUN_ID || '').trim();
  const supplied = [controlFile, world, runId].filter(Boolean).length;
  if (supplied === 0) {
    const controlRoot =
      process.env.BEHOLD_WORLD_CONTROL_ROOT ||
      path.resolve(process.cwd(), '.behold-runtime', 'world-control');
    return Object.freeze({
      mode: 'unmanaged',
      proof: beginUnmanagedControllerAdmission(controlRoot),
    });
  }
  if (supplied !== 3) {
    throw new Error(
      'Managed controller admission requires BEHOLD_WORLD_CONTROL_FILE, BEHOLD_WORLD_ID, and BEHOLD_RUN_ID together',
    );
  }
  return Object.freeze({
    mode: 'managed',
    proof: beginManagedControllerAdmission({ controlFile, world, runId }),
  });
}

function confirmControllerAdmission(admission: ControllerAdmissionProof) {
  if (admission.mode === 'managed') return confirmManagedControllerAdmission(admission.proof);
  return confirmUnmanagedControllerAdmission(admission.proof);
}

/**
 * Lync's events.json is a derived acceleration snapshot; the .lync bytes are
 * the durable center. Its current file store rewrites the snapshot before the
 * per-root log, so interruption can leave either the new snapshot or the old
 * log intact. Preserve an invalid snapshot as evidence and let the published
 * loader rebuild from .lync instead of making a healthy life unopenable.
 */
async function recoverInvalidLyncSnapshot(directory: string, warnings: string[]) {
  const snapshotFile = path.join(directory, 'events.json');
  let raw: string;
  try {
    raw = await fsPromises.readFile(snapshotFile, 'utf8');
  } catch (error: any) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }

  let valid = false;
  try {
    const parsed = JSON.parse(raw);
    valid = parsed != null && typeof parsed === 'object' && Array.isArray(parsed.events);
  } catch {}
  if (valid) return;

  const preservedName = `events.invalid-${Date.now()}-${randomUUID()}.json`;
  await fsPromises.rename(snapshotFile, path.join(directory, preservedName));
  warnings.push(
    `preserved invalid derived Lync snapshot as ${preservedName}; recovered from authoritative .lync bytes`,
  );
}

/**
 * A life may have many historical branches, but only one process may embody
 * and extend its selected branch at a time. The lease is per entity, so Scout
 * and Builder remain independently runnable.
 */
async function ensureEntityCircleBinding(
  entityId: string,
  directory: string,
  requestedCircleId?: string,
) {
  const requested = String(requestedCircleId || '').trim();
  const file = path.join(directory, 'circle.json');
  let existing: EntityCircleBinding | null = null;
  try {
    existing = JSON.parse(await fsPromises.readFile(file, 'utf8')) as EntityCircleBinding;
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      throw new Error(`invalid entity circle binding ${file}`);
    }
  }
  if (existing) {
    if (
      existing.protocol !== 'behold.entity-circle-binding.v1' ||
      existing.entityId !== entityId ||
      typeof existing.circleId !== 'string' ||
      !existing.circleId.trim()
    ) {
      throw new Error(`invalid entity circle binding ${file}`);
    }
    if (requested && existing.circleId !== requested) {
      throw new Error(
        `${entityId} is bound to circle ${existing.circleId}, not ${requested}; refusing cross-world loom reuse`,
      );
    }
    return existing.circleId;
  }
  if (!requested) return null;
  const binding: EntityCircleBinding = {
    protocol: 'behold.entity-circle-binding.v1',
    entityId,
    circleId: requested,
  };
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsPromises.writeFile(temporary, `${JSON.stringify(binding, null, 2)}\n`, 'utf8');
  await fsPromises.rename(temporary, file);
  fsyncDirectorySync(directory);
  return requested;
}

async function acquireEntityRuntimeLease(
  entityId: string,
  directory: string,
): Promise<EntityRuntimeLease> {
  const file = path.join(directory, 'runtime.lock');
  const record: EntityRuntimeLeaseRecord = {
    protocol: 'behold.entity-runtime-lease.v1',
    entityId,
    pid: process.pid,
    hostname: os.hostname(),
    startedAt: Date.now(),
    token: randomUUID(),
    ...(process.env.BEHOLD_RUN_ID ? { managedRunId: process.env.BEHOLD_RUN_ID } : {}),
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const handle = await fsPromises.open(file, 'wx', 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      fsyncDirectorySync(directory);

      let closed = false;
      const releaseSync = () => {
        if (closed) return;
        closed = true;
        try {
          const current = JSON.parse(fs.readFileSync(file, 'utf8')) as EntityRuntimeLeaseRecord;
          if (current.token === record.token) {
            fs.unlinkSync(file);
            fsyncDirectorySync(directory);
          }
        } catch (error: any) {
          if (error?.code !== 'ENOENT') throw error;
        }
      };
      process.once('exit', releaseSync);

      return {
        file,
        active: () => !closed,
        close: async () => {
          process.removeListener('exit', releaseSync);
          releaseSync();
        },
      };
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
    }

    const existing = await readRuntimeLease(file);
    if (!existing) continue;
    if (existing.protocol !== 'behold.entity-runtime-lease.v1' || existing.entityId !== entityId) {
      throw new Error(`invalid runtime lease ${file}; refusing to remove it automatically`);
    }
    if (existing.hostname !== record.hostname) {
      throw new Error(
        `${entityId} is leased by pid ${existing.pid} on ${existing.hostname}; cannot prove that remote holder is dead`,
      );
    }
    if (isProcessAlive(existing.pid)) {
      throw new Error(
        `${entityId} is already running in pid ${existing.pid} (since ${new Date(existing.startedAt).toISOString()})`,
      );
    }

    // Preserve the stale record as evidence while atomically clearing the
    // well-known path. Only a demonstrably dead same-host process reaches here.
    const stale = `${file}.stale.${existing.pid}.${existing.token}`;
    try {
      await fsPromises.rename(file, stale);
      const moved = await readRuntimeLease(stale);
      if (moved?.token !== existing.token) {
        try {
          await fsPromises.rename(stale, file);
        } catch {}
        throw new Error(`runtime lease ${file} changed during stale recovery; retry explicitly`);
      }
      await fsPromises.unlink(stale);
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  throw new Error(`could not acquire runtime lease for ${entityId}`);
}

function fsyncDirectorySync(directory: string) {
  const descriptor = fs.openSync(directory, 'r');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

async function readRuntimeLease(file: string): Promise<EntityRuntimeLeaseRecord | null> {
  try {
    return JSON.parse(await fsPromises.readFile(file, 'utf8')) as EntityRuntimeLeaseRecord;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) {
      throw new Error(`invalid runtime lease ${file}; refusing to remove it automatically`);
    }
    throw error;
  }
}

function isProcessAlive(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    if (error?.code === 'ESRCH') return false;
    return true;
  }
}

async function appendLyncTurn(loom: LyncEntityLoom, parentId: string | null, turn: EntityTurn) {
  return loom.appendTurn(parentId, turn, {
    protocol: 'behold.entity-turn-link.v1',
    entityId: turn.entityId,
    sequence: turn.sequence,
    legacyId: turn.id,
  });
}

async function assertLoomIdentity(loom: LyncEntityLoom, entityId: string, circleId: string | null) {
  const info = await loom.info();
  if (
    info.meta?.protocol !== 'behold.entity-loom.v1' ||
    info.meta?.profile !== 'org.behold.inhabitant.v1' ||
    info.meta?.entityId !== entityId
  ) {
    throw new Error(`Lync loom ${loom.id} does not belong to ${entityId}`);
  }
  if (circleId && info.meta.circleId && info.meta.circleId !== circleId) {
    throw new Error(
      `Lync loom ${loom.id} belongs to circle ${info.meta.circleId}, not ${circleId}`,
    );
  }
}

async function findMigrationTip(loom: LyncEntityLoom, legacy: EntityTurn[]) {
  const leaves = await loom.leaves();
  if (leaves.length === 0) return null;
  const candidates: Array<{ tip: string; length: number }> = [];
  for (const leaf of leaves) {
    const thread = await loom.threadTo(leaf.id);
    const payloads = thread.map((turn) => turn.payload);
    if (isLegacyCompatible(payloads, legacy)) {
      candidates.push({ tip: leaf.id, length: payloads.length });
    }
  }
  const longest = Math.max(...candidates.map((candidate) => candidate.length), -1);
  const best = candidates.filter((candidate) => candidate.length === longest);
  if (best.length !== 1) {
    throw new Error(
      `could not uniquely resume the interrupted legacy migration for ${legacy[0]?.entityId || 'entity'}`,
    );
  }
  return best[0].tip;
}

async function recoverUniqueTip(
  loom: LyncEntityLoom,
  manifestTip: string | null,
  warnings: string[],
) {
  if (manifestTip !== null && !(await loom.hasTurn(manifestTip))) {
    throw new Error(`Lync manifest references missing tip ${manifestTip}`);
  }
  let tip = manifestTip;
  let recovered = 0;
  while (true) {
    const children = await loom.childrenOf(tip);
    if (children.length === 0) break;
    if (children.length > 1) {
      throw new Error(
        `Lync branch after active tip ${tip ?? '<root>'} is ambiguous; refusing to choose silently`,
      );
    }
    tip = children[0].id;
    recovered += 1;
  }
  if (recovered > 0)
    warnings.push(`recovered ${recovered} committed Lync turn(s) after the manifest tip`);
  return tip;
}

async function materializeThread(loom: LyncEntityLoom, tip: string | null, entityId: string) {
  const turns = tip === null ? [] : await loom.threadTo(tip);
  const payloads = turns.map((turn) => turn.payload);
  validateEntityTrajectory(payloads, entityId, `Lync loom ${loom.id}`);
  for (const storedTurn of turns) validateLyncTurnMeta(storedTurn, entityId);
  return payloads;
}

function validateLyncTurnMeta(turn: LyncStoredTurn, entityId: string) {
  if (
    turn.meta?.protocol !== 'behold.entity-turn-link.v1' ||
    turn.meta.entityId !== entityId ||
    turn.meta.sequence !== turn.payload.sequence ||
    turn.meta.legacyId !== turn.payload.id
  ) {
    throw new Error(`Lync turn ${turn.id} has invalid Behold linkage metadata`);
  }
}

function assertLegacyCompatible(stored: EntityTurn[], legacy: EntityTurn[]) {
  if (!isLegacyCompatible(stored, legacy)) {
    throw new Error('legacy loom differs from the active Lync history; refusing to merge silently');
  }
}

function isLegacyCompatible(stored: EntityTurn[], legacy: EntityTurn[]) {
  const overlap = Math.min(stored.length, legacy.length);
  for (let index = 0; index < overlap; index += 1) {
    if (JSON.stringify(stored[index]) !== JSON.stringify(legacy[index])) return false;
  }
  return true;
}

async function readManifest(file: string, entityId: string) {
  try {
    const parsed = JSON.parse(await fsPromises.readFile(file, 'utf8')) as EntityLoomManifest;
    if (
      parsed?.protocol !== 'behold.entity-loom-manifest.v1' ||
      parsed.entityId !== entityId ||
      typeof parsed.loomId !== 'string' ||
      (parsed.tipTurnId !== null && typeof parsed.tipTurnId !== 'string')
    ) {
      throw new Error(`invalid entity loom manifest ${file}`);
    }
    return parsed;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeManifest(file: string, manifest: EntityLoomManifest) {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsPromises.writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await fsPromises.rename(temporary, file);
}

function validateNextTurn(stored: EntityTurn[], turn: EntityTurn, entityId: string) {
  const previous = stored.at(-1);
  const expectedSequence = previous ? previous.sequence + 1 : 1;
  if (turn.protocol !== 'behold.entity-turn.v1') {
    throw new Error('unsupported entity turn protocol');
  }
  if (turn.entityId !== entityId) {
    throw new Error(`entity loom expected ${entityId}, received ${turn.entityId}`);
  }
  if (turn.sequence !== expectedSequence) {
    throw new Error(
      `entity turn sequence ${turn.sequence} does not follow ${expectedSequence - 1}`,
    );
  }
  if (turn.parentId !== (previous?.id ?? null)) {
    throw new Error('entity turn parent does not match the current loom tip');
  }
  if (turn.id !== `${entityId}:turn:${turn.sequence}`) {
    throw new Error(`entity turn id ${turn.id} does not match its entity and sequence`);
  }
}

function validateEntityTrajectory(turns: EntityTurn[], entityId: string, source: string) {
  const accepted: EntityTurn[] = [];
  for (const turn of turns) {
    try {
      validateNextTurn(accepted, turn, entityId);
    } catch (error: any) {
      throw new Error(`${source}: ${error?.message || String(error)}`);
    }
    accepted.push(turn);
  }
}

export function readEntityLoom(file: string) {
  const turns: EntityTurn[] = [];
  const warnings: string[] = [];
  if (!fs.existsSync(file)) return { turns, warnings };

  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    try {
      const turn = JSON.parse(line);
      if (turn?.protocol !== 'behold.entity-turn.v1') {
        warnings.push(`ignored line ${index + 1}: unsupported entity turn`);
        continue;
      }
      turns.push(turn);
    } catch {
      warnings.push(`ignored line ${index + 1}: malformed JSON`);
    }
  }
  return { turns, warnings };
}

export function historyMessages(
  turns: EntityTurn[],
  projectObservation: (
    observation: any,
    context: {
      index: number;
      turn: EntityTurn;
      previousTurn: EntityTurn | null;
      phase: 'observation' | 'nextObservation';
    },
  ) => any = (observation) => observation,
  mayReplayAction: (turn: EntityTurn) => boolean = () => true,
) {
  const messages: any[] = [];
  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index];
    const previousTurn = turns[index - 1] ?? null;
    if (!mayReplayAction(turn)) {
      messages.push({
        role: 'user',
        content: `Historical controller turn with non-resident action omitted:\n${JSON.stringify({
          observation: projectObservation(turn.observation, {
            index,
            turn,
            previousTurn,
            phase: 'observation',
          }),
          action: {
            name: turn.action.name,
            inputOmitted: true,
            reason: 'not_resident_observable',
          },
          outcome: {
            ok: turn.outcome.ok,
            eventType: turn.outcome.eventType,
            resultOmitted: true,
            reason: 'not_resident_observable',
          },
          nextObservation: projectObservation(turn.nextObservation, {
            index,
            turn,
            previousTurn,
            phase: 'nextObservation',
          }),
        })}`,
      });
      continue;
    }
    if (turn.action.source !== 'llm') {
      messages.push({
        role: 'user',
        content: `Historical ${turn.action.source} controller turn:\n${JSON.stringify({
          observation: projectObservation(turn.observation, {
            index,
            turn,
            previousTurn,
            phase: 'observation',
          }),
          action: projectResidentVisibleValue(turn.action),
          outcome: projectResidentVisibleValue(turn.outcome),
          nextObservation: projectObservation(turn.nextObservation, {
            index,
            turn,
            previousTurn,
            phase: 'nextObservation',
          }),
        })}`,
      });
      continue;
    }
    messages.push({
      role: 'user',
      content: `World observation:\n${JSON.stringify(
        projectObservation(turn.observation, {
          index,
          turn,
          previousTurn,
          phase: 'observation',
        }),
      )}`,
    });
    messages.push(replayAssistantMessage(turn.utterance.assistant));
    const content = JSON.stringify(projectResidentVisibleValue(turn.outcome));
    if (turn.action.toolCallId) {
      messages.push({
        role: 'tool',
        tool_call_id: turn.action.toolCallId,
        name: turn.action.name,
        content,
      });
    } else {
      messages.push({
        role: 'user',
        content: `Action observation for ${turn.action.name}: ${content}`,
      });
    }
  }
  return messages;
}

/**
 * Reconstruct only the protocol-visible assistant message needed for the next
 * model call. Provider-private reasoning remains in the immutable EntityTurn
 * for audit, but replaying it would make every later prompt grow with a second
 * hidden autobiography that neither caused the action nor observed its result.
 */
function replayAssistantMessage(assistant: any) {
  const replay: any = {
    role: 'assistant',
    content: assistant?.content ?? null,
  };
  if (Array.isArray(assistant?.tool_calls) && assistant.tool_calls.length > 0) {
    replay.tool_calls = assistant.tool_calls;
  }
  if (assistant?.name != null) replay.name = assistant.name;
  return replay;
}
