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

The full build, lint, and test gate passes 328 of 328 tests. None of those tests
proves Luna will save Wren in the live world. That remains the next small,
bounded empirical question.

## Next gate

The next paid validation should use one endangered resident, Gemini as the
ordinary model, Luna only for bodily urgency, aggregate concurrency one, a very
small call ceiling, and the normal managed owner. It should prove all of the
following from journals and Minecraft consequences:

- the urgent request and broker admission name Luna while ordinary or social
  thought still names Gemini;
- the first urgent action changes exposure or otherwise produces a defensible
  bodily consequence;
- every accepted call reaches a terminal before owner teardown;
- the world saves and all authority is released; and
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
- provider-free request profiles and exact-frame candidate records under the
  two resident run directories
