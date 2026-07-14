# A neutral Minecraft agent benchmark

## Purpose

Measure whether a mind can inhabit and act in Minecraft through a stable,
human-legible interface. The benchmark must reveal weak perception, planning,
memory, and action choice. It must not hide those weaknesses behind a long
strategy prompt, a benchmark-specific macro, or controller code that chooses
the next move.

Behold can use the same environment to run a continuing resident, but the
resident product and the benchmark are different compositions.

## The minimum contract

One decision step needs only:

```text
observation + available actions -> proposed action
proposed action -> terminal result -> next observation
```

Around that loop, the harness owns identity, world/epoch provenance, action
admission, interruption, journaling, save/restart, and independently observed
consequences. Those mechanisms make a result trustworthy; they do not tell the
mind what to do.

The mind request should contain:

- this body's bounded current observation;
- bounded history that this same resident actually lived;
- the exact actions and inputs admitted for this step;
- an optional user task or the explicit fact that the life is untasked;
- a disclosed time, token, action, and cost budget.

The neutral protocol instruction should say only that the model is the embodied
resident, must choose from the admitted action space, and cannot claim a result
until Minecraft returns it. Survival advice, project strategy, preferred action
ordering, failure recovery recipes, and benchmark solutions do not belong in
that instruction.

## Four layers that must not collapse

### 1. Minecraft environment

The environment owns sensory projection and player-like execution. Dynamic
action projection answers “can this action be meaningfully attempted from this
state?”, not “would this be a wise action?”

It may remove an inventory action when the body lacks the item, bind a target to
an object actually perceived by this body, or reject a stale entity id. It must
not hide a risky but legal choice merely to improve model behavior. A human can
mine a supporting block, walk into danger, waste an item, or repeat a bad idea;
the benchmark should normally let Minecraft expose that consequence.

Any non-vanilla safety policy—protected regions, mutation budgets, no downward
digging—must be an explicit, versioned episode policy shared by every candidate,
not an invisible recommendation embedded in the affordance compiler.

### 2. Benchmark episode

An episode pins:

- immutable starting artifact and world/epoch identity;
- game version and runtime profile;
- spawn/body identity;
- observation and action profile versions;
- task, if any;
- budgets and terminal conditions;
- outcome verifiers and metrics;
- model, mind program, prompt artifact, and random seed where supported.

Evaluation should use ordinary consequences whenever possible: position,
inventory, health, block and entity changes, communication received by each
body, persistence after restart, elapsed world time, and causal attribution.
The verifier may inspect privileged state after the episode, but that state
must not enter the resident's observation or prompt.

### 3. Mind program

The mind maps the request to one proposal. Direct tool calling, Ax, another
DSPy-style system, a human, or a hand-written policy should all fit the same
boundary. Behold validates the proposal but does not repair its reasoning.

Prompts, demonstrations, model routing, sampling settings, and learned
instructions are mind artifacts. They are candidate variables, not environment
semantics.

### 4. Continuing resident

Lync autobiography, sparse project/place projections, attention routing,
personality, proactive goals, and a user-selected safety constitution can make
a better persistent character. They should be evaluated as optional agent
features over the neutral environment. They must not silently become the
benchmark baseline.

## Lync lives and Lync episodes

Lync is not only long-term memory. Its append-only turns, branches, thread
references, computed views, and indexes are also a natural episode substrate.
We do not need a second mutable “episode database.”

The scopes should remain explicit:

- A **world epoch** is one authoritative server incarnation and its admitted
  bodies. Minecraft lifecycle evidence owns this fact.
- A **resident life** is one identity's continuing Lync loom. Its selected
  thread can cross controller stops, model changes, and many world epochs.
- A **controller episode** is a bounded range of lived turns between anchors in
  that life. Current turns already carry the observed `managedRunId`, so
  run-bound ranges can be derived without rewriting history. Finer wake-to-yield
  boundaries can be appended as explicit episode events when they become useful.
- A **benchmark episode** is an evaluator-owned record that references one or
  more resident-life ranges plus the immutable world start, policy profile,
  mind artifact, budgets, and verifier results.
- A **dataset** is a Lync index of episode looms or references, with an explicit
  train/validation/held-out partition.

An episode is therefore a durable view over source events, not a replacement
source of truth. For a single-life episode, start and terminal turn references
are enough. A multi-resident or restart episode can use its own small Lync loom
whose events reference each participant's life range, the world lifecycle, and
the evidence artifacts. Evaluator judgments and privileged witnesses stay on
that evaluator loom; the resident sees only its own life view.

This is especially useful for optimization. We can append candidate mind
artifacts, rollout references, objective metrics, selections, and retractions
without editing prior results. Lync's branches retain rejected prompt candidates
and its indexes define portable episode corpora. Exported Ax examples are
projections of selected Lync evidence, while the Lync source remains available
for audit and later re-scoring.

## Human-ish action grain

The benchmark does not need raw keyboard ticks, and it should not supply story
solutions. One action may contain the reactive motor work a human performs
while holding one intention, provided it does not choose the next intention.

