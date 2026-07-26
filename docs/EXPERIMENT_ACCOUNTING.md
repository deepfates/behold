# Experiment accounting v1

Behold's first quota-controlled population accounting layer is an operator-side causal
record. It does not alter a resident's prompt, observations, actions, Lync, or
Minecraft body. Its hard limits apply to provider-attempt authorizations, not
to estimated tokens, inferred decisions, or Minecraft actions.

Equal limits prevent one resident or auxiliary context process from consuming
another resident's allocation. They do not make heterogeneous models a fair or
matched comparison: provider, route, availability, tokenization, context,
latency, schema reliability, and failure behavior remain part of the observed
deployment ecology.

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
  --accountingScope living-pilot-2026-07-25 \
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

Equal declared limits are checked again at every release. Remaining balances
are not required to be equal after residents have lived: model latency,
failures, cancellations, and voluntary waiting can produce different durable
usage. Restart preserves those independent balances without refill, catch-up,
or compensation. The separately configured fixed-decision pilot remains the
exception because its one-shot schedule requires fresh accounts.

## What the counters mean

These evidence layers remain distinct:

| Quantity                        | Authoritative event                                            | Hard-capped in v1?                    | Meaning                                                                                                                                                        |
| ------------------------------- | -------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider attempt authorization  | quota ledger `charged`                                         | yes, per resident and purpose         | Durable permission granted immediately before one broker admission. A crash after authorization remains conservatively consumed.                               |
| Auxiliary context work          | provider ledger purpose `loom_fold`                            | yes                                   | Loom/Ax context-fold provider work; it cannot consume any resident's `resident_decision` quota.                                                                |
| Resident-decision provider work | provider ledger purpose `resident_decision`                    | yes                                   | A model request made for a resident decision. Provider/network retries are new attempts and consume only this resident's purpose quota.                        |
| Provider outcome                | quota ledger `settled`                                         | n/a                                   | Response, failure, timeout, or cancellation for one charged authorization. Unsettled charges remain visible after a crash.                                     |
| Provider tokens and cost        | provider response usage in `settled`                           | measured, not hard-capped             | Only metrics actually reported by the provider are totaled. Per-metric report counts distinguish an unreported value from a reported zero.                     |
| Broker admission                | cognition journal `admitted`                                   | bounded by the matching authorization | A request admitted to the one-at-a-time-per-resident/concurrency scheduler.                                                                                    |
| Scheduled decision opportunity  | resident journal `resident_decision_opportunity` / `scheduled` | no                                    | A controller asked one resident mind for one logical decision. It exists before transport and is not inferred from a response.                                 |
| Provider-attempt terminal       | raw transport attempt plus broker terminal                     | n/a                                   | `success`, `provider_error`, `network_error`, `timeout`, and `cancelled` remain distinct. A repeated logical request has a one-based physical-attempt ordinal. |
| Logical response terminal       | resident journal `resident_decision_opportunity` / `terminal`  | n/a                                   | Valid response, malformed output, adapter rejection, admission rejection, transport/provider failure, or cancellation; only `success` can become `model_turn`. |
| Admitted resident decision      | resident journal `model_turn`                                  | no separate durable cap yet           | A response accepted by the resident controller as a decision. This is not inferred from provider success.                                                      |
| Physical Minecraft attempt      | resident journal `action_started`                              | no separate durable cap yet           | An embodied action dispatched to the serialized action kernel. Outcomes remain separate authenticated action/Lync evidence.                                    |

The last two rows are intentionally not relabeled as provider attempts. A
successful provider response can fail decision parsing, a decision can yield,
and a decision can produce zero or several controller actions. Analysis must
join these event streams by their existing run, resident, turn, request, and
action identities rather than collapse them into one number.

## Evidence and visibility boundary

The quota ledger, cognition journal, resident run journal, and
`_cognition/transport` directory are raw operator evidence. Every admitted
physical provider attempt has an immutable start record, exact content-addressed
request and response bytes, a terminal record, and a broker-journal reference.
The records retain requested and returned model/provider identity, route without
authentication, timing, HTTP outcome, reported tokens/cost, and content hashes.
Authentication headers are never retained; known credential values in content
fail capture closed, and error strings are redacted. Verification rejects a
missing, extra, edited, or unreferenced record/blob.

These raw records are not appended to mind requests, body observations,
model-facing replay, Lync prose, or a Textile presentation. Lifecycle events
expose the private evidence path and verified totals to an operator. A human
projection may cite selected content hashes later, but it must not become the
causal source or copy raw/private world fields into resident context.

Ax assertion-driven output correction is disabled by default. An explicitly
configured correction requires the accounted cognition transport; every extra
HTTP request receives its own quota charge, broker admission, raw wire capture,
and `behold.model-adapter-intervention.v1` reference to that physical attempt.
There is no route/model substitution or silent catch-up opportunity.

Loom cache protocol v3 distinguishes a model-generated fold from the
`deterministic-source-anchors-v1` fallback. A summarizer error or empty summary
records its failure, exact projected-source hash, resulting-summary hash, and a
`behold.context-intervention.v1` run-journal event before the fallback can be
used. Console actions, setup hooks, and non-population Minecraft players are
likewise separate operator/external-player intervention records. Server-side
evidence honestly labels an unknown external client as
`native_human_or_unmanaged_player`; it does not claim to infer the client type.

This deterministic gate proves mechanics: purpose isolation, configured-limit
equality, durable exhaustion, idempotent replay, exact transport retention, and
reported-usage accounting. It does not prove that two models receive
semantically equal information, use their budgets similarly, or behave
scientifically comparably in a live world.
