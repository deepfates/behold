# First Life

## The point

Behold should make a Minecraft agent feel like a continuing inhabitant, not a
chatbot that occasionally calls game tools.

The far-horizon vision is simple:

> Make worlds agents can genuinely inhabit, and learn what becomes possible
> when they do.

Minecraft is where we are learning the grain of that problem. We are not
building a universal world protocol in advance. We are making one life work,
watching it closely, and keeping only the patterns that survive contact with the
world.

## What counts as a life

An inhabitant repeatedly receives an observation, chooses one action from the
world's ordinary affordances, and receives the real consequence as its next
observation. Over time it should:

- notice events that matter to it;
- care for its body;
- acquire and use materials;
- begin and continue projects of its own;
- respond to other inhabitants without suspending the rest of its life;
- leave changes that remain in the shared world; and
- return after a controller restart as the same continuing entity.

This is deliberately more demanding than completing a scripted task. A task can
be passed by a disposable controller. A life has unfinished concerns.

## The first live proof

On July 13, 2026, `ScoutLife` entered the local Minecraft world without a task
brief. It inspected its condition, found spruce, walked to a tree, harvested and
collected logs, made planks, crafted and placed a crafting table, then made
sticks, a wooden pickaxe, and a wooden axe. The crafting table remained in the
world at approximately `(3513, 1, 641)`.

While doing this, a player unexpectedly asked where everybody had gone and said
they did not know how to play. Scout answered with its location, asked for the
player's coordinates, and kept progressing instead of turning the whole life
into a blocked conversation.

We then stopped the controller process. On restart, the same named entity loaded
27 prior turns, returned with the same body position and inventory beside the
same crafting table, checked its condition, equipped the axe it had made, and
resumed cutting and collecting spruce. The restart changed the running process;
it did not reset the life.

This proves a small but real vertical slice: self-directed material progression,
social interruption, persistent world change, and behavioral continuation after
restart. It does not yet prove a long, robust life.

## The first population proof

On July 13, 2026, `AppleResident` and `CarrotResident` entered one managed
Minecraft epoch as separate model-controlled bodies. Each received its own
observation stream, task, process lease, run journal, and Lync autobiography.
They independently collected different dropped items through ordinary
`collect_nearby_item` affordances, and Minecraft attributed each collection to
the correct body. After both controllers stopped, a fresh witness saw that
neither dropped item remained; fresh connections as the two bodies saw only the
correct apple or carrot in their own inventory.

Both residents then restarted together in a new epoch. Their Lync logs reported
five and four prior turns respectively, their Minecraft bodies retained the
correct positions and inventories, and neither was offered the now-impossible
nearby-item action. Both yielded without repeating completed work. The managed
owner drained both controllers, saved Minecraft, and released each epoch.

The proof used the deliberately selected `openai/gpt-5.6-luna` model, took 32.6
seconds across both live epochs, made 11 model calls, consumed 34,327 tokens,
cost $0.047945, and observed at most two concurrent model calls. The largest
single call took 3.9 seconds; the largest resident journal and Lync log were
306,231 and 133,663 bytes. All declared budgets passed. A separate reassessment
rehashes and reparses every journal, lifecycle, Lync log, and exported
trajectory before recomputing the verdict.

This proves the first population rung: shared world authority with isolated
resident identity, experience, memory, model context, consequences, restart,
and resource accounting. It does not prove that the residents can yet sustain
a relationship, cooperate on a project, resolve contention, or live together
for a long time.

### The bounded population cognition gate

On July 14, the same story was strengthened so the two residents did not begin
with their resources already visible and could not make provider calls in
parallel. They used an ordinary two-axis first-person look, found different
items, collected them through Minecraft, restarted from separate Lync lives,
and declined to repeat completed work. A runner-owned cognition broker held
the OpenRouter credential, admitted every exact resident request, serialized
aggregate provider work at one active call, and durably reconciled all
terminals before Minecraft save and stop.

The clean default-model run used `google/gemini-3.5-flash`, made 13 calls,
consumed 32,057 tokens, cost $0.050718, and completed in 60.7 seconds. Every
declared causal, process, concurrency, latency, token, cost, storage, restart,
and shutdown assertion passed. The implementation lessons and nonclaims are in
[the bounded population cognition report](reports/2026-07-14-bounded-population-cognition.md).

