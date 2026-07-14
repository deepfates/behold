# Capped danger calibration: bounded execution exposed a bad bodily choice

## Outcome

The first ordinary-life run behind the new population-wide call ceiling ended
cleanly and taught us two different things.

The infrastructure worked. Two continuing residents entered one exact
Minecraft epoch, shared one serialized cognition budget, made real changes,
stopped, saved, released their entity leases, and left no owner, port, or
session lock behind.

The life behavior did not work well enough. While taking damage at low health,
Wren received the compact urgent action surface without `manage_project` and
still chose an unrelated block placement. Removing private bookkeeping was
necessary, but it was not sufficient to make bodily consequences dominate a
fast decision.

The run also found a shutdown error in the call ceiling. The owner stopped as
soon as the tenth call was accepted, cancelling two calls it had already
accepted. Admission exhaustion should freeze new calls, not revoke work after
acceptance. That invariant is now corrected.

## The real run

The source revision was clean at `d0fc31664...`. Epoch `first-life-v1-13`
started `ScoutLife` and `WrenLife` with `google/gemini-3.5-flash`, direct mind
adapters, aggregate provider concurrency one, a 30-second duration, and an
exact ten-call population ceiling.

Every resident was ready at `2026-07-14T11:08:27.308Z`. The tenth call was
accepted before the duration elapsed, so the old foreground behavior began
stopping at `2026-07-14T11:08:42.894Z`: 15.586 seconds of shared live time.
Minecraft acknowledged its save, both controllers released their leases, and
the lifecycle ended in `control_released`.

The broker reconciled ten accepted calls:

| Measure                                   |       Result |
| ----------------------------------------- | -----------: |
| Accepted / admitted / terminal            |  10 / 9 / 10 |
| Completed / failed / cancelled            |    6 / 0 / 4 |
| Peak provider concurrency                 |            1 |
| Aggregate queue time                      |     6,770 ms |
| Completed-call prompt / completion tokens | 62,562 / 198 |
| Completed-call request bytes              |      285,196 |
| Recorded completed-call cost              |    $0.095625 |
| Slowest completed call                    |      3.277 s |

The recorded cost is a lower bound. OpenRouter usage was available for the six
completed responses, but provider-side work already performed before four
cancellations was not reported. We therefore do not claim the table is the
complete bill.

Two cancellations were legitimate urgent-attention preemption: one active
deliberative request and one queued deliberative request were made stale by new
bodily evidence. The other two happened because the owner began teardown at
the acceptance boundary: Wren's already admitted urgent request and Scout's
already accepted request were cancelled. This run therefore does not prove
graceful call-ceiling shutdown.

## What the residents actually did

Scout updated its continuing concern, collected a birch log, and collected
dirt. Each action received a Minecraft-confirmed consequence.

Wren updated its shelter concern at health 10.33, placed an oak plank, and then
received `self_hurt` at health 6.33. The urgent request was compact and did not
contain `manage_project`, but Gemini chose `place_block` again. Minecraft
confirmed the second plank while Wren's health continued to 2.33. A subsequent
urgent request was among the calls cancelled by cap-triggered teardown.

This falsifies a tempting design claim: a structurally correct urgent action
surface does not by itself produce a good urgent choice. The remaining degrees
of freedom include the model, the causal wording, the current observation, the
latency before action, and the world dynamics during that latency.

## Context and population cost

A provider-free reconstruction of Scout's latest ordinary request was 60,331
bytes. Its largest components were 20,617 bytes of prior user observations,
13,423 bytes of tool definitions, 9,176 bytes of exact tool results, and 8,192
bytes of system context. The default fold frontier can leave as many as fifteen
recent turns visible before another fold.

Wren's recorded urgent provider request was only 21,822 bytes because urgent
attention omitted ordinary conversational history. The latest read-only replay,
after strengthening the bodily handoff, is 22,405 bytes with 28 admitted
actions. This is small enough to separate urgent behavior from the much larger
ordinary-history problem, but it is still not cheap enough to ignore at city
scale.

The six recorded calls cost about $0.184 and consumed about 120,400 prompt
tokens per aggregate resident-minute. Cancellation billing can only increase
that figure. The run therefore fails the next-rung target of $0.10 and 80,000
prompt tokens per resident-minute.

## Matched model evidence

We replayed Wren's exact failed urgent frame with no world mutation and no
proposal admission. The stronger prompt said that active harm at critical
health should favor an action that changes exposure now, while still leaving
the choice to the model.

