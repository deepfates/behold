#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

function usage() {
  console.error('Usage: generate-canopy-transition.mjs <datapack-root>');
}

if (process.argv.length !== 3) {
  usage();
  process.exit(64);
}

const packRoot = resolve(process.argv[2]);
if (!existsSync(join(packRoot, 'pack.mcmeta'))) {
  throw new Error(`Not a datapack root: ${packRoot}`);
}

const functionRoot = join(packRoot, 'data', 'behold_transition', 'function');
await rm(functionRoot, { recursive: true, force: true });
await mkdir(functionRoot, { recursive: true });

// Both endpoints are clear generated-road columns in the accepted SF world.
// Aerial controls remain above the cluster's highest audited block (Y 143).
const controls = [
  { x: 3010, y: 118.15, z: 7100, yaw: 95, pitch: 12, ticks: 1, role: 'clear-road-start' },
  { x: 3010, y: 185, z: 7100, yaw: 155, pitch: 50, ticks: 60, role: 'vertical-rise' },
  { x: 2950, y: 195, z: 7060, yaw: -125, pitch: 58, ticks: 28, role: 'canopy-reveal-west' },
  { x: 3000, y: 205, z: 7010, yaw: -135, pitch: 55, ticks: 24, role: 'canopy-scale-center' },
  { x: 3054, y: 185, z: 6947, yaw: -139, pitch: 48, ticks: 30, role: 'align-descent' },
  { x: 3054, y: 124.15, z: 6947, yaw: -139, pitch: 10, ticks: 60, role: 'clear-road-descent' },
];

function lerp(from, to, t) {
  return from + (to - from) * t;
}

function lerpAngle(from, to, t) {
  const delta = ((to - from + 540) % 360) - 180;
  return from + delta * t;
}

const frames = [];
for (let controlIndex = 1; controlIndex < controls.length; controlIndex += 1) {
  const from = controls[controlIndex - 1];
  const to = controls[controlIndex];
  for (let tick = 1; tick <= to.ticks; tick += 1) {
    const t = tick / to.ticks;
    frames.push({
      x: lerp(from.x, to.x, t),
      y: lerp(from.y, to.y, t),
      z: lerp(from.z, to.z, t),
      yaw: lerpAngle(from.yaw, to.yaw, t),
      pitch: lerp(from.pitch, to.pitch, t),
      role: to.role,
    });
  }
}

function frameId(index) {
  return `frame_${String(index).padStart(4, '0')}`;
}

await writeFile(
  join(functionRoot, 'start.mcfunction'),
  [
    'gamemode spectator importdf',
    ...frames.map((_, index) => `schedule clear behold_transition:${frameId(index)}`),
    `tp importdf ${controls[0].x} ${controls[0].y} ${controls[0].z} ${controls[0].yaw} ${controls[0].pitch}`,
    'title importdf actionbar {"text":"Directed transition · canopy to city scale","color":"aqua"}',
    `schedule function behold_transition:${frameId(0)} 2s replace`,
  ].join('\n') + '\n',
);

for (let index = 0; index < frames.length; index += 1) {
  const frame = frames[index];
  const next = index + 1 < frames.length ? frameId(index + 1) : 'finish';
  await writeFile(
    join(functionRoot, `${frameId(index)}.mcfunction`),
    [
      `tp importdf ${frame.x.toFixed(4)} ${frame.y.toFixed(4)} ${frame.z.toFixed(4)} ${frame.yaw.toFixed(3)} ${frame.pitch.toFixed(3)}`,
      `schedule function behold_transition:${next} 1t replace`,
    ].join('\n') + '\n',
  );
}

await writeFile(
  join(functionRoot, 'finish.mcfunction'),
  'title importdf actionbar {"text":"Canopy transition complete","color":"aqua"}\n',
);
await writeFile(
  join(functionRoot, 'cancel.mcfunction'),
  [
    ...frames.map((_, index) => `schedule clear behold_transition:${frameId(index)}`),
    'title importdf actionbar {"text":"Canopy transition paused","color":"yellow"}',
  ].join('\n') + '\n',
);

const manifest = {
  schemaVersion: 1,
  recipe: 'scripts/sf-world/generate-canopy-transition.mjs',
  sourceRunId: 'sf-full-v3-snapshot-20260713T095831Z',
  sourceRouteRange: [140, 169],
  highestAuditedClusterBlockY: 143,
  minimumAerialY: 185,
  controls,
  frameCount: frames.length,
  durationSeconds: frames.length / 20,
  mutatesBlocks: false,
};
await writeFile(join(packRoot, 'vertical-transition-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
