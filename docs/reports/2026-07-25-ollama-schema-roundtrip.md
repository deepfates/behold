# Ollama 0.23.2 resident-action schema round trip

Date: 2026-07-25 local / 2026-07-26 UTC

This is one model-free transport conformance experiment. It does not load a
model, perform inference, contact a provider, start Minecraft, or change the
resident contract.

## Verdict

The pinned native Ollama tool path is a no-go for a local living-world pilot.
All 18 resident actions and their descriptions reach the installed template,
but the path does not show the model the complete action contract:

1. Ollama 0.23.2's `api.Tool` decode drops the numeric bounds from four
   canonical actions; and
2. the installed `llama3.2:3b` template renders every tool as an unlabeled Go
   struct such as `{function <nil> {...}}`, not as JSON or named schema fields.

Behold still validates a returned action against its original admitted schema
before minting an intent. Required-field, type, enum, and numeric-bound drift
therefore fails as `adapter_rejected` before a world action. That protects the
world, but it does not give the resident the missing guidance or refund the
scheduled opportunity/provider attempt spent producing an invalid proposal.

## Exact experiment

The input was derived from compiled Behold revision
`05a9cd6c09eb05ab6fd9a15742c4648323c1c734` through the real resident-policy
request construction:

- policy profile label: `neutral-benchmark-v1` (a configuration name, not a
  scientific-neutrality claim);
- body/action profile: `minecraft-human-semantic-v1`;
- safety profile: `vanilla-player-v1`;
- 17 complete canonical Minecraft actions from the current interpreter and
  action profile; and
- the controller-added `wait_for_event`, for 18 model-facing actions total.

The model-free mind captured the constructed request and stopped. A standalone
Go harness then, exactly once:

1. unmarshaled all 18 native tools through
   `github.com/ollama/ollama/api.Tool` from exact module `v0.23.2`;
2. parsed the installed 3B model template with the same revision's
   `template.Parse`;
3. executed that template with the decoded tools and inert marker messages; and
4. retained the decoded structures and exact rendered prompt.

This is a full-catalog compatibility check. Live Behold may narrow the offered
actions on a particular turn; the experiment does not claim that every live
observation makes all 18 simultaneously available.

Pinned identities and evidence:

- Ollama tag/revision:
  `v0.23.2` /
  `f866e7608f378dcfca6f8c717101df1945db3b97`
- Go module sum:
  `h1:4u+iqgeqNhXsW6v/09ycWe3FN56Wjs/Yyza+GWkpG9I=`
- installed template SHA-256:
  `966de95ca8a62200913e3f8bfbf84c8494536f1b94b49166851e76644e966396`
- input SHA-256:
  `90a786f2a51852c0b6d0acd862388004fffcfaced1438abdd17c5ce39472e17d`
- exact rendered-prompt SHA-256:
  `286f8178c4746c211501a1c7e4c48c71c4b92c79392eb7adfd3b1bd79695323f`
- result-file SHA-256:
  `801f4eed634ee1fc5a0c788b36a35c902eb0838a4dc67b160e6ec76fc5522713`
- harness binary SHA-256:
  `3ba2333385f473e20c433395961c0196cdd5e3fabae9fbf2862b878ba0b4ae15`
- execution:
  `2026-07-26T00:56:47.950665Z` under `go1.26.0`
- ignored local evidence:
  `.behold-runtime/ollama-schema-roundtrip-2026-07-25/{input.json,result.json}`

`/api/ps` was empty before and after. The harness never called an Ollama HTTP
generation endpoint.

## Facet comparison

