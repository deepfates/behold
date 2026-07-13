# San Francisco world federation alignment

The San Francisco world is a Minecraft world with geographic provenance. It is not a universal world model. This note records the smallest useful seams with adjacent projects so reuse can emerge without coupling their kernels.

## Local authority

Minecraft owns blocks, collision, time, entities, mechanics, and whether an action actually occurred. The accepted Arnis output and its checksummed archive provide the canonical initial block state. A running server owns the live continuation.

The SF pipeline owns geographic inputs, projection metadata, generation evidence, immutable source identity, atlas configuration, disposable stages, route correspondence audits, and reversible presentation overlays. It does not own an inhabitant's beliefs, intentions, or memory.

BlueMap, cinematic splines, and route reports are views. They may reveal or summarize world state; they are not world authority.

## Minimal shared waist

Adjacent systems may exchange this causal shape without sharing domain objects:

```text
scoped observation -> typed proposal -> authority decision -> actual result -> evidence
```

For a non-mutating view such as a route audit, the proposal and decision may be absent. For a presentation overlay, they must be explicit because blocks in a disposable stage change.

The shared envelope needs only stable identity, scope, version, causal references, result status, and evidence locators. Domain payloads remain versioned and local. Do not introduce universal street, citizen, ecology, settlement, camera, or memory classes.

## Local mappings

| System            | What can be reused                                                                                                            | What remains sovereign                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Behold            | Embodied observation, ordinary affordances, serialized intents, verified Minecraft consequences, continuing entity trajectory | Minecraft mechanics and each inhabitant's experience                    |
| SF world pipeline | Geographic projection, immutable world identity, correspondence records, derived navigation layers, reversible stage overlays | Source data meaning and live Minecraft state                            |
| Lync              | Append-only continuity and branch topology                                                                                    | Simulation truth, world mechanics, and resident memory semantics        |
| Armok Lab         | Proposal/result/evidence discipline, content-addressed branching, verifier separation                                         | Dwarf Fortress time, saves, jobs, pathing, and settlement concepts      |
| ALMO              | Persistent multi-agent environment experiments and authored world resources                                                   | Evennia object semantics and its world database                         |
| World Instrument  | Conformance questions, authority boundaries, and evidence-gated claims                                                        | Any renderer, model provider, or pre-existing project as mandatory core |

These are mappings, not dependencies.

## SF records that have earned existence

- **Source-world identity:** binds every derived claim to one immutable generated block tree.
- **Coordinate bridge:** maps geographic coordinates to the accepted world's block coordinates and back.
- **Correspondence observation:** records where a geographic route agrees or disagrees with generated surfaces and collision.
- **Directed view:** turns correspondence evidence into a camera or navigation path for one consumer.
- **Presentation overlay:** an idempotent, reversible set of stage-only changes with preconditions and verification.

Nothing broader is required yet. A general abstraction should be extracted only after at least two distinct consumers need the same semantics and the shared part is smaller than their local adapters.

## Change-rate layers

Keep layers with different rates of change independently replaceable:

1. Frozen geographic inputs and source-world archive
2. Live Minecraft continuation and checkpoints
3. Derived correspondence and navigation data
4. Reversible presentation/ecology overlays
5. Inhabitant controllers and working attention
6. Atlas, game client, films, and other views

A faster layer may reference a slower layer's identity. It must not silently rewrite it.

## Current restraint

Do not make the route audit a runtime dependency of Behold's first life. Do not make cinematic patches part of agent navigation. Do not call a route polyline walkable until collision-valid traversal proves it. Do not call operational event history resident memory. Do not create a cross-project package until a second real integration demonstrates a stable seam.
