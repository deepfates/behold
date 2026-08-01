---
id: beh-yjkx
status: open
deps: []
links: []
created: 2026-08-01T09:35:30Z
type: task
priority: 0
assignee: deepfates
parent: beh-06av
tags: [architecture, authority, simplicity]
---

# Make habitat authority and mutable state legible

State and enforce the smallest authority algebra for one resident cycle and one habitat lifecycle. Find duplicated writable representations or orchestration state that can disagree, then remove or bind only defects that matter to ordinary use.

## Design

Start from World to View to Choice to Attempt to Consequence to Lync to next View. Minecraft owns world truth and consequences; the body owns raw experience and controls; the controller owns one current decision; Lync owns canonical life history; episode records bind lifecycle facts; Textile and operator views project rather than rewrite. This is not a general architecture rewrite.

## Acceptance Criteria

Canonical documentation and the supported code path agree on the owner of every causal transition and durable record. An adversarial trace of ordinary live, stop, and resume finds no independently mutable duplicate capable of changing admitted perception, action, consequence, identity, or lifecycle truth. Any duplicate found is removed, derived, or explicitly bounded by one owner, and the resulting path is exercised live.
