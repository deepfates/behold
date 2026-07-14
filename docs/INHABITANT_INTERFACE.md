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
current action specifications, and `attempt(intent)`. A mind is a replaceable
proposal adapter above that boundary. It does not own waking, authorization,
execution, memory, or world truth.

## Minecraft observation v2

New Minecraft observations use `behold.inhabitant.v2`.

- `self` is direct body state: pose, health, food, oxygen, held item, inventory,
  current action, and bounded own-trajectory projections.
- `scene.social` is explicit server-roster presence. It never implies proximity,
  visibility, attention, or willingness to interact.
- `scene.focus` is the nearest entity or selectable block hit by the current
  eye ray within survival interaction range. Zero yaw and pitch are ordinary
  directions, not missing values.
- `scene.entities` contains only entities inside the current first-person field
  of view for which at least one sampled body point has an unoccluded block ray.
- `scene.terrain` contains unique first-selectable-surface samples from a fixed
  9 by 5 camera-ray grid out to 24 blocks. It is not a rendered image or a
  loaded-volume scan. Transparent surfaces can be sampled while they do not
  visually occlude entities behind them.
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
