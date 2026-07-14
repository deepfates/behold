# Resident affordances

The Behold interface should feel like inhabiting Minecraft, not operating a
Minecraft database. We should not discover it one benchmark verb at a time.
This note is the forward model we use to decide what belongs.

## The contract stays small

The stable loop is:

1. the resident receives bounded lived evidence;
2. the world/body adapter publishes the actions supported by that exact observation;
3. the resident chooses one intelligible next action;
4. a body skill carries that choice through Minecraft mechanics;
5. Minecraft returns a terminal result;
6. later observation establishes the consequence;
7. the resident's own Lync preserves the trajectory.

Cantrip's useful lesson is that the medium, gates, and wards determine the
available action space. Lync preserves autobiography. World Instrument's
proposal/outcome distinction reinforces that a model proposal is not yet a
world fact. None of those projects needs to define Minecraft verbs for Behold.

## What earns a resident affordance

An affordance belongs on the normal resident surface only when all of these are
true:

- A Minecraft player would recognize the sensation or intention without
  protocol vocabulary.
- The choice depends only on this body's current view, body, inventory,
  remembered experience, or communication it actually received.
- Any multi-tick implementation preserves the resident's choice rather than
  choosing a new goal for it.
- It is bounded, interruptible, and ends with an explicit success, failure, or
  uncertainty.
- It changes no more of the world than an ordinary player could change.
- Minecraft or a later independent observation—not the model's prose—decides
  what happened.

Exact yaw radians, loaded-chunk scans, server entity tables, and bulk geometry
inspection fail this test. They remain operator or evaluation instruments.

## The player-shaped coverage frame

The native client's controls and Mineflayer's API reduce to a small basis at
the level of player intention. This is a coverage frame, not a claim that every
Minecraft activity is implemented. We should fill its missing cells and
compose from it instead of adding a verb for every benchmark story.

| Family            | What the resident experiences or chooses                                                   | Body implementation                                                      |
| ----------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Attend            | Current camera view, crosshair target, sounds, body/HUD, inventory, chat, and new events   | Bounded observation and attention wakeups                                |
| Orient            | Turn left/right/around, look up/down/level, face a visible or remembered target            | Mineflayer `look` / `lookAt`                                             |
| Locomote          | Walk relative to the current view, go to a known place, approach a perceived being, stop   | Controls plus bounded pathfinding                                        |
| Manipulate        | Mine the targeted block, place/use the held item, operate the targeted block, drop/pick up | Mineflayer dig/place/activate/inventory calls                            |
| Care for the body | Equip, eat, sleep, wake, escape danger, recover after death                                | Inventory and body APIs plus short reactive skills                       |
| Fight             | Engage or disengage one perceived target                                                   | Bounded pursuit, legal attack timing, death/escape/interruption terminal |
| Make              | Read available recipes, craft, use nearby workstations and containers                      | Minecraft recipe and window transactions                                 |
| Relate            | Speak, whisper, listen, offer, give, receive                                               | Minecraft chat and ordinary item/world consequences                      |
| Yield             | Wait for a relevant world event without pretending the world stopped                       | Controller suspension while Minecraft continues                          |

The frame also tells us what does _not_ need to become a separate model tool.
Sprint, sneak, jump, hotbar selection, mouse-button duration, legal attack
timing, and ordinary path corrections can remain body mechanics while they
serve one admitted intention. They become resident choices only when the
distinction itself matters—for example, deliberately sneaking at an edge or
choosing whether to flee rather than fight.

Projects, remembered places, relationships, and commitments are not extra
Minecraft powers. They are sparse projections over the resident's own history
that help it choose among the same player affordances after a restart.

Project completion is therefore a resident conclusion, not an omniscient
verdict. It must be grounded in the resident's own post-start consequence, and
is recorded with `authority: inhabitant` and `worldStateCertified: false`.
An evaluator may separately certify a stronger property such as exact enclosure,
but its loaded-block scan does not enter the resident's observation or replay.
Legacy `space_enclosed` turns remain readable for immutable-history and place
compatibility; a current resident must repair such an active project to an
ordinary evidence channel or abandon it. New construction uses
`world_change`, which remembers only a built-or-modified site. Learning doors,
interiors, and shelter affordances through ordinary looking and movement is an
honest remaining gap, not a reason to restore symbolic topology as a sense.

## The executable offer boundary

The stable catalog names everything a body implementation can ever attempt.
It is not the prompt for every moment. For each observation, the world adapter
publishes a subset through `actionsFor(observation)` and narrows inputs to exact
current entity, block, inventory, roster, or own-memory references. The generic
controller may further restrict that set for authorization or urgent attention,
but it does not discover Minecraft objects or mechanics.

