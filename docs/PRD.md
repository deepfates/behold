# Historical product brief: one shared action surface

Date: 2025-10-14

Status: superseded design record, not current requirements or an operator
runbook.

The original Behold PRD proposed a plug-and-play Mineflayer console in which a
person and a model used one command registry and one serialized intent stream.
That console shape is no longer the product target. The current capability and
limits live in the [README](../README.md), the bounded current slice lives in
[First Life](FIRST_LIFE.md), and the intended endpoint lives in the
[product horizon](PRODUCT_HORIZON.md).

This short record remains because the earlier proposal contained design reasons
that still matter even though its interface, milestones, and acceptance tests
do not.

## Rationale that survived

- A resident should act through player-recognizable perception and controls,
  not privileged server state presented as if it were perceived.
- Human and model control should meet at an explicit, serialized ownership
  boundary. A model does not earn a parallel or hidden action surface merely
  because it is automated.
- Provider, terminal, and presentation choices should remain replaceable around
  the inhabitant's causal trajectory: observations, attempted actions,
  Minecraft consequences, and continuity.
- Operator visibility, bounded actions, prescriptive failures, and rate limits
  are safety properties, not cosmetic terminal features.
- Population-scale or durable-life claims require lived causal evidence. A
  command registry or fixture test can prove mechanics but cannot establish an
  inhabited world.

## What was superseded

The 2025 brief treated `behold <AgentName>` and a rolling terminal REPL as the
candidate production path. It specified a fixed command vocabulary, token
syntax, frame layout, human-over-model arbiter, and console acceptance tests.
Those details do not govern the current `behold live` lifecycle, qualified
Place input, resident sets, Minecraft/Lync authority boundary, or stop/resume
contract.

The complete original brief and its construction history remain recoverable in
Git. Keeping this file does not revive its old defaults, red gates, future
claims, or roadmap priority.
