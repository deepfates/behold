# Resident-instance isolation and the remaining installed frontier

Date: 2026-07-26

## Verdict

No new installed candidate earned an Oxford living-world treatment. One real
runtime defect discovered in the prior Qwen release is corrected: residents
using the same LM Studio artifact now own distinct entity-bound model instances
instead of sharing one `parallel = 1` instance. That correction preserves the
resident charter, action surface, deadlines, scheduling, and final validator.
It does not alter choices or rescue Qwen's repeated-camera behavior.

The only untouched compact MLX candidate accepted by the installed model index,
`rice-cracker-qwen3.5-0.8b-abliterated-base`, passed exact setup readiness but
timed out on its first resident decision after 60.018 seconds. The GGUF
production gap exposed by `berduck-qwen2-1.5b` was then closed without changing
the resident contract. Berduck's exact production path was fast and
reasoning-free, but both fresh horizons selected the same look-down camera
action and the addressed-chat commitment confused Qwen's activity with the
resident's own expected consequence. The remaining installed SmolLM2 instruct
family then failed exact JSON integrity and the five-second horizon at 1.7B,
360M, and 135M. None earned Minecraft.

No retry, repair, prompt change, normalization, fallback, action steering,
provider call, download, or Minecraft mutation was used. Since neither
candidate earned admission, there was no new live/resume/view/Textile episode.

## Implemented instance boundary

The Qwen live treatment used two independent cognition credentials and broker
concurrency two, but both residents named the same digest-derived LM Studio
custom instance. The release loaded that instance with `parallel = 1`. Resident
processes were distinct while their model instance and its session/cache
identity were not.

Commit `6cb902e` makes the model-instance identity a digest of the exact policy
and stable entity identity. Managed startup now loads one exact instance for
each active resident, even when policies name the same artifact. The session
record binds each entity to that instance. The controller receives its own
instance only; the authenticated broker validates request bytes and returned
identity against the same entity-bound instance; release unloads and verifies
every owned instance independently. Artifact preflight remains deduplicated
because two residents using one immutable artifact do not require hashing it
twice.

This is implemented and fixture-exercised, not live-exercised. A same-model
two-resident test proves two loads, distinct IDs, and two unloads. A broker test
presents Birch's model instance on Aster's credential and receives a refusal
before any upstream call. The managed runner test proves that the scoped ID
crosses release, controller environment, and cleanup.

## Rice-Cracker Qwen3.5 0.8B

The exact installed artifact was:

- model and catalog key
  `rice-cracker-qwen3.5-0.8b-abliterated-base`;
- index identity
  `dalatexcoder/Rice-Cracker-Qwen3.5-0.8B-Abliterated-Base`;
- 1,524,856,527 bytes, BF16, Qwen3.5 architecture, 262,144 indexed maximum
  context, and indexed tool-use training;
- artifact-tree SHA-256
  `26b233723a888429008d246ad52dab3adffaf39e20b4244864ad399a422b9be4`;
- template SHA-256
  `273d8e0e683b885071fb17e08d71e5f2a5ddfb5309756181681de4f5a1822d80`;
- LM Studio `0.4.12+1`, CLI `0b2a176`, and MLX engine
  `mlx-llm-mac-arm64-apple-metal-advsimd@1.10.1`.

The template enables thinking only when an explicit `enable_thinking = true`
value is supplied. Behold supplied no such model-specific option. The actual
readiness response contained empty `reasoning_content` and zero reasoning
tokens, so the static reading was confirmed rather than assumed.

The production-path screen used an exact retained Oxford addressed-chat
horizon, an entity-bound custom instance, read-only preflight, session-owned
load, authenticated cognition broker, durable quota, exact transport capture,
and the resident mind. Prefix readiness returned `{ "ready": true }` in 3.772
seconds with zero reasoning tokens. The 24,160-byte urgent decision request
then reached Behold's unchanged 60-second upstream boundary without returning a
response. The recorded upstream latency was 60.018 seconds.

The broker journal verifies nine events with tip
`db4b9e8cd4962c87c1b0ff6acc0342a06a0d263f35f25e1c573450d6c38356a1`.
Both physical attempts settled, none remained unsettled, and the quota tip is
`f4f381f369ba6b69b027dcc86f210743a5f4d5077db820916c50c581ffd675ac`.
The journal file SHA-256 is
`96ea81813b9561c2d96776aaa2d6a175afaf68d662ec1f9e2724900ea4373f0a`;
the timed-out transport attempt SHA-256 is
`db20c2dfb4f5d02031fc404ee2fd8b0de085257490f6f302927c4cbe20012f3d`.
The owned instance unloaded and the final `lms ps --json` result was empty.

This candidate fails the body horizon by more than an order of magnitude. Its
output quality is unknown because no decision response existed to parse.

