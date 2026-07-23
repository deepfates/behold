# A neutral resident changed Minecraft and kept the result

## Outcome

Behold now has one resettable, outcome-scored Minecraft episode through the
normal inhabitant loop. GPT-5.4 Mini, through the direct mind adapter, received
a neutral task, a first-person observation, and the complete
`minecraft-player-v1` action surface. No action, target, plan, or tool choice
was required. In three model calls it chose to face one visible oak log, mine
that exact block, and collect the resulting dropped stack.

Minecraft confirmed all three terminal consequences. The resident observed its
inventory change from zero oak logs to one before shutdown. The manager then
stopped the controller and server, saved the child history, and started a fresh
paused controller process in a new epoch. That process attached the same saved
Minecraft body and independently observed the oak log still in its inventory.

The result passed both the runner's immediate assessment and a separate
verification invocation at clean revision
`6d9fc890d55d8f8ff4b6973ec68b281e185900a7`.

## What the model was asked

The outcome contract was:

> End this episode with at least 1 more oak_log in your own inventory than you
> began with. Use only the ordinary Minecraft actions your current body can
> perceive and attempt. Choose how. Yield after the result is actually
> observable to you.

The run used `neutral-benchmark-v1`, `minecraft-player-v1`, and
`vanilla-player-v1`. Its hard ceilings were six resident turns, six provider
calls, one resident, one concurrent provider call, and 240 seconds. The episode
finished after three turns and three provider calls:

1. `face_visible_target` selected the visible oak log.
2. `dig_block` received an exact native block update from oak log to air.
3. `collect_nearby_item` received `mineflayer:playerCollect` for the exact
   dropped entity and the next observation contained `oak_log ×1`.

The exact resident range is Lync life
`lync:019f636a-2f05-7485-b110-586b01085376`, turns 1 through 3. The evaluator
references that closed range from its own episode loom; it does not copy a
success label into the resident's memory.

The pristine child had previously been reserved under the identifier
`first-life-inventory-ax-v1`, but this episode explicitly declared and ran the
direct adapter. The identifier is lineage, not a claim that Ax produced these
actions.

## The failure that improved the interface

The first real sibling run failed, usefully. The model made the same sensible
first two choices and then selected the visible dropped log. During the roughly
one-second model decision, the falling entity left the next camera sample. The
interpreter re-read only that newer sample and rejected the target before the
admitted action could start. The model had chosen correctly; the body had lost
the thing it had just offered.

Commit `6d9fc89` repaired the action boundary rather than the prompt. An intent
now carries the exact lived observation whose affordance surface admitted it.
The body may close that selected action against the same live entity even if a
later visual sample loses it. It still fails closed if the entity disappeared,
is no longer a dropped item, changed item identity, or moved beyond the body's
bounded pursuit range. The mind receives no hidden coordinates or strategy.

The passing collection demonstrates the seam directly. Observation sequence
19 saw entity 253 falling at approximately `(15.3, 69.6, 86.5)`. By execution
the same exact oak-log entity was on the ground at approximately
`(15.9, 64, 86.1)`. The body completed the already selected pickup and recorded
both positions plus native collection confirmation.

## Verification

The standalone verifier recomputed all of the following from immutable or
checksummed evidence:

- checkpoint, source lifecycle, fork lineage, and child-history identity;
- isolated server profile and initial world digest;
- act and restart journals plus both closed lifecycle epochs;
- exact cognition admission ceiling and three actual provider calls;
- the exact resident Lync range and evaluator-owned episode;
- zero-to-one gain before stop, body-reported inventory change, and one-item
  persistence in the fresh paused process.

The complete repository gate also passed: TypeScript, ESLint, and 454 tests.

## Evidence

- passing report:
  `.behold-runtime/world-histories/evidence/first-life-inventory-bound-v2-proof/evidence/inventory-gain-result.json`
- honest failed predecessor:
  `.behold-runtime/world-histories/evidence/first-life-inventory-direct-v1-proof/evidence/inventory-gain-result.json`
- fork receipt:
  `.behold-runtime/world-histories/receipts/first-life-inventory-gain-v1-20260714.json`
- runner and assessment implementation: commit `5aa0ff3`
- observation-bound action handoff: commit `6d9fc89`

## What remains red

This is one useful outcome in one checkpoint family with one model. It does not
establish broad Minecraft competence, generalize to held-out terrain or task
families, rank direct against Ax, or prove population-scale performance. The
next honest increase in confidence is a small held-out family that keeps this
environment contract fixed while varying checkpoints, outcome classes, and
minds. Prompt optimization should wait for that split.
