# Ollama strict-JSON action transport conformance

## Verdict

`behold.ollama-local-json-action.v1` is a viable **transport candidate** for a
future bounded local inference test. It gives both installed models the same
canonical 18-action human-semantic contract and bypasses Ollama native tools.
It is not yet a living-world or model-capability result: no model was loaded,
no inference ran, and no Minecraft process or provider was contacted.

The exact schema survives as raw model-request input and as exact rendered
prompt text. Not every schema constraint becomes an Ollama grammar constraint:
the four numeric bounds remain model-visible guidance and are enforced only by
Behold's unchanged final validator. That division is explicit below.

## Versioned path

The new adapter admits only:

- body and action profile `minecraft-human-semantic-v1` with
  `vanilla-player-v1` safety;
- transport `behold.ollama-local-json-action.v1` and schema descriptor
  `behold.ollama-local-json-action-schema.v1`;
- exact loopback `/api/chat`, exact model tag/content digest, exact installed
  template digest, and common 16k/512/temperature/load settings;
- a request with `model`, `messages`, `format`, `stream`, `options`, and
  `keep_alive` only—there is no `tools` field;
- one JSON object with exactly `action` and `arguments`, with no native tool
  call, prose, multiple candidate, correction, retry, or tolerant unwrapping.

The ordinary final user message contains canonical JSON for the complete
resident action catalog. The `format` value is a `oneOf` of the same exact
input schemas, discriminated by an action-name `const`. A required-action turn
contains only that admitted variant. Behold parses the envelope and admitted
action name, then sends the original arguments unchanged through the existing
resident action validator before any intent or world call.

Managed release identity now includes the local policy and therefore the
transport/schema, model, installed content, installed template, and settings.
Each raw attempt additionally records the exact action-contract and response-
format digests. The cognition broker reconstructs and checks that identity
before forwarding a request and verifies the returned model tag separately.

## What the model actually receives

The provider-free conformance input used the canonical catalog previously
derived from Behold revision `05a9cd6c09eb05ab6fd9a15742c4648323c1c734`.
There was no action/profile change between that revision and the implementation
base `b645511e8abfe858e9d4258bec71cff27594f6e8`; the surface remains 17 body
actions plus `wait_for_event`.

The same request construction was decoded through pinned Ollama `v0.23.2`
module revision `f866e7608f378dcfca6f8c717101df1945db3b97` and rendered independently
through both installed templates:

| Case | Model content digest                                               | Template digest                                                    | Native tools | Exact contract in rendered prompt | Raw `format` after `api.ChatRequest` decode |
| ---- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | -----------: | --------------------------------- | ------------------------------------------- |
| 3B   | `a80c4f17acd55265feec403c7aef86be0c25983ab279d83f3bcd3abbcb5b8b72` | `966de95ca8a62200913e3f8bfbf84c8494536f1b94b49166851e76644e966396` |            0 | yes                               | byte-identical                              |
| 70B  | `a6eb4748fd2990ad2952b2335a95a7f952d1a06119a0aa6a2df6cd052a93a3fa` | `948af2743fc78a328dcb3b0f5a31b3d75f415840fdb699e8b1235978392ecf85` |            0 | yes                               | byte-identical                              |

Both cases had the same raw `format` digest
`3ec80a04079073a5049e66431cb3ad1aae7ec758d0663fbf3a0753f9e4e5361d`,
stable response-format identity
`d7895e07207941a82930b22f026765553ff7f6a5d4b4a30fb8c9a421cd288879`,
and canonical action-contract identity
`50c72496c42a2a959645b279baf742bf04931e7a7d9115dfd108ab817bc57cc6`.
The full rendered prompts differ because the installed templates differ, while
the embedded contract substring is exact in each.

Ollama declares `ChatRequest.Format` as `json.RawMessage`; the decode proof
retained its bytes exactly. The pinned server passes those bytes directly to
`SchemaToGrammar`. The following grammar classification is grounded in the
pinned converter source
`llama.cpp/common/json-schema-to-grammar.cpp` SHA-256
`27e2d6c22db63244dac05d7be104413e18b7a58a0c807e5ab48fe6b9cf9feb42`.
The Go module distribution lacks the nested nlohmann/miniaudio headers needed
to compile that CGo package independently, so this slice did not produce a
fresh grammar text artifact. That is the largest model-free proof limitation.

## Constraint accounting

| Constraint                                           | Exact prompt/raw `format`                                                | Pinned Ollama grammar                                                    | Behold final boundary                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| All 18 admitted action names and descriptions        | Exact                                                                    | `oneOf` plus each name `const`; descriptions do not constrain generation | Rejects an unadmitted action                                                                 |
| One top-level object, exactly `action` + `arguments` | Explicit instruction and `additionalProperties: false`                   | Enforced as object shape                                                 | Strict decoder independently rejects missing/extra fields                                    |
| Required action, when controller-specified           | Exact contract field; `format` narrows to one branch                     | Enforced by the single remaining action `const`                          | Strict decoder checks the required action again                                              |
| Argument property names and required lists           | Exact                                                                    | Enforced                                                                 | Original validator enforces required fields                                                  |
| String/boolean/number/object/array types             | Exact                                                                    | Enforced                                                                 | Original validator enforces types and finite numbers                                         |
| String enums                                         | Exact                                                                    | Enforced                                                                 | Original validator enforces enum membership                                                  |
| Array item schemas                                   | Exact                                                                    | Enforced                                                                 | Original validator validates every item                                                      |
| `minimum`/`maximum` on four `type: number` fields    | Exact and visible                                                        | **Not enforced**; this converter implements bounds only for `integer`    | Original validator enforces all four bounds before intent                                    |
| Descriptions                                         | Exact and visible                                                        | Non-grammatical guidance only                                            | Not a validator constraint                                                                   |
| Extra argument keys                                  | Canonical action schemas do not declare an `additionalProperties` policy | Converter currently forbids them when building these object rules        | Original validator ignores them; this is a grammar-only narrowing, not a new controller rule |

The grammar is therefore not a substitute for Behold's validator. It is an
ergonomic generation constraint around a verbatim contract. The validator is
still authoritative for the exact resident action schema, especially numeric
bounds. The extra-key behavior is intentionally only reported here; changing
the canonical body validator or action schema would be a separate behavioral
decision outside this transport slice.

## Fail-closed evidence

Focused, no-network tests proved:

- legacy local-policy v1 and any transport/schema/template drift are rejected;
- requests contain no native tools and broker admission reconstructs the exact
  contract/format identities before the fake upstream sees bytes;
- invalid JSON, a top-level extra field, non-object arguments, an unadmitted
  action, and the retained typed-wrapper native-tool response each become one
  distinct `malformed_output` with one physical attempt and no correction;
- a valid strict-JSON `move_controls` proposal with `durationMs: 20000` crosses
  the strict decoder but is rejected by the original maximum-2000 validator
  before model turn, entity turn, intent, or world mutation; and
- two resident release configs bind different model/template digests to the
  same transport/schema/settings contract.

`npm run build`, `npm run lint`, and 12 focused TypeScript tests passed. The
model-free Go decode/render harness passed both installed templates with
`GOPROXY=off`. No Ollama runner remained loaded. A full suite was not run in
this bounded slice.

## Status

This removes the **native-tools schema/template** no-go; it does not authorize
inference. The smallest honest next experiment, if separately authorized, is
one inference through this exact transport using the already admitted envelope
and zero retry/substitution. It must retain malformed output as an observed
deployment outcome and cannot establish a fair 3B-versus-70B comparison.
