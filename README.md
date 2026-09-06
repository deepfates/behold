# Behold

Behold is trying to make a Minecraft agent feel like a continuing inhabitant,
not a chatbot that occasionally calls game tools.

The attraction is a world worth returning to: independently minded residents
might notice the same place differently, develop unfinished concerns, affect
one another, and leave changes a person can encounter later. Behold does not
promise that conduct. It tries to make it possible without scripting the
outcome—and to preserve enough truthful history to tell what actually
happened.

Today, Behold is an alpha runtime for operators and researchers. It gives
model-driven residents player-shaped perception and action in persistent
Minecraft habitats, keeps Minecraft authoritative about the shared world, and
can resume each resident's private Lync-backed life after the runtime stops.

## First Life now

The current First Life slice can start a qualified Place release with one or
more named residents, expose each resident's point of view and a read-only
causal lens, accept a native Minecraft client on the same server, stop cleanly,
and resume the same world, bodies, resident configurations, and private Lync
histories. Resident actions are admitted against their current perception and
Minecraft supplies the consequences; Behold does not score or correct the
resident's judgment.

This path has been exercised from a fresh clone on the workshop machine with
the tracked OpenRouter resident, an automated Minecraft visitor, a
Minecraft-recorded resident reply, clean stop, and resume of the same world and
life. The exact exercise and its negative results are retained in the
[2026-08-22 report](docs/reports/2026-08-22-first-life-local-installed-resume.md).
That is local evidence, not independent reproduction.

## Try the ordinary path

Follow the [First Life ordinary entry](docs/FIRST_LIFE_QUICKSTART.md). Its
canonical command is:

```sh
npm run live -- /absolute/path/to/qualified-release \
  --accept-eula \
  --residents examples/first-life.residents.json \
  --session first-life \
  --place-compiler-bin /absolute/path/to/place-compiler \
  --place-compiler-version <version> \
  --place-compiler-distribution-sha256 <sha256>
```

The walkthrough names the required Node, Java, Minecraft server, Place
Compiler, qualified release, and cognition-provider inputs. Run its preflight
form before granting world authority. On a clean stop, Behold prints the exact
resume command.

## Authority boundary

Place Compiler owns release provenance and living-entry qualification.
Minecraft owns live world state and material consequences. Behold owns the
session lifecycle, exclusive world and body leases, resident configuration,
cognition admission, and the binding between saved world heads and resident
lives. Each resident's append-only Lync loom is its canonical private causal
history. Run journals, episode records, the browser lens, and POV viewers are
evidence or projections; they do not replace Minecraft or Lync.

See [Architecture and authority](docs/ARCHITECTURE.md) for lifecycle, failure,
recovery, privacy, and derivation boundaries.

## Present limitations

- Behold is private alpha software, not a published package or hosted service.
- A qualified starter Place has no durable public download coordinate, so a
  repository checkout alone cannot run First Life.
- No independent person or machine has reproduced the current ordinary entry.
- The repeated multi-day habitat acceptance remains in progress. Brief local
  episodes do not establish durable ecology, resident competence, survival,
  social coherence, model quality, or usefulness.
- The foreground command exposes a native-client endpoint but does not launch
  Minecraft for the person or run Textile for them.
- Current evidence is from the workshop's macOS setup; cross-platform support
  has not been established.
- Models may repeat, fail, remain inactive, or make poor choices. Those are
  observations unless the runtime gave them false information, unusable
  controls, missing consequences, broken continuity, or an inoperable habitat.

## Documents

- [First Life](docs/FIRST_LIFE.md) — implemented capability, exercised evidence,
  and current unknowns.
- [First Life ordinary entry](docs/FIRST_LIFE_QUICKSTART.md) — clean-checkout
  preflight, start, stop, and resume runbook.
- [Preserved local First Life entry](docs/FIRST_LIFE_OPERATOR.md) — a
  workshop-machine route into the historical `sf-csdr` world, not the
  canonical clean-checkout path.
- [Architecture and authority](docs/ARCHITECTURE.md) — responsibility, state,
  lifecycle, and failure boundaries.
- [Product horizon](docs/PRODUCT_HORIZON.md) — owner-ratified direction,
  nonclaims, and owner-held decisions; it is not a ticket backlog.
- [Historical console PRD](docs/PRD.md) — the rationale that survived an
  earlier product shape and a clear record of what no longer governs Behold.
- [Managed resident sets](docs/MANAGED_RESIDENT_SET.md) and [experiment
  accounting](docs/EXPERIMENT_ACCOUNTING.md) — operator configuration and
  provider-attempt governance.
- [`docs/reports/`](docs/reports/) — dated exercises and negative results.
- [Resident affordances](docs/RESIDENT_AFFORDANCES.md), [inhabitant
  interface](docs/INHABITANT_INTERFACE.md), and [resident Lync
  presentation](docs/RESIDENT_LYNC_PRESENTATION.md) — current specialized
  contracts.
- [Human-semantic body](docs/HUMAN_SEMANTIC_BODY.md), [resident
  transcript](docs/RESIDENT_TRANSCRIPT.md), [action record](docs/ACTION_RECORD.md),
  and [Minecraft benchmark](docs/MINECRAFT_BENCHMARK.md) — named research and
  evaluation contracts.
- [San Francisco world plan](docs/SAN_FRANCISCO_WORLD_PLAN.md) — a separate
  completed world artifact and its retained execution record.
- [Tickets](.tickets/) — bounded unfinished work and its acceptance criteria.

The former narrative `docs/ROADMAP.md`, research-yield ledger, resident-model
decision page, user-story backlog, and verification scoreboard are superseded
by this document set and dated reports. Their complete construction history
remains in Git; the operator coordinates and console rationale that are still
useful remain above with explicit historical scope.

## Development

Behold requires Node.js 22.13 or newer.

```sh
npm ci
npm run check
npm run behold -- live --help
```

The project is TypeScript, licensed under Apache-2.0, and currently marked
`private` in `package.json`. Autonomous Minecraft bodies can damage a world or
spam other players; use a private server and bounded resident quotas.
