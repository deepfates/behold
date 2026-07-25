# Human-comparable semantic Minecraft body

## Status and identity

`minecraft-human-semantic-v1` is the ratified body contract for Behold's first
serious comparative experiments. It is a transparent semantic interface to
ordinary Minecraft perception, UI, and character controls. It is not a claim
that a text model receives pixels or presses hardware keys.

The contract has two versioned surfaces:

- observation protocol `behold.minecraft-human-semantic-observation.v1`;
- action profile `minecraft-human-semantic-v1`.

The authoritative `behold.inhabitant.v2` observation remains private to the
body adapter, causal journal, admission fence, and verifier. A mind never needs
the raw frame to use this contract.

## Observation contract

The semantic observation may expose information an ordinary player can obtain
from the current first-person view or standard UI:

- visible block, entity, held-item, and dropped-item kinds;
- a coarse egocentric material/depth field made only from unoccluded camera
  rays;
- the current crosshair focus, with qualitative proximity;
- chat and other perceivable local events;
- health, food, breath bubbles, sleep and dimension state;
- held item, inventory names/counts, and the server roster as semantic versions
  of ordinary inventory/HUD/Tab UI;
- loss counters and causal sequence anchors needed to say when the bounded
  observation is incomplete.

It must not expose:

- absolute world coordinates, yaw/pitch, velocity vectors, exact distances, or
  numeric bearings;
- native UUIDs, managed-run/world identity, stable entity ids, or block ids
  containing dimension and coordinates;
- loaded-world geometry, pathfinding state, reachability conclusions, support
  or hazard conclusions such as `pickupGround`, or registry-derived item-use
  advice;
- controller state, projects, places, conflicts, or evaluator evidence;
- action availability that reveals hidden prerequisites or classifies the
  current focus beyond what is semantically perceived.

References such as `visible-entity-1` are observation-local labels only. They
must not remain stable across frames or encode server identity.

## Action contract

One action may provide bounded ergonomic motor assistance when its entire
meaning is visible in the action name and parameters and it does not choose a
goal, route, target, recovery, or plan.

Allowed v1 action grain:

- send chat or whisper;
- turn the view by a named egocentric increment;
- hold one movement direction and optional jump/sprint/sneak controls for a
  bounded duration, always releasing controls on completion or cancellation;
- stop current bodily input;
- swing once at the entity under the crosshair;
- dig the currently focused reachable block without automatic approach;
- place the held block against the face currently under the crosshair without
  selecting support or repositioning;
- use the currently focused block once;
- inspect or transfer items through the currently focused container;
- equip, drop, or consume an item named in ordinary inventory UI;
- sleep in the currently focused bed or wake from sleep;
- explicitly yield for another event.

The profile excludes absolute `move_to`, entity approach/pursuit, automatic
item collection, bounded fight loops, exact-target orientation, autonomous
dig/placement approach, crafting-table discovery, recipe selection, remembered
door routes, project management, and privileged sensing.

The body adapter may privately bind a focus action to the exact raw target in
the admitted frame and re-check it immediately before execution. That is a
causal stale-target fence, not information supplied to the mind.

## Causal kernel left unchanged

The body contract does not weaken:

- exact request/decision hash binding and schema validation;
- one admitted action per decision and one physical intent per body;
- stale observation and stale target rejection;
- engine authorization, serialization, cancellation acknowledgement, and
  authenticated matching terminal events;
- Minecraft-confirmed block, body, inventory, container, sleep, and collection
  consequences;
- world/body leases, append-only entity turns, journals, save, stop, and resume.

## Named treatments outside the body

`resident-v1` prompt strategy, `manage_project`, project/place projections,
behavioral loop breakers, CSDR permissions, `resident-safe-v1`, loom folds,
urgent-attention policy, tasks, and tool allowlists are separate named
treatments. They do not become part of `minecraft-human-semantic-v1` merely
because a product resident uses both.

## Narrow implementation and test plan

1. Add a required body-profile identity to new mind requests and managed-run
   evidence while retaining legacy parsing.
2. Project current, historical, urgent-continuity, and fold inputs through the
   same human-semantic sanitizer. Reject or invalidate folds produced for a
   different projection profile.
3. Add the fixed human-semantic action allowlist and cursor/control actions.
   Bind focus actions to the raw admitted observation internally, then re-check
   the current cursor before execution.
4. Make neutral evaluation default to the human-semantic body, vanilla risk,
   and the matching action profile. Retain old profiles as explicitly named
   legacy/product treatments.
5. Add conformance tests proving forbidden coordinates, stable ids, geometry
   conclusions, registry uses, project/place/controller fields, pathfinder
   macros, and hidden focus classification cannot enter a mind request.
6. Add action tests proving movement never invokes pathfinder, controls clear on
   success and abort, focus changes fail closed, and block/container effects use
   the existing consequence verifiers.
7. Keep experiment-control work body-neutral: per-resident/per-purpose budgets,
   an armed all-ready barrier, exact media-ready transport evidence, and
   explicit fold/context/operator/native-human intervention records.

Pixel input and raw inventory-screen clicking are intentionally outside v1.
Their later addition must use content-addressed frame evidence and the same
causal action boundary rather than widening this semantic contract silently.
