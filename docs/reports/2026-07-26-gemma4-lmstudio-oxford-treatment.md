# Gemma 4 LM Studio Oxford treatment

Date: 2026-07-26

## Verdict

The current LM Studio runtime and installed Gemma 4 models establish a credible
local cognition path, but they do **not** establish sustained resident life.

`google/gemma-4-26b-a4b-qat@4bit` was the strongest condition exercised. It
passed Behold's exact no-world session contract at 1.55-1.68 seconds per
decision, then ran two ordinary two-resident Oxford episodes at a 3.77 and 4.52
second mean. The residents moved and their positions survived stop/resume, but
they converged on camera oscillation and stale digging. There was no successful
world mutation, useful social exchange, or sustained adaptive conduct.

`google/gemma-4-12b@q4_k_m` also passed the exact compact gate and broke the
earlier pure-camera failure long enough to exchange chat and move both bodies.
Its shared live decisions took 8.24-17.91 seconds and it did not produce a world
mutation. This is a weaker fallback, not a successful treatment.

## Intended endpoint

The endpoint remains independently continuing residents in one persistent
Minecraft world: timely perception, decision and action; isolated identity and
memory; ordinary live/watch/stop/resume; resident-authored persistent
consequences; and canonical Lync histories readable through Textile. A compact
wire pass, a loaded model, movement, or a readable aftermath is only one part of
that conjunction.

## Current host and runtime

The exercised host was an M4 Max MacBook Pro with 128 GiB memory. LM Studio was
`0.4.20+1`, CLI commit `71bd99c`, MLX `1.10.1`, llama.cpp `2.27.1`, and the
loopback server at port 1234.

The handoff inventory was stale. During this treatment:

- Ministral 3 3B Instruct Q4_K_M completed and indexed at 2,147,023,008 bytes;
- Gemma 4 12B QAT Q4_0 subsequently completed and indexed at 7,151,067,268
  bytes;
- the old Qwen3.5 partial was absent except for its retained projector; and
- no model remained loaded after each owned gate or live episode.

Evidence-ranked conditions for this exact resident contract are:

1. Gemma 4 26B-A4B QAT 4-bit MLX: compact pass, best live latency, negative
   conduct treatment.
2. Gemma 4 12B Q4_K_M GGUF: compact pass, slow mixed live treatment, no world
   mutation.
3. Gemma 4 12B QAT Q4_0 GGUF: newly installed, not yet gated; no evidence to
   promote it above the passing 26B condition.
4. Larger installed Gemma 4 31B and Nemotron-class candidates: potentially
   capable but unmeasured on this contract and expected to have a harder live
   latency envelope.
5. Ministral 3 3B Instruct Q4_K_M: unchanged contract failed before inference
   because its installed template rejects the required system role. LM Studio's
   structured-output documentation also warns that models below 7B are less
   reliable for schema adherence.
6. Qwen3-VL 4B MLX: earlier exact gate pass, but its ordinary live/resume
   treatment produced 47 camera sweeps and no adaptive conduct.

## LM Studio contract findings

The current official documentation was read before the final gates:

- the native REST comparison recommends `/api/v1/*`, but `/api/v1/chat` cannot
  carry assistant-history messages while `/v1/chat/completions` can, so Behold's
  complete stateless resident history remains on the OpenAI-compatible chat
  endpoint;
- JSON Schema structured output is supported through chat completions, using a
  llama.cpp grammar for GGUF and Outlines for MLX;
- the load API exposes an explicit instance id and effective load config; and
- the current MLX engine describes parallel slots, continuous batching, and
  content-keyed prefix checkpoints, but does not document a per-resident KV
  namespace guarantee.

