#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function listFiles(root, relative = '') {
  const directory = path.join(root, relative);
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    .flatMap((entry) => {
      const child = path.join(relative, entry.name);
      if (entry.isDirectory()) return listFiles(root, child);
      if (entry.isFile()) return [child];
      throw new Error(`Unsupported non-file entry: ${path.join(root, child)}`);
    });
}

const arguments_ = process.argv.slice(2);
const verify = arguments_[0] === '--verify';
const [rootArgument, outputArgument] = verify ? arguments_.slice(1) : arguments_;
if (!rootArgument || !outputArgument) {
  console.error(
    'Usage:\n' +
      '  tree-hash.mjs <root-directory> <output-manifest.json>\n' +
      '  tree-hash.mjs --verify <root-directory> <existing-manifest.json>',
  );
  process.exit(64);
}

const root = path.resolve(rootArgument);
const output = path.resolve(outputArgument);
if (!verify && existsSync(output)) throw new Error(`Refusing to overwrite ${output}`);
if (verify && !existsSync(output)) throw new Error(`Missing checksum manifest: ${output}`);
const files = [];
const tree = createHash('sha256');
let totalSizeBytes = 0;
for (const relativePath of listFiles(root)) {
  const filePath = path.join(root, relativePath);
  const sizeBytes = statSync(filePath).size;
  const digest = await sha256(filePath);
  const portablePath = relativePath.split(path.sep).join('/');
  files.push({ path: portablePath, sizeBytes, sha256: digest });
  totalSizeBytes += sizeBytes;
  tree.update(`${digest}  ${sizeBytes}  ${portablePath}\n`);
}

const manifest = {
  schemaVersion: 1,
  algorithm:
    'sha256 of sorted lines: <file-sha256><two spaces><size><two spaces><relative-path><newline>',
  root,
  createdAt: new Date().toISOString(),
  fileCount: files.length,
  totalSizeBytes,
  treeSha256: tree.digest('hex'),
  files,
};
if (verify) {
  const expected = JSON.parse(readFileSync(output, 'utf8'));
  for (const field of ['fileCount', 'totalSizeBytes', 'treeSha256']) {
    if (manifest[field] !== expected[field]) {
      throw new Error(`${field} mismatch: expected ${expected[field]}, got ${manifest[field]}`);
    }
  }
  if (JSON.stringify(manifest.files) !== JSON.stringify(expected.files)) {
    throw new Error('Per-file checksum records do not match');
  }
  process.stdout.write(
    `${JSON.stringify({ status: 'verified', fileCount: manifest.fileCount, totalSizeBytes, treeSha256: manifest.treeSha256 })}\n`,
  );
} else {
  writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(
    `${JSON.stringify({ fileCount: manifest.fileCount, totalSizeBytes, treeSha256: manifest.treeSha256 })}\n`,
  );
}
