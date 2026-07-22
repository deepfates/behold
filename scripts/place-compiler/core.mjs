import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import path from 'node:path';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function finite(value, label) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
  return value;
}

function relativeRepositoryPath(value, label) {
  if (typeof value !== 'string' || value.length === 0 || path.isAbsolute(value)) {
    throw new Error(`${label} must be a non-empty repository-relative path`);
  }
  const normalized = path.normalize(value);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`${label} escapes the repository`);
  }
  return normalized;
}

export function validatePlaceRecipe(value, source = '<recipe>') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${source} must contain a JSON object`);
  }
  if (value.schemaVersion !== 1) throw new Error(`${source} has unsupported schemaVersion`);
  if (!SLUG.test(value.id ?? '')) throw new Error(`${source} has an invalid place id`);
  if (typeof value.name !== 'string' || value.name.trim().length === 0) {
    throw new Error(`${source} is missing name`);
  }
  const bounds = value.geography?.bounds;
  const minLat = finite(bounds?.minLat, 'geography.bounds.minLat');
  const minLon = finite(bounds?.minLon, 'geography.bounds.minLon');
  const maxLat = finite(bounds?.maxLat, 'geography.bounds.maxLat');
  const maxLon = finite(bounds?.maxLon, 'geography.bounds.maxLon');
  if (!(minLat < maxLat) || !(minLon < maxLon)) throw new Error(`${source} has inverted bounds`);
  if (minLat < -90 || maxLat > 90 || minLon < -180 || maxLon > 180) {
    throw new Error(`${source} has bounds outside latitude/longitude limits`);
  }
  const spawn = value.geography?.spawn;
  finite(spawn?.lat, 'geography.spawn.lat');
  finite(spawn?.lon, 'geography.spawn.lon');
  if (spawn.lat < minLat || spawn.lat > maxLat || spawn.lon < minLon || spawn.lon > maxLon) {
    throw new Error(`${source} spawn is outside its bounds`);
  }
  if (value.geography.projection !== 'local') {
    throw new Error(`${source} currently requires Arnis local projection`);
  }
  if (!(finite(value.geography.scaleBlocksPerMeter, 'geography.scaleBlocksPerMeter') > 0)) {
    throw new Error(`${source} scale must be positive`);
  }
  finite(value.geography.rotationDegrees, 'geography.rotationDegrees');
  const landmarks = value.landmarks;
  if (!Array.isArray(landmarks) || landmarks.length < 2) {
    throw new Error(`${source} needs at least two geographic validation landmarks`);
  }
  const landmarkIds = new Set();
  for (const landmark of landmarks) {
    if (!SLUG.test(landmark?.id ?? '') || landmarkIds.has(landmark.id)) {
      throw new Error(`${source} has an invalid or duplicate landmark id`);
    }
    landmarkIds.add(landmark.id);
    finite(landmark.lat, `landmark ${landmark.id} latitude`);
    finite(landmark.lon, `landmark ${landmark.id} longitude`);
    if (
      landmark.lat < minLat ||
      landmark.lat > maxLat ||
      landmark.lon < minLon ||
      landmark.lon > maxLon
    ) {
      throw new Error(`${source} landmark ${landmark.id} is outside bounds`);
    }
  }
  relativeRepositoryPath(value.toolLock, 'toolLock');
  if (!Array.isArray(value.runtimeProfiles) || value.runtimeProfiles.length === 0) {
    throw new Error(`${source} must select at least one runtime profile`);
  }
  for (const profile of value.runtimeProfiles) {
    if (!SLUG.test(profile)) throw new Error(`${source} has invalid runtime profile ${profile}`);
  }
  const settings = value.generation;
  for (const key of [
    'terrain',
    'interiors',
    'overture',
    'fillGround',
    'extendedHeight',
    'bakedLighting',
    'mapPreview',
    'startingMap',
  ]) {
    if (typeof settings?.[key] !== 'boolean')
      throw new Error(`${source} generation.${key} must be boolean`);
  }
  if (!['creative', 'survival'].includes(settings.gameMode)) {
    throw new Error(`${source} has unsupported gameMode`);
  }
  if (!Number.isSafeInteger(settings.worldTime) || settings.worldTime < 0) {
    throw new Error(`${source} has invalid worldTime`);
  }
  return value;
}

export function loadPlaceRecipe(recipePath) {
  const absolute = path.resolve(recipePath);
  return {
    path: absolute,
    recipe: validatePlaceRecipe(JSON.parse(readFileSync(absolute, 'utf8')), absolute),
  };
}

export function loadRuntimeProfiles(profilePath, selected) {
  const absolute = path.resolve(profilePath);
  const document = JSON.parse(readFileSync(absolute, 'utf8'));
  if (document.schemaVersion !== 1 || !document.profiles || typeof document.profiles !== 'object') {
    throw new Error(`Malformed runtime profile document: ${absolute}`);
  }
  return Object.fromEntries(
    selected.map((id) => {
      const profile = document.profiles[id];
      if (!profile) throw new Error(`Unknown runtime profile: ${id}`);
      return [id, profile];
    }),
  );
}

function booleanArgument(arguments_, enabled, positive, negative = null) {
  if (enabled) arguments_.push(positive);
  else if (negative) arguments_.push(negative);
}

export function compileArnisArguments(recipe, outputRoot, osmJson, useSnapshot) {
  const { geography, generation } = recipe;
  const { bounds, spawn } = geography;
  const arguments_ = [
    '--output-dir',
    outputRoot,
    '--bbox',
    `${bounds.minLat},${bounds.minLon},${bounds.maxLat},${bounds.maxLon}`,
    '--scale',
    String(geography.scaleBlocksPerMeter),
    '--projection',
    geography.projection,
  ];
  booleanArgument(arguments_, generation.terrain, '--terrain');
  arguments_.push(`--interior=${generation.interiors}`);
  arguments_.push(`--overture=${generation.overture}`);
  booleanArgument(arguments_, generation.fillGround, '--fillground');
  booleanArgument(arguments_, generation.extendedHeight, '--disable-height-limit');
  booleanArgument(arguments_, generation.bakedLighting, '--bake-lighting');
  booleanArgument(arguments_, generation.mapPreview, '--map-preview');
  arguments_.push(`--map-item=${generation.startingMap}`);
  arguments_.push('--gamemode', generation.gameMode);
  arguments_.push('--world-time', String(generation.worldTime));
  arguments_.push('--spawn-lat', String(spawn.lat));
  arguments_.push(`--spawn-lng=${spawn.lon}`);
  arguments_.push('--rotation', String(geography.rotationDegrees));
  arguments_.push(useSnapshot ? '--file' : '--save-json-file', osmJson);
  return arguments_;
}

export async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

export function timestamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

export function recipeSnapshot(recipe, recipePath, recipeSha256, runtimeProfiles) {
  return {
    id: recipe.id,
    name: recipe.name,
    recipePath,
    recipeSha256,
    geography: recipe.geography,
    generation: recipe.generation,
    dataSources: recipe.dataSources,
    landmarks: recipe.landmarks,
    runtimeProfiles,
  };
}
