# LM Studio MLX resident-runtime probe

## Verdict

LM Studio's installed MLX runtime is a credible Behold cognition backend: it
preserved the exact strict resident action schema, kept two different local
models resident together, and returned four validator-clean decisions without
tools, repair, retry, substitution, or world authority. It was materially
faster than the exercised Ollama pair, but the observed 8.55–16.16 second
request latency still does not meet Behold's five-second bodily-urgency window.
This is runtime evidence, not a living-world acceptance or a model comparison.

## Exact boundary

The outer transport is `behold.lmstudio-local-resident-session.v1`. It uses the
loopback-only OpenAI-compatible `/v1/chat/completions` endpoint with
`response_format.type = json_schema`, `strict = true`, the same exact
`behold.ollama-local-json-action-schema.v2` action schema already enforced for
local residents, and no native tools or server-side conversational state.
Every request binds:

- selected model key, catalog key, LM Studio index identity, complete artifact
  tree digest, installed chat-template digest, and a session-owned instance id;
- LM Studio app `0.4.12+1`, CLI commit `0b2a176`, and MLX engine
  `mlx-llm-mac-arm64-apple-metal-advsimd@1.10.1`;
- 16,384 context tokens, 512 maximum output tokens, temperature 0.2, and one
  parallel sequence per loaded model;
- stable charter/action-contract prefix, dynamic resident continuity and
  current perception, exact response schema, and the final unchanged Behold
  action validator.

The response parser accepts LM Studio's literal empty `tool_calls: []` as
evidence that no tool call occurred. It rejects a non-empty array or any other
non-null representation. It neither repairs nor normalizes model content.

LM Studio documents JSON-schema-constrained structured output on this endpoint,
explicit model-instance identifiers for loaded models, and exact-prefix MLX KV
cache checkpoints at 256-token boundaries:

- <https://lmstudio.ai/docs/developer/openai-compat/structured-output>
- <https://lmstudio.ai/docs/developer/rest/load>
- <https://lmstudio.ai/blog/mlx-engine-agentic-workloads>

## Setup findings

Two setup failures occurred before the successful probe and consumed no model
inference:

1. `lms load` did not accept an index's selected-variant key as a locator. The
   bridge now proves the selected variant and its exact artifact bytes during
   preflight, loads through its catalog alias, assigns a digest-derived custom
   instance id, and checks the actual loaded configuration before use.
2. The installed 1-bit Bonsai artifact could not load in the selected MLX
   engine, whose error listed only 2/3/4/5/6/8-bit support. It was excluded as
   runtime-incompatible. No conversion or substitute under that identity was
   attempted.

The completed probe used two already-installed four-bit MLX artifacts:

| Resident model                    | Artifact bytes | Complete tree SHA-256                                              | Template SHA-256                                                   | Loaded memory |
| --------------------------------- | -------------: | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------: |
| `google/gemma-4-26b-a4b-qat@4bit` | 15,641,333,028 | `cad5a2a1f495bc41ea2c1e6fa202c4860dbd1bea9f10363448c106286ce26d48` | `29af862bccabb14b90a4ff951bcd14c33fe74b651c5f07fc7f2e9aa46a59fe7c` |     14.57 GiB |
| `qwen/qwen3-vl-4b@4bit`           |  3,109,915,433 | `28f19c53f352d1ffd6238f93c1ba26f0df363e18a5e2aa05a70390842e65332c` | `3636d0f0bd6bef02654cdffdc447b79cb2cef8ab02cc75267345946291a489e4` |      2.90 GiB |

Both were simultaneously resident. Gemma loaded in 9.38 seconds and Qwen in
3.69 seconds during the retained successful session.

## Retained inference

The probe made two concurrent independent rounds. It reused two exact retained
Oxford resident requests but had no Minecraft or world authority.

| Round | Model | Wall time | Prompt / output tokens | Native TTFT | Native generation | Decision    |
| ----: | ----- | --------: | ---------------------: | ----------: | ----------------: | ----------- |
|     1 | Gemma |  16.163 s |             3,816 / 55 |    11.618 s |           4.426 s | look around |
|     1 | Qwen  |  12.724 s |             3,219 / 60 |     8.035 s |           4.564 s | look right  |
|     2 | Gemma |  11.353 s |             3,421 / 55 |     6.687 s |           4.642 s | look around |
|     2 | Qwen  |   8.550 s |             3,264 / 61 |     5.182 s |           3.342 s | look left   |

LM Studio returned the exact custom instance id in both `model` and
`system_fingerprint`; all four responses reported zero reasoning tokens. After
the empty-tool-array transport fix, the immutable raw responses decode into one
public commitment and one admitted action each, and all four action arguments
pass Behold's unchanged validator.

Second-round latency improved substantially, and each resident's stable prefix
hash was unchanged. The retained LM Studio log does **not** report cached versus
uncached prompt-token counts, so this is consistent with prefix reuse but does
not prove a cache hit. Significant unrelated host load was present during the
run; the numbers are observed deployment conditions, neither a clean benchmark
nor grounds for normalizing away latency.

Retained ignored evidence:

- `data/lmstudio-resident-probe/result.json` — SHA-256
  `1ddbce453db59ea9326ef603964b8c056a813f10bba0c35f7611da012b28c84f`
- `data/lmstudio-resident-probe/model-log.jsonl` — SHA-256
  `3a1ddbefb65fa8317b8b605d3da446ad1bcf54aba65238ec76e5bbbbfc8d2dd0`

Both owned model instances were unloaded and the final LM Studio inventory was
empty. An unrelated Ollama model owned by another process was not touched.

## Limits and next product step

The retained source requests were produced before the controller-shaped-memory
repair in commit `5e8ade1`; their continuity object still contains nested raw
`turns`, actions, outcomes, and remembered perceptions rather than the final
human-scale `experiences` projection. The probe therefore establishes the
runtime, schema, exact identity, simultaneous residency, and rough latency. It
does not establish the final session context or resident behavior.

The useful next move is to admit this runtime through Behold's existing durable
broker/release/world-runner boundary and exercise the final resident-session
context in Oxford. Ordinary deliberation may tolerate the observed latency;
five-second bodily urgency may not. Behold must retain cancellation and stale
action rejection rather than slowing Minecraft, extending safety deadlines, or
presenting a delayed decision as current. The acceptance question is sustained
adaptive conduct in the world, not another isolated schema or throughput score.
