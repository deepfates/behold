#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function parse(argv) {
  const out = { runRoot: null, profile: null, destination: null, port: 25565 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--run-root') out.runRoot = path.resolve(argv[++i]);
    else if (argv[i] === '--profile') out.profile = argv[++i];
    else if (argv[i] === '--destination') out.destination = path.resolve(argv[++i]);
    else if (argv[i] === '--port') out.port = Number(argv[++i]);
    else throw new Error(`Unknown or incomplete argument: ${argv[i]}`);
  }
  if (!out.runRoot || !out.profile || !out.destination)
    throw new Error('--run-root, --profile, and --destination are required');
  if (!Number.isInteger(out.port) || out.port < 1 || out.port > 65535)
    throw new Error('invalid port');
  return out;
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
if (!profile) throw new Error(`run does not publish profile ${options.profile}`);
const output = path.join(options.runRoot, 'output');
const worlds = readdirSync(output).filter((name) => name.startsWith('Arnis World '));
if (worlds.length !== 1) throw new Error(`expected one source world, found ${worlds.length}`);
const source = path.join(output, worlds[0]);
if (existsSync(path.join(source, 'session.lock'))) throw new Error('source world is locked');
mkdirSync(path.dirname(options.destination), { recursive: true });
mkdirSync(options.destination, { recursive: false });
await run('cp', ['-cR', source, path.join(options.destination, 'world')]);

const { minecraft, ecology } = profile;
const properties = {
  'allow-flight': true,
  difficulty: minecraft.difficulty,
  'enable-command-block': false,
  'enable-rcon': false,
  gamemode: minecraft.gameMode,
  'generate-structures': true,
  'level-name': 'world',
  'max-players': 20,
  motd: `${manifest.place.name} · ${options.profile}`,
  'online-mode': false,
  'server-port': options.port,
  'simulation-distance': minecraft.simulationDistance,
  'spawn-animals': ecology.mobSpawning,
  'spawn-monsters': ecology.mobSpawning,
  'spawn-npcs': ecology.mobSpawning,
  'spawn-protection': 0,
  'view-distance': minecraft.viewDistance,
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
const functions = path.join(datapack, 'data', 'place_runtime', 'function');
const tags = path.join(datapack, 'data', 'minecraft', 'tags', 'function');
mkdirSync(functions, { recursive: true });
mkdirSync(tags, { recursive: true });
writeFileSync(
  path.join(datapack, 'pack.mcmeta'),
  `${JSON.stringify({ pack: { pack_format: 61, description: `Place Compiler ${options.profile} policy` } }, null, 2)}\n`,
);
writeFileSync(
  path.join(tags, 'load.json'),
  `${JSON.stringify({ values: ['place_runtime:load'] }, null, 2)}\n`,
);
writeFileSync(
  path.join(functions, 'load.mcfunction'),
  `gamerule doDaylightCycle ${ecology.daylightCycle}\ngamerule doWeatherCycle ${ecology.weatherCycle}\ngamerule doMobSpawning ${ecology.mobSpawning}\ndifficulty ${minecraft.difficulty}\n`,
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
  minecraftServerSha256: manifest.generator.minecraftServerSha256,
  launch: ['java', '-Xms2G', '-Xmx8G', '-jar', manifest.generator.minecraftServerPath, 'nogui'],
};
writeFileSync(
  path.join(options.destination, 'runtime-manifest.json'),
  `${JSON.stringify(runtime, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(runtime, null, 2)}\n`);
