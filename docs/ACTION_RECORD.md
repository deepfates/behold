# The action record

## Elevator pitch

The action record is a small immutable graph that keeps an inhabitant's
observation, proposal, authorization, execution, confirmed world facts, and
evaluation distinct without making different worlds share physics or game
rules.

It has two deliberately separate layers:

1. `src/evaluation/action-record.ts` validates the world-neutral envelope,
   content identities, causal and temporal graph, access metadata, source
   references, and a structural check record.
2. `src/evaluation/behold-action-record.ts` projects authenticated Behold and
   Minecraft evidence into that graph. Other worlds should write their own
   projection and semantic verifier instead of importing Minecraft concepts.

The generic checker proves graph conformance only. It does not prove that an
action was wise, that a physical effect occurred, or that a source tells the
truth. Those claims belong to world-aware verifiers that reopen the addressed
artifacts.

## The common envelope

Every record has a content-addressed ID, stage, world and run IDs, time,
author, creator program, derivation causes, optional world-local order,
optional controller/body reference, access policy, and opaque JSON payload.

The common stages are:

- **Observation:** what one body received, including named sources, explicit
  limits, an as-of cursor, and an access-controlled artifact reference.
- **Proposal:** what a controller wants to do, based on which observation, and
  any reason it chose to expose. A proposal cannot authorize itself.
- **Decision:** what authority allowed, denied, transformed, or deferred the
  proposal, linked to the authority's native evidence.
- **Execution:** what the world adapter started, failed, interrupted, or
  completed. A command returning `ok` is still only execution evidence.
- **World fact:** a claim confirmed by a world-native source and a named
  semantic verifier. Facts are optional when no such confirmation exists.
- **Check:** a structurally post-hoc record of what an evaluator inspected and
  what graph predicates passed. Its payload is exact and cannot add arbitrary
  semantic success claims.

The base graph does not require one fixed happy path. A denied proposal can
honestly end after its decision. An allowed proposal may have several
execution or observation records. A world fact appears only when a world-aware
verifier has earned one.

`causes` is reserved for production or derivation. Other relations remain
explicit in stage payloads. For example, a later observation says
`observedAfter`; it does not claim that every state it contains was caused by
the preceding action.

## Current Behold mappings

The neutral Minecraft turn currently maps as follows:

| Record             | Authenticated source                                  | Meaning                                                                          |
| ------------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| Observation before | Exact private `behold.inhabitant.v2` mind input       | This body's bounded situation, not global server state                           |
| Proposal           | Exact model intent and request artifact               | One action selected from the admitted catalog                                    |
| Decision           | Fresh `permission_decision` event                     | The named Behold authority allowed this exact intent                             |
| Execution started  | Fresh `action_started` event                          | Behold's action engine began dispatch of the authorized action to the world edge |
| Execution terminal | One fresh `action_completed` or `action_failed` event | Behold's action engine recorded one terminal world-edge result                   |
| Observation after  | Later complete inhabitant observation                 | The body received later action and world state                                   |
| Structural check   | Post-run graph assessor                               | IDs, references, ordering, access metadata, and evidence commitments conform     |

There is intentionally no `world_fact` in the neutral look record. A later
client pose and `self.currentAction` are useful observations, but neither is a
server-confirmed material effect.

The material Minecraft profile now adds three records without changing the
generic graph:

| Record                     | Authenticated source                                                                              | Meaning                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Resident observation after | Complete first-person observation immediately after the terminal                                  | The acting body received the result and later local state                                         |
| Fresh-body observation     | A separately connected Minecraft client after the resident quiesced                               | A different body later read the exact dimension, cell, block name, and state ID                   |
| World fact                 | World-aware verifier over callback-time `blockUpdate`, the successful terminal, and fresh witness | This exact cell changed from air to dirt during execution and the later client saw the same state |

The live material proof used a scripted `place_block` proposal through the
production engine. That is honest evidence for the body, authority, world, life,
and verification boundaries; it is not evidence of model competence. The fact
also does not claim indefinite persistence, a separately operated Minecraft
service, or that every successful action has a material consequence.

Behold's world-action binding now refuses a started action unless it finds one
fresh, earlier `permission_decision` for the same intent, with the same
authorization carried through start and terminal events. The record projection
uses the real event authority and time rather than reconstructing permission
after the fact.

## Checks and independent reassessment

`completeActionRecord` creates a structurally post-hoc check. It runs outside
the mind/world turn, uses a separate checker identity, and cannot guide the
completed proposal. This separation is useful, but it is not process
independence by itself.

The stronger neutral proof is `verify:neutral-turn`. That command independently opens
the private mind request, run journal, world lifecycle, Lync life turn, and
evaluator episode; verifies their digests and references; reconstructs the
decision, authorization, execution, observations, and action-record graph; and
refuses any mismatch with the stored result.

The material counterpart is `verify:native-body`. It reopens the phase,
fresh-body witness, lifecycle, and canonical Lync file; verifies exact digests,
world/run/resident identity, quiescence order, and one durable turn; then
recomputes both the native assessment and the complete action record. See the
[live material-fact report](reports/2026-07-14-material-action-fact-v2.md).

## Privacy

Every record and evidence reference carries a visibility, audience, and
projection policy. The current proof artifacts are private to the inhabitant
and run operator. Raw observations stay in access-controlled request and Lync
artifacts; the graph stores references and commitments. The proof process uses
a private umask, mode `0700` directories, and mode `0600` durable files. Its
independent reassessor rejects symlinks, paths outside the proof root, or
permissive modes on private evidence.

A SHA-256 digest is an integrity commitment, not encryption. Low-entropy data
may still be guessable, and a private file path may still disclose metadata.
No action-record bundle should be published merely because it contains hashes.
A public redacted projection and a two-observer non-leakage test remain future
work.

## What stays world-owned

The shared graph does not define perception, action catalogs, permission law,
physics, native event kinds, clocks, targeting, material-effect semantics,
checkpoint creation, or fork behavior. It also does not expose one generic
`fork()`: record branches, controller-trajectory forks, identity transfers,
and restored world histories are different operations.

Controller references are optional and stage-specific. Behold currently names
one controller instance from the managed run and body; it does not pretend its
program artifact is the controller identity or claim a controller lease epoch
that has not been authenticated into this record.

## Evidence still required

The following remain red:

- stale controller/lease fencing against live authority, not merely consistent
  references inside one graph;
- duplicate delivery of one proposal ID without a repeated physical effect;
- restart recovery without repeating a completed action;
- a second dependent proposal constructed only after the first result arrives;
- a public/redacted export with two-observer privacy evidence;
- the same graph predicates and independent semantic checks over a contrasting
  real world, with Golarion currently the strongest controller/world contrast.

These are named nonclaims, not properties inferred from passing unit tests.
