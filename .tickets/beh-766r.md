---
id: beh-766r
status: closed
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

## Progress

The local `inspect:resident-turn` command now verifies an episode checkpoint, cognition journal, exact transport capture, resident journal binding, request digest, response bytes, and—when one exists—the canonical Lync causal turn. It writes only a newly created mode-0700 private directory with mode-0600 files. A real retained episode-000012 turn produced an exact 84,224-byte request, 849-byte response, 44,882-byte camera JPEG, matching broker/admission digest, and resolved causal turn. Episode `000015` correctly failed with `bodyRetention=none` and created no output. This proves the inspector and the limitation; the acceptance criterion still requires a fresh ordinary decision under the repaired selected treatment, so the ticket remains open.

## Notes

**2026-08-02T11:10:51Z**

2026-08-02 acceptance crossed on fresh selected-treatment episode 000019. The private inspector verified OxfordSedge journal model_turn 11 against the completed episode, broker journal, exact transport capture, and canonical Lync turn 401. It materialized a 62,655-byte provider request whose SHA-256 exactly equals the admitted body digest, the 15,313-byte camera JPEG, response schema, 733-byte exact response, parsed model turn, and 38,762-byte canonical causal turn. The output directory is mode 0700 and all six files are 0600. The request contains 21 ordered messages, including cognition 400 null followed by fresh experience. The first attempted invocation followed a stale README placeholder that said episode directory; the CLI correctly failed before output because it requires episode-record.json, and README now matches the actual interface. Default no-body episode 000015 remains honestly uninspectable.