## The first native handoff proof

On July 13, 2026, `GiverResident` entered a managed epoch first, walked to a
prepared apple, and acquired it through Minecraft's ordinary proximity pickup.
`ReceiverResident` then joined the same epoch. The giver chose `drop_item`, which
confirmed only its own inventory loss. The recipient independently chose
`move_to`, Minecraft collected the dropped apple into that body, and each
resident later observed its own side of the consequence. Fresh Minecraft
connections found zero apples with the giver, one with the recipient, and no
dropped apple in the world.

The admitted physical action surface was deliberately tiny: the giver had
`move_to` and `drop_item`; the recipient had only `move_to`. Neither received a
symbolic geometry probe, an item-collection macro, or a social command such as
`offer_item_to_player`. `wait_for_event` remained an explicit controller yield,
not a Minecraft power. The residents restarted together, recovered their
separate experiences, and both yielded without repeating the exchange.

The passing run used `openai/gpt-5.6-luna`, made 9 model calls, consumed 27,189
tokens, cost $0.03723325, and completed its two live phases in 45.4 seconds. Its
largest call took 2.8 seconds; model concurrency peaked at two. A separate
reassessment reparsed and rehashed the evidence and reproduced every passing
assertion.

Two earlier attempts exposed a real observation bug. Mineflayer announced chunk
readiness before the existing item entity arrived, so a resident could mistake
late initial synchronization for a new drop. Residents now wait through a
bounded initial synchronization window, and entity appearances say whether they
belong to `initial_world_sync` or the live world. The final proof also stages the
giver eight seconds before the recipient, so it tests a handoff instead of an
unrelated race for an unowned item.

## The first shared cache proof

On July 13, 2026, `AppleKeeper` and `CarrotKeeper` entered one managed epoch
without a shared controller. Each picked up a different ordinary food item,
put exactly one contribution into the same nearby chest, told the other
resident what it had done, received the other resident's message through its
own observation stream, and opened the chest for itself. Both saw exactly one
apple and one carrot before yielding.

The admitted surface was the player-scale acts pick up, put in a chest, look
inside a chest, and speak, plus explicit controller yield. No collaboration
command, controller-owned cache state, shared private context, symbolic terrain
probe, or withdrawal action was admitted. A separately connected Minecraft
body opened the real chest and observed the two items; fresh connections as
each resident observed no contribution left in either inventory and no prepared
drop remaining. Both controllers then restarted together from separate Lync
histories and yielded without depositing, withdrawing, or announcing again.

The clean passing run used `openai/gpt-5.6-luna`, made 13 model calls, consumed
50,510 tokens, cost $0.0679585, and completed both managed epochs in 73.5
seconds. Model concurrency peaked at two, the slowest call took 3.3 seconds,
and the largest resident journal and Lync autobiography were 478,080 and
189,052 bytes. A pure reassessment reparsed and rehashed the lifecycle journals,
resident journals, trajectories, and Lync logs and reproduced every assertion.

Two preceding runs exposed an evidence-harness race rather than a resident
failure. Chunk readiness preceded a reliably interactive local scene, so a
fresh witness sent its chest interaction before Minecraft would open a window.
A direct diagnostic showed that the same four-second synchronization window
already used before resident policy startup made the fresh body open the chest
and see both contributions. Fresh proof witnesses now use that measured
synchronization window instead of weakening the external witness.

This proves a small shared institution: two private lives can establish and
independently recognize one persistent common resource through Minecraft. It
does not prove open-ended cooperation, relationship development, contention,
repair, survival, or a household that remains coherent for hours.

## The first unscripted household trials

`ScoutLife` and `WrenLife` have now run untasked in one continuing survival
world. They formed separate concerns, gathered and crafted, converged without a
collaboration macro, fled threats, died, respawned, recovered possessions, and
continued work across managed restarts. Scout once freely chose to defend Wren
from a zombie. The world, separate private histories, safe lifecycle, and free
choice held; a stable household did not. Slow model calls, packet-grain combat,
polling delay, stale pre-death decisions, forced item collection, misleading
perception wording, and name-only moving targets were each exposed and corrected
at their owning boundary.

