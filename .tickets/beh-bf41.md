---
id: beh-bf41
status: in_progress
deps: []
links: []
created: 2026-08-02T00:15:51Z
type: bug
priority: 0
assignee: deepfates
parent: beh-06av
---

# Refuse illegal cursor attack targets before Minecraft input

Episode oxford-qualified-habitat-a-qwen36-camera-v1/000004 offered attack_focused_entity while Sedge's exact cursor focus was an arrow/projectile. The resident chose the offered action; Minecraft kicked the body with multiplayer.disconnect.invalid_entity_attacked and the managed epoch entered recovery_required. This is an action admission defect, not resident conduct.

## Acceptance Criteria

The human-semantic action surface offers attack_focused_entity only for an exact currently focused entity class that Minecraft accepts as an attack target. Interpreter revalidation fails locally for a projectile or other illegal class and sends no attack packet. A legal focused living target remains attackable. Tests cover offer and adapter defense; an ordinary live run no longer permits this disconnect.

## Notes

**2026-08-02T00:29:00Z**

Implemented action-admission and interpreter defense in depth: only exact cursor-reachable Mineflayer living/player/mob classes are offered; projectile/object/orb/global/other classes fail locally as focused_entity_not_attackable and send no attack input. Focused tests cover projectile refusal and legal hostile offer. Full npm run check: 696 pass, 1 intentional skip. Ordinary live validation remains required.
