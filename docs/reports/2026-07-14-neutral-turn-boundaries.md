# Neutral turn boundaries

## What we were trying to learn

The first version of this proof waited for an untasked model to choose a
non-yield Minecraft action. That mixed two different questions:

1. Did a freely configured mind receive an exact bounded situation and make a
   valid decision?
2. Did that decision exercise the body/world action boundary?

An explicit wait is a valid answer to the first question and no evidence for
the second. Sampling until the model happened to choose the evaluator's
preferred kind of action would turn a supposedly free decision into a hidden
behavior test.

The verifier now produces separate bindings:

- `behold.decision-turn-binding.v1` authenticates the world epoch, runtime
  configuration, exact mind request and program, admitted decision, exact Lync
  turn, evaluator episode, and artifact digests. It accepts an explicit yield.
- `behold.world-action-turn-binding.v1` exists only when a non-yield action
  reaches `action_started`, obtains one terminal result, and that exact terminal
  is delivered as new evidence in a complete later observation window.
- A material-effect claim remains outside both bindings. It requires evidence
  defined by the world adapter, such as a Minecraft block update, inventory
  transition, native server record, or fresh-body witness.

The world-action assessment reports `passed`, `failed`, or `not_exercised`.
Yield and pre-world rejection are `not_exercised`; they are not fabricated
world failures.

## Adversarial controls

Provider-free tests now reject:

- task or action-allowlist configuration drift;
- a mind request whose content no longer matches its recorded digest;
- a copied or edited Lync turn;
- a required action or provider tool-choice override presented as an uncoached
  decision;
- an Ax call without a content-addressed program identity;
- a pre-world block presented as a world action;
- a terminal event that is missing, old, or outside a complete fresh
  observation window.

A matching task remains valid framework input. It simply cannot satisfy the
separate uncoached-decision assessment.

## Live evidence

The first decision-mode attempt used `openai/gpt-5.4-mini`. OpenRouter returned
HTTP 429 after three Ax retries, so the run stopped, saved Minecraft, released
ownership, and retained the failed call. It produced no decision binding.

The second attempt used `google/gemini-3.5-flash`, selected as the availability
fallback because OpenRouter exposed two current providers, low measured
tool-call error, and high recent uptime. It remains more expensive than GPT-5.4
Mini and is not the new default. Current provider information is available on
the [OpenRouter model page](https://openrouter.ai/google/gemini-3.5-flash/providers).

The successful run was `neutral-decision-v2-20260714b`. Its operator-observed
repository revision was `50bf23db083068b507399d3f0181904989b86ee7`; the v2
result did not embed that revision, so it is not part of the machine-verified
binding. V3 now refuses a dirty worktree and embeds the source revision.

- one entity: `FreeWren`;
- one disposable Minecraft epoch: `behold-owned-flat-v1`, epoch 1;
- Ax 23.0.0 with `google/gemini-3.5-flash`;
- no task, allowlist, required action, or provider tool choice;
- one accepted model call maximum;
- exact request SHA-256
  `94443f725bc6f444226f4043e345e9613c564354da92b6b9714c87d442d75ec3`;
- Ax program artifact SHA-256
  `6a66d8c67abfdb65e53adbc4168e7ff7cd63a7e3366db20b65aaef38e5e994fc`;
- 1.901-second provider latency, 5,260 prompt tokens, 61 completion
  tokens, and $0.008439 reported cost;
- freely selected `look_direction` with player-scale input;
- one exact entity Lync turn and a separate evaluator-owned episode reference;
- clean resident drain, Minecraft save and stop, and world-control release.

Both the uncoached decision and world-action boundary passed. The latter means
the orientation action crossed the real adapter and its terminal delivery was
freshly observed. Looking did not materially change Minecraft, so no material
effect is claimed.

Canonical local evidence is under
`.behold-runtime/owned-world-proofs/neutral-decision-v2-20260714b/`.
The exact mind request is private mode-0600 evidence. The committed report
contains only identities, measurements, verdicts, and evidence locations.

After the run, verifier revision
`76098013d296006c687bbcb61b2aaaefd6fdb057` independently reopened the
evaluator Lync episode, authenticated its exact entity-life range, re-read the
run and lifecycle journals, recomputed the decision and world-action
assessments, matched the private request artifact, and reproduced both
bindings. The reassessment is
`evidence/reassessment-v1-clean.json` under the proof root, with SHA-256
`06a4c0f5b8521fb484fff66317f497e8f18e236d3bce9717363cfb75c35574d1`.
It records material effect and world competence as `not_assessed`.

## What this proves and what it does not

This proves that a neutral real-model choice can be bound across an exact mind
request, Ax program, admitted action, managed world epoch, terminal adapter
delivery, personal Lync turn, and evaluator episode without turning a desired
Minecraft behavior into the success condition.

It does not prove a material Minecraft change, Minecraft competence, matched
direct/Ax rollouts from isolated world children, optimization improvement,
dataset integrity, or portability to a second world. Those remain separate red
claims.
