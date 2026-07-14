# Living Places human visit v1

The human-visit flow now runs unchanged across San Francisco, Lower Manhattan, and Venice. It derives its itinerary from the accepted Living Places v3 fixture, experience, inspection, route, sightline, and map evidence; no city has a private visit script.

## Human contract

Every materialized visit includes a Markdown guide, a machine-readable guide, a checksummed checkpoint map, and three ordinary player triggers:

- `/trigger place_visit set 1` — measured safe arrival
- `/trigger place_visit set 2` — start of the collision-audited ground leg
- `/trigger place_visit set 3` — measured city reveal

Joining and using these controls requires neither an agent nor operator status. The production runner separately connects `VisitProof`, a deterministic Mineflayer observer rather than a Behold inhabitant, to verify that the advertised stages work against the real Minecraft server.

## Canonical proof

| Place           | Arrival       |    Real ground traversal | Reveal                         | Capture                       |
| --------------- | ------------- | -----------------------: | ------------------------------ | ----------------------------- |
| San Francisco   | Civic Center  | 39.0 blocks, 4 waypoints | Sutro Tower to Golden Gate, +2 | 18.6 s H.264 Minecraft window |
| Lower Manhattan | City Hall     | 54.4 blocks, 5 waypoints | One World Trade to Battery, +2 | not required                  |
| Venice          | Rialto Bridge | 79.8 blocks, 4 waypoints | Rialto to Arsenal, +32         | not required                  |

All twelve waypoint transitions produced successful Minecraft path searches with no digging, parkour, or one-by-one towers. All three servers saved and stopped cleanly. The San Francisco capture is 1280×828, 1,080 frames, and 30,679,386 bytes with SHA-256 `d731aca96d9e77a39277346c67ebb7c2b6bd468cad754ecd4811f1f6920292fa`.

The canonical report digests are:

- San Francisco captured v5: `1b1955ae23fd69c4db5f16a0dc7b78442b3a9c5dba250da51077840b666fb93c`
- Lower Manhattan canonical v1: `78c478a0d041459616e65df451ec0b99b4c9b08e262733a5874af62e886a0602`
- Venice canonical v1: `af8f2b70620103006aa9fcbb14f97ec7c51f675d31c8a3307a3f49d76976b710`

`verify-visit.mjs` re-derives each plan from the accepted contract and independently checks world identity, arrival support/headroom, every pathfinder result and observed waypoint, reveal position, map identity, runtime binding, guide closure, progress sequence, server ready/join/save/stop evidence, capture claims, and every evidence digest. The exact three-place set passes with capture required.

## Reusable corrections found by the real loop

The first Manhattan run hung before producing a path search. A server-side forced chunk was not sufficient evidence that the client observer had received that chunk. The shared policy now moves the observer to the selected corridor, force-loads every audited waypoint chunk, waits for those columns in the client world, and gives each waypoint a distance-scaled deadline with path/reset/position diagnostics.

The first capture attempt timed out because Swift source compilation happened inside the recording deadline. The runner now compiles the ScreenCaptureKit helper before server launch. The isolated native client uses a generic offline identity, platform-aware Java resolution, 32 render chunks, 10 simulation chunks, explicit presentation settles, and clean signal forwarding.

## Honest limits

- The movie is a compact proof visit, not the earlier full Windmill-to-Ferry bicycle film.
- The Sutro-to-Golden-Gate result proves a clear voxel sightline. Vanilla 32-chunk rendering cannot display a target more than 7,000 blocks away; Distant Horizons remains a separate presentation capability.
- The route legs prove bounded embodied movement, not continuous walkability for each complete city-scale route.
- The proof observer validates the human contract but is not an AI villager, Behold identity, or ecology simulation.
