const EARTH_RADIUS_METERS = 6_371_000;

function radians(value) {
  return (value * Math.PI) / 180;
}

export function distanceMeters(left, right) {
  const latitude = radians(right.lat - left.lat);
  const longitude = radians(right.lon - left.lon);
  const a =
    Math.sin(latitude / 2) ** 2 +
    Math.cos(radians(left.lat)) * Math.cos(radians(right.lat)) * Math.sin(longitude / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a));
}

function scoreTags(tags) {
  let score = 0;
  let category = null;
  const candidates = [
    ['tourism', ['attraction', 'museum', 'viewpoint', 'gallery'], 80],
    ['historic', null, 76],
    ['amenity', ['townhall', 'university', 'library', 'theatre', 'marketplace'], 72],
    ['man_made', ['tower', 'lighthouse', 'monument'], 68],
    ['natural', ['peak', 'cliff', 'beach'], 64],
    ['railway', ['station', 'halt'], 62],
    ['leisure', ['park', 'nature_reserve', 'garden', 'stadium'], 58],
    ['building', ['civic', 'university', 'train_station', 'church', 'cathedral'], 54],
    ['place', ['square', 'neighbourhood', 'suburb'], 48],
  ];
  for (const [key, accepted, weight] of candidates) {
    if (!tags[key] || (accepted && !accepted.includes(tags[key]))) continue;
    if (weight > score) {
      score = weight;
      category = `${key}:${tags[key]}`;
    }
  }
  if (tags.wikipedia) score += 16;
  if (tags.wikidata) score += 8;
  if (tags.website) score += 2;
  return { score, category };
}

function centers(document) {
  const nodes = new Map();
  const ways = new Map();
  for (const element of document.elements ?? []) {
    if (element.type === 'node' && Number.isFinite(element.lat) && Number.isFinite(element.lon))
      nodes.set(element.id, { lat: element.lat, lon: element.lon });
    if (element.type === 'way') ways.set(element.id, element.nodes ?? []);
  }
  const centerOfNodes = (ids) => {
    const points = ids.map((id) => nodes.get(id)).filter(Boolean);
    if (!points.length) return null;
    return {
      lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
      lon: points.reduce((sum, point) => sum + point.lon, 0) / points.length,
    };
  };
  return (element) => {
    if (element.type === 'node') return nodes.get(element.id) ?? null;
    if (element.type === 'way') return centerOfNodes(element.nodes ?? []);
    if (element.type === 'relation') {
      const ids = (element.members ?? [])
        .filter((member) => member.type === 'way')
        .flatMap((member) => ways.get(member.ref) ?? []);
      return centerOfNodes(ids);
    }
    return null;
  };
}

function inside(point, bounds) {
  return (
    point.lat >= bounds.minLat &&
    point.lat <= bounds.maxLat &&
    point.lon >= bounds.minLon &&
    point.lon <= bounds.maxLon
  );
}

function slug(value) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 56);
}

export function deriveLandmarkCandidates(document, bounds) {
  const centerOf = centers(document);
  const deduplicated = new Map();
  for (const element of document.elements ?? []) {
    const tags = element.tags ?? {};
    if (!tags.name) continue;
    const scored = scoreTags(tags);
    if (!scored.category) continue;
    const point = centerOf(element);
    if (!point || !inside(point, bounds)) continue;
    const candidate = {
      id: `${element.type}-${element.id}`,
      name: tags.name,
      slug: slug(tags.name) || `${element.type}-${element.id}`,
      lat: Number(point.lat.toFixed(7)),
      lon: Number(point.lon.toFixed(7)),
      category: scored.category,
      evidenceScore: scored.score,
      osm: { type: element.type, id: element.id },
      sourceTags: Object.fromEntries(
        [
          'name',
          'amenity',
          'tourism',
          'historic',
          'man_made',
          'natural',
          'railway',
          'leisure',
          'building',
          'place',
          'wikipedia',
          'wikidata',
        ]
          .filter((key) => tags[key])
          .map((key) => [key, tags[key]]),
      ),
    };
    const key = tags.name.toLowerCase().replace(/\W/g, '');
    const previous = deduplicated.get(key);
    if (!previous || candidate.evidenceScore > previous.evidenceScore)
      deduplicated.set(key, candidate);
  }
  return [...deduplicated.values()].sort(
    (left, right) =>
      right.evidenceScore - left.evidenceScore ||
      left.name.localeCompare(right.name) ||
      left.id.localeCompare(right.id),
  );
}

