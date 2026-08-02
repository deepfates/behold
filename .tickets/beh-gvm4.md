---
id: beh-gvm4
status: closed
deps: []
links: []
created: 2026-08-02T06:14:19Z
type: bug
priority: 0
assignee: deepfates
parent: beh-06av
tags: [observability, human-entry, episode-record]
---

# Distinguish optional human assessment from observed external players

Episode records currently write nativeHuman:null when no optional --native-player assessment was requested, even when preserved Minecraft and resident journals prove an unmanaged player joined and interacted. This is naturally misread as no human/player presence.

## Design

Keep nativeHuman backward-compatible as the optional declared-player assessment. Add an always-produced, conservative external-player summary derived only from the already-bound Minecraft server log and resident journals. Exclude managed resident bodies and never infer client provenance or biological human identity.

## Acceptance Criteria

With no --native-player flag, an observed unmanaged player yields nativeHuman:null plus a nonempty authenticated external-player summary with server and per-resident evidence. Managed resident bodies are excluded. A declared assessment can coexist with the same summary. Focused tests and the full check pass.

## Notes

**2026-08-02T06:17:02Z**

Episode 000012 ground truth: nativeHuman:null means only that no optional --native-player assessment was requested. The bound Minecraft log and both resident journals independently record unmanaged player importdf joining before resident release and later sending three public chats. Implementing an additive externalPlayers summary that preserves this distinction, excludes managed bodies, and never infers client provenance or biological human identity.

**2026-08-02T06:18:58Z**

Implemented additively in the episode-record writer. New records always include behold.live-external-players.v1 derived from the already-bound current episode server log and resident journals. It excludes managed bodies, preserves setup versus runtime witness events, records server line references, and classifies each participant only as unmanaged_player_client_provenance_unknown. nativeHuman remains the backward-compatible optional declared-player assessment. The exact episode-000012 inputs now summarize importdf with login/join/death-like event/three chats and four witness events in each resident journal. Focused tests and full npm run check pass: 724 pass, 0 fail, 1 intentional skip.