The latest bounded restart left both residents alive, but it did not include a
human interaction, sustained relationship, completed shared place, or
restart-after-completion proof. It made eight model calls in roughly 33 seconds,
using 171,100 prompt tokens, 749 completion tokens, 28.35 seconds of aggregate
model latency, and $0.218363. That is continuity evidence and a clear cognition
budget failure, not household acceptance.

### A bounded production-life calibration

The production owner can now bound live time after all residents are ready and
then use its normal controller drain, cognition reconciliation, Minecraft save,
stopped-state verification, and ownership release. ScoutLife and WrenLife used
that path for a continuing 30-second untasked episode with the selected Gemini
3.5 Flash mind and aggregate provider concurrency one.

Wren resumed a shelter concern, made planks, placed a crafting table, and made
doors. Scout recovered tools and wood but died under skeleton fire. The episode
proved the owner control and several ordinary consequences; it failed
ordinary-life acceptance. Fourteen recorded calls consumed 254,914 tokens and
cost $0.28757775. One autobiography fold alone used 67,319 prompt tokens and
cost $0.1049295. At critically low health Scout spent its last completed turn
updating a project to say it should retreat instead of performing an embodied
retreat.

The exact evidence, including the preceding stale-environment model calibration
and next-run gate, is in [the bounded ordinary-life report](reports/2026-07-14-bounded-ordinary-life.md).

A subsequent ten-call run proved that the cap itself was exact but exposed two
more failures. Wren received the corrected urgent surface at health 6.33 and
still chose another unrelated plank placement, while immediate cap-triggered
teardown cancelled two already accepted calls. Admission exhaustion now waits
for accepted-call settlement before shutdown, and bodily urgency can use a
separately authorized, fully evidenced model tier. Exact replay selected Luna
provisionally for that workload while retaining Gemini for ordinary
orientation. The run, comparison, costs, and live nonclaim are in the
[capped danger calibration](reports/2026-07-14-capped-danger-calibration.md).

The demonstrated failures are now corrected at their owning source boundaries,
pending live validation. Urgent bodily attention retains the complete admitted
Minecraft action surface but defers the private `manage_project` mutator; a
replay of Scout's exact low-health frame confirms the action and prompt contract
without calling a provider. Disposable Lync folds now consume the same causal,
loss-visible observation deltas as recent model history instead of copying full
scene snapshots. The actual eight-turn Wren evidence now projects to 33,930
bytes; its old complete provider request was 204,375 bytes, so this is not an
apples-to-apples full-request reduction and only a new live call can establish
billed tokens. Finally, the managed owner has an exact
population-wide accepted-call ceiling, enforced before upstream even under
concurrent arrivals and recorded in the cognition journal. These are reusable
preconditions for the next episode, not a retroactive household pass.

## The first packaged-place life proof

On July 14, 2026, the current first-person resident loop entered the independently
compiled Venice Place release under its vanilla-first `living` profile. Behold
verified and materialized the package as its own world epoch; the resident saw
and collected one exact supported apple through Minecraft, a fresh body witnessed
the consequence, and a second managed epoch restored the changed body and
continued the same two-turn Lync life without repeating collection.

This closes the previously unproved junction between the Place and inhabitant
lanes without merging their internals. The same revision also reran the stronger
synthetic occlusion, moving-target, body-motion, and five-turn continuity proof.
The full evidence, failure analysis, digest identities, and nonclaims are in
[the packaged-place first-person report](reports/2026-07-14-packaged-place-first-person.md).

## The first model project inside a packaged place

The next Venice run replaced the scripted inhabitant with the selected
`openai/gpt-5.6-luna` mind. `ProjectResident` collected two visible cobblestone,
started a landmark, placed and recorded one Minecraft-confirmed block, stopped,
then reopened in a second managed epoch with the same body, inventory, five
prior Lync turns, active project, and prior world consequence. It restated the
unfinished commitment before acting, placed the distinct adjacent block, and
completed only after confirmation. Fresh Minecraft bodies witnessed the partial
and final builds.

The model had first-person observations and no loaded-world scan. Nine calls
cost $0.06260825; an independent reassessment verified both lifecycle chains,
the exact journal-to-Lync trajectory, Place provenance, immutable inputs,
runtime progression, and the two witnesses. The exact proof and its useful
failed orientation attempt are recorded in [the packaged-place model project
report](reports/2026-07-14-model-project-in-packaged-place.md).

