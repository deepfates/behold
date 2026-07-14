import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PROTOCOL = 'behold.world-compilation-loom.v1';
const VIA = 'behold-earth-to-living-world@0.1.0';

async function lyncRuntime(directory, options = {}) {
  const [{ createFileEventStore }, { createLyncLooms, loomRootId }] = await Promise.all([
    import('@deepfates/lync/file-log'),
    import('@deepfates/lync/looms'),
  ]);
  const store = createFileEventStore(directory);
  const looms = createLyncLooms({
    store,
    author: { actor: 'place-compiler', via: VIA },
    ...(options.now ? { now: options.now } : {}),
    ...(options.createId ? { createId: options.createId } : {}),
  });
  return { store, looms, loomRootId };
}

function foundryLoomHandle(root, store, loom, loomRootId, initialTipTurnId) {
  const directory = path.join(root, 'history');
  let tipTurnId = initialTipTurnId;
  const manifestPath = path.join(directory, 'manifest.json');
  const persistManifest = () =>
    writeFileSync(
      manifestPath,
      `${JSON.stringify({ protocol: PROTOCOL, loomId: loom.id, tipTurnId }, null, 2)}\n`,
    );
  return {
    protocol: PROTOCOL,
    loomId: loom.id,
    file: path.join(directory, `${encodeURIComponent(loomRootId(loom.id))}.lync`),
    get tipTurnId() {
      return tipTurnId;
    },
    async append(payload, meta = {}) {
      const turn = await loom.appendTurn(tipTurnId, payload, { protocol: PROTOCOL, ...meta });
      tipTurnId = turn.id;
      persistManifest();
      return turn;
    },
    async branch(parentId, payload, meta = {}) {
      return loom.appendTurn(parentId, payload, { protocol: PROTOCOL, ...meta });
    },
    async diagnostics() {
      return store.diagnostics();
    },
    close() {
      loom.close();
    },
  };
}

export async function createFoundryLoom(root, identity, options = {}) {
  const directory = path.join(root, 'history');
  mkdirSync(directory, { recursive: true });
  const { store, looms, loomRootId } = await lyncRuntime(directory, options);
  const info = await looms.create({ protocol: PROTOCOL, ...identity });
  const loom = await looms.open(info.id);
  const handle = foundryLoomHandle(root, store, loom, loomRootId, null);
  writeFileSync(
    path.join(directory, 'manifest.json'),
    `${JSON.stringify({ protocol: PROTOCOL, loomId: loom.id, tipTurnId: null }, null, 2)}\n`,
  );
  return handle;
}

export async function openFoundryLoom(root, options = {}) {
  const directory = path.join(root, 'history');
  const manifest = JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  if (manifest.protocol !== PROTOCOL) throw new Error('unsupported world compilation history');
  const { store, looms, loomRootId } = await lyncRuntime(directory, options);
  const loom = await looms.open(manifest.loomId);
  if (manifest.tipTurnId && !(await loom.hasTurn(manifest.tipTurnId)))
    throw new Error(`world compilation history tip is missing: ${manifest.tipTurnId}`);
  return foundryLoomHandle(root, store, loom, loomRootId, manifest.tipTurnId);
}

export async function readFoundryHistory(root) {
  const [{ createFileEventStore }, { createLyncLooms }] = await Promise.all([
    import('@deepfates/lync/file-log'),
    import('@deepfates/lync/looms'),
  ]);
  const directory = path.join(root, 'history');
  const manifest = JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  if (manifest.protocol !== PROTOCOL) throw new Error('unsupported world compilation history');
  const store = createFileEventStore(directory);
  const looms = createLyncLooms({
    store,
    author: { actor: 'place-compiler', via: VIA },
  });
  const loom = await looms.open(manifest.loomId);
  const turns = manifest.tipTurnId ? await loom.threadTo(manifest.tipTurnId) : [];
  return { manifest, turns, diagnostics: await store.diagnostics() };
}
