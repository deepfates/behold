import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

interface Library {
  name: string;
  downloads?: { artifact?: { path?: string } };
  rules?: Array<{ action: 'allow' | 'disallow'; os?: { name?: string; arch?: string } }>;
}

interface VersionManifest {
  id: string;
  mainClass: string;
  assets: string;
  type: string;
  libraries: Library[];
}

const version = process.env.NATIVE_MC_VERSION || '1.21.4';
const minecraftHome =
  process.env.MINECRAFT_HOME ||
  path.join(os.homedir(), 'Library', 'Application Support', 'minecraft');
const runtimeHome = path.resolve(
  process.env.NATIVE_MC_RUNTIME || path.join(process.cwd(), '.behold-runtime', 'native-client'),
);
const gameDir = path.join(runtimeHome, 'game');
const nativesDir = path.join(runtimeHome, 'natives', version);
const manifestPath = path.join(minecraftHome, 'versions', version, `${version}.json`);
const clientJar = path.join(minecraftHome, 'versions', version, `${version}.jar`);
const renderDistance = integerSetting('NATIVE_MC_RENDER_DISTANCE', 32, 2, 32);
const simulationDistance = integerSetting('NATIVE_MC_SIMULATION_DISTANCE', 10, 5, 32);
const hideGui = booleanSetting('NATIVE_MC_HIDE_GUI', false);
for (const required of [manifestPath, clientJar]) {
  if (!fs.existsSync(required))
    throw new Error(`Missing installed Minecraft component: ${required}`);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as VersionManifest;
const java = resolveJava();
if (path.isAbsolute(java) && !fs.existsSync(java)) throw new Error(`Missing Java runtime: ${java}`);
const classpath: string[] = [];
const nativeJars: string[] = [];
const missing: string[] = [];

for (const library of manifest.libraries) {
  if (!allowsMac(library.rules)) continue;
  const artifact = library.downloads?.artifact?.path;
  if (!artifact) continue;
  const file = path.join(minecraftHome, 'libraries', artifact);
  if (!fs.existsSync(file)) {
    missing.push(file);
    continue;
  }

  const native = library.name.includes(':natives-');
  if (native) {
    if (
      library.name.includes(':natives-macos-arm64') ||
      library.name.includes(':natives-macos-patch')
    ) {
      nativeJars.push(file);
      classpath.push(file);
    }
    continue;
  }
  classpath.push(file);
}

if (missing.length) {
  throw new Error(
    `The installed client is incomplete; ${missing.length} libraries are missing:\n${missing.join('\n')}`,
  );
}
classpath.push(clientJar);

fs.mkdirSync(gameDir, { recursive: true });
extractNatives(nativeJars, nativesDir);
writeDefaultOptions(gameDir, { renderDistance, simulationDistance, hideGui });

const username = process.env.NATIVE_MC_USERNAME || 'Visitor';
const uuid = process.env.NATIVE_MC_UUID || offlineUuid(username);
const server = process.env.NATIVE_MC_SERVER || '127.0.0.1:25565';
const maxMemory = process.env.NATIVE_MC_MEMORY || '4G';

const args = [
  '-XstartOnFirstThread',
  `-Xmx${maxMemory}`,
  `-Djava.library.path=${nativesDir}`,
  `-Djna.tmpdir=${nativesDir}`,
  `-Dorg.lwjgl.system.SharedLibraryExtractPath=${nativesDir}`,
  `-Dio.netty.native.workdir=${nativesDir}`,
  '-Dminecraft.launcher.brand=behold-local',
  '-Dminecraft.launcher.version=1',
  '-cp',
  classpath.join(path.delimiter),
  manifest.mainClass,
  '--username',
  username,
  '--version',
  manifest.id,
  '--gameDir',
  gameDir,
  '--assetsDir',
  path.join(minecraftHome, 'assets'),
  '--assetIndex',
  manifest.assets,
  '--uuid',
  uuid,
  '--accessToken',
  '0',
  '--clientId',
  'behold-local',
  '--xuid',
  '0',
  '--userType',
  'msa',
  '--versionType',
  manifest.type,
  '--width',
  '1280',
  '--height',
  '800',
  '--quickPlayMultiplayer',
  server,
];

console.log(`[native] Minecraft ${version} as ${username}`);
console.log(`[native] ${classpath.length} classpath entries, ${nativeJars.length} native bundles`);
console.log(`[native] Game directory: ${gameDir}`);
console.log(`[native] Quick-connecting to ${server}`);

if (process.argv.includes('--dry-run')) {
  console.log(`[native] Java: ${java}`);
  console.log('[native] Launch validated (dry run).');
  process.exit(0);
}

const child = spawn(java, args, { cwd: gameDir, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  });
}
child.on('error', (error) => {
  console.error('[native] Failed to launch:', error);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  console.log(`[native] Minecraft exited (${signal || code || 0}).`);
  process.exitCode = code ?? (signal ? 1 : 0);
});

