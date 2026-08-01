---
id: beh-2h0i
status: closed
deps: []
links: [beh-e6w5, beh-wssv]
created: 2026-08-01T23:13:50Z
type: bug
priority: 0
assignee: deepfates
parent: beh-06av
tags: [communication, action-contract, living-world]
---

# Stop silently truncating resident Minecraft speech

minecraftChat silently clipped every chat and whisper to 120 characters at a word boundary while the tool schema declared no limit. Qualified habitat episode 000001 consequently delivered syntactically amputated resident speech while canonical model intents contained complete text.

## Acceptance Criteria

The model-visible chat and whisper schemas declare their actual one-message character bounds. Complete in-bound utterances are delivered unchanged after whitespace normalization. Over-bound utterances are not sent and return an explicit result with actual and allowed lengths; no hidden clipping or hidden multi-packet expansion occurs. Focused tests, full check, and ordinary resume exercise a complete resident sentence.

## Notes

**2026-08-01T23:39:22Z**

First same-life resume episode 000002 exposed one missed owning seam: the published chat schemas used minLength/maxLength but validateResidentActionInput rejected those keywords, so Lark's attempted chat failed before world intent. Episode stopped cleanly and is retained as a negative integration result. Added exact string-bound schema support and adversarial under/over/non-string/malformed-bound tests; full check now passes 689/690 with one intentional skip.

**2026-08-01T23:53:58Z**

Episode 000003 exercised the repaired bound end to end. Lark's 156-character public sentence passed schema validation, was submitted unchanged as chat_input_dispatched, and appeared byte-for-byte in Sedge's chat_received event. Longer in-bound chats/whispers also remained complete; Textile now distinguishes dispatch from delivery. Full check remains 689 pass/1 intentional skip.
