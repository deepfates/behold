---
id: beh-ro6n
status: closed
deps: []
links: []
created: 2026-07-31T01:23:25Z
type: task
priority: 1
assignee: deepfates
parent: beh-n4fe
tags: [living-world, resident-policy, architecture]
---

# Make the resident decision cycle explicit

Separate the existing perception, attention/wake, bounded context, mind decision, action admission/settlement, and Lync turn-commit phases behind the current resident policy facade. Preserve ordinary behavior while making the active phase and next wake cause directly inspectable for management and defect diagnosis.

## Acceptance Criteria

The production resident path exposes one coherent decision-cycle state with mutually intelligible phases and wake causes; phase transitions are driven by the existing authentic body, engine, mind, and loom boundaries; experiment/evaluation hooks do not define the core state machine; targeted transition tests and the full repository gate pass.

## Notes

**2026-07-31T01:44:48Z**

Implemented a volatile resident decision-cycle state at src/policy/decision-cycle.ts and drove it from authentic policy boundaries: perception, context preparation, mind wait, physical intent ownership, terminal settlement, and durable EntityTurn/Lync commit, with suspended/stopped dominance. Wake causes are compact diagnostics only and never policy input or history. The interactive resident view now shows phase, pending tool, and awaited boundary. Focused barrier/race tests passed; final full gate passed 583 with one environment skip. No Minecraft, model, provider, or Lync state changed.
