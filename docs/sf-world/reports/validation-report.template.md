# San Francisco world validation report

Status: draft

Run ID: `TBD`

Generation manifest: `TBD`

## Decision

- [ ] Accepted as immutable source
- [ ] Rejected
- [ ] Accepted with documented deviations

Decision owner: `TBD`

Decision date: `TBD`

Summary: `TBD`

## Generator and artifact identity

| Field                | Value         |
| -------------------- | ------------- |
| Arnis version        | TBD           |
| Arnis binary SHA-256 | TBD           |
| Minecraft version    | 1.21.4        |
| Projection           | TBD           |
| Scale                | 1 block/meter |
| World canonical path | TBD           |
| World size           | TBD           |
| World tree SHA-256   | TBD           |

## Generation measurements

| Measurement                    | Value                 |
| ------------------------------ | --------------------- |
| Geographic area                | Approximately 207 km² |
| Minecraft dimensions           | TBD                   |
| Download time                  | TBD                   |
| Generation time                | TBD                   |
| Peak memory                    | TBD                   |
| Stream-to-disk activated       | TBD                   |
| Warnings or provider fallbacks | TBD                   |

## Compatibility gates

- [ ] `level.dat`, region files, `metadata.json`, preview, and expected datapacks exist
- [ ] `metadata.json` bounds, projection, and scale match the manifest
- [ ] Minecraft Java 1.21.4 opens the disposable validation copy
- [ ] Extended height works without clipping or corruption
- [ ] The server saves, stops, and restarts successfully
- [ ] The native client connects, renders, flies, and teleports successfully
- [ ] BlueMap renders the full validation copy
- [ ] BlueMap lighting is acceptable without the missing-light fallback, or the fallback is explicitly accepted
- [ ] Latitude/longitude to Minecraft X/Z round trips stay within the recorded tolerance

## Coordinate bridge checks

| Place              | Latitude | Longitude | Expected X | Expected Z | Actual X | Actual Z | Round-trip error | Pass |
| ------------------ | -------: | --------: | ---------: | ---------: | -------: | -------: | ---------------: | ---- |
| Civic Center spawn |  37.7793 | -122.4193 |        TBD |        TBD |      TBD |      TBD |              TBD | TBD  |
| Ocean Beach        |      TBD |       TBD |        TBD |        TBD |      TBD |      TBD |              TBD | TBD  |
| Ferry Building     |      TBD |       TBD |        TBD |        TBD |      TBD |      TBD |              TBD | TBD  |
| Twin Peaks         |      TBD |       TBD |        TBD |        TBD |      TBD |      TBD |              TBD | TBD  |
| Treasure Island    |      TBD |       TBD |        TBD |        TBD |      TBD |      TBD |              TBD | TBD  |

## Distributed landmark and neighborhood checks

| Place                       | Latitude | Longitude | Expected X/Z | Actual X/Z | Terrain | Roads | Water | Major structures | Recognizable | Notes |
| --------------------------- | -------: | --------: | ------------ | ---------- | ------- | ----- | ----- | ---------------- | ------------ | ----- |
| Ocean Beach                 |      TBD |       TBD | TBD          | TBD        | TBD     | TBD   | TBD   | TBD              | TBD          | TBD   |
| Golden Gate Park            |      TBD |       TBD | TBD          | TBD        | TBD     | TBD   | TBD   | TBD              | TBD          | TBD   |
| Presidio                    |      TBD |       TBD | TBD          | TBD        | TBD     | TBD   | TBD   | TBD              | TBD          | TBD   |
| Golden Gate Bridge          |      TBD |       TBD | TBD          | TBD        | TBD     | TBD   | TBD   | TBD              | TBD          | TBD   |
| Marina                      |      TBD |       TBD | TBD          | TBD        | TBD     | TBD   | TBD   | TBD              | TBD          | TBD   |
| Fisherman's Wharf           |      TBD |       TBD | TBD          | TBD        | TBD     | TBD   | TBD   | TBD              | TBD          | TBD   |
| Chinatown                   |      TBD |       TBD | TBD          | TBD        | TBD     | TBD   | TBD   | TBD              | TBD          | TBD   |
| Financial District          |      TBD |       TBD | TBD          | TBD        | TBD     | TBD   | TBD   | TBD              | TBD          | TBD   |
| Civic Center                |      TBD |       TBD | TBD          | TBD        | TBD     | TBD   | TBD   | TBD              | TBD          | TBD   |
| SoMa                        |      TBD |       TBD | TBD          | TBD        | TBD     | TBD   | TBD   | TBD              | TBD          | TBD   |
| Mission                     |      TBD |       TBD | TBD          | TBD        | TBD     | TBD   | TBD   | TBD              | TBD          | TBD   |
| Castro                      |      TBD |       TBD | TBD          | TBD        | TBD     | TBD   | TBD   | TBD              | TBD          | TBD   |
| Twin Peaks                  |      TBD |       TBD | TBD          | TBD        | TBD     | TBD   | TBD   | TBD              | TBD          | TBD   |
| Haight-Ashbury              |      TBD |       TBD | TBD          | TBD        | TBD     | TBD   | TBD   | TBD              | TBD          | TBD   |
| Sunset                      |      TBD |       TBD | TBD          | TBD        | TBD     | TBD   | TBD   | TBD              | TBD          | TBD   |
| Richmond                    |      TBD |       TBD | TBD          | TBD        | TBD     | TBD   | TBD   | TBD              | TBD          | TBD   |
| Bernal Heights              |      TBD |       TBD | TBD          | TBD        | TBD     | TBD   | TBD   | TBD              | TBD          | TBD   |
| Bayview/Hunters Point       |      TBD |       TBD | TBD          | TBD        | TBD     | TBD   | TBD   | TBD              | TBD          | TBD   |
| Excelsior/Visitacion Valley |      TBD |       TBD | TBD          | TBD        | TBD     | TBD   | TBD   | TBD              | TBD          | TBD   |
| Embarcadero                 |      TBD |       TBD | TBD          | TBD        | TBD     | TBD   | TBD   | TBD              | TBD          | TBD   |
| Treasure/Yerba Buena Island |      TBD |       TBD | TBD          | TBD        | TBD     | TBD   | TBD   | TBD              | TBD          | TBD   |
| Alcatraz                    |      TBD |       TBD | TBD          | TBD        | TBD     | TBD   | TBD   | TBD              | TBD          | TBD   |

## Citywide checks

- [ ] No neighborhood-sized missing swaths
- [ ] No repeated, shifted, or corrupted regions
- [ ] No unacceptable elevation or land-cover seams
- [ ] Downtown is not clipped vertically
- [ ] Shoreline and water are coherent and navigable
- [ ] Overture enrichment did not hit an unreviewed cap or disappear silently
- [ ] External 3D models and props do not introduce severe corruption
- [ ] Spawn is above ground and safe
- [ ] Creative mode, commands, operator access, and flight work

## Atlas checks

| Field                       | Value |
| --------------------------- | ----- |
| BlueMap version             | TBD   |
| Binary SHA-256              | TBD   |
| Render duration             | TBD   |
| Render size                 | TBD   |
| Missing-light fallback used | TBD   |
| Landmark markers            | TBD   |
| Neighborhood shape markers  | TBD   |

## Defects and deviations

| ID  | Severity | Place or subsystem | Evidence | Decision | Owner |
| --- | -------- | ------------------ | -------- | -------- | ----- |
| TBD | TBD      | TBD                | TBD      | TBD      | TBD   |

## Final notes

`TBD`
