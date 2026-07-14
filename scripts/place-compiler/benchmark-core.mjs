import { existsSync, readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPlaceRecipe, loadRuntimeProfiles, sha256 } from './core.mjs';
import { experienceLandmarks, loadPlaceExperience } from './experience-core.mjs';

const REQUIRED_DIMENSIONS = [
  'correspondence',
  'legibility',
  'habitability',
  'ecology',
  'experience',
  'capacity',
];

function assert(condition, message) {
  if (!condition) throw new Error(`Living Places benchmark: ${message}`);
}

function repositoryPath(root, value, label) {
  assert(
    typeof value === 'string' && value.length > 0 && !path.isAbsolute(value),
    `${label} must be repository-relative`,
  );
  const resolved = path.resolve(root, value);
  assert(
    resolved === root || resolved.startsWith(`${root}${path.sep}`),
    `${label} escapes repository`,
  );
  return resolved;
}

function worldPath(runRoot) {
  const output = path.join(runRoot, 'output');
  assert(existsSync(output), `fixture output is missing: ${output}`);
  const worlds = readdirSync(output).filter((name) => name.startsWith('Arnis World '));
  assert(worlds.length === 1, `expected one world under ${output}; found ${worlds.length}`);
  return path.join(output, worlds[0]);
}

function project(metadata, latitude, longitude) {
  return {
    x: Math.trunc(
      metadata.minMcX +
        ((longitude - metadata.minGeoLon) / (metadata.maxGeoLon - metadata.minGeoLon)) *
          (metadata.maxMcX - metadata.minMcX),
    ),
    z: Math.trunc(
      metadata.minMcZ +
        (1 - (latitude - metadata.minGeoLat) / (metadata.maxGeoLat - metadata.minGeoLat)) *
          (metadata.maxMcZ - metadata.minMcZ),
    ),
  };
}

