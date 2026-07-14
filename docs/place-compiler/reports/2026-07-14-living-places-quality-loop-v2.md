# Living Places v2 quality loop

Living Places v2 accepts both immutable city artifacts for a natural-Minecraft arrival experience while retaining the remaining generation-quality frontiers as explicit evidence. The result is `accepted-with-frontiers`, not an unqualified all-green claim.

## Reusable repair

Generation recipes and accepted world trees remain unchanged. Each place may instead bind a small, independently hashed experience policy that selects a recipe landmark as the measured natural arrival, declares a one-native-day survival threshold, may correct an acceptance checkpoint without changing generation identity, and may declare an honest presentation transition when the artifact does not support the intended ground experience.

The benchmark refuses missing or changed experience digests. The quality verifier checks report digests, case completeness, arrival identity, native elapsed ticks, deaths, Minecraft authority, clean shutdown, and any checkpoint override against real inspection evidence.

## Measured result

| Place           | Arrival      | Native ticks | Deaths | Effective TPS | Result |
| --------------- | ------------ | -----------: | -----: | ------------: | ------ |
| San Francisco   | Civic Center |       24,016 |      0 |           492 | green  |
| Lower Manhattan | City Hall    |       24,014 |      0 |           421 | green  |

Both runs kept daylight, weather, random ticks, and mob spawning under Minecraft authority. No lighting overlay, peaceful mode, entity clearing, custom ecology, or source-world mutation was used.

The corrected Lower Manhattan bridge approach inspected as built `smooth_stone` with headroom instead of water. San Francisco's Golden Gate span remains geographically legible but only 67.77% swept-ground traversable in the route audit, so its experience policy declares an aerial transition rather than pretending the accepted artifact supports a clean ground crossing.

## Retained frontiers

- Both safe arrivals remain hostile-dominated in the bounded 128-block end-of-day sample. This is a scoped ecology-quality candidate, not evidence of arrival failure or a world-wide census.
- Sparse checkpoint inspection still exposes only two biome IDs in each city. This remains an ecology/experience generation frontier.
- The San Francisco Golden Gate center still resolves to water and the swept crossing is discontinuous. The defect is narrowed and the presentation contract is honest, but generation is not repaired.

## Evidence and reproduction

The local evidence roots are:

- `.behold-artifacts/place-benchmarks/living-places-v2/foundry-v2-quality-loop-ecology-v1`
- `.behold-artifacts/place-benchmarks/living-places-v2/foundry-v2-quality-loop-inspection-v1`

Verify them with:

```sh
node scripts/place-compiler/verify-quality-loop.mjs \
  docs/place-compiler/benchmarks/living-places-v2.json \
  .behold-artifacts/place-benchmarks/living-places-v2/foundry-v2-quality-loop-ecology-v1 \
  .behold-artifacts/place-benchmarks/living-places-v2/foundry-v2-quality-loop-inspection-v1
```

These run roots remain noncanonical working evidence until the release ticket assembles them into a digest-closed evidence set.
