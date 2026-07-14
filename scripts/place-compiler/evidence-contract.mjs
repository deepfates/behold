function unique(values, label) {
  const result = [...new Set(values)];
  if (result.length !== values.length) throw new Error(`duplicate ${label}`);
  return result;
}

export function deriveEvidencePlan({
  benchmark,
  fixtures,
  performanceProfiles = null,
  repetitions = benchmark.performanceSweep.repetitions,
}) {
  const placeIds = unique(
    fixtures.map((fixture) => fixture.placeId),
    'place id',
  );
  const profileIds = unique(
    performanceProfiles ?? benchmark.performanceSweep.profiles,
    'performance profile id',
  );
  if (!placeIds.length) throw new Error('evidence plan requires at least one place');
  if (!profileIds.length)
    throw new Error('evidence plan requires at least one performance profile');
  if (!Number.isInteger(repetitions) || repetitions < 1)
    throw new Error('evidence plan repetitions must be a positive integer');

  const inspection = placeIds.map((placeId) => `${placeId}:inspection`);
  const ecology = placeIds.map((placeId) => `${placeId}:ecology`);
  const performance = placeIds.flatMap((placeId) =>
    profileIds.flatMap((profileId) =>
      Array.from(
        { length: repetitions },
        (_, index) => `${placeId}:${profileId}:performance:r${index + 1}`,
      ),
    ),
  );
  return {
    schemaVersion: 1,
    kind: 'place-compiler-evidence-plan',
    benchmarkId: benchmark.id,
    places: placeIds,
    performanceProfiles: profileIds,
    repetitions,
    lanes: { inspection, ecology, performance },
    expectedCaseCount: inspection.length + ecology.length + performance.length,
  };
}

export function laneExpectation(plan, lane) {
  const cases = plan.lanes[lane];
  if (!cases) throw new Error(`unknown evidence lane: ${lane}`);
  return { lane, expectedCaseIds: cases, expectedCaseCount: cases.length };
}