## The architecture we actually need

The implementation has seven boundaries. They are useful because each corresponds
to a different fact about an inhabitant, not because seven layers are inherently
good.

1. **The world adapter** is Mineflayer. It owns the Minecraft connection and raw
   game events.
2. **Experience** turns body state, local scene summaries, and changes over time
   into a versioned observation. Each inhabitant owns its own event state.
3. **Embodied actions and skills** are a discoverable command registry. A human,
   a model, or a script can attempt the same player-scale Minecraft acts.
4. **The engine** admits and serializes intents. It prevents overlapping actions,
   deduplicates equivalent pending actions, and lets a human suspend the model.
   The active adapter command still runs to a terminal result; acknowledged
   in-flight cancellation is not yet proved.
5. **The controller** owns the resident episode, bounded attention, policy, and
   lifecycle. It asks for one proposal, validates it, sees the terminal result,
   and observes the world again. An episode is bounded even though the life
   continues.
6. **The mind** makes one bounded proposal from the admitted actions and lived
   context. The direct OpenRouter implementation and the Ax implementation are
   interchangeable here. A mind has no body capability and cannot execute or
   certify an action.
7. **The entity loom** is the append-only autobiography that survives process and
   model changes. Run journals remain separate operational evidence.

These boundaries let us replace a model, add an action, improve sensing, or move
the history store without changing what an observation-action consequence means.

There are now two earned lifecycle scopes. A **world epoch** owns one exact
server incarnation and its admitted resident set. A **resident life** owns one
entity identity, body lease, observation cursor, controller, mind, journal, and
loom. Population machinery coordinates these scopes; it does not create a
shared private mind or weaken per-body authority.

### The irreducible loop

The portable abstraction is a causal loop, not a particular prompt framework:

```text
world events -> observation -> mind proposal -> authority decision
             -> serialized action -> terminal result -> fresh observation
             -> entity trajectory -> next proposal
```

Each arrow crosses an ownership boundary. Minecraft owns live world truth.
Experience owns the bounded report and its cursor. The mind owns only its
proposal. The controller and engine own admission, ordering, budgets, and
lifecycle. The adapter owns execution and its terminal result. A later
observation establishes the independently witnessed consequence. The entity
loom owns the durable causal autobiography. An external verifier owns any claim
that a trajectory satisfied an evaluation.

This is why a successful tool response cannot silently become memory of a world
fact, and why model-generated text cannot silently become an action. Results,
consequences, memories, and evaluation claims are related records with different
authorities.

### Libraries are implementations, not the waist

- Minecraft and Mineflayer implement the world and body boundary.
- Behold owns the embodied observation, proposal admission, action, consequence,
  and resident-lifecycle contracts.
- Ax implements one DSPy-style typed mind. Direct OpenRouter tool calling is
  another. A Python DSPy program or a local model can implement the same mind
  request and decision without changing the resident loop.
- Lync supplies append-only event integrity, causal topology, and portable
  storage. Behold supplies the entity-turn meaning and bounded memory views.
- Zod validates untrusted structured output at adapter boundaries. It does not
  define the domain model.

The neighboring projects support the same pattern without needing the same
package. Cantrip's circles, gates, wards, and looms correspond to environment,
affordances, enforced policy, and continuity. World Instrument's
Proposal/Law/Outcome/Event path corresponds to proposal, authority, result, and
evidence. ALMO exercises an observe/provider/action loop in Evennia. Those are
useful translations, not a reason to import their world objects or controller
internals. We extract a shared package only after two live integrations need the
same semantics and the shared part is smaller than their adapters.

### The player's grain

We want experiential parity, not literal keypress parity. A language model does
not need to emit twenty movement packets per second, but it should live inside
the same intelligible world as a player.

- **Observation** is what this body can presently perceive or feel: its HUD-like
  condition, inventory, local scene, chat, and changes over time. A symbolic
  encoding may replace pixels, but it must preserve locality, uncertainty,
  timing, and provenance. Loaded server data must not masquerade as sight.
- **A body action** is something a Minecraft player naturally says they do:
  walk there, look, break, place, use, attack, craft, equip, eat, drop, speak,
  open a container, or sleep.