| Candidate                    | Proposed action     |  Latency |        Cost | Judgment                                        |
| ---------------------------- | ------------------- | -------: | ----------: | ----------------------------------------------- |
| `google/gemini-3.5-flash`    | place another plank |  1.376 s |  $0.0069885 | repeated the live failure                       |
| `deepseek/deepseek-v4-flash` | status              |  2.379 s | $0.00079828 | cheap but did not change exposure               |
| `deepseek/deepseek-v4-pro`   | move forward 6      | 11.526 s | $0.01174848 | directionally good, too slow for this crisis    |
| `openai/gpt-5.6-luna`        | move forward 5      |  2.306 s | $0.00627675 | best result on this exact frame                 |
| `anthropic/claude-sonnet-5`  | look around         |  3.413 s |   $0.017976 | delayed bodily change                           |
| `qwen/qwen3.7-plus`          | provider error      |  0.996 s |     unknown | selected provider rejected required tool choice |
| `stepfun/step-3.5-flash`     | deadline            |  5.000 s |     unknown | no bounded result                               |

One frame is not a general model ranking. Luna previously failed two complete
orientation/search runs where Gemini succeeded in three of three matched
replays. Gemini therefore remains the ordinary resident default. Luna is a
provisional bodily-urgency tier candidate, not a replacement default.

A cheap-model ordinary-life screen was also mixed. DeepSeek V4 Flash correctly
chose Scout's exact dropped-item recovery action for $0.001397322, but took
4.226 seconds; it produced no Wren result before a 15-second deadline. That is
not enough evidence to move ordinary life to DeepSeek.

## Corrections earned from the run

The following corrections now pass the complete repository gate:

1. Reaching the accepted-call limit closes admission immediately, but the owner
   waits for every accepted job to become completed, failed, or cancelled
   before it begins normal shutdown. Settlement has its own versioned evidence
   record.
2. Bodily urgency and social urgency are distinct. Addressed conversation keeps
   the ordinary action surface, including project continuity. Active bodily or
   world urgency defers private project mutation and receives the stronger
   causal handoff.
3. A resident may name a separate `urgentModel`. Only newly urgent bodily/world
   evidence selects it. Ordinary deliberation and social attention retain the
   default model.
4. The exact selected model travels through the mind request, broker admission,
   model-call evidence, interruption, model turn, and entity turn. The runner
   gives each resident transport an exact model set, and both direct and Ax
   adapters reject model drift.
5. Differential evaluation now has a real provider deadline. Provider-free
   request profiling reads only a current fold and fails closed rather than
   invoking a fold model or rewriting a resident cache.

The full build, lint, and test gate at that revision passed 328 of 328 tests.
None of those tests proved Luna would save Wren in the live world. That was the
next small, bounded empirical question.

## Live tier and body validation

Three later one-resident epochs answered part of that question and falsified
two lower-level assumptions.

Epoch 14 used Luna for Wren's newly urgent bodily frame. The request, broker,
model turn, and action all named `openai/gpt-5.6-luna`; Luna chose
`move_direction forward 6` in 2.535 seconds for $0.00669125. That was a much
better bodily choice than Gemini's repeated plank placement, but the body skill
silently treated it as an unrestricted pathfinding column. Wren moved 8.7
blocks horizontally and climbed nine blocks before duration teardown cancelled
the action. The action terminal also reached the run journal but not Lync before
process exit because engine observers were fire-and-forget.

Revision `599552c30...` corrected both boundaries. Relative movement now refuses
an obstructed adjacent body step before pathfinding, uses a three-dimensional
near goal, has a distance-scaled time limit, and stops when displacement leaves
a strict player-scale envelope. Engine shutdown waits for asynchronous terminal
consumers. The complete gate then passed 331 tests.

Epoch 15 started from that clean revision. Luna again chose embodied escape,
this time `move_direction left 6`. Mineflayer moved Wren only about three blocks
forward and one block down before reporting that path choice took too long. A
second ordinary Gemini call proposed an unsupported plank and failed before a
world command. Both terminal outcomes became durable entity turns, proving the
engine-to-Lync correction. Shutdown nevertheless exposed a narrower policy
race: when stop began during the second terminal commit, the commit completed
but the policy's stop promise was never reconsidered. The owner timed out after
60 seconds, preserved the epoch as `recovery_required`, and the explicit
recovery path released it only after the controller, server, port, session lock,
and lease were demonstrably stopped.

