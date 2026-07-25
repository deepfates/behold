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

The runner rejects missing resident quotas, unequal limits, unequal body,
action, or safety profiles, a missing or malformed scope, and any attempt to
combine this mode with `--maxModelCalls`.
The older aggregate call limit is purpose-blind: allowing both would let an
auxiliary fold consume a population ceiling intended for resident decisions.

## All-ready release

Quota-controlled populations automatically use
`behold.experiment-release-plan.v1`; this is not the legacy `--paused` mode.
Every configured controller receives its normal policy and a runner-owned
broker credential, connects its Minecraft body, synchronizes local chunks, and
then writes a durable arm record. Minecraft ticks are frozen before the first
controller is launched. The runner will not write the release record until:

- every exact life/body in the plan owns its expected controller lease and arm;
- model, mind, policy, observation, action, safety, experiment-scope, and quota
  account identities still match the plan;
- the broker has accepted and admitted zero requests and every quota ledger is
  byte-for-byte unchanged from setup;
- Minecraft acknowledges `save-all flush` while frozen and Behold records the
  resulting `behold-tree-v2` world digest.

Paused residents are rejected because pause removes the policy and credential
that the gate is meant to arm. The runner unfreezes Minecraft, appends exactly
one `experiment_released` lifecycle event, and exclusively creates one release
record referring to that event. Controllers then claim release observation in
actual ordinal order. This is an all-ready barrier, not a claim of simultaneous
execution: `resident_release_observed` records first, second, and later
observation of the shared epoch.

Before release, body events and operator commands use `setup_` journal types;
setup-time perception is discarded and re-baselined before policy start. An
interactive controller command is rejected before release. Programmatic setup
hooks are logged explicitly. No setup event enters Lync because no resident
turn can be admitted. Each later mind-request artifact, model-turn record, and
Lync entity turn carries the authenticated release reference outside the
Minecraft observation projection.

Release directories and their plan, arm, release, and claim records are
exclusive, private, fsynced files under the managed run. Reopening an exact
record is idempotent; a conflicting plan, arm, release, population, account, or
profile fails closed. A crash with only some arms or with a lifecycle release
event but no release file cannot start resident cognition. A recovered world
owner creates a new epoch and release directory; durable quota accounts do not
refill.

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