- **A motor skill** may compose many keypresses or pathfinder steps for one body,
  provided it is bounded and interruptible and does not absorb a new decision.
  `move_to` is a motor skill; “build a home” is not.
- **An intention** such as give, teach, help, follow, trade, explore, survive, or
  build together belongs to the resident's multi-turn thinking. It succeeds
  only as ordinary acts and new observations accumulate.
- **Controller operations** such as yielding, managing a durable project, or
  selecting a memory view are part of cognition and lifecycle. They are not
  Minecraft affordances even when the model invokes them through the same wire
  protocol.

A body action passes the grain test when a player would recognize the verb, it
spends only one body's agency, it has a bounded horizon, and its result claims
only that body's or its direct target's terminal consequence. It fails when it
contains another being's choice, certifies a downstream social outcome, grants
unlabeled extra-sensory knowledge, or is named after an entire user story.

The test is cultural, not packet-level. A player says “pick up the apple,” “put
the apple in the chest,” and “walk to the tree.” Those are honest embodied
affordances even when the adapter composes pathfinding, a GUI interaction, or
several movement packets. Forcing a mind to aim at raw collision coordinates is
not more native merely because it exposes lower-level mechanics. The skill must
remain local, bounded, interruptible, and authoritative only for this body and
the directly manipulated Minecraft object.

The current registry is still transitional. Its technical wire names are not
the ontology: `collect_nearby_item` means the player act “pick up this dropped
item,” while `deposit_in_container` means “put this item in that chest.”
Explicitly symbolic local-geometry probes from earlier experiments remain
different: they are privileged sensing unless we can ground their information
in a player's viewpoint. Parity-critical proofs declare their exact admitted
surface and exclude any skill whose verified postcondition would decide the
specific question under test. The handoff proof therefore used walking plus
automatic pickup to expose recipient choice and attribution; ordinary lives may
honestly use the bounded pick-up skill.

### Where behavior belongs

When a lived failure suggests a new capability, change the smallest boundary
that owns the missing fact:

- **Experience** owns player-scale facts available now, including uncertainty,
  provenance, and relations such as whether another body is within interaction,
  nearby, or distant range.
- **A body action** owns one culturally intelligible act and a postcondition the
  adapter can verify. A motor skill may contain several mechanical steps only
  while they remain one body's continuous act.
- **The controller** owns multi-turn purposes such as showing, teaching,
  following, exploring, building, and surviving. These are not new commands.
- **A loom view** carries earlier evidence, relationships, and unfinished
  concerns into bounded attention. It is derived memory, not a second mutable
  truth store.
- **A verifier** judges a trajectory from outside the life. It does not become
  an instruction or privileged action inside the circle.

An action or skill is justified when it is useful across many intentions, has a
world-verifiable consequence, and cannot be safely or honestly composed from
smaller existing acts at the model's decision rate. A command named after one
user story is evidence that behavior has leaked out of the controller.
Conversely, a long action that hides important changes should acquire a bounded,
interruptible horizon rather than a new story-shaped replacement.

Consequences do not transfer between bodies. If Scout moves, speaks, enters a
home, or crafts an item, that alone says nothing about whether another player
followed, heard, arrived, learned, or received it. Joint activity advances only
through new observations involving every relevant participant.

## Scaling rules

We will keep these rules true as the system grows:

- Entity state is per inhabitant. Adding a second inhabitant must not merge event
  cursors, current actions, short-term context, or autobiography.
- Identity is scoped to a circle. An inhabitant loom bound to one world must
  refuse to open in another world, even when both servers are local Minecraft
  copies with similar terrain.
- One body executes one consequential action at a time. More agents do not weaken
  the lease around movement and world changes.
- Working attention is bounded. The full autobiography may grow on disk, but a
  model receives a small recent trajectory and only newly relevant events.
- Consequences outrank acknowledgements. Pathfinder saying “arrived” is not
  arrival; a cache changing is not a verified block change; walking toward an
  item is not collection.
- Capabilities are discovered through the action registry. The controller does
  not require a new hard-coded loop every time an affordance is added.
- Controllers are replaceable. Identity belongs to the embodied trajectory, not
  to a particular model process.
- Protocol changes are versioned. We can add richer observations without silently
  changing the meaning of old histories.
