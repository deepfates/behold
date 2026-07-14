# Resident model selection

This is a workload decision, not a permanent ranking of model families. The
live resident proof is authoritative; a model name or general benchmark is
not.

## Current decision: Gemini 3.5 Flash

On July 14, 2026, `openai/gpt-5.6-luna` failed two full population runs after
the residents gained an honest first-person orientation action. In both runs,
one resident repeatedly separated horizontal and vertical looking, exhausted
the eight-step episode, and never saw its target on the ground. The world,
action, scheduler, and causal verifier were healthy.

We replayed the exact first CarrotResident request from failed run v7 three
times through each remaining fast candidate. The request contained the same
current first-person scene, task, tool schemas, and required model-selected
action. No proposal could reach Minecraft.

| Model                        | Combined horizontal + downward scan |    Latency | Cost per matched call | Judgment                             |
| ---------------------------- | ----------------------------------: | ---------: | --------------------: | ------------------------------------ |
| `google/gemini-3.5-flash`    |                                 3/3 |  1.1–2.2 s |            $0.0021915 | Selected for the full embodied proof |
| `anthropic/claude-haiku-4.5` |                                 0/3 |  1.3–1.7 s |              $0.00236 | Repeated the one-axis Luna strategy  |
| `openai/gpt-5.6-luna`        |                     failed live 2/2 | 2.3–7.6 s* |     $0.053–$0.055/run | Removed as the resident default      |

`*` Luna's range is from individual calls in the two complete causal runs; the
later search timeouts stopped before a proof report could be assessed.

The selected model is `google/gemini-3.5-flash`. OpenRouter describes it as a
high-efficiency model optimized for agentic execution loops, lists tool-choice
support, and currently reports $1.50 input / $9 output per million tokens with
roughly 1.6-second provider latency. At the proof's 40,000-token and $0.10
limits, it remains inside the intended interactive cost envelope.

- [Gemini 3.5 Flash pricing and providers](https://openrouter.ai/google/gemini-3.5-flash/providers)
- [Gemini 3.5 Flash API and tool parameters](https://openrouter.ai/google/gemini-3.5-flash-20260519/pricing)
- [Claude Haiku 4.5 pricing](https://openrouter.ai/anthropic/claude-haiku-4.5/pricing)

## Earlier screen

On July 13, we had replayed a much easier restart request: the resident already
held its carrot and only needed to wait. Luna, Gemini, Haiku, Qwen 3.7 Plus,
and DeepSeek V4 Pro all chose the grounded action; Luna was then the cheapest
of the two low-latency choices. GPT-5.4 Mini returned prose instead of a tool.
That screen was useful but did not measure active embodied search, so it no
longer controls the default.

Future changes should repeat a matched lived-request comparison and then pass
the full live proof. The record must include actual provider calls, latency,
tokens, cost, choices, Minecraft consequences, restart behavior, and budget
verdicts.
