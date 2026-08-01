---
id: beh-8nil
status: closed
deps: []
links: []
created: 2026-08-01T03:55:37Z
type: task
priority: 0
assignee: deepfates
parent: beh-kpqx
tags: [resident-interface, affordances, docs]
---

# Define one truthful resident control and affordance contract

Resolve the current overlap among stable player-shaped controls, observation-visible preconditions, authorization, meaningfully attemptable actions, and Minecraft-returned failure. Use the fixed human-semantic control surface only where it avoids hidden-state leakage; do not describe every callable control as presently executable or advisable.

## Acceptance Criteria

One canonical contract names stable controls, visible preconditions, authorization, and returned failures distinctly; HUMAN_SEMANTIC_BODY and RESIDENT_AFFORDANCES no longer contradict each other; runtime terminology and focused tests agree with the contract; no hidden classification task preference safety judgment or behavioral steering enters the ordinary resident observation.

## Notes

**2026-08-01T04:00:37Z**

Implemented the control/precondition distinction in the normative human-semantic and inhabitant contracts and reconciled RESIDENT_AFFORDANCES. Model-visible ordinary prompts now call the surface supplied bodily controls and explicitly say that authorization is not a success or precondition claim. The fixed cursor-like vocabulary remains unfiltered where presence would expose private classification, but human-semantic referential controls no longer admit guessed roster or inventory names when those visible sets are empty, and wake_up is absent while awake. Added a focused regression. npm run check passes 610 tests with one environment skip. No model provider world or resident process ran.
