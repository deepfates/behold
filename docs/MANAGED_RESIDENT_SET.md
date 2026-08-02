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
installed template digest, versioned strict-JSON action transport/schema,
context/output/temperature settings, and request-scoped `keep_alive` load
setting. It uses Ollama's `format` schema and never native `tools`. A local
population must give every active resident an `ollamaLocal` contract with the
same endpoint, transport/schema, and settings; per-model tag, content digest,
and template digest remain exact resident identities. Its configured `model`
must equal the exact Ollama tag.

For a text-only `resident-v2` model that should not spend the bodily horizon on
hidden reasoning, the v4 OpenRouter route additionally binds reasoning disabled
and the request-level privacy filters. Endpoint tags and returned provider names
are distinct OpenRouter identities and both must be declared exactly:

```json
{
  "protocol": "behold.openrouter-route-policy.v4",
  "routes": [{ "requestTag": "deepinfra/fp4", "responseProvider": "DeepInfra" }],
  "allowFallbacks": false,
  "maxOutputTokens": 512,
  "residentDecisionFormat": "strict_json",
  "reasoningEnabled": false,
  "zdr": true,
  "dataCollection": "deny"
}
```

This is a versioned inference contract, not a claim that every model becomes
fast when reasoning is disabled. It remains subject to the normal model,
provider-response, resident-identity, schema, quota, and cognition-broker gates.

For sustained `legible-resident-v1` life, use the separately versioned
`behold.ollama-local-resident-session.v1` transport. It keeps a nonzero
`keepAlive`, places the charter and exact admitted action contract ahead of
changing lived context, and uses the v2 public-commitment schema. During an
all-ready start, the runner loads every exact admitted model while Minecraft
ticks are frozen and proves they are simultaneously resident before releasing
the population. On stop it drains cognition, unloads only those owned loads,
and verifies they disappeared before saving and releasing the world. The
older one-shot transports remain distinct and are not silently promoted to a
session.

For example, one local resident entry has this shape (use the digest from the
local `/api/tags` inventory, not this placeholder):

```json
{
  "entityId": "LocalLife",
  "model": "llama3.2:3b",
  "mind": "direct",
  "policyProfile": "legible-resident-v1",
  "bodyProfile": "minecraft-human-semantic-v1",
  "actionProfile": "minecraft-human-semantic-v1",
  "safetyProfile": "vanilla-player-v1",
  "ollamaLocal": {
    "protocol": "behold.ollama-local-policy.v2",
    "endpoint": "http://127.0.0.1:11434/api/chat",
    "modelTag": "llama3.2:3b",
    "modelDigest": "<64-lowercase-hex>",
    "transport": {
      "protocol": "behold.ollama-local-resident-session.v1",
      "schemaProtocol": "behold.ollama-local-json-action-schema.v2",
      "schemaSha256": "1a0c46d7467e7df2aee3483f54b6ffb2f6497bfc52ff42001d0f03dc4c07325e",
      "templateSha256": "<64-lowercase-hex>"
    },
    "settings": {
      "contextTokens": 16384,
      "maxOutputTokens": 512,
      "temperature": 0.2,
      "keepAlive": "30m"
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

The ordinary `behold live` entry treats each stopped/resumed episode as a new
bounded accounting scope under the stable live-session namespace. This lets a
continuing life receive a new declared episode budget without rewriting or
refilling any prior ledger. It does not equalize actual calls between residents,
change cognition concurrency, or imply a fair model comparison.

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
missing completion capability, template drift, or insufficient model context.
This preflight neither calls `/api/chat` nor loads model weights. A separately
logged resident-session setup calls `/api/chat` with an empty message list only
after world-time freeze; those model-load calls are never resident cognition.

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
runner always verifies the authenticated broker journal, quota settlement, and
content identities for every admitted physical attempt before reporting
terminal and usage totals. A sealed run with `BEHOLD_RECORD_MODEL_IO=1` also
retains and verifies exact request/response bodies under the private
`_cognition/transport` boundary; ordinary runs retain no body files or file
references.