Current camera rays retain a bounded list of exact first-hit block targets.
`face_visible_target` can orient toward one selected visible surface after
freshly checking its id and name, and must confirm the same block under the
cursor afterward. It does not find an object, choose which object matters,
approach it, or use it. Cursor-gated skills appear only after that separately
observable relation is true. This is a target language shared by doors and
future block interactions, not a block ontology or a new verb per material.

The offer compiler now applies the same rule beyond doors. Inventory stacks
publish their native item uses from the active registry plus Mineflayer's
ordinary consume rules; empty or inapplicable inventory removes eating,
equipment, dropping, placement, and crafting fiction. Digging, toggles,
containers, and beds require an exact reachable cursor block, and their schemas
carry that one current position. Sleeping and waking follow the body's current
state. Operator `status`, cursor probes, and raw coordinate looking are not
resident choices because the lived observation already contains their ordinary
information.

Affordances also have a closing time. Newly urgent bodily attention now carries
a five-second default decision budget and only three recent committed turns in
a 6 KB continuity envelope. The controller aborts a cooperative slow mind at
the deadline and reobserves instead of admitting an indefinitely late proposal.
That is a failure boundary, not yet a fast survival constitution: live evidence
must still determine whether model routing can close in time or whether the mind
needs a transparent local reaction layer.

Run 41 showed the other half of closing time. A 19.239-second `move_to` leg kept
the body while Wren was attacked, so urgent cognition did not begin until the
action failed and health had fallen from 20 to 11.17. The engine now lets a
newly bodily-urgent lived event terminalize a queued model-owned action before
dispatch or request cancellation of one already in flight. An in-flight action
still owns the body until its adapter's acknowledged terminal, then the resident
reobserves. The world does not choose the response, and human-owned actions are
never seized by this rule.

## Primitive versus body skill

The model should not choose every keyboard tick, but a body skill must not
become a hidden planner. A useful rule is:

> One resident choice may cover the reactive work a human would perform while
> holding one intention, but it may not silently choose the resident's next
> intention.

Walking one bounded leg, pursuing one visible creature, collecting one selected
stack, fighting one selected threat, or crossing one known doorway can be body
skills. Choosing a destination, a resource, a building design, a collaborator,
or whether to keep fighting belongs to the resident.

## Current coverage, including the future game

This is the forward-looking census. “Partial” means we can already perform
ordinary examples but have not covered the whole native family.

| Player family                              | Current status               | Important missing native experiences                                                                                      |
| ------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Seeing, hearing, HUD, and events           | Partial                      | exact-camera visual evidence; more legible obstruction and interaction feedback                                           |
| Looking and facing                         | Live-proven basic coverage   | decide when images are worth their cost; face selected visible targets consistently                                       |
| Walking and exploration                    | Live-proven walk and swim    | vertical swimming and climbing; intentional sneak/sprint when meaningful                                                  |
| Breaking, placing, and ordinary use        | Partial                      | carry the exact visible-target language through mine/place/use; held-item use rather than block-specific controller verbs |
| Inventory, equipment, pickup, and drop     | Strong basic coverage        | offhand and inventory arrangement only when gameplay makes them meaningful                                                |
| Crafting and storage                       | Partial                      | furnace, brewing, smithing, anvil, enchanting, and other real workstation transactions                                    |
| Food, sleep, hazards, death, and recovery  | Live-proven bounded recovery | continuous survival competence, varied hazards, and recovery across long lives                                            |
| Creatures and combat                       | Partial                      | independently proven sustained combat; feed, breed, tame, leash, fish, and ordinary entity use                            |
| Villagers and multiplayer relations        | Partial                      | inspect/select trades, exchange/gifts with witnessed transfer, longer collaboration                                       |
| Books, signs, maps, and built culture      | Red                          | read/write native artifacts and understand visual builds without an oracle                                                |
| Vehicles and world traversal               | Red                          | mount/dismount, boats/minecarts, portals/dimensions, and later elytra                                                     |
| Projects, places, commitments, and restart | Strong core                  | evidence from longer lives and multiple concurrent residents                                                              |

Mineflayer already exposes real Minecraft mechanisms for many red cells,
including generic block/entity/item activation, furnaces, enchanting, anvils,
villager trading, fishing, books, and mounting. That is encouraging: much of
the frontier is interface design and verification over native mechanics, not a
parallel game implementation.

## Current Behold surface

What is already sound:

- first-person entity visibility, bounded semantic terrain rays, sound,
  body/HUD/inventory, source provenance, event cursors, and gap reporting;
- exact resident identity, world/epoch admission, action ownership,
  interruption, save/stop, restart, and private Lync;
- bounded movement, collection, combat, digging, placing, doors, crafting,
  containers, eating, sleeping, chat, and independently witnessed consequence;
