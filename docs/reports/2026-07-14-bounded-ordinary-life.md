# Bounded ordinary life: the owner works, the life loop is still too expensive

## Outcome

The production world owner can now run an untasked population for an exact
amount of live time. The clock starts only after Minecraft and every resident
are ready. When it expires, the owner stops new resident work, drains every
controller and cognition request, waits for Minecraft's save acknowledgement,
verifies that the port, session lock, and entity leases are clear, and releases
the world epoch.

That control passed a real continuing-world run. Ordinary-life acceptance did
not. The residents made meaningful Minecraft progress, but their cognition was
too frequent and too large, and urgent bodily danger still competed with
private project bookkeeping.

This is useful failure. It identifies the next system boundary without reducing
the native Minecraft action surface or inventing another scripted scene.

## The selected-model run

Source revision `d21025abe197b51ede5ab0bff43edc45b8e7fe21` was clean.
`ScoutLife` and `WrenLife` resumed the persistent vanilla survival world in
epoch `first-life-v1-12` with 70 and 49 prior Lync turns. Both the owner
lifecycle and resident journals identify the model as
`google/gemini-3.5-flash`. Aggregate provider concurrency was one.

The owner became ready at `2026-07-14T10:43:50.546Z` and began stopping at
`2026-07-14T10:44:20.587Z`: 30.041 seconds of live time against a declared
30-second boundary. The lifecycle ended in `control_released`; the server port,
session lock, controller leases, and owner record were all clear afterward.

Minecraft-confirmed progress was real:

- Scout recovered a dropped wooden pickaxe, mined and collected an oak log, and
  updated its continuing tools concern.
- Wren began a starter-shelter project, converted logs into planks, recovered
  from two ordinary crafting errors, crafted and placed a crafting table, then
  used it to craft three oak doors.
- The owner's timed stop interrupted Wren's later attempt to mine the crafting
  table. Mineflayer acknowledged cancellation, observed no side effect, and
  Minecraft saved with the table still present.

This was not a household proof. There was no shared project, conversation,
mutual aid, independent fresh-body witness, or restart after the new work.
Scout died under skeleton fire. Its final selected response at critically low
health was to change the text of its `early_tools` project to “retreat to
safety”; it did not perform the retreat before dying. That is a design failure,
not good planning.

## Measured resource use

| Measure                               |        Result |
| ------------------------------------- | ------------: |
| Live time                             |      30.041 s |
| Residents                             |             2 |
| Broker accepted / admitted / terminal |  17 / 16 / 17 |
| Provider calls recorded by residents  |            14 |
| Peak aggregate provider concurrency   |             1 |
| Prompt / completion tokens            | 254,099 / 815 |
| Total model cost                      |   $0.28757775 |
| Slowest completed call                |       4.775 s |
| New resident journal bytes            |       597,468 |
| New Lync bytes                        |       372,841 |
| Cognition journal bytes               |        53,279 |

The two residents therefore consumed one resident-minute in aggregate. The
run cost about `$0.288` per resident-minute and generated about 254k prompt
tokens per resident-minute. That is nowhere near a city-scale cognition
budget.

Wren's single autobiography-fold call was especially revealing: its request
body was 204,375 bytes, it consumed 67,319 prompt tokens and 439 completion
tokens, cost `$0.1049295`, and took 3.96 seconds. One disposable summary update
accounted for more than a third of the run's cost. The authoritative Lync source
did not need to be rewritten; its fold projection repeated too much observation
state.

A provider-free replay of Wren's later shelter decision was 46,964 bytes:
17,700 bytes of prior observations, 12,922 of tool definitions, 6,812 of system
and folded continuity, 4,266 of current observation, and 3,599 of exact tool
results. The urgent Scout replay was 27,360 bytes; tool definitions were 47.2%
of it. Earlier experiments already showed that merely changing the tool syntax
saved almost no billed tokens and hurt decisions. The next move is not another
compact action-wire experiment.

## The configuration calibration that preceded it

The first use of the new duration boundary resumed the same world for 60 live
seconds, but it inherited `LLM_MODEL=openai/gpt-4o-mini` from the credential
dotenv. The owner correctly recorded and admitted that model; the operator had
failed to override a stale environment choice. That run is configuration and
cost calibration, not selected-model evidence.

It still closed cleanly and exposed the same scaling issue: 29 accepted broker
requests, 258,273 prompt tokens, 1,025 completion tokens, `$0.03433515`, and
946,437 resident-journal bytes in 60 seconds. The selected run therefore names
its model explicitly instead of depending on the credential file. The shared
credential file was not modified.

