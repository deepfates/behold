#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function parse(argv) {
  const options = { runRoot: null, profile: null, destination: null, port: 25565 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--run-root') options.runRoot = path.resolve(argv[++i]);
    else if (argv[i] === '--profile') options.profile = argv[++i];
    else if (argv[i] === '--destination') options.destination = path.resolve(argv[++i]);
    else if (argv[i] === '--port') options.port = Number(argv[++i]);
    else throw new Error(`Unknown or incomplete argument: ${argv[i]}`);
  }
  if (!options.runRoot || !options.profile || !options.destination)
    throw new Error('--run-root, --profile, and --destination are required');
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535)
    throw new Error('invalid port');
  return options;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    );
  });
}

const options = parse(process.argv.slice(2));
if (existsSync(options.destination)) throw new Error(`destination exists: ${options.destination}`);
const manifest = JSON.parse(
  readFileSync(path.join(options.runRoot, 'generation-manifest.json'), 'utf8'),
);
const profile = manifest.place?.runtimeProfiles?.[options.profile];
if (!profile) throw new Error(`run does not publish runtime profile: ${options.profile}`);
const output = path.join(options.runRoot, 'output');
const names = readdirSync(output).filter((name) => name.startsWith('Arnis World '));
if (names.length !== 1) throw new Error(`expected one source world, found ${names.length}`);
const source = path.join(output, names[0]);
if (existsSync(path.join(source, 'session.lock'))) throw new Error('source world is locked');
mkdirSync(options.destination, { recursive: false });
await run('cp', ['-cR', source, path.join(options.destination, 'world')]);

const minecraft = profile.minecraft;
const ecology = profile.ecology;
const properties = {
  'allow-flight': 'true',
  difficulty: minecraft.difficulty,
  'enable-command-block': 'false',
  'enable-rcon': 'false',
  'enforce-whitelist': 'false',
  gamemode: minecraft.gameMode,
  'generate-structures': 'true',
  'level-name': 'world',
  'max-players': '20',
  motd: `${manifest.place.name} · ${options.profile}`,
  'online-mode': 'false',
  'server-port': String(options.port),
  'simulation-distance': String(minecraft.simulationDistance),
  'spawn-animals': String(ecology.mobSpawning),
  'spawn-monsters': String(ecology.mobSpawning),
  'spawn-npcs': String(ecology.mobSpawning),
  'spawn-protection': '0',
  'view-distance': String(minecraft.viewDistance),
};
writeFileSync(
  path.join(options.destination, 'server.properties'),
  `${Object.entries(properties)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}\n`,
);
writeFileSync(path.join(options.destination, 'eula.txt'), 'eula=true\n');

const datapack = path.join(options.destination, 'world', 'datapacks', 'place-runtime');
const functionRoot = path.join(datapack, 'data', 'place_runtime', 'function');
const tagRoot = path.join(datapack, 'data', 'minecraft', 'tags', 'function');
mkdirSync(functionRoot, { recursive: true });
mkdirSync(tagRoot, { recursive: true });
writeFileSync(
  path.join(datapack, 'pack.mcmeta'),
  `${JSON.stringify({ pack: { pack_format: 61, description: `Place Compiler ${options.profile} runtime policy` } }, null, 2)}\n`,
);
writeFileSync(
  path.join(tagRoot, 'load.json'),
  `${JSON.stringify({ values: ['place_runtime:load'] }, null, 2)}\n`,
);
writeFileSync(
  path.join(functionRoot, 'load.mcfunction'),
  [
    `gamerule doDaylightCycle ${ecology.daylightCycle}`,
    `gamerule doWeatherCycle ${ecology.weatherCycle}`,
    `gamerule doMobSpawning ${ecology.mobSpawning}`,
    `difficulty ${minecraft.difficulty}`,
  ].join('\n') + '\n',
);

const runtime = {
  schemaVersion: 1,
  placeId: manifest.place.id,
  sourceRunId: manifest.runId,
  sourceRecipeSha256: manifest.place.recipeSha256,
  profileId: options.profile,
  profile,
  port: options.port,
  world: 'world',
  launch: ['java', '-Xms2G', '-Xmx8G', '-jar', manifest.generator.minecraftServerPath, 'nogui'],
};
writeFileSync(
  path.join(options.destination, 'runtime-manifest.json'),
  `${JSON.stringify(runtime, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(runtime, null, 2)}\n`);
