# Ollama typed-wrapper argument root cause

Date: 2026-07-25 local / 2026-07-26 UTC

This is a source-inspection and no-network regression report. It does not run
either installed model, contact a provider, or change resident treatment.

## Verdict

The captured `llama3.2:3b` response is schema-invalid and must not become a
resident turn, but it does not prove that the model is generally incapable of
Behold's tool surface. The synthetic feasibility request itself was not a valid
Behold action-contract probe: it used `additionalProperties` and `const`, which
Behold's published validator does not support, and Ollama 0.23.2's typed tool
API silently omits before template rendering.

The typed wrapper was not added by Behold. Ollama's generic tool parser also
does not construct or normalize it: it parses the model's JSON argument object
and copies the entries into its response. The strongest classification
available without another inference is therefore:

1. the model/template path emitted a JSON object containing the typed wrapper;
2. Ollama's generic parser preserved that object;
3. Behold's adapter preserved it again;
4. Behold's resident boundary rejected `reason` because an object is not a
   string; and
5. no model turn, correction request, retry, yield turn, intent, or world action
   followed.

Ollama did not retain the pre-parser generated text in the captured response or
the default server log, so the exact generated token string remains unknown.
The parser source is nevertheless sufficient to rule out schema-based argument
construction at that layer.

## Exact retained evidence

The checked-in fixture
[`tests/fixtures/ollama-local-typed-wrapper.json`](../../tests/fixtures/ollama-local-typed-wrapper.json)
contains the privacy-safe exact mind request, native `/api/chat` request body,
and native response body from the one authorized attempt.

- request body SHA-256:
  `2d4ff538670bccb842446bb498cec4c893a7496310627e7b5b96aabdc3dc5765`
- captured transport attempt digest:
  `a5f6eb6a44585ae7a07cc9f75a3ca4cee275bc3282c608fda27a906f815a31da`
- Ollama: `0.23.2`
- model: `llama3.2:3b`
- installed model digest:
  `a80c4f17acd55265feec403c7aef86be0c25983ab279d83f3bcd3abbcb5b8b72`
- installed template blob:
  `966de95ca8a62200913e3f8bfbf84c8494536f1b94b49166851e76644e966396`

The request used the standard native `tools[].function.parameters` shape and
the response named the correct tool. Its arguments were:

```json
{
  "object": "<nil>",
  "reason": {
    "type": "string",
    "value": "transport feasibility probe"
  }
}
```

The required input was a string-valued `reason`.

## Layer-by-layer source classification

### Behold request and action boundary

`directOllamaRequestBody` maps an admitted `ResidentMindRequest` into the
ordinary native Ollama `messages` plus `tools` body. `responseDecision` returns
an object-valued `function.arguments` unchanged; it does not unwrap a
`{type,value}` shape.

The last trust boundary is later and intentionally separate.
`validateMindDecision` validates that unchanged input against the action schema
before minting an intent. The captured wrapper fails with
`$.reason: expected string`; the terminal scheduled opportunity is
`adapter_rejected`.

The synthetic fixture also exposes a probe error. Behold's
`validateResidentActionInput` supports only `type`, `properties`, `required`,
`enum`, `minimum`, `maximum`, `description`, and `items`. The fixture's root
`additionalProperties` is unsupported, and its nested `const` would also be
unsupported. Even the requested ideal argument could never have passed that
synthetic schema through the real resident boundary.

### Ollama 0.23.2 typed tools and template

The exact Ollama tag used locally is source revision
[`f866e7608f378dcfca6f8c717101df1945db3b97`](https://github.com/ollama/ollama/tree/f866e7608f378dcfca6f8c717101df1945db3b97).
Its native API defines
[`ToolProperty`](https://github.com/ollama/ollama/blob/f866e7608f378dcfca6f8c717101df1945db3b97/api/types.go#L432-L440)
and
[`ToolFunctionParameters`](https://github.com/ollama/ollama/blob/f866e7608f378dcfca6f8c717101df1945db3b97/api/types.go#L487-L503)
as typed Go structs. Neither admits `const`, `additionalProperties`,
`minimum`, or `maximum`. Go JSON decoding ignores those unknown request fields.
The
[template conversion](https://github.com/ollama/ollama/blob/f866e7608f378dcfca6f8c717101df1945db3b97/template/template.go#L390-L477)
therefore cannot present them to the model.

This matters beyond the bad synthetic fixture. The current
`minecraft-human-semantic-v1` catalog has 17 actions; four
(`move_controls`, `drop_item`, `deposit_in_focused_container`, and
`withdraw_from_focused_container`) publish `minimum` or `maximum` bounds.
Ollama 0.23.2 accepts the outer request but omits those bounds from the actual
rendered prompt. Raw Behold wire capture consequently proves what Behold sent,
not the exact prompt Ollama showed the model.

For this installed Llama model, no built-in parser is named in its manifest.
The chat handler therefore selects Ollama's
[generic tool parser](https://github.com/ollama/ollama/blob/f866e7608f378dcfca6f8c717101df1945db3b97/server/routes.go#L2410-L2468).
Its
[`findArguments`](https://github.com/ollama/ollama/blob/f866e7608f378dcfca6f8c717101df1945db3b97/tools/tools.go#L220-L321)
function JSON-decodes the generated object and returns the nested
`arguments`/`parameters` map. It does not validate the tool schema or synthesize
`type` and `value` wrappers.

### Native `format` and alternate templates

Ollama documents `tools` as the function-calling surface and `format` as the
separate whole-response structured-output surface. Adding `format` would
introduce another generation constraint and is not a repair for invalid
function arguments. Ollama 0.23.2's chat handler passes `format` separately
from the generic tool parser; no source path makes it a per-tool schema
validator.

The installed 3B and 70B template blobs differ in incidental system/question
layout but give the same essential instruction: emit a JSON object with a tool
name and a `parameters` dictionary. Source inspection provides no basis for
claiming that the untested 70B template would remove the wrapper. Changing a
template would also mint a different local model artifact and treatment; it is
not a transparent parser fix.

## Regression

Two no-network regressions now preserve the failure:

1. the native adapter receives the exact fixture response, makes one stubbed
   call, preserves the wrapper and raw response structure, and performs no
   correction; and
2. the policy receives that adapter decision, records one scheduled opportunity
   followed by `adapter_rejected`, makes no second provider attempt, and emits
   no model turn, entity turn, intent, yield turn, or world attempt.

This preserves the important distinction between a successful authenticated
transport attempt and an invalid resident decision.

## Smallest honest next experiment

No more inference should run yet. First, a model-free compatibility check should
round-trip every canonical `minecraft-human-semantic-v1` action schema through
the exact Ollama 0.23.2 `api.Tool` decode and installed template render, then
compare the rendered semantic schema with the Behold request. The current
source inspection predicts a red result for numeric bounds.

Until that discrepancy is either rejected before calls or resolved by an
explicitly versioned and identity-bound transport/template contract, local
Ollama is a no-go for the claim that residents receive the same complete action
surface. A future single-attempt model probe should use an actual canonical
resident request only after that model-free gate passes. It would be a new
contract-conformance experiment, not a retry or compensation opportunity.
