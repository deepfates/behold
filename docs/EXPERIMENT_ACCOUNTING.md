# Experiment accounting v1

Behold's first matched-population accounting layer is an operator-side causal
record. It does not alter a resident's prompt, observations, actions, Lync, or
Minecraft body. Its hard limits apply to provider-attempt authorizations, not
to estimated tokens, inferred decisions, or Minecraft actions.

## Quota-controlled populations

Use a `behold.managed-resident-set.v1` file and give every resident the same
two limits:

```json
{
  "providerQuotas": {
    "residentDecisionAttempts": 100,
    "auxiliaryContextAttempts": 20
  }
}
```

Start it with an explicit stable experiment identity:

```sh
npm run swarm -- \
  --world sf-csdr \
  --residents .behold-runtime/residents.local.json \
  --accountingScope matched-run-2026-07-25 \
  --maxModelConcurrency 2
```

The runner rejects missing resident quotas, unequal limits, a missing or
malformed scope, and any attempt to combine this mode with `--maxModelCalls`.
The older aggregate call limit is purpose-blind: allowing both would let an
auxiliary fold consume a population ceiling intended for resident decisions.

The scope is deliberately not derived from the world-owner epoch. Each
resident account is the SHA-256 of scope, world, and continuing life ID. Its
append-only hash-chained ledger lives below
`<controlRoot>/accounting/<scope digest>/provider/`. A restart, recovered owner
epoch, or new broker therefore reopens the same account rather than refilling
it. Replaying the exact same charge evidence is idempotent; conflicting replay,
configuration drift, and edited chains fail closed. Every append is fsynced
before the upstream request can begin.

## What the counters mean

These evidence layers remain distinct:

| Quantity                        | Authoritative event                         | Hard-capped in v1?                    | Meaning                                                                                                                                    |
| ------------------------------- | ------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Provider attempt authorization  | quota ledger `charged`                      | yes, per resident and purpose         | Durable permission granted immediately before one broker admission. A crash after authorization remains conservatively consumed.           |
| Auxiliary context work          | provider ledger purpose `loom_fold`         | yes                                   | Loom/Ax context-fold provider work; it cannot consume any resident's `resident_decision` quota.                                            |
| Resident-decision provider work | provider ledger purpose `resident_decision` | yes                                   | A model request made for a resident decision. Provider/network retries are new attempts and consume only this resident's purpose quota.    |
| Provider outcome                | quota ledger `settled`                      | n/a                                   | Response, failure, timeout, or cancellation for one charged authorization. Unsettled charges remain visible after a crash.                 |
| Provider tokens and cost        | provider response usage in `settled`        | measured, not hard-capped             | Only metrics actually reported by the provider are totaled. Per-metric report counts distinguish an unreported value from a reported zero. |
| Broker admission                | cognition journal `admitted`                | bounded by the matching authorization | A request admitted to the one-at-a-time-per-resident/concurrency scheduler.                                                                |
| Admitted resident decision      | resident journal `model_turn`               | no separate durable cap yet           | A response accepted by the resident controller as a decision. This is not inferred from provider success.                                  |
| Physical Minecraft attempt      | resident journal `action_started`           | no separate durable cap yet           | An embodied action dispatched to the serialized action kernel. Outcomes remain separate authenticated action/Lync evidence.                |

The last two rows are intentionally not relabeled as provider attempts. A
successful provider response can fail decision parsing, a decision can yield,
and a decision can produce zero or several controller actions. Analysis must
join these event streams by their existing run, resident, turn, request, and
action identities rather than collapse them into one number.

## Evidence and visibility boundary

The quota ledger and cognition journal are raw operator evidence. They contain
resident account identities, request hashes, model names, response usage, and
local evidence paths. They are not appended to mind requests, body
observations, model-facing replay, or Lync prose. Lifecycle events expose the
scope, equal limits, ledger identity, and verified shutdown snapshot to an
operator. A future Textile presentation may project selected totals, but it
must not become the causal source and must not copy unrelated raw/private world
fields into a resident's model context.

This deterministic gate proves mechanics: purpose isolation, equality
enforcement, durable exhaustion, idempotent replay, and usage accounting. It
does not prove that two models receive semantically equal information, use
their budgets similarly, or behave scientifically comparably in a live world.
