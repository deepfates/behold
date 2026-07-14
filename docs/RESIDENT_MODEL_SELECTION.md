# Resident model selection

This is a workload decision, not a permanent ranking of model families.

On July 13, 2026, the population proof stopped inheriting the old
`openai/gpt-4o-mini` value from an unrelated environment file. We queried
OpenRouter's [live model catalog](https://openrouter.ai/api/v1/models) for models
with tool support, then replayed the exact first restart request from
`CarrotResident` in failed population proof v2. The request contained the
resident's own confirmed collection history, current carrot inventory, bounded
Minecraft observation, task, and available tools. Each candidate received the
same request twice through OpenRouter.

| Model                        | Correct grounded tool | Observed latency | Catalog input/output per 1M tokens | Judgment                                         |
| ---------------------------- | --------------------: | ---------------: | ---------------------------------: | ------------------------------------------------ |
| `openai/gpt-5.6-luna`        |                   2/2 |         1.9–2.8s |                            $1 / $6 | Selected                                         |
| `google/gemini-3.5-flash`    |                   2/2 |         1.6–1.7s |                         $1.50 / $9 | Faster, more expensive                           |
| `anthropic/claude-haiku-4.5` |                   2/2 |         2.8–3.6s |                            $1 / $5 | Slower and much more verbose                     |
| `qwen/qwen3.7-plus`          |                   2/2 |         6.8–7.1s |                      $0.32 / $1.28 | Cheaper, too slow for the interactive loop       |
| `deepseek/deepseek-v4-pro`   |                   2/2 |         6.8–7.7s |                     $0.435 / $0.87 | Cheaper, too slow for the interactive loop       |
| `openai/gpt-5.4-mini`        |        0/2 tool calls |         0.8–0.9s |                      $0.75 / $4.50 | Returned plain text instead of the admitted tool |

The selected model is `openai/gpt-5.6-luna`. It is on the observed frontier:
only Gemini was faster, while Luna was cheaper; every cheaper correct candidate
was more than twice as slow. OpenRouter describes Luna as the fast,
cost-efficient GPT-5.6 model for high-volume, latency-sensitive lightweight
agentic work, which matches this controller role.

Two trials are a directional screen, not a broad quality claim. The live
population proof remains the authority: it records actual provider, latency,
tokens, cost, choices, Minecraft results, restart behavior, and budget verdicts.
Future model changes should repeat a matched lived-request comparison and then
pass the full live proof. A newer model name alone is not sufficient.
