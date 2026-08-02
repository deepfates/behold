---
id: beh-tm0q
status: in_progress
deps: []
links: []
created: 2026-08-02T00:15:51Z
type: bug
priority: 1
assignee: deepfates
parent: beh-06av
---

# Deliver private resident speech to its recipient

Episode oxford-qualified-habitat-a-qwen36-camera-v1/000004 retained a full 169-character Sedge whisper as whisper_input_dispatched, but Lark received no lived event because InhabitantExperience and the console bind Mineflayer chat but not its separate whisper event. Private delivery is therefore absent from recipient perception and history.

## Acceptance Criteria

A Minecraft whisper received by a resident becomes one high-salience recipient event that preserves exact sender/text and private channel, reaches model-facing continuity without being called public chat, is journaled durably, and is readable through canonical Lync/Textile presentation. Public chat remains distinct. Focused tests and an ordinary resident-to-resident live exchange pass.

## Notes

**2026-08-02T00:29:00Z**

Implemented distinct public chat/private whisper reception in both resident experience and managed console. Recipient events retain exact sender/text/channel; private speech is inherently addressed; factual and folded continuity preserve the private distinction. Canonical Lync commit ddace87 renders received v2 private speech as Private whisper while retaining byte-stable v1 public presentation. Behold full check: 696 pass, 1 intentional skip; Lync pnpm verify: 200 pass. Ordinary resident-to-resident exchange remains required.
