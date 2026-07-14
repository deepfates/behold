# Verification ladder

## What progress means

We are building a reusable way to attach a mind to a world. The mind receives
one body's bounded observation and current affordances, proposes one action,
receives the authoritative result, observes the consequence, and carries a
personal context forward. The resulting causal trajectory must be usable for
continuation, inspection, replay, evaluation, and training.

A Minecraft resident surviving the night is one valuable task result. It is not
the framework goal. A survival failure may expose a missing observation, a bad
action boundary, a weak mind, or ordinary bad luck. We should learn which one
without patching the harness to make the creature choose differently.

Progress therefore has two scoreboards:

1. The **foundation scoreboard** asks whether the observation-action-life loop
   remains honest, replaceable, reproducible, and bounded.
2. A **world competence pack** asks what a particular mind can accomplish
   through one world's native interface. Minecraft survival, Dwarf Fortress
   governance, and another world's social life are different packs.

The foundation cannot earn credit from a scripted story succeeding. A
competence pack cannot change the foundation prompt or reveal hidden state to
force a pass.

## The foundation ladder

| Rung                 | Falsifiable claim                                                                                                                                                                    | Evidence required                                                                                                               | Current read                                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Honest turn       | A bounded observation leads to one admitted proposal, one serialized execution, one terminal result, and a fresh consequence without confusing their authorities.                    | Contract tests plus one live world action and an independent witness.                                                           | Proven for representative Minecraft actions; the full affordance census remains open.                                                                                                     |
| 2. Continuing life   | Identity, private context, cursors, unfinished concerns, and earned world consequences survive controller and process changes without repeating completed acts.                      | Clean stop, restart, first resumed observation and choice, Lync integrity, and fresh world evidence.                            | Proven for several Minecraft lives and two-resident exchanges.                                                                                                                            |
| 3. Replaceable mind  | Direct, Ax, scripted, local, and future minds can receive the same request and return the same decision contract without gaining body authority.                                     | Exact request identity, adapter provenance, matched proposal replays, and one matched real rollout.                             | Direct and Ax now complete a live-provider comparison from one immutable request artifact with controller-authenticated matching input identity; one matched real rollout remains red.    |
| 4. Replaceable world | A second real world can publish its own bounded observations and affordances into the same causal loop without importing Minecraft concepts or weakening its own authority.          | One live turn and continuation in a contrasting world, followed by a comparison of what truly repeats.                          | Design correspondence exists in ALMO, Armok Lab, Cantrip, Golarion, and World Instrument; a second live adapter proof is red.                                                             |
| 5. Learnable episode | A bounded episode can reference exact life and world-history ranges, become a dataset example, and support optimization without becoming private memory or changing the environment. | Lync episode references, immutable request/program identities, train/held-out separation, and a held-out real rollout.          | Request and Ax program artifacts plus evaluator-owned exact life ranges now exist; runtime/program/lifecycle binding, assessment, world-lineage, dataset, and held-out proofs remain red. |
| 6. Population        | Many private lives can share one world and cognition budget without identity leakage, unfair scheduling, uncontrolled cost, or ambiguous consequences.                               | Concurrency and cost bounds, independent trajectories, contention tests, clean drain, and soak evidence.                        | Two-resident ownership and cognition proofs pass; sustained population behavior and soak are red.                                                                                         |
| 7. Forked histories  | Worlds can checkpoint, fork, continue, and be re-entered without confusing a place artifact, runtime epoch, world history, life, or evaluation episode.                              | Immutable checkpoint lineage, isolated writable children, branch-local clocks, crossing receipts, and honest identity behavior. | Armok Lab has the leading live pattern; the Minecraft history lifecycle is red.                                                                                                           |

This is a dependency ladder, not a waterfall. We can study later rungs early,
but a later demonstration does not repair a broken earlier invariant.

## The evidence loop for each change

Every meaningful change should close this loop:

1. **Name one claim.** Say what new fact would be true and what layer owns it.
2. **Name the likely falsifier.** Include the easiest way the demo could cheat,
   leak hidden state, confuse an acknowledgement with a consequence, or depend
   on one prompt.
3. **Use the cheapest honest test first.** Contract tests and provider-free
   request reconstruction should find cheap errors. They do not prove a live
   world claim.
4. **Run the smallest real closed loop needed by the claim.** Use the world's
   actual authority. Keep evaluator state outside the inhabitant's observation.
5. **Witness from another authority.** Reobserve after the terminal result and,
   for material claims, use a fresh body or native world evidence.
6. **Test the boundary that should survive.** Depending on the claim, swap the
   mind, restart the controller, restore the checkpoint, or run the second world.
7. **Record exact evidence.** Store versions, profile and program identities,
   request hashes, world and life identities, event ranges, latency, tokens,
   cost, stop reason, and artifact paths.
8. **Try to delete the special case.** Once the proof passes, remove story-shaped
   actions, prompt patches, duplicate runners, and fixtures that no longer catch
   a distinct failure.

A claim stays red when its evidence is reconstructed but not hash-equal,
fixture-only when it claims a live property, dependent on hidden evaluator
state, or missing a terminal consequence. Honest red is progress because it
locates the next boundary.

## How we choose the next swing

Choose the highest-leverage red edge that is shared by more than one future
world or mind and whose prerequisites already pass. Prefer a small proof that
can invalidate the design over a large demonstration that merely exercises it.

Use this order when two candidates seem equally useful:

1. causal integrity and loss visibility;
2. exact reproducibility and replaceability;
3. portability to a second real world;
4. learning on held-out episodes;
5. population cost and operations;
6. additional world-specific competence.

The next foundation swings are therefore:

1. Finish the neutral request boundary and make exact versus reconstructed
   replay impossible to confuse.
2. Run direct and content-addressed Ax minds over the same captured requests,
   then run selected candidates over held-out real Minecraft episodes.
3. Prove one honest turn and continuation through a second real world adapter.
   Only then extract a shared package from the semantics both integrations
   actually need.
4. Apply the resulting conformance pack to population and forked-history work.

Minecraft competence work remains useful when it discovers a generally missing
fact or action. It should live in a named competence pack with outcome-only
scoring, not silently become the foundation roadmap.

## Measures that cannot be replaced by test count

- **Causal integrity:** ambiguous, duplicated, fabricated, or unattributed
  physical consequences; target is zero.
- **Reproducibility:** exact request, profile, program, checkpoint, and episode
  identities when a comparison claims they match.
- **Replaceability:** minds and worlds passing the same boundary without private
  adapter assumptions entering the waist.
- **Continuity:** restarts without identity leaks, event loss, or repeated
  completed actions.
- **Boundedness:** p50/p95 decision and action latency, prompt bytes, tokens,
  cost, storage growth, and CPU/memory per active and sleeping inhabitant.
- **Learning:** held-out outcome improvement without changing the observation,
  action, safety, or evaluator contract.
- **Trace utility:** an episode can be inspected, replayed as a record, exported
  for training, and traced back to its authoritative world and life evidence.

Unit tests protect invariants. Live proofs establish one real composition.
Cross-world and held-out results establish that we built a reusable medium
rather than a successful Minecraft story.
