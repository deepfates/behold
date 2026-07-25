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
      "tickMs": 1200
    },
    {
      "entityId": "BuilderLife",
      "bodyUsername": "BuilderBody",
      "model": "provider/builder-model",
      "mind": "ax",
      "tickMs": 5000,
      "paused": true
    }
  ]
}
```

`entityId` and `model` are required for every entry. Optional fields are
`bodyUsername`, `urgentModel`, `mind`, `policyProfile`, `actionProfile`,
`safetyProfile`, `tickMs`, `maxTurnSteps`, `resumeAfterBudget`, `task`,
`target`, `allowTools`, and `paused`. Unknown fields and wrong types are errors;
the runner never silently substitutes a global value for a misspelled field.

## Preflight and start

Check that the Place and ownership fences are clear, then start the same
foreground owner used by ordinary managed runs:

```sh
npm run world -- status --world sf-csdr
npm run swarm -- \
  --world sf-csdr \
  --residents .behold-runtime/residents.local.json \
  --maxModelConcurrency 2
```

`--residents` is deliberately exclusive with resident-level flags such as
`--controller`, `--body`, `--model`, `--mind`, `--tickMs`, profiles, tasks, and
`--paused`. Population controls remain command-level: `--maxResidents`,
`--maxModelConcurrency`, `--maxModelCalls`, and `--duration` still apply to the
managed epoch as a whole.

An `OPENROUTER_API_KEY` is required when at least one configured resident is
active. A set whose every entry has `"paused": true` can connect its bodies
without provider credentials. The key remains in the runner-owned cognition
broker and is never copied into this file or a resident process.

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
runtime evidence by itself.