- privileged scans and raw controls are excluded from the normal mind.
- non-resident action inputs and results remain in the authoritative audit
  history but are omitted from resident restart replay and urgent continuity.

What remains red, in priority order:

1. **View-complete orientation.** A resident could face a known point but could
   not naturally turn to reveal unseen terrain. `look_direction` now supplies
   one ordinary glance as two orthogonal player choices: horizontal
   same/left/right/around and vertical same/up/level/down. The normal mind sees
   facing and vertical bands rather than raw angles. Two residents used it to
   find different grounded items outside their initial views. We still need to
   decide, with evidence, whether structured rays are sufficient or an
   on-demand first-person image is necessary for architecture and visual
   culture.
2. **Egocentric local movement.** `move_direction` now supplies bounded
   forward/back/left/right walking or swimming relative to the resident's view,
   while `move_to` remains for visible, communicated, or remembered
   coordinates. Its first endangered live admission exposed unrestricted
   pathfinder routing, so the skill refuses a blocked adjacent body step and
   enforces a local time, horizontal, and vertical envelope. A later untasked
   resident used one broker-admitted GPT-5.4-mini decision to swim from x=1.3
   to x=5.5 during a genuine oxygen crisis. The first version of that proof
   also revealed that repeated drowning events canceled the very urgent action
   selected to escape; urgent action ownership now lets one already-selected
   response reach a bounded terminal before reobservation. Vertical water
   movement, climbing, and more varied traversal remain red.
3. **Legible obstruction.** Failed relative walking now reports only the
   adjacent feet, head, and support cells. Coordinate `move_to` failures still
   need equally useful body-scale evidence without revealing a hidden route or
   loaded-volume map.
4. **Visible-target interaction.** Peripheral first-hit surfaces now have exact
   ids and a resident can select and face one with stale-target checks. Carry
   that same reference through mine, use, place, and approach. Coordinates
   remain valid remembered-place evidence, not the only language of embodied
   action.
5. **Authentic visual channel.** A bounded screenshot may be the honest way to
   understand façades, signs, maps, builds, and human visual communication.
   It should supplement—not erase—the cheap structured body/event channel and
   must use the exact resident camera.
6. **Temporal embodiment and long survival competence.** One bounded untasked
   recovery now composes body-origin urgency, a real model decision, ordinary
   swimming, Minecraft-confirmed oxygen recovery, save, and a fresh-epoch
   witness. Long continuous life remains red: materials, tools, food, light,
   shelter, sleep, varied hazards, hostile creatures, death, and recovery must
   work together without evaluator-authored resident choices.
7. **Embodied place learning.** A resident can remember where it acted, but new
   construction does not magically become a certified room, doorway, or safe
   interior. Those affordances must be learned through its camera, movement,
   ordinary use, and later consequences; exact topology remains evaluator-side.

## How we learn without whack-a-mole

For each family above, maintain one compact matrix:

- native player control or feedback;
- Mineflayer/Minecraft implementation;
- Behold observation or action;
- terminal and independent evidence;
- interruption behavior;
- live proof and known failure.

Then use live worlds adversarially. A live failure may falsify the matrix, but
it does not automatically earn a new tool. First ask whether the failure came
from missing observation, missing primitive, weak body skill, weak model
choice, world content, or evaluation design. Add an affordance only when the
native-player basis has a real hole.

The run-38 door failure is the regression shape for this rule. An oak door was
present in peripheral first-person rays while the cursor remained on a log, so
the resident tried to place another door into the existing lower half. The
repair was not `find_door` or an install-door story command. It was a bounded
exact target projection, a generic orientation action, and world-owned dynamic
admission of the already-existing cursor-gated crossing.

Body conformance and lived competence are separate gates. A deterministic
driver may choose one ordinary action to prove that authorization, bounded
motor work, Minecraft confirmation, durable consequence, independent witness,
and teardown all compose on a real server. It must not be reported as evidence
that a mind would choose that action. Conversely, a model failure does not
falsify a body skill until the production-path conformance gate fails. The
first such gate proved a body-intersection `place_block` without steering or
paying a model.

The Venice trial on July 14, 2026 is the example: an untasked resident chose a
base project and persisted it across restart, but followed sparse façade
coordinates and opened a one-block-high tunnel while ordinary doors existed
off camera. The general hole was relative visual orientation, not a Venice
route, a building ontology, or a `find_door` oracle.

The [untasked recovery trial](reports/2026-07-14-untasked-resident-recovery.md)
is the corresponding example for temporal embodiment. Its first run stayed red
because new harm events repeatedly interrupted the already-urgent movement
selected to escape. The correction was a general action-ownership rule, not an
underwater story action. The unchanged rerun recovered and persisted across a
fresh managed epoch.
