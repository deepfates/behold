import { landmarkFamily } from './bootstrap-core.mjs';

export function semanticFinalists(candidates, perFamily = 6) {
  const groups = new Map();
  for (const candidate of candidates) {
    const family = landmarkFamily(candidate);
    const group = groups.get(family) ?? [];
    if (group.length < perFamily) group.push({ ...candidate, family });
    groups.set(family, group);
  }
  const selected = [...groups.values()].flat();
  const unique = new Map(selected.map((candidate) => [candidate.id, candidate]));
  return [...unique.values()].map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    family: candidate.family,
    category: candidate.category,
    evidenceScore: candidate.evidenceScore,
    lat: candidate.lat,
    lon: candidate.lon,
    osm: candidate.osm,
    sourceTags: candidate.sourceTags,
  }));
}

export function validateSemanticSelection(output, landmarkFinalists, arrivalFinalists, count = 8) {
  const landmarkIds = new Set(landmarkFinalists.map((item) => item.id));
  const arrivalIds = new Set(arrivalFinalists.map((item) => item.id));
  if (!Array.isArray(output?.selectedIds) || output.selectedIds.length !== count)
    throw new Error(`semantic selection must contain exactly ${count} landmark ids`);
  if (new Set(output.selectedIds).size !== output.selectedIds.length)
    throw new Error('semantic landmark ids must be unique');
  if (output.selectedIds.some((id) => !landmarkIds.has(id)))
    throw new Error('semantic selection invented a landmark id');
  if (!Array.isArray(output?.arrivalCandidateIds) || output.arrivalCandidateIds.length < 1)
    throw new Error('semantic selection needs at least one arrival candidate');
  if (output.arrivalCandidateIds.some((id) => !arrivalIds.has(id)))
    throw new Error('semantic selection invented an arrival candidate id');
  if (typeof output.rationale !== 'string' || output.rationale.length < 20)
    throw new Error('semantic selection needs a substantive rationale');
  if (typeof output.placeCharacter !== 'string' || output.placeCharacter.length < 20)
    throw new Error('semantic selection needs a substantive place character');
  return output;
}

export function materializeSemanticSelection(output, allCandidates, arrivalCandidates) {
  const byId = new Map(allCandidates.map((item) => [item.id, item]));
  const arrivalsById = new Map(arrivalCandidates.map((item) => [item.id, item]));
  const selected = output.selectedIds.map((id) => byId.get(id));
  const arrivals = output.arrivalCandidateIds.map((id) => arrivalsById.get(id));
  const primaryArrival = arrivals[0];
  if (!selected.some((item) => item.id === primaryArrival.id)) {
    selected[selected.length - 1] = byId.get(primaryArrival.id) ?? primaryArrival;
  }
  return {
    selected: selected.map((item, index) => ({
      ...item,
      family: landmarkFamily(item),
      selectionRank: index + 1,
      selectionPolicy: 'ax-grounded-place-interpretation-v1',
    })),
    arrivals,
  };
}

export function evaluateSemanticRepresentation(materialized, count = 8) {
  const familyCounts = Object.fromEntries(
    [...new Set(materialized.selected.map((item) => item.family))]
      .sort()
      .map((family) => [
        family,
        materialized.selected.filter((item) => item.family === family).length,
      ]),
  );
  const representedFamilyCount = Object.keys(familyCounts).length;
  const maximumFamilyCount = Math.max(0, ...Object.values(familyCounts));
  const checks = [
    {
      id: 'exact-cardinality',
      status: materialized.selected.length === count ? 'green' : 'red',
      evidence: materialized.selected.length,
    },
    {
      id: 'representational-breadth',
      status: representedFamilyCount >= 5 ? 'green' : 'red',
      evidence: { representedFamilyCount, familyCounts },
    },
    {
      id: 'category-concentration',
      status: maximumFamilyCount <= Math.floor(count / 2) ? 'green' : 'red',
      evidence: { maximumFamilyCount, familyCounts },
    },
    {
      id: 'arrival-grounding',
      status: materialized.arrivals.length > 0 ? 'green' : 'red',
      evidence: materialized.arrivals.map((item) => item.id),
    },
  ];
  return {
    status: checks.every((check) => check.status === 'green') ? 'accepted' : 'rejected',
    checks,
  };
}