export async function loadBenchmark(benchmarkPath, repositoryRoot) {
  const absolute = path.resolve(benchmarkPath);
  const benchmark = JSON.parse(readFileSync(absolute, 'utf8'));
  assert(benchmark.schemaVersion === 1, 'unsupported schemaVersion');
  assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(benchmark.id ?? ''), 'invalid benchmark id');
  assert(Array.isArray(benchmark.dimensions), 'dimensions must be an array');
  assert(
    REQUIRED_DIMENSIONS.every((item) => benchmark.dimensions.includes(item)),
    'score vector is missing a required dimension',
  );
  assert(
    new Set(benchmark.dimensions).size === benchmark.dimensions.length,
    'score vector contains duplicates',
  );
  assert(
    Array.isArray(benchmark.fixtures) && benchmark.fixtures.length >= 2,
    'at least two fixtures are required',
  );
  assert(
    Array.isArray(benchmark.profiles) && benchmark.profiles.length >= 3,
    'cinematic, playable, and living profiles are required',
  );
  const profilePath = path.join(repositoryRoot, 'docs/place-compiler/runtime-profiles.json');
  const profiles = loadRuntimeProfiles(profilePath, benchmark.profiles);
  assert(
    profiles.living?.policy?.minecraftAuthoritative === true,
    'living profile must keep Minecraft authoritative',
  );
  assert(
    profiles.living?.policy?.customEcologyRequired === false,
    'living profile cannot require a parallel ecology',
  );
  assert(
    benchmark.ecologySoak?.sprintTicks >= 24000,
    'ecology soak must simulate at least one Minecraft day',
  );
  assert(benchmark.performanceSweep?.repetitions >= 1, 'performance sweep needs repetitions');
  assert(
    Array.isArray(benchmark.refusalRules) && benchmark.refusalRules.length >= 5,
    'refusal rules are incomplete',
  );

  const fixtureIds = new Set();
  const fixtures = [];
  for (const fixture of benchmark.fixtures) {
    assert(!fixtureIds.has(fixture.placeId), `duplicate fixture: ${fixture.placeId}`);
    fixtureIds.add(fixture.placeId);
    const runRoot = repositoryPath(repositoryRoot, fixture.runRoot, `${fixture.placeId}.runRoot`);
    const recipePath = repositoryPath(
      repositoryRoot,
      fixture.recipePath,
      `${fixture.placeId}.recipePath`,
    );
    assert(existsSync(runRoot), `fixture run root is missing: ${fixture.runRoot}`);
    assert(
      (await sha256(recipePath)) === fixture.recipeSha256,
      `${fixture.placeId} recipe digest mismatch`,
    );
    const { recipe } = loadPlaceRecipe(recipePath);
    assert(recipe.id === fixture.placeId, `${fixture.placeId} recipe identity mismatch`);
    const generationPath = path.join(runRoot, 'generation-manifest.json');
    const treePath = path.join(runRoot, 'evidence', 'world-checksums.json');
    assert(
      existsSync(generationPath) && existsSync(treePath),
      `${fixture.placeId} evidence manifests are missing`,
    );
    const generation = JSON.parse(readFileSync(generationPath, 'utf8'));
    const tree = JSON.parse(readFileSync(treePath, 'utf8'));
    assert(
      generation.runId === fixture.runId && generation.status === 'generated',
      `${fixture.placeId} generation identity or status mismatch`,
    );
    assert(
      generation.inputs?.sha256 === fixture.inputSha256,
      `${fixture.placeId} input digest mismatch`,
    );
    assert(
      tree.treeSha256 === fixture.worldTreeSha256,
      `${fixture.placeId} world-tree digest mismatch`,
    );
    assert(tree.fileCount === fixture.worldFileCount, `${fixture.placeId} file count mismatch`);
    assert(
      tree.totalSizeBytes === fixture.worldSizeBytes,
      `${fixture.placeId} world size mismatch`,
    );
    const world = worldPath(runRoot);
    assert(
      !existsSync(path.join(world, 'session.lock')),
      `${fixture.placeId} immutable source is locked`,
    );
    const metadataPath = path.join(world, 'metadata.json');
    assert(existsSync(metadataPath), `${fixture.placeId} metadata is missing`);
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
    assert(
      metadata.projection === recipe.geography.projection,
      `${fixture.placeId} projection mismatch`,
    );
    assert(
      metadata.scale === recipe.geography.scaleBlocksPerMeter,
      `${fixture.placeId} scale mismatch`,
    );
    let experience = null;
    let experiencePath = null;
    if (fixture.experiencePath) {
      experiencePath = repositoryPath(
        repositoryRoot,
        fixture.experiencePath,
        `${fixture.placeId}.experiencePath`,
      );
      assert(
        typeof fixture.experienceSha256 === 'string' &&
          (await sha256(experiencePath)) === fixture.experienceSha256,
        `${fixture.placeId} experience digest mismatch`,
      );
      experience = loadPlaceExperience(experiencePath, recipe);
    }
    const checkpoints = experienceLandmarks(recipe, experience).map((landmark) => ({
      ...landmark,
      ...project(metadata, landmark.lat, landmark.lon),
    }));
    assert(
      checkpoints.every(
        (item) =>
          item.x >= metadata.minMcX &&
          item.x <= metadata.maxMcX &&
          item.z >= metadata.minMcZ &&
          item.z <= metadata.maxMcZ,
      ),
      `${fixture.placeId} checkpoint projects outside world`,
    );
    fixtures.push({
      ...fixture,
      runRoot,
      recipePath,
      world,
      metadataPath,
      metadata,
      checkpoints,
      experience,
      experiencePath,
    });
  }
  return { path: absolute, benchmark, profiles, fixtures };
}

export function hardwareFingerprint() {
  return {
    platform: process.platform,
    architecture: process.arch,
    release: os.release(),
    hostname: os.hostname(),
    cpuModel: os.cpus()[0]?.model ?? 'unknown',
    logicalCpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    node: process.version,
  };
}

export const benchmarkDimensions = REQUIRED_DIMENSIONS;
