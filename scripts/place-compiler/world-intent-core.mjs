import { createHash } from 'node:crypto';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EARTH_KM_PER_LATITUDE_DEGREE = 111.32;

function assert(condition, message) {
  if (!condition) throw new Error(`World intent: ${message}`);
}

function finitePositive(value, label) {
  assert(Number.isFinite(value) && value > 0, `${label} must be positive and finite`);
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

export function sha256Value(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export function validateWorldIntent(value, source = '<intent>') {
  assert(value?.schemaVersion === 1, `${source} is not a v1 world intent`);
  assert(SLUG.test(value.id ?? ''), `${source} has an invalid id`);
  assert(
    typeof value.query === 'string' && value.query.trim().length >= 3,
    `${source} needs query`,
  );
  assert(
    typeof value.purpose === 'string' && value.purpose.trim().length >= 10,
    `${source} needs a substantive purpose`,
  );
  assert(
    typeof value.creativeDirection === 'string' && value.creativeDirection.trim().length >= 10,
    `${source} needs creativeDirection`,
  );
  const budget = value.budget;
  finitePositive(budget?.targetAreaKm2, 'budget.targetAreaKm2');
  finitePositive(budget?.maximumAreaKm2, 'budget.maximumAreaKm2');
  assert(budget.targetAreaKm2 <= budget.maximumAreaKm2, 'target area cannot exceed maximum area');
  finitePositive(budget?.maximumSideBlocks, 'budget.maximumSideBlocks');
  finitePositive(budget?.scaleBlocksPerMeter, 'budget.scaleBlocksPerMeter');
  finitePositive(budget?.maximumGenerationMinutes, 'budget.maximumGenerationMinutes');
  finitePositive(budget?.maximumDiskGiB, 'budget.maximumDiskGiB');
  assert(
    Array.isArray(value.requiredQualities) && value.requiredQualities.length > 0,
    `${source} needs requiredQualities`,
  );
  assert(
    value.requiredQualities.every((item) => typeof item === 'string' && item.trim()),
    `${source} requiredQualities must be non-empty strings`,
  );
  return value;
}

export function summarizeNominatimCandidate(candidate, index) {
  const lat = Number(candidate.lat);
  const lon = Number(candidate.lon);
  const rawBounds = candidate.boundingbox?.map(Number);
  assert(
    Number.isFinite(lat) && Number.isFinite(lon),
    `resolver candidate ${index} lacks a center`,
  );
  assert(
    rawBounds?.length === 4 && rawBounds.every(Number.isFinite),
    `resolver candidate ${index} lacks bounds`,
  );
  const [minLat, maxLat, minLon, maxLon] = rawBounds;
  assert(minLat < maxLat && minLon < maxLon, `resolver candidate ${index} has invalid bounds`);
  return {
    rank: index + 1,
    displayName: String(candidate.display_name ?? ''),
    name: String(candidate.namedetails?.name ?? candidate.name ?? candidate.display_name ?? ''),
    center: { lat, lon },
    sourceBounds: { minLat, minLon, maxLat, maxLon },
    osm: {
      type: String(candidate.osm_type ?? ''),
      id: Number(candidate.osm_id),
      category: String(candidate.category ?? candidate.class ?? ''),
      featureType: String(candidate.type ?? ''),
    },
    placeRank: Number(candidate.place_rank ?? 0),
    importance: Number(candidate.importance ?? 0),
    address: candidate.address ?? {},
    names: candidate.namedetails ?? {},
    extraTags: candidate.extratags ?? {},
    geometry: candidate.geojson ?? null,
  };
}

export function chooseResolverCandidate(rawCandidates) {
  assert(
    Array.isArray(rawCandidates) && rawCandidates.length > 0,
    'resolver returned no candidates',
  );
  const candidates = rawCandidates.map(summarizeNominatimCandidate);
  const selected = candidates[0];
  assert(selected.displayName.length > 0, 'selected resolver candidate has no display name');
  return {
    selected,
    candidates,
    decision: {
      kind: 'deterministic-provider-ranking',
      selectedRank: 1,
      authority:
        'Nominatim search order for the complete user query; alternatives are frozen for audit and revision',
      semanticCallRequired: false,
    },
  };
}

function longitudeKmPerDegree(latitude) {
  return Math.max(1, EARTH_KM_PER_LATITUDE_DEGREE * Math.cos((latitude * Math.PI) / 180));
}

function rounded(value) {
  return Number(value.toFixed(7));
}

export function deriveBudgetedBounds(candidate, budget) {
  const latitudeKm = EARTH_KM_PER_LATITUDE_DEGREE;
  const longitudeKm = longitudeKmPerDegree(candidate.center.lat);
  const sourceWidthKm =
    (candidate.sourceBounds.maxLon - candidate.sourceBounds.minLon) * longitudeKm;
  const sourceHeightKm =
    (candidate.sourceBounds.maxLat - candidate.sourceBounds.minLat) * latitudeKm;
  const sourceAspect = Math.min(2, Math.max(0.5, sourceWidthKm / sourceHeightKm));
  const targetAreaKm2 = Math.min(budget.targetAreaKm2, budget.maximumAreaKm2);
  let widthKm = Math.sqrt(targetAreaKm2 * sourceAspect);
  let heightKm = targetAreaKm2 / widthKm;
  const maximumSideKm = budget.maximumSideBlocks / (budget.scaleBlocksPerMeter * 1000);
  const shrink = Math.min(1, maximumSideKm / widthKm, maximumSideKm / heightKm);
  widthKm *= shrink;
  heightKm *= shrink;
  const halfLat = heightKm / latitudeKm / 2;
  const halfLon = widthKm / longitudeKm / 2;
  const bounds = {
    minLat: rounded(candidate.center.lat - halfLat),
    minLon: rounded(candidate.center.lon - halfLon),
    maxLat: rounded(candidate.center.lat + halfLat),
    maxLon: rounded(candidate.center.lon + halfLon),
  };
  const actualWidthKm = (bounds.maxLon - bounds.minLon) * longitudeKm;
  const actualHeightKm = (bounds.maxLat - bounds.minLat) * latitudeKm;
  return {
    bounds,
    derivation: {
      policy: 'centered-budgeted-rectangle-v1',
      sourceWidthKm: Number(sourceWidthKm.toFixed(3)),
      sourceHeightKm: Number(sourceHeightKm.toFixed(3)),
      sourceAspect: Number(sourceAspect.toFixed(4)),
      widthKm: Number(actualWidthKm.toFixed(3)),
      heightKm: Number(actualHeightKm.toFixed(3)),
      areaKm2: Number((actualWidthKm * actualHeightKm).toFixed(3)),
      widthBlocks: Math.round(actualWidthKm * 1000 * budget.scaleBlocksPerMeter),
      heightBlocks: Math.round(actualHeightKm * 1000 * budget.scaleBlocksPerMeter),
      targetAreaKm2,
      constrainedByMaximumSide: shrink < 1,
    },
  };
}

export function buildPlaceSeed(intent, resolution, evidence) {
  validateWorldIntent(intent);
  const { selected, candidates, decision } = chooseResolverCandidate(resolution);
  const geography = deriveBudgetedBounds(selected, intent.budget);
  const identity = {
    intentSha256: sha256Value(intent),
    resolverResponseSha256: evidence.responseSha256,
    selectedOsmType: selected.osm.type,
    selectedOsmId: selected.osm.id,
    bounds: geography.bounds,
    scaleBlocksPerMeter: intent.budget.scaleBlocksPerMeter,
  };
  return {
    schemaVersion: 1,
    kind: 'earth-to-living-world-place-seed',
    seedId: `${intent.id}-${sha256Value(identity).slice(0, 12)}`,
    intent,
    identity,
    resolution: { selected, candidates, decision },
    geography: {
      ...geography,
      projection: 'local',
      rotationDegrees: 0,
      scaleBlocksPerMeter: intent.budget.scaleBlocksPerMeter,
    },
    sourcePolicy: {
      resolver: evidence.resolver,
      resolverRequestSha256: evidence.requestSha256,
      resolverResponseSha256: evidence.responseSha256,
      resolverResponsePath: evidence.responsePath,
      osm: 'freeze exact Overpass response for derived bounds before generation',
      elevation: 'generator-selected provider must be recorded and coverage-tested',
      attribution: '© OpenStreetMap contributors; ODbL 1.0',
    },
    semanticDecisions: [],
    nextRequiredEvidence: [
      'frozen-osm-snapshot',
      'source-coverage-profile',
      'landmark-candidates',
      'spawn-candidates',
      'draft-place-recipe',
    ],
  };
}