| Facet                     | Original Behold surface                  | After `api.Tool` decode | Exact installed-template output                                                 | Consequence                                                            |
| ------------------------- | ---------------------------------------- | ----------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Action availability/order | 18 ordered actions                       | All 18, same order      | 18 lines, same order                                                            | No availability drift in this complete-catalog pass                    |
| Action names              | 18 named functions                       | Exact                   | All names visible, but only as positional struct values                         | Identity is recoverable; representation is not self-describing         |
| Action descriptions       | One description per action               | Exact                   | Exact text visible, positional after the name                                   | Useful prose survives                                                  |
| Root parameter type       | `object` for every action                | Exact                   | Bare positional `object` after two `<nil>` values                               | Type value survives; its schema role is unlabeled                      |
| Property names/types      | Exact property maps                      | Exact                   | Valid JSON fragments inside each otherwise non-JSON line                        | Useful property/type guidance survives                                 |
| Required fields           | Exact arrays                             | Exact                   | Bare arrays such as `[username text]`, with no `required` label or JSON quoting | Material ambiguity for every parameterized action with required fields |
| Enums                     | Four enum-bearing properties             | Exact                   | Exact JSON arrays in the property-map fragment                                  | Enum guidance survives                                                 |
| Property descriptions     | Four described properties                | Exact                   | Exact strings in the property-map fragment                                      | Property prose survives                                                |
| `minimum` / `maximum`     | Four bounded numeric properties          | Omitted                 | Absent                                                                          | Material guidance loss; controller still rejects out-of-range values   |
| `items`                   | `wait_for_event.events` has string items | Exact                   | Exact JSON in the property-map fragment                                         | Array-item guidance survives                                           |
| `const`                   | No canonical occurrence                  | No occurrence           | No occurrence                                                                   | Not exercised by this resident surface                                 |
| `additionalProperties`    | No canonical occurrence                  | No occurrence           | No occurrence                                                                   | Not exercised; Behold's current validator does not prohibit extra keys |
| Whole definition syntax   | JSON tool/schema structure               | Typed Go value          | Unlabeled Go struct, not JSON                                                   | Universal material transport ambiguity                                 |

The exact first rendered line was:

```text
{function <nil> {chat Send one public Minecraft chat message. {object <nil> <nil> [text] {"text":{"type":"string"}}}}}
```

The `<nil>` values and positional lists are not part of the Behold schema. They
are Go's default formatting of Ollama's template-facing structs. The installed
template ranges over individual converted tools with `{{ . }}`; those
individual values have no JSON `String` method in this Ollama revision.

## Every action

“Guarded” below means the action name and original published input schema are
checked before an intent can be minted. It does not mean arbitrary extra keys
are forbidden: `additionalProperties` is absent from this canonical surface
and unsupported by Behold's current validator.