function allowsMac(rules: Library['rules']) {
  if (!rules?.length) return true;
  let allowed = false;
  for (const rule of rules) {
    const osMatches = !rule.os?.name || rule.os.name === 'osx';
    const archMatches = !rule.os?.arch || ['arm64', 'aarch64'].includes(rule.os.arch);
    if (osMatches && archMatches) allowed = rule.action === 'allow';
  }
  return allowed;
}

function resolveJava() {
  if (process.env.NATIVE_MC_JAVA) return path.resolve(process.env.NATIVE_MC_JAVA);
  const executable = process.platform === 'win32' ? 'java.exe' : 'java';
  const candidates =
    process.platform === 'darwin'
      ? [
          path.join(
            minecraftHome,
            'runtime',
            'java-runtime-delta',
            process.arch === 'arm64' ? 'mac-os-arm64' : 'mac-os',
            'java-runtime-delta',
            'jre.bundle',
            'Contents',
            'Home',
            'bin',
            executable,
          ),
        ]
      : process.platform === 'linux'
        ? [
            path.join(
              minecraftHome,
              'runtime',
              'java-runtime-delta',
              process.arch === 'arm64' ? 'linux-arm64' : 'linux',
              'java-runtime-delta',
              'bin',
              executable,
            ),
          ]
        : [];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? executable;
}

function offlineUuid(name: string) {
  const bytes = createHash('md5').update(`OfflinePlayer:${name}`).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x30;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytes.toString('hex');
}

function extractNatives(jars: string[], target: string) {
  const marker = path.join(target, '.ready');
  const signature = jars.map((file) => `${file}:${fs.statSync(file).mtimeMs}`).join('\n');
  if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === signature) return;

  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  for (const jar of jars) {
    const result = spawnSync('/usr/bin/unzip', ['-oq', jar, '-d', target], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`Could not extract ${jar}: ${result.stderr}`);
  }
  fs.rmSync(path.join(target, 'META-INF'), { recursive: true, force: true });
  fs.writeFileSync(marker, signature);
}

function integerSetting(name: string, fallback: number, minimum: number, maximum: number) {
  const raw = process.env[name];
  const value = raw == null ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

function booleanSetting(name: string, fallback: boolean) {
  const raw = process.env[name];
  if (raw == null) return fallback;
  if (raw !== 'true' && raw !== 'false') throw new Error(`${name} must be true or false`);
  return raw === 'true';
}

function writeDefaultOptions(
  targetGameDir: string,
  visual: { renderDistance: number; simulationDistance: number; hideGui: boolean },
) {
  const options = path.join(targetGameDir, 'options.txt');
  const defaults = [
    'version:4189',
    'autoJump:false',
    'fullscreen:false',
    `hideGui:${visual.hideGui}`,
    'invertYMouse:false',
    'joinedFirstServer:true',
    'key_key.back:key.keyboard.s',
    'key_key.forward:key.keyboard.w',
    'key_key.jump:key.keyboard.space',
    'key_key.left:key.keyboard.a',
    'key_key.right:key.keyboard.d',
    'lang:en_us',
    'maxFps:120',
    'mouseSensitivity:0.5',
    'onboardAccessibility:false',
    'pauseOnLostFocus:false',
    'perspective:0',
    'rawMouseInput:true',
    `renderDistance:${visual.renderDistance}`,
    `simulationDistance:${visual.simulationDistance}`,
    'skipMultiplayerWarning:true',
    'tutorialStep:none',
  ];

  const managed = new Map(defaults.map((line) => [line.slice(0, line.indexOf(':')), line]));
  const existing = fs.existsSync(options) ? fs.readFileSync(options, 'utf8').split('\n') : [];
  const output = existing
    .filter(Boolean)
    .map((line) => managed.get(line.slice(0, line.indexOf(':'))) ?? line);
  const present = new Set(output.map((line) => line.slice(0, line.indexOf(':'))));
  for (const [key, line] of managed) if (!present.has(key)) output.push(line);
  fs.writeFileSync(options, `${output.join('\n')}\n`);
}