## Berduck Qwen2 1.5B GGUF

Static inventory exposed one further compact instruct-shaped artifact that the
then-MLX-only production boundary could not admit:

- model key `berduck-qwen2-1.5b`;
- index identity
  `mradermacher/berduck-qwen2-1.5b-GGUF/berduck-qwen2-1.5b.Q8_0.gguf`;
- 1,646,573,408 bytes, Q8_0, Qwen2 architecture, and 32,768 indexed maximum
  context;
- file SHA-256
  `29b38f80cd7e0f19a7e3024dc3d822209b199ab62cafd69d9be7d3af8c69f2f2`;
- regular-file-tree SHA-256
  `5c5f93ebf582cb3d3e2ba5edcc826381e81f2ef0b82beb8ace4c4e7882ad2059`;
- exact embedded `tokenizer.chat_template` SHA-256
  `cd8e9439f0570856fd70470bf8889ebd8b5d1107207f67a5efb46e342330527f`;
- llama.cpp engine
  `llama.cpp-mac-arm64-apple-metal-advsimd@2.14.0`.

One direct, authority-free diagnostic used the same exact retained addressed
Oxford wire, strict JSON schema, 16,384-token context, 512-token output cap,
temperature 0.2, and no tools. It completed in 2.312 seconds, reported zero
reasoning tokens, and passed both the strict parser and unchanged action-input
validator. It chose:

```text
look_direction {"horizontal":"same","vertical":"down"}
```

Its public intention paraphrased Qwen's incoming description of stone-brick
stairs and stained glass, then proposed looking at those already-visible
materials. This was not the voice-copying failure seen from Bonsai, but neither
was it evidence of consequence-sensitive continuation or useful response to an
addressed urgent event.

That first diagnostic's result SHA-256 is
`3f747c5c1cc5a49e3644f8303eabc204f69b1ef8c865dfc437d83f3b564a846b`;
the model-log SHA-256 is
`42e0ebfc7b926ee0a902766ee7a2ce5e4c92456d36547081d11705d6ded982e3`.
The instance unloaded and final inventory was empty.

### Exact GGUF product boundary

Commit `c25c8a7` extends the same LM Studio resident-session policy narrowly to
GGUF. A bounded streaming metadata reader verifies the GGUF magic and version,
walks typed metadata without loading model tensors, requires exactly one UTF-8
string at `tokenizer.chat_template`, and hashes those exact embedded bytes. The
preflight also binds the regular-file artifact tree, exact indexed GGUF member
and byte count, app and CLI versions, selected llama.cpp engine, native model
inventory, context, output cap, temperature, strict schema, and unloaded state.
It then uses the existing entity-bound instance load, two stable inventory
reads, authenticated broker, response identity check, unchanged strict parser
and controller validator, and independent unload verification.

The implementation does not treat the whole model hash as a template hash,
extract or rewrite a sidecar template, add llama.cpp-specific prompt content,
or normalize output. A fixture binds a minimal GGUF's exact embedded template,
rejects a template digest mismatch, loads an entity-scoped instance, and proves
unload. Lint passed; 55 focused LM Studio/broker/runner tests passed. The full
suite passed 565 tests, skipped one mounted-artifact test, and had zero
failures.

### Multi-horizon production result

The production-path screen used two exact retained fresh Oxford horizons in one
session: nearby Qwen with no prior resident action continuity, followed by a
newly addressed urgent message from Qwen. One authority-free prefix readiness
completed in 0.789 seconds. The two resident decisions completed in 2.099 and
2.566 seconds. All three responses used the exact entity-bound instance,
reported zero reasoning tokens, contained no tool calls, and passed their
unchanged schemas. There was no retry or correction.

Both decisions were identical:

```text
look_direction {"horizontal":"same","vertical":"down"}
```

The first commitment proposed looking around despite selecting no horizontal
turn. The second reused the visible stone-brick/stained-glass subject and said
the expected consequence was that the player-list UI would show Qwen exploring
those materials. That confuses another resident's incoming report with this
body's expected camera consequence. Fast structural conformance therefore did
not become evidence of grounded adaptation.

The production result SHA-256 is
`e4a4c829f4ebd3d7a5024155d29b8f819eca5a83e776c3d9918f4ca44343ffed`.
The broker journal verifies twelve events with tip
`49d655cb8bb4f974ac5426e6acf5adeb272242aa4e5ddb139915db5b9b0520b6`;
its file SHA-256 is
`1f39100ce0034f599b86e51ae6a9e19f90a9c722d32428656ef3a5c90ccc204b`.
Transport verification found three successful attempts, no failures,
cancellations, identity failures, or corrections. All three quota charges
settled, none remained unsettled, and the quota tip is
`f3f4d4fc8e86e3904e29f2c07c27a60450d915426028605583f47ba25d2f3976`.
The owned instance unloaded and `lms ps --json` was empty.

