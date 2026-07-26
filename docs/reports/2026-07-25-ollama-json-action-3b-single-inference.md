# One strict-JSON local 3B inference

## Verdict

Exactly one `llama3.2:3b` inference crossed
`behold.ollama-local-json-action.v1` successfully. The model returned one
strict action object:

```json
{ "action": "wait_for_event", "arguments": { "reason": "Birch is online" } }
```

Behold decoded it without retry, correction, normalization, or substitution.
The unchanged canonical `wait_for_event` validator accepted the arguments. No
world interface existed, no action was attempted, Minecraft was not running,
and the model unloaded immediately under `keep_alive: 0s`.

This is one transport/validator feasibility result, not evidence of reliable
model behavior, a living-world pilot, or a comparison with another model.

## Input

The request used:

- Behold revision `83d2dd9458583594485e55a5df5941870f3f6507`;
- the privacy-safe OxfordAster human-semantic observation in
  `tests/fixtures/oxford-aster-human-semantic-v1.lync`, event
  `019f9b8f-8a75-7de2-a306-6fe25fecb9a6`;
- the complete canonical surface of 17 `minecraft-human-semantic-v1` body
  actions plus `wait_for_event`;
- the ordinary `neutral-benchmark-v1` controller prompt as an implementation
  profile name, without any claim of scientific neutrality;
- no task, required action, prior action, project, intervention, or world
  execution authority; and
- a deliberative 16,384-token context, 512-token maximum output, temperature
  `0.2`, and `keep_alive: 0s`.

The resident request identity was
`ea31c6c2b0b0b90c5ef420c3405ec814ea3d73d73a6e13574ee513976e116ed7`.
The exact native request was 14,421 bytes with SHA-256
`d83ce444b2ee16bdc172b98602253ab840c0524ffd0bc7903366088bf8115ad6`.
It bound:

- model content
  `a80c4f17acd55265feec403c7aef86be0c25983ab279d83f3bcd3abbcb5b8b72`;
- installed template
  `966de95ca8a62200913e3f8bfbf84c8494536f1b94b49166851e76644e966396`;
- action contract
  `50c72496c42a2a959645b279baf742bf04931e7a7d9115dfd108ab817bc57cc6`;
  and
- structured-output format
  `d7895e07207941a82930b22f026765553ff7f6a5d4b4a30fb8c9a421cd288879`.

The live preflight verified Ollama `0.23.2`, cloud-disabled config, exact
installed tag/content/template, completion capability, and empty `/api/ps`.
Its digest was
`dfac0c58e46756c9001d99e2f5c00316d5fe8ab139afd11f52324fe7389b1a0e`.

## One attempt

The cognition broker admitted exactly one `resident_decision` request and
forwarded one unauthenticated-loopback `POST /api/chat`. Its hard
`maxAccepted: 1` ceiling made a second physical attempt inadmissible. There was
no OpenRouter credential, route, provider object, fallback, auxiliary fold, or
second model.

| Evidence                      |        Result |
| ----------------------------- | ------------: |
| Physical `/api/chat` attempts |             1 |
| Returned model                | `llama3.2:3b` |
| Adapter terminal              |     `success` |
| Prompt tokens                 |         1,671 |
| Completion tokens             |            17 |
| Adapter wall latency          |       1.787 s |
| Ollama total duration         |       1.703 s |
| Load duration                 |       0.589 s |
| Prompt evaluation             |       0.867 s |
| Generation                    |       0.118 s |
| World mutation attempts       |             0 |

The authenticated raw response blob is 374 bytes with SHA-256
`0284d8220097765555e06c65b6a1aab2d3e8aa8d0acffa4c5b9c4c299b12c668`.
It contains the exact response above, `done_reason: stop`, the returned model
identity, and Ollama's native timings. Parsing that blob and the separately
retained model-call `raw` object produced identical JSON values.

The strict adapter selected the canonical `wait_for_event` schema, passed the
unchanged input object directly to `validateResidentActionInput`, and retained
`{ "ok": true }`. The model chose to wait because Birch was online; Behold did
not suggest that action, require it, correct it, execute it, or infer a world
consequence from it.

## Retained evidence and shutdown

The complete ignored runtime record is under:

`data/ollama-json-action-v1-3b-single/run-2026-07-26T01-56-11.128Z`

It contains the resident request artifact, live preflight, authenticated broker
journal, exact request/response transport blobs, per-attempt identities, raw
model call, validator outcome, and unload checks. The aggregate report SHA-256
is `22533afa46fdef48982ad06365f7492bda2e77aa2b67bb1b3ec8dbebbcc8319e`.

The first post-attempt `/api/ps` check was empty, and a separate final read-only
check also found no loaded runner. No 70B request, provider call, Minecraft
process, retry, correction, normalization, substitution, or publication
occurred.

## Meaning

This one result falsifies the narrow concern that the new path necessarily
repeats the old native-tools typed-wrapper failure: for this input, one model
received the canonical contract, produced conforming strict JSON, and crossed
the unchanged validator. It does not show that future outputs will conform,
that numeric bounds are grammar-enforced, that waiting was a good behavioral
choice, or that the model can sustain an embodied life. Those remain later,
separately authorized questions.