## What the run changes

We have a forward affordance map at the family level: orient and perceive;
move and traverse; manipulate blocks; use inventory and crafting; care for the
body; communicate and coordinate; use shared artifacts; maintain projects and
places; and yield. Mineflayer and Minecraft adapters can be audited against
those families. We do not need to discover the existence of each family by
random model behavior.

What still requires lived evidence is the causal grain within and between
families: when an observation is fresh enough to act on, what cancellation
means, whether Minecraft independently confirms the consequence, which
information deserves attention now, and which cognition tier should pay for
the decision. This run found two cross-family errors:

1. Private memory maintenance is represented as a mutually exclusive action
   beside embodied Minecraft actions. Under urgent harm, that lets a resident
   write “retreat” instead of retreating.
2. Every ordinary turn can invoke a large general model request, and fold work
   can be larger than the decisions it is meant to support. Population
   concurrency is bounded, but aggregate call and token budgets are not yet
   enforced by the production owner.

## Gate for the next paid household run

The next paid run should wait for a reusable change at those boundaries. Its
acceptance gate should be declared before launch:

- exact explicit model identity in owner and resident evidence;
- hard aggregate call admission plus a post-run token and cost verdict;
- no private project-only action in response to urgent bodily harm while an
  embodied response is available;
- a fold request below 20k prompt tokens, with exact source anchors and action
  consequences retained;
- no more than `$0.10` and 80k prompt tokens per resident-minute for this next
  rung;
- provider-call latency below five seconds at p95 and aggregate concurrency one;
- clean timed stop with every broker request terminal, Minecraft saved, and all
  leases and OS ownership clear; and
- after those resource gates pass, a longer untasked episode with one genuine
  shared consequence and restart continuity.

These are near-term engineering gates, not the final city budget. If they
cannot pass without making the resident's world or action space smaller, the
architecture—not the inhabitant—has to change.

## Provider-free corrections after the run

The failures above have now produced three reusable source-level corrections.
They have passed the full repository gate, but they are not yet a second live
ordinary-life result.

First, urgent attention defers only `manage_project`, the private continuity
mutator. A provider-free replay of Scout's exact low-health observation at
journal sequence 40 retained every other admitted action. The old request was
27,360 bytes with 29 actions; the corrected request is 24,518 bytes with 28.
Its system messages fell from 8,461 to 7,451 bytes and tool definitions from
12,922 to 11,090. The regenerated urgent system guidance names only the actions
actually admitted. This removes the demonstrated “write retreat instead of
retreating” competition without selecting a bodily response for the resident
or narrowing ordinary deliberative play.

Second, live recent context and disposable Lync folds now use one canonical
causal observation projection. Historical evidence retains source turn
anchors, exact attempted actions and outcomes, body-state changes, and new
events, while dropping copied scene snapshots and suppressing only an exact
event sequence/type already present in the immediately preceding causal frame.
Bounded event omission remains explicit in `eventWindow`; it is not silently
treated as complete. On the actual Wren turns 41–48 that produced the
204,375-byte fold request, the newly projected `newLoomEvidence` is 33,930
bytes. Scout turns 57–64 project to 41,483 bytes. The former number is not
directly comparable to the complete old provider request, and no billed-token
claim is made until the next real fold call.

Third, the production cognition owner now accepts `--maxModelCalls <n>` as an
exact population-wide admission ceiling distinct from concurrency and live
duration. The loopback broker refuses every valid request after the accepted
count reaches `n`, before any further upstream call; concurrent-arrival tests
prove the count cannot overshoot. The configured limit, remaining admissions,
and exact accepted count are present in snapshots and the hash-chained broker
journal, and the foreground owner begins its normal shutdown when the limit is
reached. This is a hard call bound, not yet a hard token or dollar bound.

The provider-free Scout profile and both real-Lync projections performed no
world mutation and made no provider request. The complete build, lint, and
test gate passes 324 of 324 tests after these changes.

## Evidence

- selected run journals:
  `.behold-runs/first-life-v1-12/{ScoutLife,WrenLife}`
- selected cognition journal:
  `.behold-runs/first-life-v1-12/_cognition/broker.jsonl`
- selected lifecycle:
  `.behold-runtime/world-control/first-life-v1/lifecycle-12.jsonl`
- provider-free request profiles:
  `request-profile-shelter.json`, `request-profile-urgent-project.json`, and
  `request-profile-urgent-embodied.json` under the selected resident run
  directories
- environment-calibration run:
  `.behold-runs/first-life-v1-11` and lifecycle `lifecycle-11.jsonl`
