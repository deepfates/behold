# A resident naturally looked around

On July 14, 2026, the relative first-person orientation primitive was tested in
a fresh admission of the Venice `living` Place. `JuniperLife` had no task,
target, tool allowlist, prior turns, active project, staged item, or privileged
scan. Its first free `openai/gpt-5.6-luna` decision was
`look_direction {"direction":"around"}`.

Mineflayer turned the exact body from south to north, Minecraft reported the
new orientation, and the next first-person terrain observation changed from a
view containing glass, polished-andesite stairs, stone bricks, and leaves to a
view containing an iron trapdoor. Juniper then chose a normal bounded movement
from that evidence and subsequently chose `look_direction left`, which turned
the body from north to west and exposed a third terrain sample. It later
started its own `starter-kit` project. No controller selected any of those
intentions.

The action keeps raw yaw and pitch out of the resident surface. It offers only
left, right, around, up, down, and level; the Mineflayer body performs the turn;
and success requires the body orientation to match afterward. Raw angle
control remains operator-only. Focused tests also cover pitch bounds,
unavailable orientation, unconfirmed turns, invalid directions, and human
interruption. The full repository gate passed 291/291 on source commit
`fe0a7a6` before the run.

## Evidence

- Place admission:
  `.behold-runtime/place-epochs/venice-core-v1-living-natural-v2`
- immutable Place release manifest:
  `07d076d935141a50385e319cae3b4d00f9fb09ca0a018ebf5327064d49d5c78c`
- run journal:
  `.behold-runs/venice-core-9a802c78123ffd46-4/JuniperLife/2026-07-14T07-42-41-135Z-JuniperLife.jsonl`
- managed lifecycle:
  `.behold-runtime/world-control/venice-core-9a802c78123ffd46/lifecycle-4.jsonl`

Five model calls used 24,478 prompt tokens and 581 completion tokens, cost
$0.03407975, and took 18.251 seconds of aggregate provider latency. Four
actions completed. The final movement was deliberately interrupted by the
human stop and Mineflayer acknowledged cancellation. The server saved and
stopped, the lifecycle reached `stopped_verified` and `control_released`, and
the port, session lock, control record, and resident lease all checked clear.

This proves that relative visual orientation is an intelligible and usable
resident affordance. It does not prove that semantic rays are sufficient for
architecture, that coordinate-based movement is the right exploration
surface, or that the resident can yet perform every native Minecraft activity.
Those remain separate cells in the affordance census.
