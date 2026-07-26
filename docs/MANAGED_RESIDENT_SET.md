# Managed resident set operator entry

Use a resident-set file when one managed Place should contain residents with
different models, minds, bodies, timing, or controller profiles. This is an
operator input to the existing managed-world runner, not a second runtime.

## Write the local resident set

Keep credentials out of this file. A convenient ignored location is
`.behold-runtime/residents.local.json`:

```json
{
  "protocol": "behold.managed-resident-set.v1",
  "residents": [
    {
      "entityId": "ScoutLife",
      "bodyUsername": "ScoutBody",
      "model": "provider/scout-model",
      "mind": "direct",
      "tickMs": 1200,
      "providerQuotas": {
        "residentDecisionAttempts": 100,
        "auxiliaryContextAttempts": 20
      }
    },
    {
      "entityId": "BuilderLife",
      "bodyUsername": "BuilderBody",
      "model": "provider/builder-model",
      "mind": "ax",
      "tickMs": 5000,
      "providerQuotas": {
        "residentDecisionAttempts": 100,
        "auxiliaryContextAttempts": 20
      },
      "paused": true
    }
  ]
}
```

`entityId` and `model` are required for every entry. Optional fields are
`bodyUsername`, `urgentModel`, `mind`, `policyProfile`, `bodyProfile`,
`actionProfile`, `safetyProfile`, `tickMs`, `maxTurnSteps`, `resumeAfterBudget`, `task`,
`target`, `allowTools`, `providerQuotas`, `providerRoute`, `ollamaLocal`, and
`paused`. Unknown fields and wrong types are errors; the runner never silently
substitutes a global value for a misspelled field.

`providerRoute` and `ollamaLocal` are mutually exclusive direct-mind transport
contracts. `providerRoute` binds an exact ordered OpenRouter provider list,
disabled fallbacks, and output cap. `ollamaLocal` instead binds the exact
loopback native `/api/chat` endpoint, installed model tag and content digest,
context/output/temperature settings, and request-scoped `keep_alive` load
setting. A local population must give every active resident an `ollamaLocal`
contract with the same endpoint and settings. Its configured `model` must equal
the exact Ollama tag.

For example, one local resident entry has this shape (use the digest from the
local `/api/tags` inventory, not this placeholder):

```json
{
  "entityId": "LocalLife",
  "model": "llama3.2:3b",
  "mind": "direct",
  "ollamaLocal": {
    "protocol": "behold.ollama-local-policy.v1",
    "endpoint": "http://127.0.0.1:11434/api/chat",
    "modelTag": "llama3.2:3b",
    "modelDigest": "<64-lowercase-hex>",
    "settings": {
      "contextTokens": 16384,
      "maxOutputTokens": 512,
      "temperature": 0.2,
      "keepAlive": "5m"
    }
  },
  "providerQuotas": {
    "residentDecisionAttempts": 4,
    "auxiliaryContextAttempts": 1
  }
}
```

`providerQuotas` is optional for legacy runs. If any resident has it, every
resident must have the same two positive limits and the start command must
provide a stable `--accountingScope`. Those per-life, per-purpose provider
attempt quotas survive owner epochs and recovery. See
[Experiment accounting v1](EXPERIMENT_ACCOUNTING.md) for exact counter meanings
and the evidence boundary.

Quota-controlled mode also enables the all-ready experiment release barrier.
Every resident must use the same body, action, and safety profile, and none may
be `paused`: the bodies connect and synchronize with their normal policies and
broker credentials while Minecraft ticks are frozen, then all begin only after
one durable shared release. Policy profiles, models, and mind adapters may
differ as explicit experimental treatments. Actual post-release observation
order is recorded and is not described as simultaneous.

## Preflight and start

Check that the Place and ownership fences are clear, then start the same
foreground owner used by ordinary managed runs:

```sh
npm run world -- status --world sf-csdr
npm run swarm -- \
  --world sf-csdr \
  --residents .behold-runtime/residents.local.json \
  --accountingScope living-pilot-2026-07-25 \
  --maxModelConcurrency 2
```

`--residents` is deliberately exclusive with resident-level flags such as
`--controller`, `--body`, `--model`, `--mind`, `--tickMs`, profiles, tasks, and
`--paused`. Population controls remain command-level: `--maxResidents`,
`--maxModelConcurrency` and `--duration` still apply to the managed epoch as a
whole. `--maxModelCalls` remains available only for legacy purpose-blind runs;
the runner rejects it when durable `providerQuotas` are active.

An `OPENROUTER_API_KEY` is required when an active population uses the remote
transport. A local Ollama population requires no OpenRouter key, but it does
require quota-controlled release mode. Before acquiring world authority the
runner reads the plain Ollama server config (default
`~/.ollama/server.json`, override with `BEHOLD_OLLAMA_SERVER_CONFIG`), requires
`disable_ollama_cloud: true`, and checks only the loopback version, tags, show,
and loaded-model endpoints. It rejects an absent tag, content-digest drift,
missing tool capability, or insufficient model context. This preflight neither
calls `/api/chat` nor loads model weights.

A legacy set whose every entry has `"paused": true` can connect its bodies
without cognition credentials. Remote upstream credentials remain in the
runner-owned cognition broker; local residents likewise receive only their
scoped loopback broker credential, never OpenRouter environment or provider
fallback semantics.

## Stop and inspect

Interrupt the foreground command normally. It drains every resident, saves
Minecraft, stops the server, and releases the exact owner epoch. Then inspect
the clear state:

```sh
npm run world -- status --world sf-csdr
```

The lifecycle journal's `run_configured` event records each normalized
resident's model, mind, profiles, timing, body, and paused state. This makes the
heterogeneous population inspectable without treating the operator file as
runtime evidence by itself. Equal quotas are resource controls, not a claim
that heterogeneous providers or models form a fair comparison. On drain, the
runner verifies the private `_cognition/transport` evidence for exact coverage
of every admitted physical attempt before reporting terminal and usage totals.
