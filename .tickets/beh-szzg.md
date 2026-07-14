---
id: beh-szzg
status: closed
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

**2026-07-14T10:10:00Z**

Closed with one evidence-derived production flow across all three accepted places. The runner materializes any selected fixture/profile, emits human and machine guides plus `/trigger` controls, proves safe arrival, preloads and physically traverses a bounded collision-valid route with per-waypoint deadlines/diagnostics, performs the measured reveal, and saves/stops cleanly. The generic native client has no personal identity and the precompiled ScreenCaptureKit path produced a real 18.6-second San Francisco movie at digest `d731ac…92fa`. The independent verifier re-derives every plan and closes the exact three-place set with capture required. Results and limits are documented in `2026-07-14-human-visit-v1.md`.
