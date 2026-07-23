# Affordance closing time: the door was real, the decision arrived too late

## Outcome

Run `first-life-v1-39` proved that observation-bound world offers work and
falsified the assumption that a correct offered action is sufficient for
embodied competence.

Wren saw an exact oak door under the current cursor while being attacked. The
world offered `cross_visible_door`; Luna selected it. During the 6.841-second
provider call, Minecraft continued. Wren died and respawned before the proposal
could be attempted, so the controller rejected it with
`body_life_boundary_changed`. No stale action reached the engine.

That is correct causal behavior and failed life behavior. An affordance has not
only a target and preconditions but a closing time.

## Exact live evidence

The first urgent request contained 26 actions and 42,390 serialized bytes. It
used 9,608 tokens, cost `$0.01276325`, and took 6.841 seconds. Its selected door
crossing was independently invalidated by the intervening death and respawn.

The bounded run drained cleanly after eight broker calls: seven resident
decisions and one Lync fold. All eight calls completed; none failed, cancelled,
or exceeded the aggregate concurrency limit of one. The seven decisions plus
fold consumed 77,801 tokens and `$0.1053346`. Wren's later post-respawn choices
were legal but not competent recovery: one relative move failed, then the mind
dug and looked through leaves.

Authoritative evidence:

- resident journal:
  `.behold-runs/first-life-v1-39/WrenLife/2026-07-14T16-32-05-791Z-WrenLife.jsonl`
- cognition journal:
  `.behold-runs/first-life-v1-39/_cognition/broker.jsonl`

## Corrections earned

The fix is not a zombie or doorway policy.

1. The Minecraft adapter now removes actions whose visible physical
   preconditions are absent and narrows item names and cursor blocks to exact
   current values. Empty inventory no longer offers inventory, crafting,
   placement, eating, storage, or sleeping fiction.
2. Active-registry item data plus Mineflayer's ordinary always-consumable rules
   distinguish placeable items and what this body can consume at its current
   hunger.
3. Raw coordinate look, status, and cursor probes remain operator commands but
   no longer compete as resident actions.
4. Storage and sleep schemas require the exact visible block position instead
   of permitting a resident request to fall through to a hidden local search.
5. Urgent working continuity is explicitly bounded to three committed turns
   and 6 KB.
6. Newly urgent bodily attention carries a five-second default wall-clock
   budget. Direct and Ax minds receive it, cooperative requests are aborted at
   the boundary, and a late result from a mind that ignores cancellation is
   rejected after it settles. The failure is journaled; no fallback action is
   fabricated and aggregate compute is not falsely released early.
7. The provider-free differential now uses the same production
   `actionsFor(observation)` boundary as a live controller. Evaluation can no
   longer profile a static catalog that the resident would never actually see.
8. Run 40 exposed a Gemini function-declaration incompatibility with numeric
   enums before any model choice. Exact block coordinates now use equal
   `minimum`/`maximum` bounds, which preserve local admission and cross the live
   provider boundary; numeric enums are rejected by the shared action boundary.

## Provider-free replay

Reconstructing the exact first run-39 frame under the corrected source produces
16 actions and a 32,447-byte direct-provider request. That is 10 fewer actions
and 9,943 fewer bytes, a 23.5% wire reduction. Tool definitions fall from 11,520
to 9,105 bytes. The observation hash is unchanged and no provider or
Minecraft action is invoked.

The replay comes from an older observation that predates item-use metadata, so
its inventory surface remains deliberately coarser than a current body frame.
The corrected hunger gate nevertheless removes `consume`; the now-valid
`place_against` offer is bound to Wren's actually held block and exact cursor
support.

Provider-free profile:
`.behold-runs/first-life-v1-39/WrenLife/request-profile-affordance-temporal-v4.json`.

## Corrected live episode

Run `first-life-v1-41` crossed the full live provider boundary after the numeric
schema fix. Seven resident decisions completed without a model-call failure:
four Gemini 3.5 Flash deliberative calls and three Luna urgent calls. The urgent
latencies were 3.910, 2.849, and 3.380 seconds, all inside the five-second
decision boundary. The seven decisions consumed 63,854 tokens and
`$0.09376825`; an eighth accepted auxiliary fold was cancelled and settled as
the capped runner drained. Peak cognition concurrency remained one.

The life still failed. Wren chose a remembered trip toward the shelter, but the
bounded `move_to` leg retained the body for 19.239 seconds and ended in a
pathfinder failure after health fell from 20 to 11.17. Only then could urgent
cognition choose a lateral escape. That adjacent direction was blocked by oak
leaves and health fell to 3.17. A second urgent choice was correctly invalidated
across death and respawn; a third post-respawn dig was legal and independently
verified, but was not recovery from the lost life.

This isolates an architectural requirement rather than another action verb:
new bodily urgency must be able to ask an active model-owned body action to
yield. The engine now terminalizes queued model actions before dispatch and
sends a cancellation request to an action already in flight. It retains
exclusive action ownership until the adapter's terminal acknowledgement, and
then gives the resident a fresh observation. It never chooses an escape and
never interrupts a human-owned action.

Authoritative run-41 evidence:

- resident journal:
  `.behold-runs/first-life-v1-41/WrenLife/2026-07-14T17-06-57-017Z-WrenLife.jsonl`
- cognition journal:
  `.behold-runs/first-life-v1-41/_cognition/broker.jsonl`

## What this does not prove

The five-second ceiling is a bounded failure contract, not a claim that five
seconds is fast enough. No corrected live run yet proves Wren can cross the
door, survive an attack, identify a hostile behind the camera, or recover after
death. No latency, token, or cost improvement is claimed from a provider-free
byte profile alone.

The next live gate is not another model comparison. It should prove that the
first urgent sound or injury ends a long model-owned movement leg, produces one
acknowledged terminal, and gives the resident a fresh urgent choice without
overlap. If that still cannot preserve a life, the next foundation is a
transparent resident-side reaction mind or standing disposition—not a
world-side scripted rescue.
