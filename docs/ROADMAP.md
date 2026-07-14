# Roadmap

## North star (Updated 2026-07-13)

Make worlds agents can genuinely inhabit, and learn what becomes possible when
they do.

The immediate milestone is [First Life](FIRST_LIFE.md): one convincing continuing
Minecraft inhabitant. The San Francisco world is valuable terrain for that life,
not the product goal by itself. Come–See–Do–Report remains a useful regression
test, not the organizing purpose of the system.

### Working

- Tool-calling LLM policy through OpenRouter
- Managed multi-resident epochs with conjunctive readiness, exact per-entity
  leases, isolated journals/Lync lives, bounded process/model concurrency, and
  all-resident drain before one Minecraft save/stop
- Unified `behold <AgentName>` CLI plus console and stdio control modes
- Observations with position, health, inventory, nearby entities, nearby blocks, chat, action lifecycle, and recent events
- Human stop latches new model work, queued intents cancel, and active actions serialize
- Come–See–Do–Report task activation and evidence-based verification
- Structured JSONL experience logs
- Per-entity append-only autobiographies that survive controller restarts
- Bounded model working context over an unbounded durable trajectory
- Event-driven idle waking, immediate admitted-action dispatch, stale body-life
  decision fencing, and an adversarially tested urgent-attention handoff that
  preserves the full player action set
- Ordinary life affordances for finding, collecting, crafting, sleeping, and defense
- One player-grain two-resident handoff using only walking, dropping, automatic
  Minecraft pickup, independent observations, and restart continuity
- One shared-cache proof in which two private lives independently acquire,
  contribute, communicate, inspect the same Minecraft chest, and restart
  without repeating or undoing the work
- Native Minecraft 1.21.4 client and isolated local server launch flow
- World-lab status, topology, digest, lock-owner, port-owner, dry-run reset planning, and fixture-only atomic reset tests
- TypeScript build and lint, with adversarial regression coverage for lifecycle authenticity, single terminals, deferred preemption, consequence attribution, and observation gaps

### Still red

- Immediate in-flight cancellation with an acknowledgement from each long-running Mineflayer action family
- Production reset/recovery with an exclusive operation fence, durable journal, managed server lifecycle, and two real resets
- A repeatable production-path Come–See–Do–Report runner; passing unit and fixture tests do not establish the live story
- A real one-decision step control; the previous hook was dead and has been removed
- Sustained multi-resident interaction, cooperation, contention, and soak
  behavior; one staged handoff and one shared cache establish causal exchange
  and a common resource, not a household or society
- Human-scale urgent cognition: matched evidence shows substantially smaller
  prompts and lower uncached cost, but not lower single-call latency

### First Life proved so far

- Scout chose and advanced a material project without a task brief.
- It responded to unexpected player chat without abandoning the rest of its life.
- It left a crafting table in the shared world and made a working tool set.
- After a full controller restart, it recovered the same body, inventory, place,
  trajectory, and material concern, then resumed harvesting.
- AppleResident and CarrotResident acted in one exact epoch, retained separate
  consequences and autobiographies, and restarted together without leakage or
  repeated work. The live and independently reassessed proof passed all declared
  process, concurrency, latency, token, cost, journal, loom, and wall-time budgets.
- GiverResident and ReceiverResident completed a native walk/drop/walk/pickup
  exchange, independently witnessed their own consequences, and restarted
  without repeating it. No social macro or symbolic sensing tool was admitted.
- AppleKeeper and CarrotKeeper stocked and independently inspected one shared
  chest, observed each other's messages through separate viewpoints, and
  restarted from separate Lync histories without depositing or announcing
  again. A fresh Minecraft body opened the chest and saw exactly one apple and
  one carrot; pure reassessment and all declared budgets passed.

## Immediate priorities

1. Prove the urgent-attention transition in one bounded live run and continue
   measuring decision freshness rather than assuming compact prompts are fast.
2. Finish the player-grain action audit and prove bounded body skills against a
   real server independently of whether a model happens to choose them.
3. Continue a recognizable building project across another session.
4. Stop multiplying scripted exchange scenarios: compress the repeated proof
   machinery, then run a minimally scripted household with a human and several
   continuing residents maintaining one shared place.
5. Run a multi-hour soak test and measure context, latency, cost, reconnects, and
   autobiography growth.
6. Extend relationship and project memory only where lived tests show that the
   bounded recent trajectory and continuity projection are insufficient.

## Useful world work

- Preserve the original Arnis world and finish its recovery manifests.
- Keep a reproducible stopped baseline for experiments that require reset.
- Validate richer San Francisco terrain when it enables better inhabited-world
  experiments.
- Add place identity, geographic position, and routes when inhabitants have real
  uses for them.

See [Complete San Francisco Minecraft World](SAN_FRANCISCO_WORLD_PLAN.md) for the
separate city-generation research plan.

## Not now

- A universal protocol designed before several worlds have taught us what repeats
- Distributed infrastructure justified only by hypothetical scale
- A giant ontology of every possible observation, action, memory, or verifier
- Treating the viewer, atlas, evaluation harness, or city generator as the product