Good core examples are: look in a relative direction, walk a bounded distance,
approach one perceived body, mine one perceived block, use or place the held
item, select/equip/drop an inventory item, craft one available recipe, attack
one perceived target, speak, and yield.

Composite skills such as “excavate a safe staircase”, “cross and close this
door”, or “inspect whether this space is a complete shelter” may be useful
product utilities. They change the problem presented to the model and therefore
belong in separately named action profiles. Loaded-volume scans, evaluator
topology, and story commands never belong in the neutral profile.

## What is currently contaminating the benchmark

The production resident policy currently includes several useful product
heuristics that are not neutral evaluation machinery:

- a long system prompt describing how to survive, build, collaborate, recover,
  manage projects, and sequence particular action families;
- a controller rule that can require `manage_project` before accepting any
  other model choice;
- hard-coded rejection after repeated actions, repeated failed action families,
  or two consecutive communications;
- danger-specific advice and action-surface changes;
- a no-downward-dig rule presented as body safety even though vanilla permits
  the attempt.

Lifecycle limits, stale-action rejection, schema validation, authority, and
causal consequence checks remain valid. The behavioral rules must move into an
optional resident policy or into the candidate mind itself. In benchmark mode,
a bad choice should remain a bad scored choice.

## Ax should optimize the mind, not the world

`@ax-llm/ax` 23.0.0 is installed. The current adapter uses an Ax signature for
typed one-action inference, assertions for admitted action names, model-call
evidence, and transport admission. It does not yet run Ax optimization.

It also calls `setInstruction(...)` on every decision using a controller-built
system prompt. That prevents an applied optimized instruction from being the
clear source of behavior. The correction is:

1. Keep only fixed protocol semantics in the decision signature.
2. Expose the candidate instruction and demonstrations as Ax-owned optimizable
   components.
3. Load and identify a serialized optimization artifact for evaluation.
4. Keep observation, task, actions, and lived history as structured runtime
   inputs rather than generated instruction text.
5. Score candidates through the same versioned episode runner.

Ax's top-level optimization path can bootstrap successful demonstrations and
use GEPA to tune instructions. It can return multi-objective Pareto results and
persist the chosen optimized program. We should optimize only after the episode
contract is reproducible, because prompt search against a shifting or coached
harness would optimize benchmark leakage.

## Evaluation and optimization loop

Use two gates:

1. **Cheap proposal replay.** Captured lived frames test schema validity,
   grounding, latency, cost, and obvious one-step causal mistakes without world
   mutation. This is fast feedback, not the final score.
2. **Disposable real-world rollout.** Each candidate receives a clean world
   instance and is scored by post-episode Minecraft evidence. Held-out artifacts,
   seeds, placements, and tasks decide selection.

Do not train on one expected action per frame. Several actions may be sensible,
and long-horizon quality is determined by consequences. Prefer deterministic
metrics when Minecraft can answer them, with a Pareto objective such as:

- task or life outcome;
- survival and irreversible loss;
- unsupported claims or invalid actions;
- model calls, prompt/completion tokens, wall latency, and cost;
- persistence and non-repetition after restart.

Qualitative judging is reserved for genuinely visual or cultural outcomes and
must remain separate from the primary causal metrics.

Training selection must not become resident memory. Marks such as “successful”,
“Pareto selected”, or “held out” belong to the episode/dataset loom, not to the
inhabitant's life. This keeps the same lived trajectory usable for evaluation,
learning, and narrative without letting evaluator hindsight leak into the next
Minecraft observation.

## Ultimate telos

The benchmark is a feedback instrument, not the product. The larger aim is a
world in which a mind can enter through a situated body, experience only what
that body can experience, choose culturally intelligible actions, live with
Minecraft's consequences, form a continuing identity, and return later without
its past being silently rewritten.

Different minds should be able to inhabit the same causal interface. Different
worlds should be able to implement it without importing Minecraft internals.
Humans, residents, evaluators, and optimizers should be able to refer to exact
episodes of those lives without confusing a model proposal, a body action, a
world fact, a memory, or a judgment.

In that telos:

```text
place artifact -> world epoch -> embodied lives -> Lync life threads
                                      |                  |
                                      +-> consequences <-+
                                             |
                                      episode references
                                             |
                              evaluation / learning / culture
```

Minecraft supplies the living medium. Behold supplies the narrow causal waist
and runtime authority. Lync supplies durable lives, episodes, branches, and
portable corpora. Ax and other mind systems supply replaceable, optimizable
cognition. None of those libraries is the telos by itself.

## First implementation cut

Before another open-ended paid life run:

1. Add one neutral policy profile that emits only the minimal protocol prompt,
   never forces `manage_project`, never blocks a valid repeated choice, and does
   not inject danger strategy.
2. Name and freeze a neutral action profile. Classify every current action as
   native core, disclosed composite skill, resident memory utility, or
   evaluator/operator instrument.
3. Make Ax instruction and optimization artifacts first-class instead of
   overwriting them per request.
4. Run direct and Ax minds through identical captured-frame replays.
5. Add one resettable real Minecraft episode with outcome-only scoring and a
   held-out variation.

Only then should GEPA spend model calls. A gain counts only if the serialized
candidate reproduces on held-out real-world episodes without changing the
environment contract.
