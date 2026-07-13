const AIR = new Set(['air', 'cave_air', 'void_air']);
const WATER = /(^|_)(water|kelp|seagrass|bubble_column)(_|$)/;
const VEGETATION =
  /(leaves|log|wood|grass|fern|flower|sapling|vine|moss|cactus|bamboo|crop|wheat|carrots|potatoes|beetroots|sugar_cane)/;
const HARD_SCAPE =
  /(concrete|terracotta|stone|brick|asphalt|pavement|road|sidewalk|cobblestone|deepslate|andesite|diorite|granite|gravel|sandstone|iron|glass|planks|slab|stairs|fence|door)/;

export function isAir(name) {
  return AIR.has(name);
}

export function classifySurface(name) {
  if (isAir(name)) return 'air';
  if (WATER.test(name)) return 'water';
  if (VEGETATION.test(name)) return 'vegetation';
  if (HARD_SCAPE.test(name)) return 'built';
  if (/(dirt|mud|sand|clay|snow|ice)/.test(name)) return 'terrain';
  return 'other';
}

export function summarizeColumns(columns) {
  const observed = columns.filter(Boolean);
  const valid = observed.filter((column) => Number.isFinite(column.y));
  const counts = {};
  const blocks = {};
  for (const column of valid) {
    counts[column.classification] = (counts[column.classification] ?? 0) + 1;
    blocks[column.block] = (blocks[column.block] ?? 0) + 1;
  }
  const heights = valid.map((column) => column.y);
  const total = valid.length || 1;
  return {
    requestedColumnCount: columns.length,
    observedColumnCount: observed.length,
    surfacedColumnCount: valid.length,
    coverage: observed.length / columns.length,
    surfacedShare: valid.length / columns.length,
    minSurfaceY: heights.length ? Math.min(...heights) : null,
    maxSurfaceY: heights.length ? Math.max(...heights) : null,
    surfaceRelief: heights.length ? Math.max(...heights) - Math.min(...heights) : null,
    classificationCounts: counts,
    classificationShares: Object.fromEntries(
      Object.entries(counts).map(([key, value]) => [key, value / total]),
    ),
    commonBlocks: Object.entries(blocks)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 8)
      .map(([block, count]) => ({ block, count })),
  };
}

export function summarizeTransect(samples) {
  const valid = samples.filter((sample) => Number.isFinite(sample.y));
  let maximumStep = 0;
  let impassableSteps = 0;
  for (let index = 1; index < valid.length; index += 1) {
    const step = Math.abs(valid[index].y - valid[index - 1].y);
    maximumStep = Math.max(maximumStep, step);
    if (step > 1 || valid[index].classification === 'water' || !valid[index].headroom) {
      impassableSteps += 1;
    }
  }
  return {
    requestedSampleCount: samples.length,
    observedSampleCount: valid.length,
    coverage: valid.length / samples.length,
    maximumObservedStep: maximumStep,
    directWalkabilityShare:
      valid.length <= 1 ? null : 1 - impassableSteps / Math.max(1, valid.length - 1),
    waterSampleCount: valid.filter((sample) => sample.classification === 'water').length,
    missingHeadroomCount: valid.filter((sample) => !sample.headroom).length,
  };
}

export function lineSamples(from, to, maximumSamples = 8) {
  const distance = Math.hypot(to.x - from.x, to.z - from.z);
  const count = Math.max(2, Math.min(maximumSamples, Math.ceil(distance / 192) + 1));
  return Array.from({ length: count }, (_, index) => {
    const ratio = index / (count - 1);
    return {
      x: Math.round(from.x + (to.x - from.x) * ratio),
      z: Math.round(from.z + (to.z - from.z) * ratio),
      ratio,
    };
  });
}

export function deriveInspectionDefects(placeId, checkpoints) {
  const defects = [];
  for (const checkpoint of checkpoints) {
    if (checkpoint.centerColumn?.classification !== 'water' || checkpoint.representativeGround)
      continue;
    defects.push({
      id: `${placeId}-${checkpoint.id}-surface-mismatch`,
      severity: 'high',
      dimensions: ['correspondence', 'habitability', 'experience'],
      kind: 'landmark-surface-mismatch-candidate',
      summary: `${checkpoint.name} resolves to water with no nearby standable surface`,
      location: {
        latitude: checkpoint.latitude,
        longitude: checkpoint.longitude,
        x: checkpoint.projected.x,
        z: checkpoint.projected.z,
      },
      evidence: {
        centerColumn: checkpoint.centerColumn,
        surfacedShare: checkpoint.aerialColumnField.surfacedShare,
      },
      qualification:
        'Coordinate-bearing benchmark finding; distinguish checkpoint placement error from generated-world omission before remediation.',
    });
  }
  const biomeIds = new Set(
    checkpoints
      .map((checkpoint) => checkpoint.centerColumn?.biome?.id)
      .filter((biomeId) => Number.isFinite(biomeId)),
  );
  if (checkpoints.length >= 4 && biomeIds.size <= 2) {
    defects.push({
      id: `${placeId}-coarse-checkpoint-biomes`,
      severity: 'medium',
      dimensions: ['ecology', 'experience'],
      kind: 'coarse-biome-diversity-candidate',
      summary: `${checkpoints.length} geographic checkpoints expose only ${biomeIds.size} biome IDs`,
      locations: checkpoints.map((checkpoint) => ({
        checkpointId: checkpoint.id,
        latitude: checkpoint.latitude,
        longitude: checkpoint.longitude,
        x: checkpoint.projected.x,
        z: checkpoint.projected.z,
        biomeId: checkpoint.centerColumn?.biome?.id ?? null,
      })),
      qualification:
        'Sparse checkpoint evidence, not a full-world biome census; ecology soak must test whether this affects native spawning and weather behavior.',
    });
  }
  return defects;
}