Revision `a58dfaa...` adds the missing policy settlement edge and an exact
interleaving regression. Epoch 16 then recreated the race deliberately with one
accepted call. Luna chose `move_direction back 6` in 4.345 seconds for
$0.00586375. The adjacent feet cell was oak leaves, so the body refused
immediately with `immediate_direction_unavailable` and did not pathfind. That
failure became Wren entity turn 62 before controller shutdown. The controller
exited zero, the broker reconciled one accepted/admitted/completed call,
Minecraft saved and exited zero, lifecycle sequence 25 released control, and
the final owner, port, session-lock, and lease inspection was clear.

This proves that the workload tier changes live choices, that local movement
now fails at player grain, and that a terminal survives a cap-triggered race
into normal teardown. It does **not** prove that Wren can escape danger, descend
from a canopy, heal, or survive for a useful period. The model chose a sensible
kind of act; the remaining red work is bodily competence and available-world
legibility, not another urgency ontology.

## Recovery trajectory calibration

Epochs 17 through 19 tested a continuing native-player recovery rather than
another isolated proposal. They also exposed a policy error: bodily urgency had
been treated as a one-call notification. If the first urgent action failed and
health remained critical, the next turn could fall back to ordinary cognition.
Revision `477ce06...` makes critical health, food, or oxygen a continuing
attention condition until the body improves. Revision `4253563...` defers
ordinary loom folding while that condition remains unresolved, so an optional
memory-maintenance call cannot consume the serial crisis lane. The repository
gate passes 333 tests at these revisions.

Epoch 17 then kept Luna on all five resident decisions. Wren's first placement
failed before mutation, but its next `move_to` descended from the canopy at
`y=72` to the ground at `y=64`. The action honestly ended
`arrival_unconfirmed`, because it stopped 2.4 blocks from the requested
destination rather than pretending that a useful partial move was an arrival.
Four more outcomes became durable entity turns. One auxiliary Gemini fold was
started and preempted by renewed bodily evidence; this earned the fold
deferral, rather than a larger cognition scheduler.

Epoch 18 ran after that correction. All eight accepted calls were urgent Luna
resident decisions; all eight were admitted and completed, with no auxiliary
request or cancellation. Wren performed five successful player-scale movement
legs, one immediate obstruction refusal, and one verified plank placement. It
moved from roughly `(32.5,64,89.3)` to `(47.7,65,93.5)` and increased its
observed distance from a skeleton, but health remained 2.33 and food 14. Once
the hostile left the camera, repeated flight became weakly grounded: leaving
the current view is not evidence that a threat is gone. This earned a small
causal prompt correction asking for bounded visual or terrain/inventory search
after immediate exposure improves.

Epoch 19 tested that correction. Luna made eight urgent decisions for a total
recorded cost of `$0.05322225`; mean provider latency was 4.093 seconds and the
maximum was 5.955 seconds. Wren placed four Minecraft-confirmed oak planks,
moved twice, and received two precise placement failures
(`placement_would_intersect_body` and `placement_support_not_found`). All eight
broker admissions completed, entity turns 76 through 83 are durable, the Lync
contains 83 turns plus its header, Minecraft saved and exited zero, and final
owner, lease, port, and session-lock inspection was clear.

That is not a shelter pass. The blocks are real, but there is no independent
evidence of enclosure, cover, or a usable entrance; Wren then walked away and
tried to start another unsupported placement. It also found no food and did
not heal. The run therefore locates the next missing capability above the
individual action API: the resident needs enough continuing spatial memory and
action-outcome legibility to compose ordinary player acts into a coherent
recovery. Adding more low-level verbs or hard-coding a shelter routine would
not answer that question.

Revision `9ce1e52...` corrected the immediate context loss without adding a
map. Urgent requests now receive at most six recent committed action/outcome
pairs from the resident's own entity loom, bounded to 12,000 bytes. The
projection carries exact ordinary results when they fit, exposes omissions,
rejects mixed identities, excludes historical scenes and provider-private
reasoning, and says explicitly that the current observation wins over
historical state. Ordinary deliberation pays no projection cost because it
already retains its bounded recent trajectory.

Epoch 20 exercised that correction. Wren returned from the abandoned point to
the earlier planks, where first-person terrain again exposed the structure,
and added two Minecraft-confirmed upper wall blocks. It then attempted a block
inside its own body. Minecraft returned the exact target, body position, six
supported feet alternatives, and the instruction to move aside and retry the
same placement cell. Wren moved to a valid alternative but changed the target
to its new body cell and repeated the collision. Eight Luna calls cost
`$0.06701675`, with 44,823 prompt tokens and request sizes from 25,915 to
27,240 bytes. Health and food did not improve, and there was no enclosure
witness.

