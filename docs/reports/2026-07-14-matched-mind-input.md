# Direct and Ax received one exact inhabited-world request

On July 14, 2026, the direct OpenRouter mind and the Ax 23.0.0 resident program
completed one provider-backed comparison from the same content-addressed
`behold.mind-request-artifact.v1` input.

This closes the request-identity part of replaceable minds. It does not claim a
matched world rollout or improved Minecraft competence.

## Input

- Request SHA-256:
  `64828ebe73dff243af92078e171cdc27573dacccd9b423a018dbb3171c57a808`
- Model: `openai/gpt-5.4-mini`
- Policy: `neutral-benchmark-v1`
- Action surface: `minecraft-player-v1`
- Safety profile: `vanilla-player-v1`
- Admitted actions: seven observation-dependent player actions, including
  explicit yield
- World execution: disabled
- Executable world functions exposed to either adapter: none

The request was reconstructed under current code from WrenLife turn 206 and a
real bounded Minecraft observation. It intentionally changed the historical
model and profiles to the selected neutral comparison configuration. Therefore
the reconstruction report says `current-code-reconstruction` and does not claim
to reproduce the old provider request.

Once created, the immutable request artifact—not the historical request—was the
exact input to both comparison arms.

## Model choice

OpenRouter's current catalog describes GPT-5.4 Mini as a production-oriented
tool-use and agent model with a 400K context, $0.75/M input pricing, and $4.50/M
output pricing. Its published benchmark view places it in the 96th percentile
for coding and the 85th percentile for agentic capability. This made it a
stronger cost/quality choice for the comparison than merely reusing the cheap
model from the source run.

Source: <https://openrouter.ai/openai/gpt-5.4-mini/pricing>

## Result

| Arm    | Input matched | Status    | Latency | Prompt / completion tokens |        Cost |
| ------ | ------------- | --------- | ------: | -------------------------: | ----------: |
| Direct | yes           | completed | 1,598ms |                 6,388 / 28 |   $0.004917 |
| Ax     | yes           | completed | 1,394ms |                 8,949 / 58 | $0.00697275 |

Both calls recorded the same mind-request hash, message hash, tool hash, model,
and profiles. Their adapter bodies had different hashes because direct uses an
OpenAI-compatible tool-call request while Ax uses its typed signature input.
That difference is expected and is no longer confused with a different
framework request.

Direct proposed `dig_block`. Ax proposed `face_visible_target`. Both proposals
were schema-valid and admitted. Behavioral agreement is descriptive, not a
passing condition: a replaceable mind must receive the same lived situation
and authority boundary, but remains free to choose differently.

## Evidence and remaining red edge

Local evidence is retained outside version control at:

- `.behold-artifacts/evaluations/matched-mind-v1/request.json`
- `.behold-artifacts/evaluations/matched-mind-v1/reconstruction.json`
- `.behold-artifacts/evaluations/matched-mind-v1/comparison.json`

The next required proof starts a fresh world epoch, records the exact mind
request before a proposal, admits one proposal through normal world authority,
waits for its terminal result, independently reobserves the consequence, and
anchors that causal interval in the inhabitant's Lync life. This comparison did
none of those world-changing steps.
