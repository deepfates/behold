# Minecraft-Legible Living Places v1

Minecraft-Legible Living Places v1 is accepted. One shared, deterministic cartography policy was
selected on Presidio, Lower Manhattan, and Venice calibration windows, then applied without
place-specific compiler logic to San Francisco and the previously unseen transfer place Berkeley.
Both outputs are playable Minecraft 1.21.4 worlds with measured arrivals, real ground traversal,
native ecology, atlases, independently verified release closure, and a shared human-visit contract.

## Acceptance result

| Requirement     | San Francisco hero                                                 | Berkeley transfer                                                  |
| --------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Canonical world | `c3e476071eee935150928b6f6d9ec4c81d1a5d30b0256da66ced5b094736b71b` | `74d9760d58e283101920f54273277a0e856fb636f2009113f98b0a4955d51046` |
| Arrival         | Civic Center, accepted support and headroom                        | Ohlone Park, accepted support and headroom                         |
| Audited route   | 98.248% swept traversable; 568 samples                             | 99.588% swept traversable                                          |
| Visit proof     | 111.03 blocks, five observed waypoints                             | 39.13 blocks, three observed waypoints                             |
| Reveal          | Sutro to Golden Gate, clear at +2                                  | Lawrence Hall to Ohlone Park, clear at +32                         |
| Vanilla ecology | 24,000 ticks at 328 effective TPS                                  | 24,000 ticks at 421 effective TPS                                  |
| Atlas           | 1,333 files, 174,665,318 bytes                                     | 15,968 files, 1,689,023,627 bytes                                  |
| Release         | schema v3, all 840/6/132 archive entries verified                  | schema v3, all 98/6/133 archive entries verified                   |

The visit-set verifier re-derived both plans from
`docs/place-compiler/visits/minecraft-legible-living-places-v1.json` and verified the exact world
identities, observed arrival blocks, every successful Minecraft path search, measured reveal,
guide and map closure, progress sequence, evidence hashes, clean server shutdowns, and the required
native-client capture. The accepted report hashes are:

- San Francisco: `201fb1ed80d5d7609ab82a3a178c987a90f29f1ddb6eb097c6149c58cff74a82`
- Berkeley: `2523b0da523b3e67520e44c5e5d3233dd23d74869071b02c476c273c9c7a8a09`

The 32-second San Francisco movie is 1280x828 H.264, 72,350,915 bytes, with SHA-256
`2f7a5d5e20beb6616342147b5d01c91cedc063811316a142020b231640f37381`. Its proof lane first
completes the accepted arrival, embodied route, and clear sightline off camera. Its presentation
lane then shows a smooth low street traversal and a masked vertical downtown reveal; cinematic
composition is evidence-bound but is not allowed to alter the canonical proof plan.

## Reproducibility and package boundary

Each release contains an immutable world, generation evidence, and a reproduction kit. The kit
closes over frozen OSM bytes, recipe, tool lock, official Arnis source archive, both local patches,
build manifest, build and test commands, and the exact generator binary
`4b50682348f6de2f1f63ba1e6be6eade96f5f4a6a9fed9b39dc28dec2bfce853`. Independent release
verification streams every archive member and recomputes the closure rather than trusting the
manifest.

The honest reproducibility promise is frozen inputs and toolchain plus semantic, structural,
route, visual, and packaged-world evidence. Arnis currently emits nondeterministic palette/NBT
serialization, so a fresh compile is not promised to be byte-identical at the raw Anvil-file level.
That limitation is recorded rather than hidden behind a normalizer or mock.

## Architecture boundary

The place compiler owns Earth data acquisition, projection, deterministic cartography policy,
world compilation, spatial evidence, runtime profiles, and release closure. Minecraft remains the
authority for weather, daylight, spawning, movement, and entity lifecycle. Behold identities,
minds, authored patches, global Earth coordinates, and imagined-world sources can attach through
the existing place/world contracts; none is a dependency of this v1 acceptance.

## Known frontiers

- Eight of 568 San Francisco route samples remain unresolved near Lands End. They are localized
  and explicit; the accepted route is not claimed to be perfectly continuous city-wide.
- Vanilla 32-chunk rendering cannot show all of San Francisco from one observer. The atlas provides
  the complete overview; distant in-client terrain remains a presentation-mod frontier.
- The overview atlas deliberately omits high-resolution tiles to keep full-city rendering bounded.
  Berkeley retains the high-resolution comparison artifact.
- Building interiors and source-map fidelity are only as complete as the available OSM and Arnis
  conversion. This milestone proves a reusable place pipeline, not a photogrammetric Earth twin.

The repository gate passes TypeScript, ESLint, and all 243 tests after the final artifacts and
verifier-compatible presentation split.
