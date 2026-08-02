# Resident transcript

`behold.resident-continuous-transcript.v1` is the model-facing projection of one
resident's private life. It is not another memory store. Canonical Lync remains
the history and Minecraft remains the authority for bodily consequences.

For one resident charter `C`, committed private turns `T`, and the current
first-person experience `E`, the conversation is:

```text
C · experience(T1) · assistant(T1) · outcome(T1)
  · experience(T2) · assistant(T2) · outcome(T2)
  · ...
  · E
```

- `experience(Tn)` is the exact safe observation admitted for that turn.
- `assistant(Tn)` is the resident's own chosen action in the current canonical
  action-response syntax.
- `outcome(Tn)` is the Minecraft-authoritative terminal settlement.
- `E` contains every resident-perceivable event since the preceding boundary
  and a fresh current first-person view.

The transcript contains no broker admissions, intent-queue stages, provider
accounting, digests, selected anchors, inferred goals, or another resident's
private life. Successive requests share the preceding conversation as an exact
prefix. V1 does not fold or truncate a life that fits the configured and
verified model context; it must fail visibly at a real context boundary rather
than create an inaccessible middle.

Context admission is part of the treatment, not an adapter afterthought.
Resident-v3 OpenRouter sessions use route v5 to bind a declared provider/model context window and count
the complete UTF-8 request conservatively before launch. LM Studio already
binds the loaded instance's context length; its OpenAI-compatible v3 path uses
the complete wire bytes plus a template margin as a conservative upper bound.
It can fail earlier than necessary but cannot silently authorize a middle cut.
LM Studio documents the exact higher-fidelity procedure as applying the model's
prompt template, counting with that model's tokenizer, and comparing with the
loaded context length:
<https://lmstudio.ai/docs/typescript/tokenization>. Replacing the conservative
bound with that exact preflight is an optimization, not permission to truncate.

## Grounded failure specimen

Oxford V4 episode `000001`, Rowan request at
`2026-08-02T01:39:06.000Z`, is the design counterexample. The retained request
body was 29,432 bytes and contained five reconstructed messages: a charter, an
action-contract system message, a selected fold through turn 38, factual
continuity for turns 42–44, and the current world observation. It explicitly
said turns 39–41 were not represented and gave Rowan no way to read canonical
Lync. It contained no chronological assistant/outcome messages from Rowan's
own prior calls.

The same boundary also accumulated raw events 311–341. One request represented
events only through 330 and caught up on the following request. Continuous
transcript work must preserve both dimensions of continuity: the committed
private life before the call and the complete perceptual interval at its tail.

Projecting Rowan's canonical stopped life with v1 produces 156 chronological
messages from all 52 turns (178,916 JSON bytes). Turns 39–41 are ordinary
experience/assistant/outcome triples rather than an absent middle. Turn 44's
admitted observation begins at event 310 and its authenticated next observation
ends at 341; turn 45 begins at 341 and continues through 347. The current view
is appended only after those committed turns.

## Inclusion boundary

The projection includes the safe `observationPresentation.observation`, the
resident's exact admitted response when Lync retained it (or a canonical action
reconstruction for older lives whose adapter discarded those bytes), and the
typed Minecraft terminal. It retains chats, bodily state, visible changes, and
other events already admitted to that resident.

It excludes the private controller frame, raw provider accounting, request
admission and scheduler state, intent plumbing, fold records, inferred goals,
and another entity's private turns. Non-model controls are described as lived
facts; their private input is replayed only when resident visibility rules allow
it. These exclusions remove implementation authority the resident never had,
not world experience it could perceive.
