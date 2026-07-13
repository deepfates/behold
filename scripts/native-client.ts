import { spawn, spawnSync } from 'node:child_process';
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
const java = path.join(
  minecraftHome,
  'runtime',
  'java-runtime-delta',
  'mac-os-arm64',
  'java-runtime-delta',
  'jre.bundle',
  'Contents',
  'Home',
  'bin',
  'java',
);

for (const required of [manifestPath, clientJar, java]) {
  if (!fs.existsSync(required))
    throw new Error(`Missing installed Minecraft component: ${required}`);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as VersionManifest;
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
writeDefaultOptions(gameDir);

const username = process.env.NATIVE_MC_USERNAME || 'importdf';
const uuid = process.env.NATIVE_MC_UUID || '5eb983c0afc14163a97e19c2a5206f36';
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

function writeDefaultOptions(targetGameDir: string) {
  const options = path.join(targetGameDir, 'options.txt');
  const defaults = [
    'version:4189',
    'autoJump:false',
    'fullscreen:false',
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
    'rawMouseInput:true',
    'renderDistance:8',
    'simulationDistance:6',
    'skipMultiplayerWarning:true',
    'tutorialStep:none',
  ];

  const existing = fs.existsSync(options) ? fs.readFileSync(options, 'utf8') : '';
  const known = new Set(existing.split('\n').map((line) => line.slice(0, line.indexOf(':'))));
  const missingDefaults = defaults.filter((line) => !known.has(line.slice(0, line.indexOf(':'))));
  if (!missingDefaults.length) return;

  const separator = existing && !existing.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(options, `${existing}${separator}${missingDefaults.join('\n')}\n`);
}
