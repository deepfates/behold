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
- Multi-bot deployment and shared action arbitration
- Unified `behold <AgentName>` CLI plus console and stdio control modes
- Observations with position, health, inventory, nearby entities, nearby blocks, chat, action lifecycle, and recent events
- Human stop/preemption and bounded world-change safety
- Come–See–Do–Report task activation and evidence-based verification
- Structured JSONL experience logs
- Per-entity append-only autobiographies that survive controller restarts
- Bounded model working context over an unbounded durable trajectory
- Ordinary life affordances for finding, collecting, crafting, sleeping, and defense
- Native Minecraft 1.21.4 client and isolated local server launch flow
- World-lab status, topology, digest, lock-owner, port-owner, dry-run reset planning, and fixture-only atomic reset tests
- TypeScript build, lint, and 56 passing tests as of this update

### First Life proved so far

- Scout chose and advanced a material project without a task brief.
- It responded to unexpected player chat without abandoning the rest of its life.
- It left a crafting table in the shared world and made a working tool set.
- After a full controller restart, it recovered the same body, inventory, place,
  trajectory, and material concern, then resumed harvesting.

## Immediate priorities

1. Let Scout encounter and manage a bodily need or world threat.
2. Continue a recognizable building project across another session.
3. Run a second independent inhabitant and verify that experience, action, and
   memory state do not leak between them.
4. Run a multi-hour soak test and measure context, latency, cost, reconnects, and
   autobiography growth.
5. Prevent two controller processes from claiming the same entity identity.
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
