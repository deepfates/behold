---
id: beh-766r
status: open
deps: []
links: []
created: 2026-08-02T09:06:11Z
type: bug
priority: 0
assignee: deepfates
parent: beh-06av
tags: [observability, context, living-world]
---

# Make the literal model-facing resident turn inspectable

Episode 000015 retained canonical projected experience, exact model-returned JSON, consequences, hashes, sizes, roles, and token accounting, but ordinary bodyRetention=none discarded the literal serialized messages, image attachment, tool definitions, schema, and response body. We therefore cannot exactly reconstruct what it was like to be the resident from the retained episode while making treatment-level claims.

## Design

Provide one bounded, explicitly private inspection path for treatment development that shows the exact provider-bound message/image/tool/schema body and exact response alongside its canonical Lync turn and Minecraft consequence. Keep ordinary privacy and storage defaults explicit; do not copy this into operational journals or make another history authority. Prefer a named opt-in episode capture or direct authenticated reconstruction whose digest equals the actual request.

## Acceptance Criteria

For a fresh ordinary resident decision made under the selected treatment, an authorized operator can inspect the exact model-facing messages in order, image binding/content, available tools and response schema, exact raw model response, parsed choice, action settlement, and next experience. The inspected request digest equals the broker-admitted request digest. The episode record states whether exact inspection is available or unavailable. Default no-body runs remain truthful about that limitation; Lync remains canonical and Textile read-only.
