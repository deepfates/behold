import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const WORLD_OWNER_PROTOCOL = 'behold.world-owner.v1' as const;

export type WorldControlState =
  | 'stopped_verified'
  | 'resetting'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'recovery_required';

export type WorldOwnerRecord = Readonly<{
  protocol: typeof WORLD_OWNER_PROTOCOL;
  world: string;
  epoch: number;
  token: string;
  hostname: string;
  managerPid: number;
  state: WorldControlState;
  createdAt: string;
  updatedAt: string;
  runtime: Readonly<{ path: string; device: number; inode: number }>;
  server: Readonly<{ pid: number; jarSha256: string }> | null;
  controllers: ReadonlyArray<Readonly<{ entityId: string; pid: number; leasePath: string }>>;
}>;

export type WorldControlInspection =
  | { state: 'clear'; file: string }
  | { state: 'held'; file: string; record: WorldOwnerRecord }
  | { state: 'invalid'; file: string; error: string };

export type WorldLifecycleEvent = Readonly<{
  sequence: number;
  at: string;
  world: string;
  epoch: number;
  type: string;
  data: unknown;
  previousDigest: string | null;
  digest: string;
}>;

export type HeldWorldControl = Readonly<{
  file: string;
  journalFile: string;
  record(): WorldOwnerRecord;
  update(
    state: WorldControlState,
    detail?: Partial<Pick<WorldOwnerRecord, 'server' | 'controllers'>>,
  ): WorldOwnerRecord;
  append(type: string, data?: unknown): WorldLifecycleEvent;
  release(): void;
}>;

export function inspectWorldControl(controlRoot: string, world: string): WorldControlInspection {
  const file = ownerFile(controlRoot, world);
  if (!fs.existsSync(file)) return { state: 'clear', file };
  try {
    return { state: 'held', file, record: parseOwnerRecord(fs.readFileSync(file, 'utf8')) };
  } catch (error: any) {
    return { state: 'invalid', file, error: error?.message || String(error) };
  }
}

export function verifyWorldLifecycleJournal(file: string) {
  const lines = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0);
  const events: WorldLifecycleEvent[] = [];
  let previousDigest: string | null = null;
  let world: string | null = null;
  let epoch: number | null = null;
  for (const [index, line] of lines.entries()) {
    const event = JSON.parse(line);
    const { digest, ...payload } = event;
    const expected = lifecycleDigest(previousDigest, payload);
    if (
      event.sequence !== index + 1 ||
      event.previousDigest !== previousDigest ||
      typeof digest !== 'string' ||
      digest !== expected ||
      (world !== null && event.world !== world) ||
      (epoch !== null && event.epoch !== epoch)
    ) {
      throw new Error(`Invalid world lifecycle journal at line ${index + 1}: ${file}`);
    }
    world = event.world;
    epoch = event.epoch;
    previousDigest = digest;
    events.push(event as WorldLifecycleEvent);
  }
  return Object.freeze({
    file,
    world,
    epoch,
    events: Object.freeze(events),
    tipDigest: previousDigest,
  });
}

