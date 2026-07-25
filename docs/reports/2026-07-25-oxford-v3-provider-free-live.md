# Oxford V3 provider-free live boundary

Date: 2026-07-25

## Verdict

Two scripted Mineflayer residents inhabited a fresh derived runtime of the
exact privacy-safe Oxford V3 release through
`minecraft-human-semantic-v1`. The real Minecraft 1.21.4 server started, both
residents joined behind the all-ready barrier, each looked, walked, spoke in
public chat, and retained a fourth observation turn in authenticated Lync
history. Both controllers and the server then exited cleanly. No model or
provider request occurred.

This is a mechanics proof, not a behavioral experiment or model comparison.
The residents were deterministic scripts, the server used local offline-mode
authentication, and the viewer was deliberately disabled.

## Exact identities

- Place Compiler revision:
  `81fd4f49de5306ed8fc79cd6561d8577056437e2`
- Behold admission implementation: `3fa018f`
- Behold frozen-state stabilization: `c93283e`
- Oxford artifact-preservation tree:
  `1cde506e1c2300db610d9111a8c36789eb970d8fc7a2e407403109d56167d48d`
- Oxford release identity:
  `01c06fd10aa60c42ee691ab2562810a3ff79bd21f9fd0475aefba2995e842166`
- Behold epoch identity and content-bound world suffix:
  `b5899b49cfb2cfa38f3b4e1dbb039bba9e375db13e0c3df4fe3f56b67c2a6d60`
- World/circle:
  `oxford-b5899b49cfb2cfa38f3b4e1dbb039bba9e375db13e0c3df4fe3f56b67c2a6d60`
- Managed run:
  `oxford-b5899b49cfb2cfa38f3b4e1dbb039bba9e375db13e0c3df4fe3f56b67c2a6d60-1`
- Release epoch:
  `c70e7f59d73293249e2248d1ef0e611942eb75bf792034901f96a1460df14fb6`
- Release digest:
  `d15bbcc41ee7183a8292198611e7f56d4e0630251b20eed78a7475a0e3f5e292`

The source release was re-snapshotted after shutdown at the same
artifact-preservation digest. The admitted epoch identity also remained
unchanged. All world mutations were confined to the writable derived runtime.

## What happened in the world

Minecraft loaded Oxford as `Arnis World 1` in survival mode with the admitted
living profile. Aster and Birch joined near one another at the Oxford spawn.
The release barrier kept the game frozen until both residents had loaded their
local world, submitted their setup observations, and armed the same release.
The durable claims record the real sequential observation order: Aster first,
Birch second. The lifecycle does not pretend those observations were
simultaneous.

After release:

- Aster looked left, moved forward about 2.15 blocks, and said
  `Aster says hello from Oxford.`
- Birch looked right, moved forward about 2.37 blocks, and said
  `Birch says hello from Oxford.`
- Both action triples returned authenticated successful outcomes.
- Both final observation windows contained the other resident's public chat.
- Aster's semantic first-person field perceived glass, polished andesite,
  stone-brick stairs, and a stone-brick wall. It also recorded spawn,
  condition, visibility, pressure-plate sound, and chat events.
- Birch perceived end-stone-brick stairs, mud bricks, oak leaves, and polished
  andesite, plus spawn, condition, pressure-plate sound, and chat events.

Each resident has four Lync turns in one loom: `look_direction`,
`move_controls`, `chat`, and `wait_for_event`. Authenticated range reads bind
all eight turns to the Oxford content-bound circle, the same release epoch,
and the body/action profile `minecraft-human-semantic-v1`. Every observation
and next-observation passed the no-oracle projection check: no absolute
coordinates, stable world/run identity, hidden entity IDs, path/navigation
conclusions, support/pickup-ground conclusions, registry/recipe planning data,
projects, places, tasks, controller state, or evaluation state appeared.

## Resource and lifecycle evidence

- Provider fetches: 0
- Broker accepted/admitted calls: 0 / 0
- Captured provider attempts: 0
- Resident-decision quota used: 0 for each resident
- Fold quota used: 0 for each resident
- Tokens and cost: 0 / $0
- Controller exits: both code 0
- Server exit: code 0
- Final lifecycle event: `control_released`
- Lifecycle chain tip:
  `e8eb532872302ff6027da09622d25ee5367458ee749b6c68f7e63135ff678fae`

The successful run also exercised the stabilization introduced in `c93283e`.
After the population armed, six authenticated digest passes detected ordinary
Minecraft region/POI files changing while being read. Attempts seven and eight
then produced the same complete frozen-runtime digest
`f6430b65e4beb1e2adefa70afa00bf9cfb9b350829c5378a38efc0e3bf564f6a`,
which became the released world state. No incomplete hash was admitted.

## Failures retained honestly

The first post-`c93283e` disposable attempt reached the server but Lync rejected
the proof script's noncanonical turn IDs. That was a harness error; the IDs
were corrected to the existing `${entityId}:turn:${sequence}` contract before
the recorded run.

In the recorded run, the complete live path and clean shutdown succeeded, but
the harness's post-run checker then read `life.circleId` instead of
`life.reference.circleId`. It therefore labelled its stop reason
`oxford_v3_live_failed` after the residents had already quiesced. The
authenticated offline evidence replay corrected only that field access and
passed the Lync, release, body, lifecycle, quota, transport, source-immutability,
and epoch-identity checks. Its immutable JSON report is:

`/Users/deepfates/Hacking/github/deepfates/behold/.behold-runtime/oxford-v3-live/oxford-v3-live-20260725e/oxford-v3-live.json`

Report SHA-256:
`2d64e9dfdcde3a2a37f556acb045377b1a6f93a06eecefe26a9e7f23b87075df`.

The evidence is sufficient for the live admission boundary. It does not claim
that a paid/free model route works, that the current body produces interesting
long-running behavior, or that the current owner watch/read experience is
ready.