| Action                            | Typed-decode result                   | What the installed template actually retains                          | Controller protection                       | Material model-guidance loss                                              |
| --------------------------------- | ------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------- |
| `chat`                            | Exact                                 | Name, action description, `text:string`; required list is unlabeled   | Guarded                                     | Yes: `text` being required is only positional                             |
| `whisper`                         | Exact                                 | Name, description, both string properties; required list is unlabeled | Guarded                                     | Yes: required semantics are unlabeled                                     |
| `look_direction`                  | Exact                                 | Both required names, types, descriptions, and both enums              | Guarded                                     | Yes: required/root roles are unlabeled, though enum guidance survives     |
| `drop_item`                       | Loses `count` bounds `1..64`          | `name:string`, `count:number`, unlabeled required `[name]`            | Guarded, including original bounds          | Yes: bounds are absent and required semantics are unlabeled               |
| `stop`                            | Exact                                 | Name, description, empty property map                                 | Guarded                                     | No action-specific constraint is lost; universal non-JSON wrapper remains |
| `equip_item`                      | Exact                                 | `name:string` and full destination enum; required list is unlabeled   | Guarded                                     | Yes: `name` being required is only positional                             |
| `wake_up`                         | Exact                                 | Name, description, empty property map                                 | Guarded                                     | No action-specific constraint is lost; universal non-JSON wrapper remains |
| `consume`                         | Exact                                 | Optional `name:string` property                                       | Guarded                                     | No action-specific constraint is lost; universal non-JSON wrapper remains |
| `move_controls`                   | Loses `durationMs` bounds `100..2000` | Direction enum, booleans, numeric duration, unlabeled required list   | Guarded, including original bounds          | Yes: duration bounds are absent and required semantics are unlabeled      |
| `attack_focused_entity`           | Exact                                 | Name, description, empty property map                                 | Guarded                                     | No action-specific constraint is lost; universal non-JSON wrapper remains |
| `dig_focused_block`               | Exact                                 | Name, description, empty property map                                 | Guarded                                     | No action-specific constraint is lost; universal non-JSON wrapper remains |
| `place_held_against_focus`        | Exact                                 | Name, description, empty property map                                 | Guarded                                     | No action-specific constraint is lost; universal non-JSON wrapper remains |
| `use_focused_block`               | Exact                                 | Name, description, empty property map                                 | Guarded                                     | No action-specific constraint is lost; universal non-JSON wrapper remains |
| `inspect_focused_container`       | Exact                                 | Name, description, empty property map                                 | Guarded                                     | No action-specific constraint is lost; universal non-JSON wrapper remains |
| `deposit_in_focused_container`    | Loses `count` bounds `1..64`          | `name:string`, `count:number`, unlabeled required `[name]`            | Guarded, including original bounds          | Yes: bounds are absent and required semantics are unlabeled               |
| `withdraw_from_focused_container` | Loses `count` bounds `1..64`          | `name:string`, `count:number`, unlabeled required `[name]`            | Guarded, including original bounds          | Yes: bounds are absent and required semantics are unlabeled               |
| `sleep_in_focused_bed`            | Exact                                 | Name, description, empty property map                                 | Guarded                                     | No action-specific constraint is lost; universal non-JSON wrapper remains |
| `wait_for_event`                  | Exact                                 | Required reason, optional string-array events, and both descriptions  | Guarded; a valid wait mints no world intent | Yes: required/root roles are unlabeled                                    |

## Safety and interpretation

`validateMindDecision` admits only an action offered for that exact observation,
checks any required action, and calls `validateResidentActionInput` with the
original Behold schema. Only after that succeeds can it call `toIntent`.
Consequently:

- an unknown action name cannot reach the world;
- missing required properties and wrong property types fail;
- values outside the retained enum sets fail;
- `drop_item`, container-transfer, and movement bounds still fail even though
  the model never saw them; and
- `wait_for_event` never enters the world action stream.

Physical stale-target checks, body cancellation, and ordinary Minecraft
mechanics remain later independent boundaries. This experiment did not execute
them. It also does not upgrade the canonical schema into strict extra-key
rejection: unexpected properties are ignored by the current schema validator.

The prior 3B response's typed wrapper is now consistent with the exact rendered
prompt, which visibly contains `object`, `<nil>`, and positional schema values.
That is an explanatory correspondence, not proof that the renderer alone
caused a particular generated token sequence.

## Smallest honest next seam

Do not run either installed local model through this native `tools` path.

The smallest candidate remedy is a separately named, identity-bound local
transport, for example `ollama-local-json-action-v1`, which:

1. omits Ollama's native `tools` field;
2. puts the exact canonical Behold action catalog, unchanged and hashed, into
   model-visible message content as canonical JSON;
3. requires one strict, versioned JSON decision envelope and rejects anything
   else without normalization or correction;
4. binds the catalog, rendered prompt, installed template, model, and parser
   versions into attempt evidence; and
5. retains the current original-schema validation before intent creation.

Ollama's whole-response `format` facility may be considered only after a
separate model-free proof that it preserves the proposed response contract; it
is not by itself a repair for the current tool definitions. A custom installed
template alone is also insufficient because the numeric bounds have already
been discarded before template execution. Upgrading Ollama is viable only if
the exact candidate version passes this same decode/render gate.

That candidate changes the transport contract and needs owner/principal review.
It was not implemented here. Until a versioned alternative or a proven Ollama
upgrade exists, local Ollama remains no-go for the first living-world pilot.
