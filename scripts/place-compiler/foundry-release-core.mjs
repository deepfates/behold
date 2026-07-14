import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  utimesSync,
} from 'node:fs';
import path from 'node:path';
import { sha256 } from './core.mjs';

export const epoch = new Date(0);
export const json = (file) => JSON.parse(readFileSync(file, 'utf8'));

export function safeRelative(value) {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalized || path.isAbsolute(normalized) || normalized.split('/').includes('..'))
    throw new Error(`unsafe release path: ${value}`);
  return normalized;
}

export function copyNormalized(source, stage, relative) {
  const safe = safeRelative(relative);
  const destination = path.join(stage, safe);
  if (!existsSync(source) || !statSync(source).isFile())
    throw new Error(`missing release input: ${source}`);
  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  utimesSync(destination, epoch, epoch);
}

export function walkFiles(root, prefix = '') {
  const out = [];
  for (const name of readdirSync(path.join(root, prefix)).sort()) {
    const relative = path.join(prefix, name);
    const status = statSync(path.join(root, relative));
    if (status.isDirectory()) out.push(...walkFiles(root, relative));
    else if (status.isFile()) out.push(relative.replaceAll('\\', '/'));
  }
  return out;
}

export function normalizeTree(root) {
  for (const name of readdirSync(root).sort()) {
    const file = path.join(root, name);
    if (statSync(file).isDirectory()) normalizeTree(file);
    utimesSync(file, epoch, epoch);
  }
  utimesSync(root, epoch, epoch);
}

export async function indexTree(root, excluded = new Set()) {
  const entries = [];
  for (const relative of walkFiles(root)) {
    if (excluded.has(relative)) continue;
    const file = path.join(root, relative);
    entries.push({ path: relative, sizeBytes: statSync(file).size, sha256: await sha256(file) });
  }
  return entries;
}

export async function archive(stage, destination) {
  normalizeTree(stage);
  const result = spawnSync(
    'tar',
    [
      '--format',
      'ustar',
      '--options',
      'gzip:compression-level=6,gzip:!timestamp',
      '--no-xattrs',
      '--uid',
      '0',
      '--gid',
      '0',
      '--uname',
      'root',
      '--gname',
      'root',
      '-czf',
      destination,
      '-C',
      stage,
      '.',
    ],
    { encoding: 'utf8', env: { ...process.env, COPYFILE_DISABLE: '1' } },
  );
  if (result.status !== 0) throw new Error(`archive failed: ${result.stderr}`);
  return { sizeBytes: statSync(destination).size, sha256: await sha256(destination) };
}
