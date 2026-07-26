# One strict-JSON local Phi-4 inference

## Verdict

Exactly one `phi4:latest` inference crossed
`behold.ollama-local-json-action.v1` successfully. The model returned one
strict action object:

```json
{
  "action": "chat",
  "arguments": { "text": "Hello Birch, nice to meet you!" }
}
```

Behold decoded it without retry, correction, normalization, or substitution.
The unchanged canonical `chat` validator accepted the arguments. No world
interface existed, no action was attempted, Minecraft was not running, and the
model unloaded immediately under `keep_alive: 0s`.

This clears the narrow one-shot transport/schema gate for considering Phi-4 as
a second local resident. It is not evidence of sustained reliability, good
Minecraft behavior, equivalent treatment, or a fair comparison with the 3B
model.

## Input and identity

The request used:

- Behold revision `5d14150b3a98343fc1e0f97c1e0e6c46f7a4d066`;
- the retained OxfordAster human-semantic observation in
  `tests/fixtures/oxford-aster-human-semantic-v1.lync`, event
  `019f9b8f-8a75-7de2-a306-6fe25fecb9a6`;
- all 17 canonical `minecraft-human-semantic-v1` body actions plus
  `wait_for_event`;
- the `neutral-benchmark-v1` implementation profile name, without a claim of
  experimental neutrality;
- no task, required action, project, intervention, world interface, or world
  execution authority; and
- a 16,384-token context, 512-token maximum output, temperature `0.2`, and
  `keep_alive: 0s`.

The resident request identity was
`48705b9f9bfa6a1a9e66afb1053619b4941b2458555545fba28ab57072dea763`.
The exact native request was 14,421 bytes with SHA-256
`f91e275fbe3a15f7092a5270917a7af2244d544c7546431fa141d9911bf3639f`.
It bound:

- model tag `phi4:latest` and installed content
  `ac896e5b8b34a1f4efa7b14d7520725140d5512484457fab45d2a4ea14c69dba`;
- installed template
  `32695b892af87ef8fca6e13a1a31c67c1441d7398be037e366e2fc763857c06a`;
- transport schema
  `92be985cd94f981e79c70b4c59551d090440c17094815b7fcd73015e80441998`;
- action contract
  `50c72496c42a2a959645b279baf742bf04931e7a7d9115dfd108ab817bc57cc6`;
  and
- structured-output format
  `d7895e07207941a82930b22f026765553ff7f6a5d4b4a30fb8c9a421cd288879`.

The live preflight verified Ollama `0.23.2`, loopback-only native chat,
cloud-disabled config, exact installed tag/content/template, completion
capability, a 16,384-token installed context, and empty `/api/ps`. It identified
the installed model as Phi-family, 14.7B, Q4_K_M. Its digest was
`0e7c49e7b5342d8f6c370cb95563aa4a0d7c8036bce22855e3cd8fc8b4793b95`.

## The one attempt

The cognition broker admitted exactly one `resident_decision` request and
forwarded exactly one unauthenticated-loopback `POST /api/chat`. Its
`maxAccepted: 1` ceiling made a second physical attempt inadmissible. There was
no OpenRouter credential, provider route, fallback, correction fold, auxiliary
model, or second call.

| Evidence                      |           Result |
| ----------------------------- | ---------------: |
| Physical `/api/chat` attempts |                1 |
| Returned model                |    `phi4:latest` |
| Adapter terminal              |        `success` |
| Prompt tokens                 |            1,665 |
| Completion tokens             |               30 |
| Adapter wall latency          |          8.414 s |
| Ollama total duration         |          8.311 s |
| Load duration                 |          3.293 s |
| Prompt evaluation             |          4.109 s |
| Generation                    |          0.686 s |
| Peak loaded `/api/ps` size    | 14,352,950,613 B |
| Peak reported VRAM            | 14,352,950,613 B |
| World mutation attempts       |                0 |

The peak reported residency is 13.367 GiB. It came from 49 loaded samples
among 81 `/api/ps` samples taken during the sole chat call; those samples did
not invoke a model. The first loaded sample independently repeated the exact
tag, content digest, 14.7B Q4_K_M metadata, 16,384 context, and reported
all 14,352,950,613 bytes in VRAM.

The authenticated raw response blob is 403 bytes with SHA-256
`2fb08f21cd354ef1ab64f06d457b45e48a9f8b37e18c784e920f5556f12b049a`.
It contains the exact response above, `done_reason: stop`, returned
`phi4:latest` identity, token counts, and native nanosecond timings. The strict
adapter selected the canonical `chat` schema and passed the returned
`arguments` object unchanged to `validateResidentActionInput`, which retained
`{ "ok": true }`. Because no world interface existed, the valid proposal was
not spoken in Minecraft and created no claimed physical consequence.

## Retained evidence and shutdown

The complete ignored runtime record is under:

`data/ollama-json-action-v1-phi4-single/run-2026-07-26T05-16-54.702Z`

It contains the resident request artifact, live preflight, authenticated broker
journal, exact request/response blobs, per-attempt identities, raw model call,
validator outcome, 81 process-memory samples, and unload checks. The report
SHA-256 is
`72163efbac884a2ee1595bb12d26321100f2655318c5c31a85cb57b44f9ebc21`;
the deterministic aggregate over the retained run files is
`776f749c409e085e0d3c734cfaf1c276e70f7af66eb66f9b46f277b5668682ad`.

The first post-attempt `/api/ps` check and a separate final check were both
empty. No `llama3.3` request, provider call, Minecraft process, retry,
correction, normalization, substitution, or publication occurred.

## Meaning

For this one OxfordAster observation, Phi-4 received the same bounded action
contract enforced by Behold, produced conforming strict JSON, retained its
identity, and crossed the unchanged validator. One sample does not establish a
conformance rate or behavioral capability. A later living-world pilot should
give residents equal scheduled decision opportunities as resource governance,
while reporting each model's latency, tokens, malformed outputs, failures, and
physical outcomes separately; equal caps do not erase model or deployment
differences.