export function acquireWorldControl(options: {
  controlRoot: string;
  world: string;
  runtimePath: string;
  now?: () => Date;
  pid?: number;
  hostname?: string;
}): HeldWorldControl {
  const now = options.now ?? (() => new Date());
  const directory = path.join(options.controlRoot, safeSegment(options.world));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fsyncDirectory(path.dirname(directory));
  fsyncDirectory(directory);
  const file = path.join(directory, 'owner.json');
  let descriptor: number;
  try {
    descriptor = fs.openSync(file, 'wx', 0o600);
  } catch (error: any) {
    if (error?.code === 'EEXIST') {
      throw new Error(`World ${options.world} is already controlled: ${file}`);
    }
    throw error;
  }

  try {
    const runtimePath = fs.realpathSync.native(options.runtimePath);
    const runtimeStats = fs.statSync(runtimePath);
    if (!runtimeStats.isDirectory()) throw new Error(`Runtime is not a directory: ${runtimePath}`);
    const epoch = advanceEpoch(directory);
    let current: WorldOwnerRecord = Object.freeze({
      protocol: WORLD_OWNER_PROTOCOL,
      world: options.world,
      epoch,
      token: randomUUID(),
      hostname: options.hostname ?? os.hostname(),
      managerPid: options.pid ?? process.pid,
      state: 'stopped_verified',
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
      runtime: Object.freeze({
        path: runtimePath,
        device: runtimeStats.dev,
        inode: runtimeStats.ino,
      }),
      server: null,
      controllers: Object.freeze([]),
    });
    writeHeldRecord(descriptor, current);
    fsyncDirectory(directory);

    const journalFile = path.join(directory, `lifecycle-${epoch}.jsonl`);
    const journalDescriptor = fs.openSync(journalFile, 'wx', 0o600);
    let journalSequence = 0;
    let previousJournalDigest: string | null = null;
    let released = false;

    const assertHeld = () => {
      if (released) throw new Error(`World control already released: ${file}`);
      const descriptorStats = fs.fstatSync(descriptor);
      const pathStats = fs.lstatSync(file);
      if (
        pathStats.isSymbolicLink() ||
        descriptorStats.dev !== pathStats.dev ||
        descriptorStats.ino !== pathStats.ino
      ) {
        throw new Error(`World owner record was replaced: ${file}`);
      }
      const observed = parseOwnerRecord(fs.readFileSync(file, 'utf8'));
      if (observed.token !== current.token || observed.epoch !== current.epoch) {
        throw new Error(`World owner token changed: ${file}`);
      }
    };

    const append = (type: string, data: unknown = {}): WorldLifecycleEvent => {
      assertHeld();
      const payload = {
        sequence: ++journalSequence,
        at: now().toISOString(),
        world: current.world,
        epoch: current.epoch,
        type,
        data: structuredClone(data),
        previousDigest: previousJournalDigest,
      };
      const event: WorldLifecycleEvent = Object.freeze({
        ...payload,
        digest: lifecycleDigest(previousJournalDigest, payload),
      });
      fs.writeSync(journalDescriptor, `${JSON.stringify(event)}\n`);
      fs.fsyncSync(journalDescriptor);
      previousJournalDigest = event.digest;
      return event;
    };

    append('control_acquired', { owner: current });

    return Object.freeze({
      file,
      journalFile,
      record: () => current,
      update: (state, detail = {}) => {
        assertHeld();
        const server =
          detail.server === undefined
            ? current.server
            : detail.server === null
              ? null
              : Object.freeze(structuredClone(detail.server));
        const controllers =
          detail.controllers === undefined
            ? current.controllers
            : Object.freeze(
                detail.controllers.map((controller) => Object.freeze(structuredClone(controller))),
              );
        current = Object.freeze({
          ...current,
          state,
          updatedAt: now().toISOString(),
          server,
          controllers,
        });
        writeHeldRecord(descriptor, current);
        append('control_state_changed', {
          state,
          server: current.server,
          controllers: current.controllers,
        });
        return current;
      },
      append,
      release: () => {
        assertHeld();
        if (current.state !== 'stopped_verified' || current.server || current.controllers.length) {
          throw new Error(`World control cannot release from state ${current.state}`);
        }
        append('control_released');
        fs.closeSync(journalDescriptor);
        fs.closeSync(descriptor);
        fs.unlinkSync(file);
        fsyncDirectory(directory);
        released = true;
      },
    });
  } catch (error) {
    try {
      fs.closeSync(descriptor);
    } catch {}
    try {
      fs.unlinkSync(file);
      fsyncDirectory(path.dirname(file));
    } catch {}
    throw error;
  }
}

function parseOwnerRecord(raw: string): WorldOwnerRecord {
  const value = JSON.parse(raw);
  if (
    value?.protocol !== WORLD_OWNER_PROTOCOL ||
    typeof value.world !== 'string' ||
    !Number.isSafeInteger(value.epoch) ||
    value.epoch < 1 ||
    typeof value.token !== 'string' ||
    typeof value.hostname !== 'string' ||
    !Number.isSafeInteger(value.managerPid) ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    ![
      'stopped_verified',
      'resetting',
      'starting',
      'running',
      'stopping',
      'recovery_required',
    ].includes(value.state) ||
    typeof value.runtime?.path !== 'string' ||
    !Number.isSafeInteger(value.runtime?.device) ||
    !Number.isSafeInteger(value.runtime?.inode) ||
    (value.server !== null &&
      (!Number.isSafeInteger(value.server?.pid) || typeof value.server?.jarSha256 !== 'string')) ||
    !Array.isArray(value.controllers) ||
    value.controllers.some(
      (controller: any) =>
        typeof controller?.entityId !== 'string' ||
        !Number.isSafeInteger(controller?.pid) ||
        typeof controller?.leasePath !== 'string',
    )
  ) {
    throw new Error('invalid behold.world-owner.v1 record');
  }
  return value as WorldOwnerRecord;
}

function writeHeldRecord(descriptor: number, record: WorldOwnerRecord) {
  const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
  fs.ftruncateSync(descriptor, 0);
  fs.writeSync(descriptor, bytes, 0, bytes.length, 0);
  fs.fsyncSync(descriptor);
}

function lifecycleDigest(previousDigest: string | null, payload: unknown) {
  return createHash('sha256')
    .update(previousDigest ?? '')
    .update('\n')
    .update(JSON.stringify(payload))
    .digest('hex');
}

function advanceEpoch(directory: string) {
  const file = path.join(directory, 'epoch');
  let previous = 0;
  try {
    previous = Number(fs.readFileSync(file, 'utf8').trim());
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const next = Number.isSafeInteger(previous) && previous >= 0 ? previous + 1 : 1;
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${next}\n`, { encoding: 'utf8', mode: 0o600 });
  const descriptor = fs.openSync(temporary, 'r');
  fs.fsyncSync(descriptor);
  fs.closeSync(descriptor);
  fs.renameSync(temporary, file);
  fsyncDirectory(directory);
  return next;
}

function ownerFile(controlRoot: string, world: string) {
  return path.join(controlRoot, safeSegment(world), 'owner.json');
}

function safeSegment(value: string) {
  const safe = String(value).replace(/[^a-zA-Z0-9._-]+/g, '-');
  if (!safe || safe === '.' || safe === '..' || safe !== value) {
    throw new Error(`Invalid world identifier: ${value}`);
  }
  return safe;
}

function fsyncDirectory(directory: string) {
  const descriptor = fs.openSync(directory, 'r');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}
