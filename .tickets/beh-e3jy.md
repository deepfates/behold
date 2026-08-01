---
id: beh-e3jy
status: in_progress
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

**2026-08-01T12:52:17Z**

An isolated candidate implementation exists at commit 6aaa8c086ddeacde1f9be74b8c4f6fb62ff6a6ac in worktree behold-beh-e3jy-checkpoint-v2. It binds exact canonical resident Lync prefixes in an ordered v2 source-set manifest without cumulative copies or eager union, retains v1 verification, and passes the full check (657 pass, one existing skip). It is not integrated or accepted: first preserve the active v1 six-hour stop, then adversarially integrate and exercise repeated multi-hour stop/resume allocation plus Textile reading.

**2026-08-01T13:03:38Z**

Adversarial follow-up produced isolated commit c2627cac2a70d4ccc73a449226353597d9531790 atop 6aaa8c0. It makes the new manifest and episode-record JSON atomic and exact-idempotent, rejects partial/different retry state without overwrite, and removes the redundant second full-prefix hash after resident drain. Focused live tests pass 20/20 and the full check passes 658 with one existing skip. A crash after clean-head publication but before the episode record still leaves that episode incomplete rather than reconstructing it automatically, but the authenticated clean head remains resumable and the next episode ID skips the incomplete directory. Keep both commits isolated until the active v1 epoch stops.

**2026-08-01T14:32:59Z**

Integration candidate was rebased over Behold main 6772bff in isolated worktree behold-checkpoint-integration. Current commits are 634b39e (ordered canonical prefix binding) and 03037ff (atomic publication). Full npm run check passes 660 tests with one intentional opt-in skip and zero failures. It remains deliberately unmerged until active v1 episode 000002 reaches its natural stop, is authenticated, and preserves the before-state for an ordinary same-world v2 resume.