Sources: [REST API](https://lmstudio.ai/docs/developer/rest),
[load API](https://lmstudio.ai/docs/developer/rest/load),
[structured output](https://beta.lmstudio.ai/docs/developer/openai-compat/structured-output),
and [MLX engine for agentic workloads](https://lmstudio.ai/blog/mlx-engine-agentic-workloads).

The installed `0.4.20+1` server empirically honors
`reasoning_effort: "none"` on chat completions. That exact value produced zero
reasoning tokens and empty private reasoning on every admitted gate and live
turn. LM Studio's current chat documentation does not make it a general
cross-version guarantee, so Behold binds it as an optional exact policy setting
rather than silently assuming it.

The MLX CLI accepted a requested 16,384-token context for Gemma 26B but the
native inventory reported an effective 262,144-token context. Behold refused
that mismatch. Re-admitting the actual echoed 262,144 setting passed. The GGUF
Gemma 12B runtime retained the requested 16,384 setting.

## Defects corrected

Commit `72af34b` keeps shared-weight serving while closing the resident boundary
found during review:

- a resident bearer can no longer submit another resident's dynamic observation
  or loom-fold source through the shared model instance;
- current selected-variant index identities are admitted exactly;
- GGUF artifacts with projector sidecars bind the whole artifact tree without
  falsely equating the text GGUF's byte count with the catalog total; and
- the optional exact `reasoningEffort: "none"` setting is serialized and checked
  on readiness, resident-action, and loom-fold wires.

The complete repository check passed 565 tests, skipped one explicitly
environment-dependent Oxford admission test, and had zero failures.

## Compact gates

Ministral failed its authority-free readiness call with HTTP 400 because the
installed template accepts user, assistant and tool roles but not system.

Gemma 4 12B Q4_K_M passed the exact production broker and resident-mind path:

| Stage     | Wall time | Result                                              |
| --------- | --------: | --------------------------------------------------- |
| readiness |    3.55 s | strict `{"ready":true}`                             |
| horizon 1 |    3.18 s | original public greeting                            |
| horizon 2 |    4.79 s | grounded reply about Qwen and the visible structure |

Gemma 4 26B-A4B QAT MLX then passed the same path:

| Stage     | Wall time | Result                               |
| --------- | --------: | ------------------------------------ |
| readiness |    2.95 s | strict `{"ready":true}`              |
| horizon 1 |    1.55 s | `Hello Qwen`                         |
| horizon 2 |    1.68 s | `Nice! I see the stained glass too.` |

Both gates used three charged and transport-captured attempts, no retry or
repair, zero reasoning, no world authority, and owned unload with an empty final
inventory.

## Ordinary Gemma 12B live/resume

Persistent session `oxford-living-gemma4-12b-v1` ran three episodes with
`OxfordAlder` and `OxfordHazel` sharing one exact weight instance while retaining
distinct prompts, credentials, quotas, controllers and Lync files.

The first episode exchanged repeated greetings and made one camera turn. The
second loaded three prior turns per resident, varied into movement, one focused
block use, and reciprocal `Hey, I see you` / `I see you too` chat. Hazel moved
from approximately z=1412 to z=1419. The third episode loaded seven prior turns
per resident and spawned Hazel at z=1419, directly confirming that consequence
survived stop/resume. Alder also moved. No block or inventory state changed.

Shared live action latency ranged from 8.24 to 17.91 seconds. This is too slow
for timely resident life even though the conduct was less degenerate than the
earlier Qwen camera loop.

Textile's real `projectRawLyncFile` adapter consumed episode three's cumulative
union as 19 source events: 17 readable resident turns, two structural roots,
zero unsupported events, zero nonconforming events, and no warnings.

## Ordinary Gemma 26B live/resume

Persistent session `oxford-living-gemma4-26b-v1` ran two 60-second episodes with
`OxfordIris` and `OxfordMoss`. The one shared instance exposed two parallel
slots; resident state remained isolated.

Episode `000001` produced 20 valid model turns and two explicit malformed-output
failures. Latency was 2.25-5.81 seconds, mean 3.77 seconds. Iris moved twice;
Moss moved once, then attempted a no-longer-visible focused block three times.
Every stale dig failed closed. The remaining actions were camera orientation.

Episode `000002` restored nine Iris turns, eleven Moss turns, and both changed
positions. It produced 26 valid turns at 3.34-6.48 seconds, mean 4.52 seconds.
Iris alternated camera up/down for 12 of 13 actions and made one short movement.
Moss alternated camera up/down with five more stale dig attempts, all correctly
rejected. There was no chat or successful world mutation in either episode.

All 46 valid live turns reported zero reasoning tokens. The cumulative episode
two Textile import is 2,225,156 bytes with SHA-256
`f01ec40ccf3fae7420b3bb375505c49d73fce91e2c8d4753231de1be7259b3ad`.
Textile projected 48 source events as 46 readable turns and two structural
roots, with zero unsupported or nonconforming events and no warnings.

## Works, broken, unknown

Works:

- current LM Studio exact artifact/runtime/schema admission and owned lifecycle;
- shared weights with distinct resident prompt, credential, quota, controller,
  journal and Lync state;
- ordinary Place live, viewers, clean stop, exact resume, persistent positions,
  canonical episode evidence and Textile-readable Lync; and
- a local 26B path near the four-second decision cadence.

Broken or insufficient:

- neither condition sustained adaptive conduct;
- no resident-authored block, inventory, shelter or other durable world
  mutation occurred;
- 26B fell into camera/stale-dig loops, while 12B was too slow; and
- no native human joined these treatments.

Unknown:

- whether another installed model or engine configuration can preserve the
  26B latency while avoiding the behavioral loops;
- whether LM Studio isolates concurrent KV/cache state beyond Behold's complete
  stateless request and resident-bound broker controls; and
- whether longer unsteered time would produce a persistent mutation rather than
  deepen the observed loops. These short treatments do not justify that claim.

The First Life and composed living-world acceptance remain open.
