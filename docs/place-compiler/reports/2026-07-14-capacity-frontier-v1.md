# Living City capacity frontier v1

This capacity evidence separates five concepts that must not be collapsed into “agents”: geographically separated active regions, connected protocol bodies, persistent native Minecraft entities, the subset running full vanilla villager cognition, and Behold/LLM inhabitants. The measured runs contain zero Behold inhabitants and zero inference workload.

## Independent axes

All cases use a real Minecraft 1.21.4 server over the accepted San Francisco world. Natural spawning is disabled only for the controlled experiment, preexisting non-player entities are cleared in the disposable clone, and persistent invulnerable villagers are counted before and after the tick sprint. Every case saves, stops, restarts, reloads each active region through protocol clients, verifies persistence, cleans up, and stops again.

| Condition       | Regions | Protocol bodies | Native bodies | Full villager brains | Effective TPS |
| --------------- | ------: | --------------: | ------------: | -------------------: | ------------: |
| Baseline        |       1 |               1 |             0 |                    0 |        13,916 |
| Wide world      |       3 |               3 |             0 |                    0 |        12,640 |
| Protocol load   |       3 |              16 |             0 |                    0 |         4,227 |
| Protocol load   |       3 |              32 |             0 |                    0 |         2,508 |
| Urban villagers |       3 |               3 |           128 |                  128 |            45 |
| Urban villagers |       3 |               3 |           512 |                  512 |            11 |
| Combined        |       3 |              16 |           128 |                  128 |            42 |
| Combined        |       3 |              16 |           256 |                  256 |            19 |

Three active regions are Civic Center, Sutro Tower, and the Ferry Building, separated by thousands of blocks. Declared simulation-distance chunk unions, observed protocol-loaded chunks, and atlas/client render reach remain distinct fields.

## Causal decomposition

The expensive axis is full vanilla villager cognition, not entity persistence or protocol presence.

| Controlled arena     | Native bodies | Full villager brains | Effective TPS |
| -------------------- | ------------: | -------------------: | ------------: |
| Cognition dormant    |           128 |                    0 |         6,634 |
| Cognition dormant    |           512 |                    0 |         1,418 |
| Flat, spaced full AI |           128 |                  128 |            51 |
| Flat, spaced full AI |           256 |                  256 |            27 |

Moving full-AI villagers from dense generated city geometry to flat two-block-spaced arenas improves throughput by roughly 13–42%, depending on the comparison. Disabling their vanilla brains improves throughput by roughly two orders of magnitude. Villager brain, navigation, and pathfinding work therefore dominates ordinary entity bookkeeping in this test.

## Tiered population proof

| Persistent native population | Full villager brains active | Effective TPS | Realtime headroom |
| ---------------------------: | --------------------------: | ------------: | ----------------: |
|                        1,024 |                           0 |           645 |            32.25× |
|                        2,048 |                           0 |           333 |            16.65× |
|                        2,048 |                         128 |            43 |             2.15× |
|                        2,048 |                         256 |            25 |             1.25× |

All 2,048 entities remained count-identical through sprint, save, stop, restart, region reload, and cleanup. This establishes a real lower bound for persistent embodied substrate with a bounded full-AI subset on this machine.

It does **not** prove 2,048 Behold inhabitants, 2,048 simultaneous pathfinders, or 2,048 concurrent LLM calls. A scalable inhabitant design should avoid stacking vanilla villager brains underneath external controllers. It can keep a large persistent native-body population dormant or cheaply deterministic, activate ordinary Minecraft cognition only where desired, and separately budget Behold decisions and inference by relevance, proximity, and available time.

## Resource and operational evidence

Each case records Java and long-lived Node harness RSS/CPU separately, per-client loaded chunks, liveness and kick/error events, server diagnostics, tick wall time, controlled entity counts, and both shutdowns. The long-lived harness reports starting RSS and peak increase because absolute RSS may retain chunk data from earlier client cases.

The causal runs are independently verifiable with:

```bash
node scripts/place-compiler/verify-capacity.mjs \
  .behold-artifacts/place-capacity/san-francisco/foundry-v2-capacity-frontier-v1/capacity-manifest.json \
  .behold-artifacts/place-capacity/san-francisco/foundry-v2-capacity-combined-refinement-v1/capacity-manifest.json \
  .behold-artifacts/place-capacity/san-francisco/foundry-v2-capacity-causal-noai-v1/capacity-manifest.json \
  .behold-artifacts/place-capacity/san-francisco/foundry-v2-capacity-causal-ai-arena-v1/capacity-manifest.json \
  .behold-artifacts/place-capacity/san-francisco/foundry-v2-capacity-tiered-activation-v1/capacity-manifest.json
```

The original 512-villager diagnostic restart used only central forced chunks and therefore undercounted unloaded wanderers. Runtime before/after counts and the below-realtime result remain valid, but persistence claims rely on the corrected reload audit used by the causal and tiered runs.
