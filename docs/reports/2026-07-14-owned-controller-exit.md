# Behold now owns the end of a resident process

Venice epoch 5 exposed a lifecycle failure after an otherwise successful
resident life. `IrisLife` had stopped its policy, drained the action engine,
disconnected its Mineflayer body, closed its entity loom, released its entity
lease, and durably written `run_stopped`. The controller process nevertheless
remained alive for about nineteen seconds, so the world manager could not save
and stop Minecraft promptly.

The cause was a dependency timer, not unfinished Behold work. Mineflayer's
`onceWithCleanup` starts its timeout with a referenced `setTimeout` promise but
does not cancel or unref that timeout when the awaited event succeeds. Its
`once` helper defaults to 20,000 milliseconds. Crafting-table use awaits
`windowOpen` through that helper, which exactly explained the delay. The same
implementation remains in [Mineflayer's upstream
source](https://github.com/PrismarineJS/mineflayer/blob/master/lib/promise_utils.js).

Behold now treats completion of its normal CLI as an owned lifecycle boundary.
Only after `runConsole` resolves—which requires engine drain, task verification,
experience teardown, body disconnect, loom close, lease release, and durable
`run_stopped`—does the CLI synchronously emit a versioned
`behold.process-exit.v1` record and exit successfully. The record counts the
remaining Node resource types, so dependency leaks stay observable. Fatal or
ambiguous shutdown still follows the existing visible nonzero path.

A deterministic child-process regression creates a real referenced 20-second
timer, writes a durable cleanup marker, and exercises the supported completion
boundary. It exits in tens of milliseconds, records the remaining `Timeout`,
and verifies the marker survived. Source commit `96a181a` passed TypeScript,
ESLint, and all 297 tests.

## Real Minecraft proof

At that clean revision, continuing resident `IrisLife` entered managed Venice
epoch 6 without a task or tool allowlist. She naturally used the nearby
crafting table to make four sticks, later made more planks, and then made a
wooden pickaxe. Every successful craft reported `usedCraftingTable: true` and
an observed inventory consequence.

On operator shutdown, the controller wrote durable `run_stopped` at
`08:06:59.133Z`. Its process-exit record exposed ten remaining `Timeout`
resources, among other live Node resources, and the independent world manager
recorded `residents_stopped` at `08:06:59.153Z`: a 20-millisecond boundary,
down from about nineteen seconds. Minecraft then acknowledged its save, exited
with code zero, reached `stopped_verified`, and released world control. A final
status probe found the port, runtime session lock, control owner, and entity
leases clear.

Evidence:

- resident journal:
  `.behold-runs/venice-core-9a802c78123ffd46-6/IrisLife/2026-07-14T08-06-08-250Z-IrisLife.jsonl`
- independent managed lifecycle:
  `.behold-runtime/world-control/venice-core-9a802c78123ffd46/lifecycle-6.jsonl`
- deterministic regression: `tests/process-lifecycle.test.ts`
- completion boundary: `src/cli/process-lifecycle.ts`

This fixes the owned controller's completion semantics. It does not claim to
repair Mineflayer's general timer hygiene for arbitrary embedding processes;
libraries that embed Behold without using the CLI must still own their process
lifecycle explicitly.
