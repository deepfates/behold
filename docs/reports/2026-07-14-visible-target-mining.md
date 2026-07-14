# Visible-target mining: three live failures compressed the interface

## Outcome

Three untasked Wren runs on July 14, 2026 turned a costly two-decision mining
sequence into one exact player-grain choice:

1. the resident sees bounded first-hit surfaces from its camera;
2. the world offers exact visible targets from the current body;
3. the resident chooses one target;
4. the body owns turning, bounded approach, and the Minecraft dig operation;
5. the executor freshly rechecks target identity and the same safety predicate;
6. Minecraft's block update, followed by later observation, determines the
   consequence.

This is reusable interface work. It is not a `clear_foliage`, `escape_tree`, or
starter-shelter story command. The runs also exposed that the current resident
safety policy and a neutral model benchmark must not be conflated.

## Run 49: the existing surface was too fine-grained

`first-life-v1-49` ran the ordinary untasked direct mind on
`openai/gpt-5.4-mini`, without an action allowlist. Wren dug several leaves and
collected two dropped items. Item collection moved the body from approximately
`(16.5, 69, 87.3)` to `(20.7, 72, 85.5)`, out of the original cell but farther
into the canopy. This is not evidence of escape or survival competence.

The useful finding was structural. Mining a peripheral surface required one
model turn to `face_visible_target`, a fresh observation, and another model
turn to `dig_block`. The run spent 12 accepted calls, 114,251 prompt tokens,
568 completion tokens, `$0.08642985`, and 16.419 seconds of aggregate model
latency in 35.634 seconds of resident runtime. The same face-then-dig pair
recurred three times.

Commit `0a5b5ff` first carried a visual target id directly into `dig_block`, so
one admitted resident intention could own the motor sequence.

## Run 50: schema safety caught a false implementation

The first implementation did not reach the model as intended. It replaced the
catalog's required coordinate arguments with a required target id only in the
dynamic offer. The policy's schema-subset gate correctly rejected that as a
broadened world offer rather than weakening its admission rule.

`first-life-v1-50` therefore establishes no mining capability. It made eight
accepted calls, used 79,884 prompt and 453 completion tokens, cost `$0.0510651`,
and accumulated 11.991 seconds of model latency. The production log repeatedly
reported `rejected broadened world-offered schema: dig_block`.

Commit `d757958` made the public resident contract target-only and retained
coordinate mining only as an internal programmatic implementation path. A
regression now compares the actual dynamically offered schema against the
actual executable catalog through the same admission check.

## Run 51: one meaningful choice exposed a precondition mismatch

`first-life-v1-51` crossed the intended live boundary. GPT-5.4-mini directly
selected:

```text
dig_block {"target":"block:overworld:24:70:85"}
```

No separate facing decision was required, and no broadened-schema rejection
occurred. The body was standing at y=72, however, while the chosen leaves were
at y=70 and y=69. Execution correctly refused the selections as unsafe downward
digging. After repeated attempts, the policy blocked the failed strategy. The
run made six calls, used 64,568 prompt and 277 completion tokens, cost
`$0.0424149`, and accumulated 9.199 seconds of model latency.

That refusal matched the current resident safety policy, but the target was not
impossible in vanilla Minecraft. Commit `cebe86e` made that policy internally
consistent by sharing one body-support predicate between action publication and
execution. A provider-free replay of run 51's exact first observation now
removes every below-support or supporting-body target and retains only the two
visible same-level surfaces:

```text
block:overworld:34:72:79
block:overworld:34:72:76
```

The full repository gate passes 406 tests. The managed world is stopped, with
its port, session lock, world owner, and resident leases clear.

## What this earns

The stable abstraction is not a larger action catalog. It is a five-part
boundary:

- **Lived reference:** one exact object from the resident's current view.
- **Dynamic offer:** only choices supported by this observation and body.
- **Resident intention:** one culturally legible action on one selected thing.
- **Embodied skill:** bounded motor details that preserve that intention.
- **Independent consequence:** Minecraft and a later observation say what
  happened.

The dynamic offer is advisory, not authority. World state may change after the
observation, so execution revalidates the target and true Minecraft invariants.
Safety preferences need a separately named policy: a neutral benchmark should
not remove a risky legal action merely to improve the model's choices. This
distinction gives us a scalable pattern for use, placement, containers,
entities, and future native interactions without handing the model raw controls
or adding a story-specific macro.

## What remains red

These runs do not prove that an untasked model has successfully completed a
direct visual mine, escaped the canopy, found safe ground, built shelter, or
survived an open-ended life. They also remain too expensive for continuous
population-scale cognition. Native conformance proves that exact visual mining
can perform and witness a real block mutation; the live mind proof currently
establishes direct selection plus safe refusal.

The next capability question is traversal, especially legible safe descent from
irregular terrain. It should be answered from native-player observation and
movement semantics, not by adding a `get_out_of_tree` tool.
