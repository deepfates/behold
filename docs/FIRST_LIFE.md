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

## The architecture we actually need

The implementation has seven boundaries. They are useful because each corresponds
to a different fact about an inhabitant, not because seven layers are inherently
good.

1. **The world adapter** is Mineflayer. It owns the Minecraft connection and raw
   game events.
2. **Experience** turns body state, local scene summaries, and changes over time
   into a versioned observation. Each inhabitant owns its own event state.
3. **Affordances** are a discoverable command registry. A human, a model, or a
   script can attempt the same ordinary Minecraft actions.
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

### Where behavior belongs

When a lived failure suggests a new capability, change the smallest boundary
that owns the missing fact:

- **Experience** owns facts available now, including relations such as whether
  another body is within interaction, nearby, or distant range.
- **An affordance** owns one reusable world transaction with a postcondition the
  adapter can verify. It may contain several motor steps when composing them in
  the controller would be unsafe or would lose the relevant world consequence.
- **The controller** owns multi-turn purposes such as showing, teaching,
  following, exploring, building, and surviving. These are not new commands.
- **A loom view** carries earlier evidence, relationships, and unfinished
  concerns into bounded attention. It is derived memory, not a second mutable
  truth store.
- **A verifier** judges a trajectory from outside the life. It does not become
  an instruction or privileged action inside the circle.

An affordance is justified when it is useful across many intentions, has a
world-verifiable consequence, and cannot be safely or honestly composed from
smaller existing affordances. A command named after one user story is evidence
that behavior has leaked out of the controller. Conversely, a long action that
hides important changes should acquire a bounded, interruptible horizon rather
than a new story-shaped replacement.

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
  collection. Item collection is now a first-class affordance confirmed by a
  Minecraft collection event.
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
3. Give the two inhabitants one real joint activity and verify every handoff
   through consequences observed by both bodies.
4. Run the pair long enough to measure whether bounded attention still produces
   coherent behavior.
5. Only then extract patterns that also explain our other inhabited worlds.
