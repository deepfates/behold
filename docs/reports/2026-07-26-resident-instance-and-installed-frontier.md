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
timed out on its first resident decision after 60.018 seconds. A separate
untouched GGUF candidate, `berduck-qwen2-1.5b`, produced one valid, reasoning-free
decision in 2.312 seconds, but it remains outside the exact production boundary
and the single choice merely looked down while paraphrasing the already-visible
scene. That is useful frontier evidence, not sufficient grounds to add a new
runtime family and release it into Minecraft.

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
crosses release, controller environment, and cleanup. Lint passed; the focused
LM Studio/runner gate passed 54 tests; the complete suite passed 564 tests and
skipped one mounted-artifact test, with zero failures.

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

Static inventory exposed one further compact instruct-shaped artifact outside
the MLX-only production boundary:

- model key `berduck-qwen2-1.5b`;
- index identity
  `mradermacher/berduck-qwen2-1.5b-GGUF/berduck-qwen2-1.5b.Q8_0.gguf`;
- 1,646,573,408 bytes, Q8_0, Qwen2 architecture, and 32,768 indexed maximum
  context;
- file SHA-256
  `29b38f80cd7e0f19a7e3024dc3d822209b199ab62cafd69d9be7d3af8c69f2f2`;
- regular-file-tree SHA-256
  `5c5f93ebf582cb3d3e2ba5edcc826381e81f2ef0b82beb8ace4c4e7882ad2059`;
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

The result SHA-256 is
`3f747c5c1cc5a49e3644f8303eabc204f69b1ef8c865dfc437d83f3b564a846b`;
the model-log SHA-256 is
`42e0ebfc7b926ee0a902766ee7a2ce5e4c92456d36547081d11705d6ded982e3`.
The instance unloaded and final inventory was empty.

Behold's production LM Studio policy deliberately admits only an exact MLX
engine and verifies a standalone `chat_template.jinja`. This GGUF stores its
template inside the model container; the diagnostic did not independently
extract and bind those exact template bytes. Treating the whole artifact hash
as if it were a template hash would blur two identities. A production GGUF
extension therefore remains unimplemented. One weak but legal choice is not a
sufficient behavioral reason to expand that boundary and launch a live world.

## Remaining installed boundary

The current conclusion is narrower than “local models cannot work.” It is that
no untouched candidate remains inside the exact installed production boundary
with evidence supporting another release:

- Gemma 4 26B and Qwen3-VL 4B were already exercised under MLX; Gemma missed
  the body horizon and Qwen's live/resume treatment produced 47 identical
  camera actions with degraded shared latency.
- Bonsai 8B is incompatible with the selected MLX engine; SmolLM3's installed
  template requests private reasoning by default; Rice timed out here.
- The existing llama.cpp GPT-OSS and Bonsai treatments failed timing/grounding,
  and Berduck has only the narrow non-production result above.
- The installed Ollama Llama 3.2 and Phi-4 treatment was slow and behaviorally
  unsuccessful. Llama 3.3 is not an untouched candidate: current local runtime
  records already contain real starts and completions, so it was not relabeled
  as fresh and rerun.
- Other indexed artifacts are large, base, reasoning-oriented, OCR/vision
  specialists, or outside the admitted runtime; zero-byte model directories are
  not installed artifacts. They were not promoted merely because an index
  entry exists.

The intended endpoint remains sustained, adaptive, resident-chosen life in
ordinary Minecraft time. The mechanics now preserve entity-specific local
session identity, current action admission, clean live/resume/view aftermath,
and Textile-readable histories. What is missing is an admitted mind/runtime
combination that can produce current, grounded choices at body-relevant
latency. Acquiring a different artifact, accepting a remote provider/privacy or
spend boundary, or declaring a native-human treatment are owner-held changes;
the existing evidence does not authorize one implicitly.
