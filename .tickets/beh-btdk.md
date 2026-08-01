---
id: beh-btdk
status: closed
deps: []
links: []
created: 2026-08-01T21:44:09Z
type: bug
priority: 0
assignee: deepfates
parent: beh-06av
tags: [embodiment, perception, minecraft]
---

# Measure bounded body-control motion from exact endpoint displacement

The human-semantic move_controls result derives bodyMoved from floored feet cells. Retained Oxford reality contains meaningful same-cell displacement mislabeled false, which can also suppress post-motion settlement. Preserve bounded key controls and action_completed semantics; measure only endpoint displacement without inferring collision, route, usefulness, or intent.

## Acceptance Criteria

Exact zero displacement reports bodyMoved=false. Endpoint displacement of at least the established 0.1-block threshold reports bodyMoved=true even within one floored cell. Sub-threshold boundary crossings remain false. Existing no-pathfinding/control-release behavior remains intact, and post-motion semantic/camera settlement follows the corrected boolean. Focused tests and full checks pass.

## Notes

**2026-08-01T21:45:55Z**

Ground truth correction: retained Oxford requests already carried bodyMoved=false, so repeated no-op choices remain resident conduct. The separate measurement defect was quantified across 1,344 retained movement turns: 10 endpoint displacements >=0.1 blocks were mislabeled false by floored-cell comparison, max 0.932521. Repair now compares exact endpoint poses at the existing 0.1 threshold; no coordinates, magnitude, collision inference, pathfinding, or steering were added. npm run check passes: 676 passed, 0 failed, 1 skipped.