export function landmarkFamily(candidate) {
  const category = candidate.category;
  if (/^(amenity:townhall|amenity:library|amenity:marketplace)/.test(category)) return 'civic';
  if (/^(amenity:university|building:university)/.test(category)) return 'education';
  if (/^railway:/.test(category)) return 'transit';
  if (/^(leisure:|natural:)/.test(category)) return 'landscape';
  if (/^(man_made:|tourism:viewpoint)/.test(category)) return 'vertical';
  if (/^place:/.test(category)) return 'district';
  if (/^(tourism:|historic:|building:church|building:cathedral)/.test(category)) return 'culture';
  return 'other';
}

function intentFamilies(intent) {
  const text = [intent.purpose, intent.creativeDirection, ...(intent.requiredQualities ?? [])]
    .join(' ')
    .toLowerCase();
  const mappings = [
    ['civic', /civic|city|downtown|public life/],
    ['education', /university|campus|education|school/],
    ['landscape', /terrain|hill|mountain|bay|water|river|park|landscape|coast/],
    ['vertical', /view|reveal|skyline|tower|height/],
    ['transit', /station|transit|rail|arrival/],
    ['culture', /history|historic|culture|recognizable|identity|anchor/],
    ['district', /neighborhood|neighbourhood|district/],
  ];
  return mappings.filter(([, pattern]) => pattern.test(text)).map(([family]) => family);
}

function candidateSelectionScore(candidate, selected) {
  const nearest = selected.length
    ? Math.min(...selected.map((item) => distanceMeters(candidate, item)))
    : 0;
  return candidate.evidenceScore + Math.min(30, nearest / 150);
}

export function selectRepresentativeLandmarks(candidates, intent, count = 8, required = []) {
  const selected = [...required];
  const remaining = candidates.filter(
    (candidate) => !required.some((item) => item.id === candidate.id),
  );
  const preferredFamilies = [
    ...intentFamilies(intent),
    'civic',
    'education',
    'landscape',
    'vertical',
    'transit',
    'culture',
    'district',
  ].filter((family, index, all) => all.indexOf(family) === index);
  for (const family of preferredFamilies) {
    if (selected.length >= count || selected.some((item) => landmarkFamily(item) === family))
      continue;
    const choices = remaining
      .filter((candidate) => landmarkFamily(candidate) === family)
      .sort(
        (left, right) =>
          candidateSelectionScore(right, selected) - candidateSelectionScore(left, selected) ||
          left.name.localeCompare(right.name),
      );
    if (!choices.length) continue;
    selected.push(choices[0]);
    remaining.splice(
      remaining.findIndex((item) => item.id === choices[0].id),
      1,
    );
  }
  while (remaining.length && selected.length < count) {
    const ranked = remaining
      .map((candidate) => {
        const familyCount = selected.filter(
          (item) => landmarkFamily(item) === landmarkFamily(candidate),
        ).length;
        return {
          candidate,
          selectionScore: candidateSelectionScore(candidate, selected) - familyCount * 24,
        };
      })
      .sort(
        (left, right) =>
          right.selectionScore - left.selectionScore ||
          right.candidate.evidenceScore - left.candidate.evidenceScore ||
          left.candidate.name.localeCompare(right.candidate.name),
      );
    const winner = ranked[0].candidate;
    selected.push(winner);
    remaining.splice(
      remaining.findIndex((item) => item.id === winner.id),
      1,
    );
  }
  return selected.slice(0, count).map((item, index) => ({
    ...item,
    family: landmarkFamily(item),
    selectionRank: index + 1,
    selectionPolicy: 'intent-aware-category-diversity-v2',
  }));
}

