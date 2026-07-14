# The first Minecraft world checkpoint has two honest futures

## Outcome

Behold can now hold lifecycle authority over one actually stopped Minecraft
world, seal its exact save as an immutable content-addressed checkpoint, and
materialize independent writable histories from it. The source world is not
renamed, reset, or made into a child.

This is the missing physical substrate for causal mind comparisons. A direct
mind and an Ax mind can now begin in separate real Minecraft worlds descended
from the same bytes, rather than proposing actions against one reconstructed
observation while only one future exists.

## Real First Life checkpoint

The production `first-life-v1` runtime was clear before capture: no world owner,
listening server, `session.lock` owner, or resident lease. World-control epoch
52 then held the runtime stopped while the checkpoint was copied and rehashed.

- checkpoint artifact:
  `sha256-30204d816f33fc7214d23f50ed1a3451e3dcc6cab0769343d75ecc141ff992b4`
- digest profile: `behold-tree-v2`
- contents: 31 files, 12 directories, 12,552,635 bytes
- writable histories: `first-life-direct-v1` and `first-life-ax-v1`
- Lync lineage:
  `lync:019f630d-a141-7806-8fe4-6442b10bcc2d`
- lifecycle journal:
  `.behold-runtime/world-control/first-life-v1/lifecycle-52.jsonl`
- durable receipt:
  `.behold-runtime/world-histories/receipts/first-life-matched-minds-v1-20260714.json`

An independent command reopened the artifact manifest and bytes, the exact
`source -> checkpoint -> [direct, ax]` Lync graph, the world-control journal,
and both child manifests. Both children still matched the checkpoint digest.
The source owner, port, session lock, and controller leases were clear after
release.

## The narrow abstraction

The implementation keeps six identities separate:

1. A compiled or prepared place is reusable world input.
2. A checkpoint is an immutable image of one stopped world state.
3. A history is one writable continuation from that checkpoint.
4. A runtime epoch is one managed server incarnation of a history.
5. A resident life is its own private Lync trajectory.
6. An evaluation episode is an outside reference to selected evidence.

Only the middle two are new here. The code does not define a universal world
ontology, merge divergent saves, copy resident memory, or choose what a mind
should do. Armok Lab supplied the earned pattern—exclusive authority, exact
checkpoint, isolated children, Lync lineage—but no Dwarf Fortress runtime code
or concepts entered Behold.

The reusable CLI is:

```text
npm run history -- fork ...
npm run history -- verify --receipt ...
```

Each child also has a normal `WorldLabDefinition`, so the existing managed
Minecraft owner can launch it without a second runtime path.

## Adversarial coverage

The repository gate passes 445 tests. The new tests establish that:

- two child worlds begin byte-identical to one immutable checkpoint;
- writing one child changes neither its sibling, checkpoint, nor source;
- a source change during capture fails before lineage is claimed;
- an active or ambiguous runtime is refused before copying;
- an existing child is reused only while its complete fork basis and bytes
  still match; and
- clean-process verification binds artifact, lineage, lifecycle, and child
  manifests instead of trusting the creator's return value.

## What remains red

This proves a real checkpoint and two launchable futures, not a counterfactual
mind result. Neither child has run yet.

Resident identity is the important next edge. One private life must not silently
become two continuing people. The first matched-mind experiment should use two
explicit branch-local evaluation copies with no inherited private Lync, feed
them the same admitted observation/action contract, and record that they are
copies rather than continuations. Later work can define an authorized life fork
with explicit memory-transfer policy and lineage; this proof does not pretend
that operation already exists.

The next acceptance gate is one causal turn in each sibling history with:

- the same checkpoint and initial world digest;
- the same model, bounded point-of-view observation, and admitted action set;
- distinct content-addressed direct and Ax program identities;
- ordinary world execution through the managed owner;
- terminal Minecraft consequences and later branch digests; and
- an outside comparison that reports differences without treating either
  future as what “would have happened” in the source life.
