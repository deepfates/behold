# Egocentric walking entered a natural life

On July 14, 2026, Behold added a player-grain `move_direction` affordance. A
resident chooses forward, back, left, or right and an optional one-to-eight
block distance. The body derives the destination from its own current yaw,
performs one bounded ordinary walk, and verifies the final horizontal column.
No world coordinates or raw angles appear in the model schema.

The change also made the navigation authority match its prose. Inspection of
Mineflayer Pathfinder found that Behold had disabled route digging but retained
the library's default dirt/cobblestone scaffolding list. Navigation could
therefore theoretically place a bridge outside the explicit world-change
authority. Normal body configuration now clears that list as well as disabling
digging and one-by-one towers. A regression protects all three settings.

When relative walking fails, the result includes only the adjacent body space:
the feet cell, head cell, and supporting block, with passability/safety. It does
not scan for an alternate route or choose the resident's next intention. Human
cancellation still succeeds only when Pathfinder acknowledges stopping.

Source commit `4805344` passed TypeScript, ESLint, and all 295 tests.

## Natural admission

A fresh Venice `living` admission then ran `IrisLife` on
`openai/gpt-5.6-luna`. The resident had no task, target, allowlist, prior turns,
active project, prepared item, or privileged scan. Its first request received
26 currently admitted tools, including the new action.

Iris did not choose `move_direction`, and no retry was made. She could already
see an exact oak-log surface and appropriately chose `move_to` for that known
coordinate. She then mined and collected wood, crafted planks and a crafting
table, adapted after a body-intersection placement failure, placed the table,
and continued her self-owned `survival-kit` project. This supports rather than
contradicts the intended split: relative movement is for local exploration;
exact movement remains useful for perceived or remembered targets.

Evidence:

- admission:
  `.behold-runtime/place-epochs/venice-core-v1-living-natural-v3`
- journal:
  `.behold-runs/venice-core-9a802c78123ffd46-5/IrisLife/2026-07-14T07-54-36-034Z-IrisLife.jsonl`
- managed lifecycle:
  `.behold-runtime/world-control/venice-core-9a802c78123ffd46/lifecycle-5.jsonl`

Twelve model calls used 95,107 prompt tokens and 1,062 completion tokens, cost
$0.12524675, and took 38.857 seconds of aggregate latency; the maximum call was
5.664 seconds. Ten actions completed and two failed visibly. The manager saved
and stopped Minecraft and reached `stopped_verified` and `control_released`.

One separate lifecycle red remains: the resident journal reached durable
`run_stopped` at 07:55:31.856Z, but the otherwise clean controller process did
not exit until roughly 19 seconds later. The port, session lock, owner, and
entity lease ultimately checked clear. This is not a movement failure, but it
needs a bounded-shutdown investigation rather than being hidden inside a green
feature result.

The live evidence proves natural admission and the reasoned coexistence of
relative and exact movement. It does not yet prove a real model selecting
`move_direction` against Minecraft. That remains an explicit census gap to be
closed by ordinary future life, not retry-until-green evaluation.