export function spawnCandidates(candidates, center) {
  const categoryWeight = (category) => {
    if (/^leisure:(park|garden)/.test(category)) return 100;
    if (/^place:square/.test(category)) return 96;
    if (/^railway:station/.test(category)) return 82;
    if (/^amenity:townhall/.test(category)) return 78;
    if (/^amenity:university/.test(category)) return 70;
    return 0;
  };
  return candidates
    .filter((item) => categoryWeight(item.category) > 0)
    .map((item) => ({
      ...item,
      spawnScore: Number(
        (
          categoryWeight(item.category) +
          item.evidenceScore * 0.2 -
          Math.min(30, distanceMeters(item, center) / 250)
        ).toFixed(3),
      ),
    }))
    .sort(
      (left, right) =>
        right.spawnScore - left.spawnScore ||
        right.evidenceScore - left.evidenceScore ||
        left.name.localeCompare(right.name),
    )
    .slice(0, 8)
    .map((item, index) => ({
      ...item,
      provisionalRank: index + 1,
      authority:
        'open/public source-derived candidate; generated Minecraft surface and survival remain unproven',
    }));
}

export function sourceProfile(document, areaKm2) {
  const byType = { node: 0, way: 0, relation: 0 };
  let named = 0;
  let tagged = 0;
  for (const element of document.elements ?? []) {
    if (element.type in byType) byType[element.type] += 1;
    if (element.tags && Object.keys(element.tags).length) tagged += 1;
    if (element.tags?.name) named += 1;
  }
  return {
    elementCount: document.elements?.length ?? 0,
    byType,
    taggedElementCount: tagged,
    namedElementCount: named,
    elementsPerKm2: Number(((document.elements?.length ?? 0) / areaKm2).toFixed(2)),
    osmTimestamp: document.osm3s?.timestamp_osm_base ?? null,
    generator: document.generator ?? null,
  };
}

export function draftRecipe(seed, selectedLandmarks, spawns) {
  if (selectedLandmarks.length < 2)
    throw new Error('Bootstrap: fewer than two landmark candidates');
  if (!spawns.length) throw new Error('Bootstrap: no provisional spawn candidate');
  const placeId = slug(seed.resolution.selected.name) || seed.intent.id.replace(/-v\d+$/, '');
  const used = new Map();
  const landmarks = selectedLandmarks.map((item) => {
    const count = (used.get(item.slug) ?? 0) + 1;
    used.set(item.slug, count);
    return {
      id: count === 1 ? item.slug : `${item.slug}-${count}`,
      name: item.name,
      lat: item.lat,
      lon: item.lon,
      source: { osm: item.osm, category: item.category, evidenceScore: item.evidenceScore },
    };
  });
  return {
    schemaVersion: 1,
    id: placeId,
    name: seed.resolution.selected.name,
    toolLock: 'docs/sf-world/tool-lock.json',
    geography: {
      bounds: seed.geography.bounds,
      projection: seed.geography.projection,
      scaleBlocksPerMeter: seed.geography.scaleBlocksPerMeter,
      rotationDegrees: seed.geography.rotationDegrees,
      spawn: { name: spawns[0].name, lat: spawns[0].lat, lon: spawns[0].lon },
    },
    generation: {
      cartographyPolicy: 'literal-v1',
      terrain: true,
      interiors: true,
      overture: false,
      fillGround: true,
      extendedHeight: true,
      bakedLighting: true,
      mapPreview: true,
      startingMap: true,
      gameMode: 'creative',
      worldTime: 6000,
    },
    resources: { generationThreads: 4, nice: 10 },
    runtimeProfiles: ['cinematic', 'playable', 'living'],
    dataSources: {
      resolver: seed.sourcePolicy.resolver,
      osm: { provider: 'OpenStreetMap Overpass', snapshotPolicy: 'frozen-before-generation' },
      elevation: { provider: 'Mapterhorn global terrain' },
      landCover: { provider: 'ESA WorldCover' },
      buildings: { providers: ['OpenStreetMap'] },
    },
    landmarks,
    provenance: {
      kind: 'autonomous-draft',
      placeSeedId: seed.seedId,
      intentId: seed.intent.id,
      spawnStatus: 'provisional-until-minecraft-inspection',
    },
  };
}
