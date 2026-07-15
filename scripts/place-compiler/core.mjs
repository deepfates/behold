import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const CARTOGRAPHY_POLICIES = Object.freeze(['literal-v1', 'minecraft-legible-v1']);

function finite(value, label) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
}

export function validatePlaceRecipe(recipe, source = '<recipe>') {
  if (!recipe || typeof recipe !== 'object' || recipe.schemaVersion !== 1)
    throw new Error(`${source} is not a v1 place recipe`);
  if (!SLUG.test(recipe.id ?? '')) throw new Error(`${source} has an invalid place id`);
  if (typeof recipe.name !== 'string' || !recipe.name.trim())
    throw new Error(`${source} is missing name`);
  if (path.isAbsolute(recipe.toolLock ?? '') || String(recipe.toolLock ?? '').startsWith('..'))
    throw new Error(`${source} toolLock must be repository-relative`);
  const { bounds, spawn } = recipe.geography ?? {};
  for (const [key, value] of Object.entries({
    ...bounds,
    spawnLat: spawn?.lat,
    spawnLon: spawn?.lon,
  }))
    finite(value, key);
  if (!(bounds.minLat < bounds.maxLat && bounds.minLon < bounds.maxLon))
    throw new Error(`${source} has inverted bounds`);
  if (
    spawn.lat < bounds.minLat ||
    spawn.lat > bounds.maxLat ||
    spawn.lon < bounds.minLon ||
    spawn.lon > bounds.maxLon
  )
    throw new Error(`${source} spawn is outside bounds`);
  if (recipe.geography.projection !== 'local' || !(recipe.geography.scaleBlocksPerMeter > 0))
    throw new Error(`${source} has unsupported projection or scale`);
  finite(recipe.geography.rotationDegrees, 'rotationDegrees');
  if (!Array.isArray(recipe.landmarks) || recipe.landmarks.length < 2)
    throw new Error(`${source} needs at least two landmarks`);
  const ids = new Set();
  for (const landmark of recipe.landmarks) {
    if (!SLUG.test(landmark.id ?? '') || ids.has(landmark.id))
      throw new Error(`${source} has invalid or duplicate landmark id`);
    ids.add(landmark.id);
    finite(landmark.lat, `${landmark.id}.lat`);
    finite(landmark.lon, `${landmark.id}.lon`);
    if (
      landmark.lat < bounds.minLat ||
      landmark.lat > bounds.maxLat ||
      landmark.lon < bounds.minLon ||
      landmark.lon > bounds.maxLon
    )
      throw new Error(`landmark ${landmark.id} is outside bounds`);
  }
  if (!Array.isArray(recipe.runtimeProfiles) || !recipe.runtimeProfiles.length)
    throw new Error(`${source} needs runtime profiles`);
  for (const key of [
    'terrain',
    'interiors',
    'overture',
    'fillGround',
    'extendedHeight',
    'bakedLighting',
    'mapPreview',
    'startingMap',
  ])
    if (typeof recipe.generation?.[key] !== 'boolean')
      throw new Error(`${source} generation.${key} must be boolean`);
  recipe.generation.cartographyPolicy ??= 'literal-v1';
  if (!CARTOGRAPHY_POLICIES.includes(recipe.generation.cartographyPolicy))
    throw new Error(
      `${source} generation.cartographyPolicy must be one of ${CARTOGRAPHY_POLICIES.join(', ')}`,
    );
  if (
    !['creative', 'survival'].includes(recipe.generation.gameMode) ||
    !Number.isSafeInteger(recipe.generation.worldTime)
  )
    throw new Error(`${source} has invalid game settings`);
  if (
    !Number.isSafeInteger(recipe.resources?.generationThreads) ||
    recipe.resources.generationThreads < 1
  )
    throw new Error(`${source} has invalid generationThreads`);
  return recipe;
}

export function loadPlaceRecipe(recipePath) {
  const absolute = path.resolve(recipePath);
  return {
    path: absolute,
    recipe: validatePlaceRecipe(JSON.parse(readFileSync(absolute, 'utf8')), absolute),
  };
}

export function loadRuntimeProfiles(profilePath, selected) {
  const document = JSON.parse(readFileSync(profilePath, 'utf8'));
  if (document.schemaVersion !== 1 || !document.profiles)
    throw new Error(`Malformed runtime profiles: ${profilePath}`);
  return Object.fromEntries(
    selected.map((id) => {
      if (!document.profiles[id]) throw new Error(`Unknown runtime profile: ${id}`);
      return [id, document.profiles[id]];
    }),
  );
}

export function compileArnisArguments(recipe, outputRoot, osmJson, snapshot) {
  const { geography: geo, generation: gen } = recipe;
  const args = [
    '--output-dir',
    outputRoot,
    '--bbox',
    `${geo.bounds.minLat},${geo.bounds.minLon},${geo.bounds.maxLat},${geo.bounds.maxLon}`,
    '--scale',
    String(geo.scaleBlocksPerMeter),
    '--projection',
    geo.projection,
    '--cartography-policy',
    gen.cartographyPolicy,
  ];
  if (gen.terrain) args.push('--terrain');
  args.push(`--interior=${gen.interiors}`, `--overture=${gen.overture}`);
  if (gen.fillGround) args.push('--fillground');
  if (gen.extendedHeight) args.push('--disable-height-limit');
  if (gen.bakedLighting) args.push('--bake-lighting');
  if (gen.mapPreview) args.push('--map-preview');
  args.push(
    `--map-item=${gen.startingMap}`,
    '--gamemode',
    gen.gameMode,
    '--world-time',
    String(gen.worldTime),
    '--spawn-lat',
    String(geo.spawn.lat),
    `--spawn-lng=${geo.spawn.lon}`,
    '--rotation',
    String(geo.rotationDegrees),
    snapshot ? '--file' : '--save-json-file',
    osmJson,
  );
  return args;
}

export async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function directoryManifest(root) {
  const absolute = path.resolve(root);
  const files = [];
  const visit = (relative = '') => {
    const directory = path.join(absolute, relative);
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const child = path.join(relative, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile()) files.push(child);
      else throw new Error(`unsupported directory entry: ${path.join(absolute, child)}`);
    }
  };
  visit();
  const tree = createHash('sha256');
  let totalSizeBytes = 0;
  const entries = [];
  for (const relative of files) {
    const file = path.join(absolute, relative);
    const sizeBytes = statSync(file).size;
    const digest = await sha256(file);
    const portablePath = relative.split(path.sep).join('/');
    entries.push({ path: portablePath, sizeBytes, sha256: digest });
    totalSizeBytes += sizeBytes;
    tree.update(`${digest}  ${sizeBytes}  ${portablePath}\n`);
  }
  return {
    fileCount: entries.length,
    totalSizeBytes,
    treeSha256: tree.digest('hex'),
    entries,
  };
}

export function timestamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}
