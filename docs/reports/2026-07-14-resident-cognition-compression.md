# Resident cognition is smaller without becoming a smaller life

The resident loop now has an exact, provider-free request profiler and a first
compression pass that preserves the native-player action surface. This was not
an exercise in making a smaller scripted bot. The current observation, admitted
actions, exact action outcomes, world events, durable loom, and first recent
self snapshot remain present.

Two sources of repetition changed:

- The conditional controller guidance says the same causal, social, project,
  perception, and building constraints in denser language. On the ordinary
  27-action surface its first system message fell from 6,613 to 5,285 bytes.
- The first recent loom turn remains a full causal anchor. Later recent turns
  carry exact outcomes and events but include only self fields that changed
  relative to the preceding post-action observation. A source marker makes the
  omitted-unchanged relationship explicit. The authoritative entity loom is
  unchanged.

`behold.resident-request-profile.v1` builds the exact current OpenRouter request
body without calling a provider or exposing executable functions, then
attributes every UTF-8 byte to system messages, the current observation,
history roles, tool definitions, or request structure. Its partition is tested
to sum exactly to the serialized body.

## What the exact replays say

Three already-lived situations were reconstructed through the current mind
contract. No proposal could cross the action-admission boundary.

| Situation                |       Before |        After |          Reduction |
| ------------------------ | -----------: | -----------: | -----------------: |
| Ordinary crafting life   | 35,349 bytes | 32,555 bytes | 2,794 bytes (7.9%) |
| Newly urgent body danger | 30,191 bytes | 28,863 bytes | 1,328 bytes (4.4%) |
| Shared-place work        | 54,965 bytes | 51,002 bytes | 3,963 bytes (7.2%) |

The urgent request has no recent conversational history, so only the standing
guidance changed there. The shared request benefited most in absolute bytes,
but still carried 16,988 bytes of prior user observations, 4,427 bytes of exact
tool results, and 12,765 bytes of action definitions.

The same Luna model then reconsidered the same three observations with the
compressed context:

- Ordinary life chose the exact baseline action: craft four sticks.
- During a newly observed skeleton attack it again chose `move_to` and proposed
  a nearby retreat, unlike cheaper candidates that stopped or dug.
- During shared work it again chose to place the held crafting table with the
  same timeout, but selected a different nearby cell. The old observation did
  not contain exact cell geometry, so this is evidence for preserved strategy,
  not proof that the cells were equivalent.

The ordinary replay matched the captured observation and action-set hashes.
The two older first-life captures use a superseded proximity scene, so the
current controller correctly admits a different exact-entity action set; those
replays are not described as fully matched. All three calls returned one valid
proposal, and the differential rejected every attempted admission.

This screen also kept the model choice honest. Current GPT-5.4 mini produced
valid tool calls quickly and cheaply but stopped during the skeleton attack.
Gemini 3.1 Flash Lite dug during that attack and proposed an unadmitted action
in shared work. MiniMax M3 made the ordinary craft choice but did not return
the urgent decision within the bounded human-scale screen. Ax reduced one
ordinary Luna prompt by about fourteen percent but proposed a wooden pickaxe
before the resident had crafted its sticks. None earned replacement of Luna as
the sole active resident mind.

## Clean live-world proof

Commit `8976727` passed TypeScript, ESLint, and all 300 tests before Minecraft
started. Continuing resident `IrisLife` entered managed Venice epoch 7 with 20
prior loom turns, no task, no tool allowlist, the direct Luna mind, and the full
safe inhabitant action surface.

Across six model turns she looked left, equipped her wooden pickaxe, looked
down and up, walked six blocks forward, and looked around. Every proposed
action was admitted normally and ended in a successful Minecraft consequence;
there were no model-call failures. The controller folded its own loom through
turn 16 during the run. No benchmark forced an action or selected a goal.

The six calls used 63,495 prompt tokens and 615 completion tokens, cost
$0.08305425, and took 2.8–4.0 seconds each. The final provider-free tip profile
was 42,931 bytes: 12,252 bytes of action definitions, 13,772 bytes of historical
user observations, 4,833 bytes of tool results, 7,453 bytes of system/fold
context, and 2,770 bytes of current observation.

On SIGINT, the resident durably recorded six entity turns and `run_stopped`,
released its body and lease, and exited zero. The world owner observed the
resident stop, received Minecraft's save acknowledgement, observed server exit
zero, verified stopped state, and released control. The port, session lock,
control owner, and resident leases all checked clear.

Evidence:

- exact ordinary profiles:
  `.behold-runs/venice-core-9a802c78123ffd46-6/IrisLife/request-profile-ordinary.json`
  and `request-profile-ordinary-compact-context.json`
- exact urgent profiles:
  `.behold-runs/first-life-v1-10/ScoutLife/request-profile-urgent.json` and
  `request-profile-urgent-compact-context.json`
- exact shared profiles:
  `.behold-runs/first-life-v1-10/WrenLife/request-profile-shared-place.json` and
  `request-profile-shared-place-compact-context.json`
- mutation-disabled Luna replays: `luna-compact-context-ordinary.json`,
  `luna-compact-context-urgent.json`, and `luna-compact-context-shared.json` in
  the corresponding run directories
- live journal:
  `.behold-runs/venice-core-9a802c78123ffd46-7/IrisLife/2026-07-14T08-34-18-091Z-IrisLife.jsonl`
- live tip profile:
  `.behold-runs/venice-core-9a802c78123ffd46-7/IrisLife/request-profile-live-tip.json`
- managed lifecycle:
  `.behold-runtime/world-control/venice-core-9a802c78123ffd46/lifecycle-7.jsonl`

## What remains red

This pass is a real Pareto improvement, not the scale result. Roughly ten
thousand prompt tokens per ordinary choice is still incompatible with a whole
city thinking continuously. The next earned target is the adapter wire: keep
the canonical admitted action contract inside Behold, but test compact typed
action signatures or structured proposals that do not resend 12–13 KB of
OpenAI tool envelopes every turn. They must beat direct tools on the same
ordinary, danger, social, building, failure-recovery, and long-continuity
episodes before becoming a production default.

Only after that should model routing or cheaper cognition tiers become a live
policy. A cheaper model is useful only where matched resident episodes show it
preserves judgment, latency, action validity, continuity, and consequence
discipline. The forward path is therefore not verb-by-verb trial and error: the
nine resident affordance families define coverage, captured lived episodes
falsify candidate representations, and clean Minecraft runs verify that a
winning representation still supports an unscripted life.