- Operational scale and experiential scale stay separate. Running many bots is
  not evidence that any one of them has a coherent life.

The code currently enforces these rules with independent experience instances,
a versioned observation, an append-only linked trajectory, bounded event and
model windows, a shared intent engine, consequence-confirming actions, exact
per-entity runtime leases, and one managed owner for the world epoch.

## What the failures taught us

The useful architecture came from concrete failures:

- Scout once repeated `move_to` because Pathfinder acknowledged a destination it
  had not reached. Movement now verifies final distance.
- Raw dropped-item coordinates encouraged repeated navigation rather than
  collection. A bounded collection skill can confirm Minecraft attribution, but
  the later handoff proof deliberately used walking plus automatic pickup when
  that native sequence was the question under test.
- Calling a terrain-support check `pickupSafety` made an item on ordinary ground
  look situationally safe even beside a hostile creature. The observation now
  reports `pickupGround` as supported, unsupported, hazardous, or unknown; the
  resident must judge threats, distance, body condition, and purpose itself.
- A name-only combat call with model-selected pursuit and timeout knobs let a
  moving zombie slip across the acquisition boundary during deliberation and
  could bind the wrong same-named creature. Combat now takes one exact perceived
  scene entity; the body, not the mind, owns bounded pursuit and attack timing.
- The first policy decision once raced ahead of local entity synchronization.
  Initial world sync and later live appearances now have distinct provenance,
  and the mind does not start until a bounded synchronization window completes.
- A proposed `offer_item_to_player` command swallowed the recipient's choice and
  falsely made one body authoritative for a social outcome. The handoff now uses
  walking, dropping, independent pickup, and observations from both bodies.
- An unbounded transcript exceeded a 128,000-token context after roughly twenty
  actions. The durable loom remains complete, while model working context is now
  a bounded projection.
- After bounding that context, Scout forgot coordinates the player had given it
  several actions earlier. A separate bounded continuity projection now carries
  older player coordinate mentions, agent communications, and verified landmarks
  forward from the complete loom without replaying the complete transcript.
- A conversation caused one controller to wait indefinitely. Quiet lives now
  receive a low-frequency time event, and conversation is explicitly allowed to
  remain open while other concerns continue.
- A weaker controller waited socially while a stronger one used the same
  interface to gather, craft, and build. Interface quality and controller
  capability are separate variables; improving one cannot compensate for never
  testing the other.
- Minecraft continued for 2.2–6.1 seconds while a resident was inside one model
  call. High or urgent events now wake an idle mind. A newly urgent event during
  slow deliberation cancels that request visibly, reobserves, and asks the same
  mind again with the current body, bounded continuity, and the unchanged full
  action set. It does not choose or narrow an action. A cache-controlled matched
  replay reduced the prompt from 17,108 to 6,922 tokens and uncached cost from
  $0.02231425 to $0.00962375, but the single urgent call was slower (3.811s versus
  2.543s). Compact context is therefore a cost and freshness mechanism, not yet
  proof of human-scale responsiveness.

## What is not proved yet

We should not describe the system as generally scalable until these experiments
have passed:

- two or more autonomous inhabitants living concurrently for an extended period
  while interacting, cooperating, or contending over shared consequences;
- one inhabitant surviving hunger, injury, night, and hostile encounters;
- a project with enough structure that intention, not merely inventory, must be
  recovered after restart;
- richer relationship memory than recent communication, coordinate mentions, and
  shared landmarks;
- a multi-hour soak test that measures context size, action latency, log growth,
  reconnect behavior, and cost; and
- resource behavior beyond the two-resident, two-epoch measured proof.

Those are experiments, not invitations to prebuild a distributed platform.
When one exposes a real bottleneck, we change the smallest boundary that owns it.

## Next meaningful experiments

1. Let Scout make a defensible place, experience night, and handle a real bodily
   need or threat.
2. Bring Scout back later and see whether it continues a named, multi-session
   building project and its relationship with the player.
3. Turn the proved handoff and shared cache into a sustained household with
   interruption, contention, maintenance, and more than one exchange.
4. Run the pair long enough to measure whether bounded attention still produces
   coherent behavior.
5. Only then extract patterns that also explain our other inhabited worlds.
