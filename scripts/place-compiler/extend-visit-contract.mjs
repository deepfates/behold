#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './core.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const options = {};
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (
    [
      '--base',
      '--benchmark',
      '--inspection',
      '--map',
      '--route',
      '--sightline',
      '--output',
    ].includes(key)
  )
    options[key.slice(2)] = path.resolve(process.argv[++index]);
  else if (key === '--place') options.place = process.argv[++index];
  else if (key === '--id') options.id = process.argv[++index];
  else throw new Error(`Unknown or incomplete argument: ${key}`);
}
for (const key of [
  'base',
  'benchmark',
  'place',
  'inspection',
  'map',
  'route',
  'sightline',
  'output',
  'id',
])
  if (!options[key]) throw new Error(`--${key} is required`);
if (existsSync(options.output)) throw new Error(`output exists: ${options.output}`);
if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(options.id)) throw new Error('invalid contract id');

function relative(file, label) {
  if (file !== repositoryRoot && !file.startsWith(`${repositoryRoot}${path.sep}`))
    throw new Error(`${label} escapes repository`);
  if (!existsSync(file)) throw new Error(`${label} is missing`);
  return path.relative(repositoryRoot, file);
}

const base = JSON.parse(readFileSync(options.base, 'utf8'));
const benchmark = JSON.parse(readFileSync(options.benchmark, 'utf8'));
if (!benchmark.fixtures?.some((fixture) => fixture.placeId === options.place))
  throw new Error('benchmark does not contain candidate place');
if (base.places?.[options.place]) throw new Error('base contract already contains candidate place');
const sources = {};
for (const role of ['inspection', 'map', 'route', 'sightline']) {
  const file = options[role];
  sources[role] = { path: relative(file, role), sha256: await sha256(file) };
}
const inspection = JSON.parse(readFileSync(options.inspection, 'utf8'));
const route = JSON.parse(readFileSync(options.route, 'utf8'));
const sightline = JSON.parse(readFileSync(options.sightline, 'utf8'));
if (
  inspection.placeId !== options.place ||
  route.placeId !== options.place ||
  sightline.placeId !== options.place
)
  throw new Error('candidate visual evidence place identity mismatch');
const contract = {
  ...base,
  id: options.id,
  benchmark: relative(options.benchmark, 'benchmark'),
  purpose: `${base.purpose} Candidate ${options.place} is appended from measured evidence.`,
  places: { ...base.places, [options.place]: sources },
};
writeFileSync(options.output, `${JSON.stringify(contract, null, 2)}\n`, { flag: 'wx' });
process.stdout.write(
  `${JSON.stringify({ output: relative(options.output, 'output'), contractId: contract.id, place: options.place, sources }, null, 2)}\n`,
);
