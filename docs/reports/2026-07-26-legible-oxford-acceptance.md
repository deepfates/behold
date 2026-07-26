# Legible-resident Oxford acceptance

## Verdict

The first live `legible-resident-v1` session failed the behavioral acceptance.
Oxford's ecology was real and severe: after the run began at night, spiders and
zombies killed Phi five times and Llama eight times. Phi made two valid camera
turns before the attacks dominated the session. Llama made no valid action.
Neither resident moved voluntarily, defended itself, sought shelter, changed a
block, used inventory, spoke, coordinated, or adapted after a consequence.

The run did establish narrower facts. Both residents inhabited the exact
privacy-safe Oxford V3 epoch with their continuing identities; both read-only
first-person viewers worked; Phi's two public commitments, actions, outcomes,
and safe perceptions persisted and rendered correctly through Textile; the
world saved; every controller, listener, port, and run-owned model load stopped
cleanly; and the immutable Place release did not change. Those mechanics do not
substitute for sustained resident life.

This was one product acceptance, not a model comparison. Different local model
latencies, output reliability, context processing, and scheduling exposure are
part of the observed deployment. Equal hard ceilings governed resources; they
do not establish fair treatment or a winner.

## What a person saw

The two symmetric Prismarine Viewer tabs showed each resident's first-person
Minecraft view without controls. At release, Llama could see Phi across the
Oxford plaza while Phi faced nearby buildings. Phi then turned right, saw
Llama, and turned left back toward its earlier view. Once hostile mobs arrived,
the viewers showed bodies being crowded and struck, but no resident-authored
response followed. The owner could watch the danger, but the viewer did not
show whether a mind was queued, timing out, malformed, or making a commitment.

Phi's two public records were:

1. Intention: `Explore the environment by turning to look right.` It expected
   its view to change from south to west. Minecraft confirmed the west-facing
   turn, and the next perception showed Llama distant and ahead-left.
2. Intention: `Explore the environment by turning to look left.` It expected
   its view to change from west to south. Minecraft confirmed the south-facing
   turn, and the next perception showed Llama leaving the current view.

The expected consequences matched the camera outcomes, but the second action
reversed the first and neither commitment developed into environmental, social,
or survival conduct.

Llama's model did express a social intention twice: send a public greeting to
Phi. Neither response met the exact public contract. The first encoded
`expectedObservableConsequence` as an object, emitted two JSON objects, and
copied a contract sentinel. The second again used an object, copied the
contract body into its response, and exhausted all 512 output tokens. Behold's
strict boundary rejected both before intent or chat. This is an honest
model-output failure, not a missing chat affordance and not a controller
normalization opportunity.

## Exact treatment and identity

The four-minute run was declared as `oxford-legible-20260726a` at Behold
revision `1388b0a26775f55122e2cd3162d87a570b64f820`.

- Place release identity:
  `01c06fd10aa60c42ee691ab2562810a3ff79bd21f9fd0475aefba2995e842166`
- Behold epoch identity:
  `b5899b49cfb2cfa38f3b4e1dbb039bba9e375db13e0c3df4fe3f56b67c2a6d60`
- Experiment release:
  `d6f134e4d9061a76277ddc31c6de5ece058406b9c472232408bf1681d6de5a89`
- Body and actions: `minecraft-human-semantic-v1`
- Safety: `vanilla-player-v1`
- Treatment: `legible-resident-v1`
- Response transport: `behold.ollama-local-json-action.v2`
- Transport schema:
  `behold.ollama-local-json-action-schema.v2` at
  `1a0c46d7467e7df2aee3483f54b6ffb2f6497bfc52ff42001d0f03dc4c07325e`
- Llama: `llama3.2:3b` at installed content digest
  `a80c4f17acd55265feec403c7aef86be0c25983ab279d83f3bcd3abbcb5b8b72`
- Phi: `phi4:latest` at installed content digest
  `ac896e5b8b34a1f4efa7b14d7520725140d5512484457fab45d2a4ea14c69dba`
- Common settings: 16,384 context tokens, 512 maximum output tokens,
  temperature `0.2`, `keep_alive: 0s`, and aggregate cognition concurrency one.
- Session shape: ordinary event-driven life for 240 seconds, no fixed
  opportunities, no task or project injection, no provider, no retry,
  correction, normalization, substitution, catch-up, or operator action after
  release.

Each resident had a high fail-safe ceiling of 32 decision attempts and four
auxiliary context attempts. These were nonbinding resource guards, not equal
opportunities: natural events scheduled 37 opportunities for Llama and 31 for
Phi.

## Cognition and timing

The world began as an ordinary deliberative session. The first four upstream
responses were the only responses that reached the transport:

| Resident | Result | Queue | Upstream | Native load | Prompt eval | Generation | Prompt / output tokens |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Phi | valid look right | 0.012 s | 22.020 s | 3.299 s | 15.952 s | 2.044 s | 5,153 / 73 |
| Llama | malformed greeting | 21.995 s | 7.132 s | 1.405 s | 4.370 s | 0.546 s | 5,138 / 70 |
| Phi | valid look left | 6.600 s | 27.531 s | 0.743 s | 20.325 s | 5.676 s | 5,297 / 73 |
| Llama | malformed, output cap | 27.516 s | 36.718 s | 0.947 s | 6.539 s | 20.699 s | 5,241 / 512 |

