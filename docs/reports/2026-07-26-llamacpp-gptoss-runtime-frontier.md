# llama.cpp GPT-OSS does not clear the resident body gate

## Verdict

The retained llama.cpp/GPT-OSS probe completed and does not admit a new Behold
resident treatment. With the resident-session request unchanged, both responses
missed strict JSON integrity and took 14.495 and 22.748 seconds. With the
diagnostic `reasoning_effort: low` field added, both responses passed the exact
schema and unchanged Behold validator, but the first still took 5.687 seconds,
beyond the five-second urgent body horizon. The 3.553-second warm response does
not erase that miss and chose a container action for an observed stone wall.

This is a negative runtime result, not a model ranking. No Minecraft process,
world authority, action, retry, correction, normalization, or substitute was
involved. The retained evidence was classified without another inference run.

## Exact retained treatments

Both probes used LM Studio `0.4.12+1`, CLI commit `0b2a176`, and
`llama.cpp-mac-arm64-apple-metal-advsimd@2.14.0` over the installed GGUF
`ggml-org/gpt-oss-20b` artifact:

- artifact SHA-256 `52f57ab7d3df3ba9173827c1c6832e73375553a846f3e32b49f1ae2daad688d4`;
- 12,109,564,352 artifact bytes;
- 16,384 context tokens, 512 maximum output tokens, and temperature 0.2;
- exact `behold.ollama-local-json-action-schema.v2` response shape and final
  Behold action validator;
- two successive retained OxfordQwen resident requests from the same persistent
  life, with no world interface.

The first treatment omitted `reasoning_effort`, as the admitted
`behold.lmstudio-local-resident-session.v1` request does. LM Studio's inventory
described the model default as low, but the runtime reported 107 and 455
reasoning tokens. Horizon one returned two concatenated JSON objects. Horizon
two reached the 512-token limit and retained an extra closing brace. Both were
rejected before an action boundary.

| Horizon | Wall time | Reasoning tokens | Finish | Strict result                        |
| ------: | --------: | ---------------: | ------ | ------------------------------------ |
|       1 |  14.495 s |              107 | stop   | invalid concatenated JSON            |
|       2 |  22.748 s |              455 | length | invalid JSON; output ceiling reached |

The second treatment explicitly added `reasoning_effort: low`. That field is a
diagnostic input and is not part of the admitted resident-session v1 request.
The runtime then reported zero reasoning tokens and returned one validator-clean
object at each horizon. However, LM Studio's transformed model-input log labels
both requests `Reasoning: medium`. Low was requested, but runtime/template
conformance to that request is contradicted by the retained evidence and is not
proven.

| Horizon | Wall time | Action                      | Boundary result                              |
| ------: | --------: | --------------------------- | -------------------------------------------- |
|       1 |   5.687 s | `look_direction`            | valid structure; late for urgent body use    |
|       2 |   3.553 s | `inspect_focused_container` | valid structure; warm and below five seconds |

The second choice was structurally legal but grounded poorly: the observation
described a stone brick wall, while the commitment claimed a container UI would
open. The probe had no Minecraft authority, so no such action was attempted.

## Integrity and limits

Both runs recorded repository revision
`8d5616a03b3ad5b00b804f1727e5a4e8a45b5803`. Each unloaded its owned model and
ended with an empty LM Studio inventory. The explicit-low retained result and
model log have SHA-256 values
`103acbc28cfcdbed9505919b1ee346fc2e5e87afc8771150838ab93b2cb72fe0` and
`78d9dce1a801e8601c987f17a3fada019f31b45ee5239488babbe9c0ed809f9d`.
The unchanged-request result has SHA-256
`b4e7f20b0ffc9f720aa58616c8dfe7af6baf058902047d8813079e42f0a4cbef`.
The probe used ignored compiled `dist` modules but did not record their exact
byte digests, so the Git revision does not independently attest those generated
JavaScript bytes.

The source requests predate the long-term LM Studio fold transport added in
`8d5616a`; their older folded ranges still say the automatic summary was
unavailable. The probe therefore does not exercise the final durable-fold
request. That limitation cannot rescue its admission: one treatment failed the
strict response boundary twice, and the other changed the transport yet still
missed the first urgent deadline.

The supported conclusion is narrow. This installed GPT-OSS/llama.cpp treatment
is not the body-compatible local cognition path. Behold should retain stale-body
rejection and ordinary Minecraft time, and continue looking for a path that
meets both exact response integrity and the measured body horizon before using
it in another living-world acceptance.