## SmolLM2 instruct GGUF family

Exact GGUF admission made three previously unreachable installed SmolLM2 Q8
artifacts eligible for a production-path screen. They share the same 368-byte
non-reasoning chat template, SHA-256
`872be49dbb638044ad01b60388f48d469ff2980e5f0dccdc22ec907db54d0788`,
and an indexed 8,192-token context:

| Model                 | Artifact bytes | Artifact-tree SHA-256                                              |
| --------------------- | -------------: | ------------------------------------------------------------------ |
| SmolLM2 1.7B Instruct |  1,820,414,656 | `300e13a5b041c6e1c285369153de67dd58dc885be401e1d78237d4dea411b83b` |
| SmolLM2 360M Instruct |    386,404,992 | `e9ed1328c2fd6da423facb77f83828b8ad20e095549f23e58be7203dae9d01c4` |
| SmolLM2 135M Instruct |    144,811,072 | `e75f4d88e3d93c82bad3bb059a14168979fdc6f3a7e9f8cc4a900687b5c67eaa` |

Each received one authority-free prefix readiness and, because its first fresh
resident decision failed, no second horizon or corrective attempt:

| Model | Readiness | First decision | Result                                                                            |
| ----- | --------: | -------------: | --------------------------------------------------------------------------------- |
| 1.7B  |   1.115 s |        6.130 s | invalid mixed schema prose, comments, duplicated actions, and malformed `whisper` |
| 360M  |   0.504 s |        7.939 s | invalid partial object followed by repeated charter text; 512-token output cap    |
| 135M  |   0.408 s |        6.516 s | invalid copied contract/observation fragments; 512-token output cap               |

The 1.7B output did contain a potentially useful intention to communicate with
Qwen, but intention is not an admitted action. It represented `action` both as
a schema object and later as `whisper`, included non-JSON commentary, and did
not close one valid object. The smaller models degraded further. All readiness
responses were clean; no response exposed private reasoning or tool calls. The
unchanged parser rejected every decision.

Each broker journal verifies nine events and two successful physical responses;
both quota charges settled and none remained unsettled. The journal file
SHA-256 values for 1.7B, 360M, and 135M are respectively
`67842c6ca0f88104126c4104833e4e0572b9a648646ad4bf830debcf7b2017f9`,
`133e0446f61892b6685103f1e98a5bb1f7d3997605483fd09e3cdaf67c80c54c`,
and `5aa49d090ec9f222b889295d415eea5617e01e1bcc4dcf84d034362e3ae1e76d`.
Every owned instance unloaded and final LM Studio inventory was empty.

## Remaining installed boundary

The current conclusion is narrower than “local models cannot work.” It is that
the exact installed compact frontier has now been exercised without producing
a candidate that supports another release:

- Gemma 4 26B and Qwen3-VL 4B were already exercised under MLX; Gemma missed
  the body horizon and Qwen's live/resume treatment produced 47 identical
  camera actions with degraded shared latency.
- Bonsai 8B is incompatible with the selected MLX engine; SmolLM3's installed
  template requests private reasoning by default; Rice timed out here.
- The existing llama.cpp GPT-OSS and Bonsai treatments failed timing/grounding,
  while exact production Berduck repeated one camera action and confused the
  addressed consequence.
- The exact installed SmolLM2 instruct family failed both strict output
  integrity and the body horizon at 1.7B, 360M, and 135M without retries.
- The installed Ollama Llama 3.2 and Phi-4 treatment was slow and behaviorally
  unsuccessful. Llama 3.3 is not an untouched candidate: current local runtime
  records already contain real starts and completions, so it was not relabeled
  as fresh and rerun.
- Other indexed artifacts are large, base, reasoning-oriented, OCR/vision
  specialists, or zero-byte model directories rather than installed artifacts.
  Baguettotron's embedded template explicitly opens a `<think>` section, while
  Pleias-RAG has no embedded chat template for exact admission. They were not
  promoted merely because an index entry exists.

The installed Qwen3-VL 4B candidate was not merely inferred to have been
exercised: it crossed exact MLX preflight and production-path fresh horizons,
then completed two ordinary Oxford live/resume episodes with 47 actions. It was
therefore not rerun or relabeled as untouched.

The intended endpoint remains sustained, adaptive, resident-chosen life in
ordinary Minecraft time. The mechanics now preserve entity-specific local
session identity, current action admission, clean live/resume/view aftermath,
and Textile-readable histories. What is missing is an admitted mind/runtime
combination that can produce current, grounded choices at body-relevant
latency. Under the no-provider, no-native-human boundary, the smallest remaining
owner-held choice is whether to authorize installing a different compact local
instruction artifact for the now-exact MLX/GGUF product path. No artifact was
downloaded or selected implicitly here.
