# Native Minecraft material fact v2

## What happened

`BodyResident` entered a fresh managed Minecraft 1.21.4 epoch with one dirt
item. The body's initial position occupied the requested destination, so the
ordinary `place_block` interpreter first owned one bounded step aside and then
placed dirt at `(24, -60, 0)` in the overworld.

This was deliberately a scripted proposal, not a model choice. The claim under
test was the inhabitation boundary: can one admitted player action cross real
Behold authority, cause an exact Minecraft-confirmed change, enter the
resident's continuing Lync life, and later be verified without trusting the
controller's success report?

After the resident's terminal result and complete post-action observation were
durable, the managed owner quiesced the resident. A separately connected
`BodyWitness` then loaded the same world epoch and observed dirt with state ID
10 at the exact dimension and cell. Only then did the world-aware verifier emit
`minecraft.block-transition-and-later-presence.v1` for the air-to-dirt change.

The resulting action graph contains nine records:

1. observation before;
2. scripted proposal;
3. authentic permission decision;
4. execution start;
5. execution terminal;
6. resident observation after;
7. fresh-body observation after quiescence;
8. world fact;
9. structural check.

## What the end-to-end test caught

The first clean run failed before a resident entered the world because the
managed launcher supplied policy, action, and safety profile flags that the
custom proof-resident CLI did not accept. That was a real integration defect,
not a flaky world result. The fix introduced one shared managed-resident process
parser, migrated every custom live proof resident to it, added a full-contract
regression test, and reran the proof unchanged.

The repository gate then passed 441 of 441 tests, including adversarial cases
for duplicate authorization, intent and terminal-result drift, wrong position,
wrong dimension, stale or same-body witnesses, state disagreement, and invalid
quiescence order.

## Live evidence

- source revision: `a7951ec7bbaf870acaab3a9c9138da6d900f5887`;
- proof run: `material-action-v2-20260714b`;
- world: `behold-owned-flat-v1`, managed epoch `behold-owned-flat-v1-1`;
- action: `place_block`, ID `BodyResident:script:1`;
- exact transition: overworld `(24, -60, 0)`, air to dirt;
- witness: `BodyWitness`, dirt state ID 10;
- resident quiescence: lifecycle sequence 14, before the fresh witness;
- lifecycle events: 23;
- action-record records SHA-256:
  `721a598592ea9ebf257566dad763bb9718831b5309d8b954f779751d2845157a`;
- material claim SHA-256:
  `b0af42f27f509e4b1736b78e17512c12a8e5ce74466445f501aa460fc1a92bd9`;
- private report SHA-256:
  `dd99f89528e13993b353f09337921b7f6d39cfae01e828ca054bf806e69e6d36`.

Canonical evidence is under
`.behold-runtime/owned-world-proofs/material-action-v2-20260714b/`. Evidence
files are mode `0600` and contain private life and run context; they are not
publication assets.

## Independent reassessment

`verify:native-body` ran in a clean process. It reopened the native phase,
fresh-body witness, managed lifecycle, and canonical Lync file; checked their
digests and private paths; required exactly one quiescence receipt between the
resident terminal and later witness; reconstructed both the native assessment
and content-addressed action graph; and required exact equality with the stored
results.

The reassessment passed. Its private SHA-256 is
`83a98e67b127d4d7a033398e89313aac0ec20582ec18621e9524ff675614bb3e`.

## What this earns—and what it does not

This earns one real material composition of the narrow graph: observation,
proposal, authorization, execution, world-native fact, and outside check can
stay distinct while a personal life carries the terminal experience forward.

It does not prove that a model knows when or where to place a block, that the
change persists indefinitely, that the witness infrastructure had a separate
operator, or that Minecraft semantics belong in a shared package. The next
architectural test is a real turn in a contrasting world, currently Golarion,
followed by extraction only of the distinctions both worlds actually need.
