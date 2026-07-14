# An untasked resident recovered and remained recovered after restart

## Outcome

On July 14, 2026, an untasked production resident experienced a genuine
Minecraft oxygen crisis, chose an ordinary movement action through a real
broker-admitted model call, reached air, and remained recovered after a clean
managed-world restart. Minecraft supplied the oxygen, movement, player state,
save, and reload behavior.

The accepted run used `openai/gpt-5.4-mini` through the direct OpenRouter mind
adapter. It was not given a task, target, action allowlist, scripted mind, or
privileged resident action. An evaluator constructed the world and moved the
body into a deterministic underwater corridor before resident readiness. Once
the resident became ready, the ordinary production life loop owned every
observation and action until shutdown.

This is a bounded survival proof, not a claim that the resident can already
live an open-ended Minecraft life.

## What the first run falsified

The first live run, `recovery-live-20260714-a`, failed at the declared twelve
call admission ceiling. The resident correctly selected forward movement more
than once, but each new drowning `self_hurt` event canceled the urgent action
that had been selected to escape the same danger. Each attempt ran for only
about 0.6 to 0.7 seconds. The body moved from approximately x=1.3 to x=3.5 but
never reached the air pocket.

That run made eleven successful provider calls, cost `$0.04367625`, and used
13.742 seconds of aggregate model latency. Its failure evidence remains in:

`.behold-runtime/owned-world-proofs/recovery-live-20260714-a`

The problem was not a missing `escape_water` tool or a weak model instruction.
It was action ownership. New bodily danger should interrupt stale
deliberation, but an embodied action already selected under that urgent
attention needs a bounded opportunity to reach a terminal. Events accumulated
during the action still force a fresh observation afterward. Death and
dimension changes remain unconditional interrupts.

Commit `9b5c6f4` applied that rule once in the model policy and made both the
production console and native attention conformance consult it.

## The unchanged rerun

The second run, `recovery-live-20260714-b`, used the same generated corridor,
model, direct mind adapter, twelve-call ceiling, and two-minute timeout. It
passed.

The evaluator finished setup before resident readiness with the body at
approximately x=1.3 and oxygen 9. The resident later observed body-origin
urgency and reached an oxygen nadir of 4. A broker-admitted urgent
`openai/gpt-5.4-mini` decision selected one ordinary
`move_direction(forward, 4)` action. That action moved the body 4.189 blocks to
x=5.5 and ended with status `arrived`. Oxygen recovered to 15 before shutdown.

A fresh managed epoch then observed the same body at the same persisted
position, within `3.46e-13` blocks, with oxygen 17. The source journal and
private Lync were unchanged by the witness, no death occurred, the world saved,
and lifecycle, port, session lock, owner, and entity authorities were released.

The source episode made four provider calls, cost `$0.0133323`, and used 5.071
seconds of aggregate model latency. The repository's full gate passed all
402 tests before the live run.

Canonical local evidence:

- report:
  `.behold-runtime/owned-world-proofs/recovery-live-20260714-b/evidence/resident-recovery-live.json`
- report SHA-256:
  `39aafbe7e437e531f4f2b3e746483d3948ad66af9f3b93106dbeb50e3f5c6337`
- restart witness:
  `.behold-runtime/owned-world-proofs/recovery-live-20260714-b/evidence/runs/behold-owned-flat-v1-2/_evidence/resident-recovery-witness.json`
- restart-witness SHA-256:
  `206b933aaa4c930576312c03bce3facfea763654dc1a369bc536bb9185958df6`
- source revision: `9b5c6f40dc7382f0e8bb81dff4973ad0e11fa54f`

The live command was:

```sh
npm run proof:resident-recovery-live -- \
  --run recovery-live-20260714-b \
  --port 25580 \
  --model openai/gpt-5.4-mini \
  --maxModelCalls 12 \
  --timeoutMs 120000
```

## What this earns

This proves that the existing layers compose for one real causal story:

1. Minecraft changes a resident's body.
2. The observation and attention systems make that change urgent.
3. The cognition broker admits a real model decision with the ordinary action
   surface.
4. A bounded body skill carries one player-grain intention to a terminal.
5. Minecraft independently changes the body state.
6. Save and restart preserve the consequence without rewriting resident
   memory.

The reusable change is the action-ownership rule, not the underwater corridor.
The corridor is an evaluator fixture that makes the causal story repeatable.

## What remains red

This run does not prove broad survival competence, visual architectural
understanding, resource acquisition, hostile combat, death recovery, vertical
swimming, climbing, multiple inhabitants, or population scale. It uses one
controlled hazard in a deterministic peaceful world. The next survival rung
should cover longer untasked life and varied naturally occurring danger, while
keeping every claimed consequence independently observable and every evaluator
intervention outside resident time.