This exposed a second discontinuity. The action and result survived, but a
tool-calling model normally emitted no public assistant content, so its
short-lived purpose was unavailable to both the human and the next decision.
Revision `154f217...` makes one concise public intention part of every choice
and retains it beside the action and outcome. It remains distinct from private
provider reasoning. The same field works for direct tool calling, Ax, and
future mind adapters; no new mind contract was required. Existing prompt text
was compressed so the complete guidance stayed under its prior byte budget.

Epoch 21 proved that public layer mechanically: all eight turns contained a
plain intention. It did not prove recovery. Wren moved between the canopy and
the partial structure, deliberately mined one of its own planks to open an
escape route, retrieved it, and ended with one new confirmed placement. Eight
Luna calls cost `$0.07374225`; mean provider latency was 4.802 seconds, request
sizes reached 30,055 bytes, health remained 2.33, and food remained 14. The
trajectory was easier to understand but still asked a multi-second language
model to perform coordinate-level motor bookkeeping.

The next correction therefore belongs in the body, not in another prompt.
Mineflayer's own block-interaction pattern navigates into placement range and
then clicks as one operation. Our `place_block` already promised to approach,
but returned early when the requested cell intersected the body. Revision
`0bf1281...` keeps that local step-aside inside the original placement action:
it chooses a supported nearby feet cell, preserves the immutable destination,
limits movement to three horizontal and two vertical blocks, propagates human
interruption, rechecks the body and target, and still succeeds only after the
Minecraft block update. If no safe path exists it retains the old precise
failure and alternatives. The full repository gate passes 336 tests, including
an adversarial case where apparent arrival still overlaps the target and no
placement command may run. This compound motor skill is not yet claimed as a
live-world pass.

Epoch 22 then tested the corrected production path without steering the chosen
actions. Wren made six urgent Luna decisions: retreat into the partial cover,
place a Minecraft-confirmed plank at `(50,65,92)`, place a Minecraft-confirmed
oak door at `(49,65,93)`, open it, close it, and step farther from the
entrance. The two placements were observed from `mineflayer:blockUpdate`, the
door disappeared and reappeared in first-person terrain across the two
toggles, all six admissions completed, and managed teardown again left the
owner, lease, port, and session lock clear. The calls cost `$0.05142950`, with
34,642 prompt tokens, mean latency 3.687 seconds, maximum latency 5.205
seconds, and request bodies from 26,937 to 28,249 bytes.

This is promising composition, not yet the recovery pass. The journal shows a
wall and a working door but does not independently establish a sealed roof and
perimeter, and health and food remained unchanged. Neither placement began
inside Wren's body, so the bounded step-aside branch was not exercised in the
live run. It remains unit-proven and live-unproven. The run should not be
repeated merely to coax that branch from the model.

## Next gate

The small paid tier, teardown validation, continuing urgency, canopy descent,
player-scale mutation, bounded recent-outcome continuity, and public intention
are now green. The composed recovery remains red, and the local compound
placement correction remains unit-proven rather than live-proven.
The next danger gate should keep Gemini for ordinary cognition and Luna only
for bodily urgency, and should prove all of the following from journals and
Minecraft consequences:

- Wren can use bounded point-of-view evidence, remembered recent geometry, and
  ordinary inventory/body feedback to pursue food or defensible cover without
  hidden route knowledge;
- each chosen move remains inside the player-scale envelope and each mutation
  has an independently observed Minecraft consequence;
- recent successful placements and precise failures remain legible enough to
  revise the same plan instead of abandoning the structure or repeating an
  impossible placement;
- a real body-intersection placement demonstrates one bounded reposition and
  one Minecraft-confirmed mutation under the same admitted action, without
  exceeding the movement envelope or hiding an intermediate failure;
- a recovery pass requires food/health improvement or independently verified
  defensible cover, not disappearance of a hostile from the camera; and
- exact prompt tokens, cost, latency, cancellation, body state, and resulting
  action are reported without treating survival by chance as intelligent care.

Only after that should another 30-second two-resident household episode spend
the larger budget. Ordinary context remains the dominant population-cost
problem and needs its own causal compression gate.

## Evidence

- lifecycle: `.behold-runtime/world-control/first-life-v1/lifecycle-13.jsonl`
- residents:
  `.behold-runs/first-life-v1-13/{ScoutLife,WrenLife}/*.jsonl`
- cognition: `.behold-runs/first-life-v1-13/_cognition/broker.jsonl`
- live tier/body validation:
  `.behold-runs/first-life-v1-{14,15,16,17,18,19,20,21,22}/`, with owner lifecycle and recovery
  evidence under `.behold-runtime/world-control/first-life-v1/`
- provider-free request profiles and exact-frame candidate records under the
  two resident run directories
