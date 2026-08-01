---
id: beh-e6w5
status: closed
deps: []
links: [beh-wssv, beh-2h0i]
created: 2026-08-01T23:13:50Z
type: bug
priority: 0
assignee: deepfates
parent: beh-06av
tags: [timing, cognition, living-world]
---

# Carry truthful urgent cognition budgets through ordinary live

Ordinary managed live drops each resident urgentDecisionTimeoutMs even though the policy and standalone CLI support it, silently forcing the 5000ms default. Qualified habitat episode 000001 measured ordinary successful Qwen calls around 7-13 seconds and recorded 33 Lark plus 44 Sedge urgent deadline failures during real combat.

## Acceptance Criteria

Managed resident configuration validates, spawns, records, stops, and resumes an explicit bounded urgency timeout; a timeout-only mind revision is allowed without body/task/charter drift; late decisions remain rejected at the declared bound; focused tests, full check, and ordinary resume prove the configured value rather than a hidden default.

## Notes

**2026-08-01T23:53:58Z**

Episode 000003 ordinary resume recorded urgentDecisionTimeoutMs=15000 in the persisted resident revision and managed run for both residents. It settled 55 resident-decision admissions across one shared local model instance with zero unsettled quota; the two stop-boundary upstream_abort_settled cancellations were explicit lifecycle drainage, not hidden 5s deadlines. Full check remains 689 pass/1 intentional skip.
