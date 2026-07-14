function check(id, passed, evidence) {
  return { id, status: passed ? 'green' : 'red', evidence };
}

export function evaluateQualityFixture(fixture, ecology, inspection) {
  const experience = fixture.experience;
  if (!experience) throw new Error(`Quality loop: ${fixture.placeId} has no experience policy`);
  if (ecology.placeId !== fixture.placeId || inspection.placeId !== fixture.placeId)
    throw new Error(`Quality loop: ${fixture.placeId} evidence identity mismatch`);
  const deaths = ecology.observerLifecycle?.deathMessages?.length ?? 0;
  const nativeTicks = ecology.after.gametime - ecology.before.gametime;
  const arrival = experience.arrival;
  const checks = [
    check(
      'declared-arrival-observed',
      ecology.observationSite.checkpointId === arrival.checkpointId,
      ecology.observationSite.checkpointId,
    ),
    check('native-day-covered', nativeTicks >= arrival.acceptance.minimumNativeTicks, nativeTicks),
    check('arrival-survival', deaths <= arrival.acceptance.maximumObserverDeaths, deaths),
    check(
      'minecraft-authoritative',
      ecology.assertions.minecraftAuthoritative && ecology.assertions.nativeRulesEnabled,
      ecology.assertions,
    ),
    check('clean-shutdown', ecology.shutdown?.clean === true, ecology.shutdown),
  ];

  for (const override of experience.checkpointOverrides ?? []) {
    const observed = inspection.checkpoints.find((item) => item.id === override.checkpointId);
    checks.push(
      check(
        `checkpoint-override:${override.checkpointId}`,
        observed?.latitude === override.lat &&
          observed?.longitude === override.lon &&
          observed?.representativeGround &&
          observed.representativeGround.classification !== 'water',
        observed ?? null,
      ),
    );
  }
  return {
    placeId: fixture.placeId,
    status: checks.every((item) => item.status === 'green') ? 'green' : 'red',
    checks,
    frontiers: [
      ...(ecology.findings ?? []).map((finding) => ({ lane: 'ecology', ...finding })),
      ...(inspection.defects ?? []).map((finding) => ({ lane: 'inspection', ...finding })),
    ],
  };
}
