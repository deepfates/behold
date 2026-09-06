# Architecture and authority

This document is for maintainers and operators deciding where a claim or fix
belongs. It describes responsibilities and mutable authority, not the source
tree's construction history.

## The causal path

One live session composes four independently meaningful systems:

| Concern        | Authority                                                                     | Behold's responsibility                                                                                                                                                  |
| -------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Released place | Place Compiler release manifest, verification, and living-entry qualification | Verify the exact installed package or pinned checkout and materialize a session-local runtime without weakening release claims.                                          |
| Live world     | The owned Minecraft server and its saved world                                | Hold one exclusive lifecycle fence, admit bodies to the exact epoch, and accept Minecraft outcomes rather than controller acknowledgements as material fact.             |
| Resident life  | The resident's selected append-only Lync loom                                 | Bind one private chronology to one entity and world circle; append experienced cognition, bodily attempts, and authenticated consequences without rewriting prior turns. |
| Cognition      | The configured model transport for one admitted request                       | Bound attempts, isolate resident sessions, retain attribution, and treat returned output as a proposed intention rather than world truth.                                |

The resident loop is: build a resident-visible experience from the current body
and unread events; determine which actions are presently admissible; ask the
configured mind for zero or one intention; revalidate the action against the
live world; serialize the body's attempt; observe Minecraft's terminal; and
append the cognition or action turn to that resident's Lync life.

### Why these boundaries matter

“Player-shaped” means experiential parity, not literal keypress parity. A body
action should be a verb a Minecraft player recognizes. It may compose packets,
pathfinding steps, or one UI interaction only while it remains local, bounded,
interruptible, and authoritative for one body and its direct target. A
multi-turn purpose such as building a home, teaching, following, or surviving
belongs to the resident; another being's response must arrive through that
being's own action and later world experience. Neither belongs in a controller
macro that declares the social or project outcome in advance.

For the same reason, an adapter acknowledgement is not a world consequence.
Walking toward an item is not collection, and a pathfinder saying “arrived” is
not arrival. Minecraft must establish the terminal physical fact before Behold
can carry it into the resident's life.

That private life is not merely a log kept after cognition finishes. It is the
continuity from which a later model process encounters its own prior
experience, choices, and consequences. Lync is canonical here so replacement
models and derived memory views can help continue one life without silently
rewriting what it experienced.

## Session-owned state

`behold live` places mutable state beneath one selected state root and stable
session ID:

- `session.json` binds the release, Place Compiler identity, world identity,
  endpoint, and initial resident configuration;
- `resident-revisions/` records explicit cognition changes without silently
  changing an existing session;
- `place-runtime/` is the session's live Minecraft runtime derived from the
  verified release;
- `head.json` identifies the latest accepted saved world head;
- `entities/` contains per-entity leases and canonical Lync storage;
- `control/` contains the exclusive world-owner record and hash-linked lifecycle
  journals;
- `runs/` contains controller and cognition journals; and
- `episodes/` contains immutable evidence for completed attempts, including
  ordered prefixes of canonical Lync sources.

The plan and head bind authority; they do not duplicate Minecraft world bytes or
resident life. Episode copies and journals are evidence. The browser resident
lens and POV viewers are live projections over journals and bodies; neither may
write the world or the resident's history. Textile is an external reader of
preserved Lync sources and is not run automatically.

## Lifecycle and concurrency

Preflight checks the clean Behold revision, external package and release
identity, living-entry qualification, server JAR, resident set, and current
cognition inventory before world authority. It may contact a configured
provider's inventory endpoint, but it does not infer, start Minecraft, or create
session state.

A live run acquires one world owner. Managed resident bodies must prove they
belong to that exact owner epoch and each body holds its own entity lease. One
body executes at most one consequential action at a time. The cognition broker
enforces per-resident attempt ceilings and configured aggregate concurrency;
shared model weights do not imply shared resident context.

A normal stop prevents new work, settles or visibly cancels admitted cognition,
drains residents, asks Minecraft to save and acknowledge, stops the server and
viewers, verifies owned resources are clear, records the episode and new head,
then releases world control. Resume verifies the stored head and reuses the
bound session identities. Changing minds requires an explicit resident revision;
changing the release or population under the same session name is refused.

## Failure and recovery

Failures remain classified rather than repaired by discarding state:

- admission failures occur before world authority where possible;
- a failed first start with a plan but no managed epoch is retried normally;
- a stopped abandoned managed epoch without a persistent head requires
  `--recover`;
- recovery checks that the owner, JVM, port, session lock, resident leases, and
  runtime identity are no longer live, records prepared and completed recovery
  evidence, and advances or releases only the exact recoverable head; and
- changed, live, foreign, or ambiguous ownership is refused.

Provider failure, malformed output, stale perception, cancellation, Minecraft
failure, and null intention remain different terminals. The runtime must not
turn any of them into a successful world action.

## Privacy and derivation

Resident-visible projections exclude controller credentials, exact private
coordinates where the selected contract forbids them, other residents' private
context, and operator-only telemetry. Ordinary runs retain causal turns,
digests, byte attribution, route identity, timing, usage, and outcomes but omit
literal model request and response bodies. `BEHOLD_RECORD_MODEL_IO=1` opts into
private exact-body retention for selected inspection; it changes evidence
retention, not world or life authority.

Protocol changes are additive or versioned. A newer presenter may make an
existing source readable, but it must not mutate that Lync source or infer a
world consequence that Minecraft did not establish.
