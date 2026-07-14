# Inhabitant interface

Behold's portable center is one causal loop:

1. Receive one bounded observation from the current body.
2. Discover the actions admitted for that observation.
3. Propose one typed intent.
4. Let the controller authorize and serialize the attempt.
5. Act through the world's own client and physics.
6. Receive a terminal attempt result separately from a newly observed consequence.
7. Append the complete turn to the entity's durable trajectory.

The world-specific boundary is intentionally small: `entityId`, `observe(cursor)`,
a complete capability catalog, `actionsFor(observation)`, and `attempt(intent)`.
The catalog says what this kind of body can ever do; `actionsFor` publishes the
observation-bound subset and may narrow inputs to exact perceived targets. It
cannot introduce a capability absent from the catalog. A mind is a replaceable
proposal adapter above that boundary. It does not own waking, authorization,
execution, memory, or world truth.

## Minecraft observation v2

New Minecraft observations use `behold.inhabitant.v2`.

- `self` is direct body state: pose, health, food, oxygen, sleeping state, held
  item, inventory, current action, and bounded own-trajectory projections.
  Current inventory stacks carry game-adapter-derived ordinary uses such as
  `place`, `consume`, `equip`, and `drop`; this is item knowledge available to
  the body, not a recipe or loaded-world scan.
- `scene.social` is explicit server-roster presence. It never implies proximity,
  visibility, attention, or willingness to interact.
- `scene.focus` is the nearest entity or selectable block hit by the current
  eye ray within survival interaction range. Zero yaw and pitch are ordinary
  directions, not missing values.
- `scene.entities` contains only entities inside the current first-person field
  of view for which at least one sampled body point has an unoccluded block ray.
- `scene.terrain` contains unique first-selectable-surface samples from a fixed
  9 by 5 camera-ray grid out to 24 blocks. Its bounded `targets` list gives
  those sampled surfaces exact block ids, names, positions, distances, and ray
  cells. It is not a rendered image or a loaded-volume scan. Transparent
  surfaces can be sampled while they do not visually occlude entities behind
  them.
- `sound_heard` records the native sound name plus coarse egocentric direction
  and distance. It never exposes the packet's exact hidden coordinates.
- `events` retain source, salience, order, cursor completeness, and whether an
  event is new to this controller update.

The projection is deliberately semantic rather than pixel-based. It gives a
model the culturally meaningful things a player can presently see or hear while
keeping its cost fixed and inspectable. Conservative false negatives are safer
than revealing server-tracked state through a wall.

Exact entity actions are observation-bound. Their tool schemas enumerate only
current visual entity ids, and the body re-observes immediately before execution.
A stale, guessed, remembered, or now-occluded target fails with
`target_not_perceived` before movement, combat, or pickup begins.

Exact visible block orientation follows the same rule. `face_visible_target`
accepts only ids and expected names published in the current bounded ray target
list, re-observes that relation before turning, and confirms that the selected
block is under the cursor afterward. It does not search, approach, manipulate,
or infer object semantics. A cursor-gated action such as doorway crossing is
offered only after the current cursor actually confirms the door.

Minecraft-specific admission belongs to the Minecraft adapter. The generic
controller applies task allowlists, bodily-attention constraints, serialization,
and catalog authorization after `actionsFor`; it has no door, entity, inventory,
or roster discovery rules. A world adapter failure therefore degrades to the
explicit yield action instead of broadening capability.

The current Minecraft adapter also removes capabilities whose visible physical
preconditions are absent. Empty inventory cannot offer placement, eating,
equipment, dropping, or crafting. Digging and ordinary block use bind to the
reachable cursor focus. Containers and beds bind to their exact visible block.
Sleep and wake reflect the body's current day and sleeping state. Exact enums
narrow item names, entity ids, and door ids; equal numeric bounds narrow block
positions without relying on provider-incompatible numeric enums. Older
observations without item-use metadata retain a conservative
coarse inventory surface rather than being silently reinterpreted.

Raw coordinate looking, `status`, and cursor-query commands remain available to
operators, but are not resident actions: their ordinary results are already in
the current observation. This prevents a mind from spending a world turn to ask
the adapter to repeat its HUD or crosshair state.

Newly urgent bodily decisions carry an enforced wall-clock budget, currently
five seconds by default and recorded as `attention.decisionBudgetMs`. A direct
or Ax request that acknowledges cancellation is aborted at that boundary; it
cannot return an arbitrarily late action as though the original body state were
still current. The next wake reobserves the world. This makes slow cognition a
bounded visible failure; it does not itself choose a survival response or prove
that five seconds is fast enough.

A newly bodily-urgent lived event also reclaims model-owned action admission. A
queued action terminalizes before dispatch. An action already in flight keeps
execution ownership until its adapter returns one terminal result and
acknowledges cancellation; no urgent action overlaps it. Human-owned actions are
outside this mechanism. After the terminal, the resident receives the newly
committed observation and chooses again. This is attention reclaiming its own
body, not a world-side escape policy.

Visibility admission does not grant continuing hidden tracking. A moving
approach updates its destination only while the target is perceived. After
sight is lost it can reach only the last-seen position, where it must reacquire
the target or finish with `target_lost_at_last_seen`. Combat stops when the
target leaves the visual scene. Pickup recovery cannot aim a direct movement at
an item that is no longer perceived.

Raw loaded-world queries (`find_blocks`, `inspect_volume`,
`inspect_reachable_space`, `nearest_entity`, `get_nearby`, and `survey_area`)
remain available to operators and diagnostic tools but are not inhabitant
affordances.

Mineflayer's loaded chunks, tracked entities, packet coordinates, and
pathfinding graph are private body-adapter state. They may implement bounded
locomotion and verify physical results, but they do not become facts available
to the mind unless an admitted observation channel carries them. The semantic
projection deliberately favors conservative false negatives over hidden world
state.

## Migration from v1

Existing `behold.inhabitant.v1` turns remain immutable and readable as historical
evidence. They are not silently relabeled. In v1, `proximity` entities and
`local_volume` terrain may contain server-tracked facts without visual line of
sight, so a current resident controller must not use a v1 scene to admit an exact
physical target. New runtime observations and managed-world manifests advertise
v2. Bounded loom folds may summarize old turns, but the original protocol and
provenance remain in Lync.
