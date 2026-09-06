# Resident model selection exercise

Date: 2026-07-14

This is retained workload evidence, not a current default-model decision or a
permanent ranking of model families. Current model and route choices live in
the resident configuration used for a run.

## Ordinary-orientation screen

`openai/gpt-5.6-luna` failed two full population runs after the residents gained
an honest first-person orientation action. In both runs, one resident repeatedly
separated horizontal and vertical looking, exhausted the eight-step episode,
and never saw its target on the ground. The world, action, scheduler, and causal
verifier were healthy.

The exact first CarrotResident request from failed run v7 was replayed three
times through each remaining fast candidate. The request contained the same
current first-person scene, task, tool schemas, and required model-selected
action. No proposal could reach Minecraft.

| Model                        | Combined horizontal + downward scan |   Latency | Cost per matched call | 2026-07-14 judgment                 |
| ---------------------------- | ----------------------------------: | --------: | --------------------: | ----------------------------------- |
| `google/gemini-3.5-flash`    |                                 3/3 | 1.1–2.2 s |            $0.0021915 | Selected for that embodied proof    |
| `anthropic/claude-haiku-4.5` |                                 0/3 | 1.3–1.7 s |              $0.00236 | Repeated the one-axis Luna strategy |
| `openai/gpt-5.6-luna`        |                     failed live 2/2 | 2.3–7.6 s |     $0.053–$0.055/run | Removed from that proof's default   |

Luna's latency range came from individual calls in the two complete causal
runs; later search timeouts stopped before a proof report could be assessed.

The selected ordinary model for that proof was `google/gemini-3.5-flash`. At
the observed conditions it fit the proof's 40,000-token and $0.10 limits. Those
conditions and prices are historical and must not be reused as current provider
facts without a new check.

## Earlier screen

On July 13, an easier restart request was replayed: the resident already held
its carrot and only needed to wait. Luna, Gemini, Haiku, Qwen 3.7 Plus, and
DeepSeek V4 Pro all chose the grounded action; Luna was then the cheapest of the
two low-latency choices. GPT-5.4 Mini returned prose instead of a tool. That
screen did not measure active embodied search and no longer controlled the
next day's proof.

Future model changes should repeat a matched lived-request comparison and then
exercise the full live path. The record should include actual provider calls,
latency, tokens, cost, choices, Minecraft consequences, restart behavior, and
budget verdicts.

## Bodily-urgency screen

The later untasked household run exposed a different workload. Wren was taking
damage at health 6.33, received compact current-body context, and nevertheless
chose another unrelated plank placement. Replaying that exact frame showed a
different frontier from orientation:

| Model                        | Exact-frame action  |  Latency |        Cost |
| ---------------------------- | ------------------- | -------: | ----------: |
| `google/gemini-3.5-flash`    | place another plank |  1.376 s |  $0.0069885 |
| `deepseek/deepseek-v4-flash` | status              |  2.379 s | $0.00079828 |
| `deepseek/deepseek-v4-pro`   | move forward 6      | 11.526 s | $0.01174848 |
| `openai/gpt-5.6-luna`        | move forward 5      |  2.306 s | $0.00627675 |
| `anthropic/claude-sonnet-5`  | look around         |  3.413 s |   $0.017976 |

The world could not be mutated by these proposals. Qwen 3.7 Plus failed because
the selected provider rejected required tool choice; Step 3.5 Flash crossed a
five-second deadline. DeepSeek V4 Flash was extremely cheap but did not choose
a bodily consequence and later timed out on one of two ordinary frames.

Luna was therefore selected as `--urgentModel` while Gemini remained the
ordinary model for that treatment. Three later endangered frames selected Luna
and produced relative escape choices instead of project bookkeeping. This
validated the workload routing and choice shift, not bodily survival: the body
over-routed once, failed one bounded path choice, and correctly refused one
blocked adjacent step. See the
[capped danger calibration](2026-07-14-capped-danger-calibration.md).

Run `first-life-v1-39` added a harder counterexample. Luna selected a currently
visible door as cover, but the call took 6.841 seconds and Wren died before
execution. The action was invalidated across the death boundary. The controller
then enforced a five-second bodily-urgency decision budget, and the Minecraft
adapter reduced the exact replay from 26 actions and 42,390 bytes to 16 actions
and 32,447 bytes. Luna remained provisional: the smaller workload still needed
a matched frontier comparison and live proof. See the
[affordance closing-time report](2026-07-14-affordance-closing-time.md).

Run `first-life-v1-41` crossed the corrected Gemini tool boundary with no model
call failure. Four Gemini decisions took 1.188–2.044 seconds. Three Luna urgent
decisions took 3.910, 2.849, and 3.380 seconds, all inside the five-second
admission boundary. Wren still died: urgent cognition was waiting behind a
19.239-second movement action, and the first escape choice was physically
blocked. These latencies kept both models in that experiment; they did not make
either model a demonstrated survival controller.
