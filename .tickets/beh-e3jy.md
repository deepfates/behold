---
id: beh-e3jy
status: open
deps: []
links: []
created: 2026-08-01T12:10:58Z
type: bug
priority: 0
assignee: deepfates
parent: beh-9b2h
tags: [lync, long-running, storage, textile]
---

# Keep long-life checkpoints from copying cumulative Lync histories quadratically

The ordinary stop path currently copies every resident’s entire cumulative Lync life into each episode and then eagerly concatenates those copies into another full Textile union. In the active Oxford trial, combined Lync is growing about 78 MB/hour; repeated stop/resume checkpoints therefore amplify retained bytes quadratically even though canonical history grows linearly.

## Design

Keep canonical resident Lync bytes authoritative and preserve exact content-bound episode ranges without adding a writable evidence store. Retain backward reading of existing episode snapshots. Prefer copy-on-write or hashed prefix/range bindings for immutable episode evidence and an ordered source-set or on-demand Textile projection over another eager cumulative union.

## Acceptance Criteria

Across repeated stop/resume checkpoints of a representative multi-hour two-resident life, newly allocated checkpoint storage is proportional to new history plus explicitly retained viewing artifacts rather than the entire cumulative history per episode; every episode still binds each exact resident prefix/range and digest; older episode records remain readable; and Textile can read the retained lives without Behold rewriting canonical Lync.

## Notes

**2026-08-01T12:11:30Z**

Cross-repo reader seam is tracked in Textile as tex-wrif. That ticket owns large ordered-source import and bounded browser materialization; this Behold ticket owns checkpoint retention and avoiding eager cumulative unions.