Host contention and the common serial lane remain in those queue/load numbers;
nothing was normalized or compensated. The successful and malformed outputs
also show that prompt history was not inert: both lives entered with a long
recent sequence of earlier camera turns, Phi continued that pattern, while
Llama at least attempted to change mode to social chat.

When bodily danger began, the ordinary policy's five-second urgent decision
deadline became the dominant mechanism. Llama recorded 23 deadline failures,
11 interrupted calls, and two malformed outputs; Phi recorded 20 deadline
failures and eight interrupted calls. Opportunity terminals were:

| Resident | Scheduled | Success | Malformed | Cancelled |
| -------- | --------: | ------: | --------: | --------: |
| Llama    |        37 |       0 |         2 |        35 |
| Phi      |        31 |       2 |         0 |        29 |

The broker accepted 67 logical jobs, admitted 46 physical local attempts,
captured four responses and 42 upstream cancellations, and drained with no
unsettled quota charge. Llama used 21 of 32 provider-attempt charges; Phi used
25 of 32. Neither used an auxiliary fold. Usage remained attributed separately:
Llama recorded 10,379 prompt and 582 completion tokens across its two returned
responses, while Phi recorded 10,450 and 146.

This is a concrete time-scale incompatibility, not merely weak behavior. The
local Phi response path needed 22-28 seconds for the two usable decisions, and
the local Llama path needed seven seconds even before serial queue delay. The
current five-second urgent boundary therefore prevented either resident from
finishing a defensive choice. Simply extending the deadline is not an honest
repair: the resident can die and respawn while the request is in flight, after
which Behold must reject the old body frame as stale. A later product treatment
needs a transparently named cognition path whose measured latency fits ordinary
Minecraft danger, or a different declared ecological/session boundary. Behold's
existing separately identified `urgentModel` seam is relevant, but no suitable
local urgent mind has been validated for this product treatment.

## Authoritative world evidence versus resident history

Minecraft's retained server log is authoritative for the ecological sequence.
It records five Phi deaths from spiders and eight Llama deaths from spiders or
zombies between 01:45:02 and 01:47:21, followed by both residents leaving,
`save-all flush`, and normal server stop. Its SHA-256 after the run is
`37525388a288e7fd4d36949844585cbe2f288f9942ee9e623b6bb4c92e27c50c`.
An exact byte-identical snapshot is retained as `server-latest.log` in the
ignored run directory so a later server start cannot overwrite this evidence.
One server warning reported a 2.153-second, 43-tick delay. That does not explain
the repeated five-second model deadlines or the 22-37 second returned calls.

The controller observation journals retained only one distinct `died` event
for Llama and three for Phi. The authoritative EntityTurn/Lync history retained
no post-danger turn for Llama and no post-danger turn for Phi. Consequently,
Textile can accurately present the two actions that happened, but it cannot
tell the main human story of the session: the residents were repeatedly hurt,
killed, and respawned while cognition failed to settle.

This exposes a product-history gap. Entity turns are correct causal records of
admitted actions, but a readable living-world aftermath also needs the existing
world/body event history joined to the same epoch and time span. Synthesizing
deaths into action turns after the fact would be false; the server/world stream
must remain its own authoritative history.

## Textile aftermath

Both continuing lives were projected non-mutatingly into ignored derived
copies under
`data/oxford-legible-session/oxford-legible-20260726a/textile-aftermath` and
passed Textile's exercised Behold presenter.

| Life          | Source events | Readable turns | Unsupported events | Unsupported observation diagnostics |
| ------------- | ------------: | -------------: | -----------------: | ----------------------------------: |
| OxfordLlamaP1 |            12 |             11 |                  0 |                                   0 |
| OxfordPhiP1   |            13 |             12 |                  0 |                                   0 |

Every derived source line survived the Textile import byte-for-byte. Visible
prose contained no `privateCausalFrames`, absolute-coordinate object, or
observation-local stable reference. Phi's two new turns read as condition and
terrain, public intention and expected consequence, action, confirmed outcome,
and next perception. Llama has no new turn to present. The source Lync files
were unchanged by derivation; their post-run SHA-256 values are
`9d236b60f44a3634c02b2376d199a0c2f1e882d6fac792e5734ba8522c782c6c`
and
`3f3133a2a4d447c66a3737c947b1b0811e26e719b79c31f158b916eb9ba1de64`.

The disposable run harness nevertheless exited one after safe teardown because
its post-run assertion looked for `utterance.content` instead of the canonical
`utterance.assistant.content`. `failure.json` preserves that assertion error.
The two Phi turns themselves contain the correct structured commitment, public
rendering, action, outcome, safe observations, binding, and experiment release.
The world/model result was preserved and not repeated.

## Integrity and endpoint status

The 240-second owner stopped for `duration_elapsed`; both controllers exited
zero; the cognition broker drained; Minecraft acknowledged save and exited
zero; world ownership returned to `stopped_verified`; viewer and server ports
closed; and immediate post-run unload checks found no run-owned model. The
exact mounted Place release, manifest, verified world digest, and Behold
admission identity were reverified unchanged. The writable derived Oxford world
and both continuing lives remain available for later inspection or explicit
continuation.

The endpoint remains open. This run did not produce adaptive conduct,
resident-authored persistent world change, conversation, meaningful
cross-resident behavior, or human native co-presence. It did prove that the
next problem is not another scheduler or a larger call ceiling. It is the
composition of real-time cognition with Minecraft ecology, plus an aftermath
that joins action history to authoritative world/body events without inventing
causality.
