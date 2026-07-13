---
id: beh-szzg
status: open
deps: [beh-w8qi, beh-xqf5, beh-905z]
links: []
created: 2026-07-13T23:49:26Z
type: feature
priority: 1
assignee: place-compiler
parent: beh-wzs5
tags: [human-ux, tour]
---

# Deliver polished cross-place human visit

One production flow from accepted artifact and profile to managed launch, clear map/join/landmark guidance, audited safe arrival, collision-valid ground leg, city-scale reveal, checksummed capture, and clean stop.

## Acceptance Criteria

Runs on all accepted places without personal usernames, absolute paths, fixed SF config, or manual hidden steps; emits structured progress and evidence; failure identifies the exact stage; ordinary visit does not require an agent.

## Notes

**2026-07-13T23:50:57Z**

Audit evidence: play.ts uses managed owner but defaults to sf-csdr/local config; native-client.ts has personal username/UUID/macOS Java/accessToken assumptions. No production flow coordinates artifact, join/map/orientation/safe route/capture/stop. Visit must not require an agent.
