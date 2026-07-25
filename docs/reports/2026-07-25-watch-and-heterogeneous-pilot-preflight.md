# Oxford watch path and heterogeneous pilot preflight

Date: 2026-07-25

## Verdict

Behold can support the smallest live pilot with two symmetric read-only
Prismarine Viewer tabs and optional OBS capture, while Textile owns the
readable causal account from exact Lync. The retained scripted Oxford run has
complete semantic/causal history but no visual replay because no viewer or
recorder was active. A real heterogeneous free-route pilot is **not ready for
provider calls**: the direct request seam does not yet pin an exact provider,
forbid fallback, or impose the same maximum output envelope, and current free
endpoint privacy evidence does not establish two suitable private routes.

This is a product and deployment preflight, not a model ranking design. Equal
quotas govern resources; they do not make heterogeneous models causally
comparable.

## What exists and what was exercised

The live Oxford boundary at Behold `2c14471` exercised two Mineflayer residents,
the exact `minecraft-human-semantic-v1` body/action surface, equal durable
per-purpose quotas, an all-ready release, Lync, intervention/capture journals,
and clean Minecraft 1.21.4 shutdown without a provider call. The viewer was
disabled and no pixels or camera track were recorded.

The current managed runner forces `VIEWER_ENABLED=0`. The separate legacy
pilot path starts one Prismarine Viewer and one interactive web cockpit. That
cockpit exposes coordinates, nearby distances, navigation, movement, chat,
follow, and other controls; it is an intervention console, not a passive
scientific watch surface.

Prismarine Viewer 1.33.0 and Mineflayer 4.37.1 are installed. The viewer's
Mineflayer adapter creates one HTTP/WebSocket server for one bot, follows that
bot's loaded world/position, and supplies first- and third-person controls.
Multiple browsers can watch one endpoint, but multiple residents require
distinct ports/endpoints; it has no built-in resident switcher. The managed
runner has not yet exercised lifecycle-safe viewer startup/shutdown.

Both retained Oxford `.lync` files verify, but current generic Lync transcript
and tree views expose nested JSON. Textile's current raw importer rejects the
real files with `No presentable events ... Unsupported kinds: lync/loom,
lync/turn`. The precise Behold-owned fixture and presentation boundary are in
[`docs/RESIDENT_LYNC_PRESENTATION.md`](../RESIDENT_LYNC_PRESENTATION.md). A live
Lync relay would improve delivery, but would not supply the missing domain
semantics by itself.

## Capability comparison

| Approach                            | POV / output                                                                                                                        | 1.21.4 fit                                                                                                         | Runtime and treatment effect                                                                                                                                                                               | Pilot decision                                                                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Existing Prismarine Viewer          | Live resident first-person; switchable only as separate resident URLs/tabs; orbiting third-person over that resident's loaded scene | Installed version explicitly supports 1.21.4                                                                       | No extra Minecraft player; adds mesh generation, HTTP/WebSocket, browser/GPU, and same-process event-loop work. Equal fixed settings are required for both residents.                                      | **Use**, read-only and symmetrically, with unique ports and no click-to-act bridge.                                              |
| Existing Behold web cockpit         | Resident status plus interactive command/navigation controls                                                                        | Local code works with the Mineflayer body                                                                          | Privileged coordinates and active interventions; materially changes the observational boundary                                                                                                             | **Reject during scored window.** Keep only as an explicitly logged operator console outside it.                                  |
| Prismarine Web Client               | Interactive browser Minecraft client, not merely a view                                                                             | Upstream's current README still describes a partial client and does not claim current 1.21.4 parity                | Adds another Minecraft client/player and a TCP proxy; movement, break, place, and chat are interventions                                                                                                   | **Reject.** Larger and less reliable than the native client for human entry.                                                     |
| Native Java spectator               | Detached free camera and entity spectating                                                                                          | Built into vanilla 1.21.4                                                                                          | Adds an authenticated server player. It can appear in player UI/chat, receive commands, and, with Oxford's current `spectators-generate-chunks=true`, free flight can load/generate persistent world state | **Reject during scored window.** Useful as a named observer phase after stop/release if entry and movement are logged.           |
| Native Java adventure/survival join | Human first-person participation                                                                                                    | Built into vanilla 1.21.4                                                                                          | Ordinary ecology participant; can affect entities/items/chat/world and therefore is an experimental intervention                                                                                           | **Reject as passive watch.** Preserve for a separately named native-human treatment, which remains part of the eventual product. |
| Mineflayer observer/spectator bot   | Extra bot POV, potentially with a viewer                                                                                            | Mineflayer understands 1.21.x and spectator state, but no stable high-level resident-spectate camera API was found | Extra client/player, process, chunks, and camera-control plumbing                                                                                                                                          | **Reject.** Existing resident-attached viewers are smaller and less invasive.                                                    |
| BlueMap CLI                         | Detached post-run 3D world map                                                                                                      | BlueMap 5.22 CLI covers 1.21.4                                                                                     | Non-mutating when run against a stopped derived copy, but an existing SF render took about 3.1 hours, 4.64 GB peak resident memory, and produced 12.8 GB                                                   | **Optional after the pilot**, never the primary live/watch or causal-history path. Plugin mode would change the vanilla server.  |
| Dynmap                              | Live tiled world map                                                                                                                | Current project documents Paper/Spigot and Fabric support through 1.21.4, not a vanilla server jar                 | Changes server implementation and adds continuous render/IO work                                                                                                                                           | **Reject for the first pilot.**                                                                                                  |
| uNmINeD                             | Offline 2D world map/web export                                                                                                     | Current tool reads modern Java worlds; not installed locally                                                       | No resident treatment if run after stop; less immersive and less causally informative than the already proven BlueMap path                                                                                 | **Defer.** A plausible later low-cost overview, not a gate.                                                                      |
| ReplayMod / Flashback client        | Recorded client POV, replay/free camera, cinematic export                                                                           | Both publish 1.21.4-compatible Fabric builds                                                                       | Requires a modded Java client connected during the run; an owner spectator recorder is still an added player/treatment. Mineflayer residents cannot emit these recordings directly                         | **Reject during the first scored window.** Consider for an explicitly observational phase.                                       |
| ServerReplay                        | Server-side per-player/chunk replay consumable by replay clients                                                                    | Publishes 1.21.x Fabric versions                                                                                   | Replaces the vanilla server with Fabric and adds recording CPU/storage/chunk behavior                                                                                                                      | **Reject for the first pilot.** Too much server change for a watch convenience.                                                  |
| OBS / screen recording              | Pixel recording of chosen viewer/native-client windows                                                                              | Installed locally; independent of protocol version                                                                 | Moderate local GPU/storage; no extra Minecraft player or resident input. It records pixels, not causal/replay semantics                                                                                    | **Optional use** over the two read-only viewer tabs.                                                                             |
| Lync + Textile                      | Live or post-run synchronized causal history, resident/world/release identity, readable event feed after a profile-aware presenter  | Protocol-level; independent of Minecraft version                                                                   | Low IO and no world mutation. Relay/sync does not change resident treatment. Current Textile presenter lacks Behold envelopes                                                                              | **Use as the authoritative account.** Textile implements presentation; Behold supplies exact fixture/domain contract.            |

Primary upstream references: [Prismarine Viewer](https://github.com/PrismarineJS/prismarine-viewer),
[Mineflayer](https://github.com/PrismarineJS/mineflayer),
[Prismarine Web Client](https://github.com/PrismarineJS/prismarine-web-client),
[BlueMap 5.22](https://github.com/BlueMap-Minecraft/BlueMap/releases/tag/v5.22),
[Dynmap](https://github.com/webbukkit/dynmap),
[uNmINeD CLI](https://unmined.net/docs/cli/getting-started/),
[ReplayMod](https://www.replaymod.com/download/),
[Flashback](https://modrinth.com/mod/flashback/versions),
[ServerReplay](https://modrinth.com/mod/server-replay), and
[OBS macOS screen capture](https://obsproject.com/kb/macos-screen-capture-source).

## Smallest good pilot experience

Before the run, expose one read-only first-person viewer endpoint per resident,
with identical fixed view distance and rendering configuration. Give the owner
two named browser tabs; optionally record both with OBS. Do not expose the web
cockpit or admit a native observer/player during the scored window. Record the
presentation profile and viewer lifecycle, but do not characterize browser
latency or dropped frames as resident behavior.

During the run, Textile should show the synchronized, profile-aware Lync feed
beside the two views once `Hac-i4by` accepts the supplied contract. The pixels
answer "what can I see now?"; Lync answers "what did this resident perceive,
say, attempt, and cause, in which released world?" If live Textile delivery is
not ready, exact `.lync` import after stop is the minimum acceptable aftermath.

After the run, retain the exact Lync/capture/intervention histories, optional
OBS pixels, and the stopped derived Oxford world. An offline BlueMap render is
useful only if the owner wants spatial context enough to justify its cost. It
cannot replace either resident POV or causal history.

The credible eventual experience is one owner page with a resident selector or
side-by-side views, a synchronized Textile causal feed, and later an offline
world map. Native human entry and detached replay remain visibly named modes:
observing, joining, and intervening must never masquerade as the untreated
resident window.

## Pilot purpose and estimand

The first provider-backed run estimates whether the complete living-world
system can sustain and expose heterogeneous resident behavior under an honest
deployment ecology. It does not estimate relative model quality, establish a
fair comparison, or select a winner.

Common controls would be:

- the exact Oxford V3 epoch and `minecraft-human-semantic-v1` body/action and
  `vanilla-player-v1` safety profiles;
- the same policy prompt, projected context, action catalog, scheduling
  opportunities, and maximum request/output envelopes;
- no injected task/project, loom fold, Ax correction, route substitution,
  retry, catch-up opportunity, native-human entry, or operator intervention
  during the scored window; and
- a tiny bound: two residents, four scheduled opportunities each, at most one
  physical provider attempt per opportunity, and approximately 10–15 minutes.

Every input must fit the smallest participating context window. The record must
keep scheduled opportunities, physical provider attempts, provider/route
failures, valid model responses, malformed responses, admitted decisions,
physical actions, tokens, latency, and cost distinct. Provider failure and
free-route reliability belong to the observed deployment ecology and must not
be attributed automatically to intelligence.

## Exact route-control gap

The production owner of direct request bytes is
`src/mind/direct-wire.ts:directOpenRouterRequestBody`. It currently emits
`model`, messages, tools, tool choice, non-parallel tools, and temperature. It
emits neither an output-token cap nor OpenRouter's `provider` routing object.
`src/mind/direct.ts:createDirectResidentMind` serializes and hashes that body,
makes one request, and retains returned model/provider identity. The world
runner's resident config owns model and quota identity, but has no admitted
route policy.

The cognition broker authenticates the resident, exact model, purpose, quota,
and raw body, then forwards the bytes unchanged. Its body validator permits a
valid output cap but does not require one and does not validate a provider
policy. Returned provider/model identity is captured, not compared with an
admitted route. Therefore capture is honest about what happened but cannot
prevent a fallback or unequal output envelope.

The smallest owning implementation seam is:

1. Add a versioned direct-mind route policy to each managed resident: requested
   model, exact ordered provider slug(s), `allow_fallbacks: false`, required
   data-policy/ZDR filters, and one shared maximum output token count.
2. Have `directOpenRouterRequestBody` render that exact policy and output cap.
   Use the direct adapter for this pilot; do not route through Ax or folding.
3. Bind the policy into the release/configuration identity, and have the broker
   reject any authenticated resident body that differs before quota charge or
   upstream I/O. The existing exact body hash/capture then proves the sent
   bytes.
4. Require returned model/provider to match the admitted identity and record a
   distinct route-identity failure. Never substitute or silently retry.

This is a narrow transport/configuration fix, not a treatment engine. Until it
is implemented and tested provider-free, the technical route control is not
implementable from operator configuration and the provider-backed pilot stays
closed.

OpenRouter documents exact provider ordering and fallback control in its
[provider routing API](https://openrouter.ai/docs/guides/routing/provider-selection),
separate [provider data policies](https://openrouter.ai/docs/guides/privacy/provider-logging/),
and [zero-data-retention routing](https://openrouter.ai/docs/guides/features/zdr).

## Current free-route privacy preflight

Public endpoint metadata was inspected read-only on 2026-07-25; no completion
request or paid/provider call was made. Free price is not a privacy guarantee,
and provider topology is mutable. OpenRouter's endpoint API does not itself
return enough retention/training evidence to admit private resident history.

| Candidate route                          | Current exact free endpoint                              | Public privacy evidence                                                                                                                                                          | Preflight status                                                                                                                                  |
| ---------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `google/gemma-4-31b-it:free`             | Google AI Studio; 262,144 context, 32,768 max completion | Provider policy currently says prompt training off, prompt logging retained for 55 days, with developer moderation                                                               | Potential only if the owner later accepts retained provider logging and another route meets the same declared boundary. Not private/ZDR evidence. |
| `nvidia/nemotron-3-super-120b-a12b:free` | NVIDIA; 262,144 context/completion                       | Free endpoint notice says not to upload confidential/personal data and permits collection/recording/use for security and service improvement; provider page reports training use | Not suitable for private Oxford/resident history. Possible only for an explicitly nonconfidential/public-input treatment after owner consent.     |
| `inclusionai/ling-3.0-flash:free`        | Novita; 262,144 context, 32,768 max completion           | Exact endpoint data policy/retention was not established from public endpoint metadata                                                                                           | Fail closed.                                                                                                                                      |
| `openai/gpt-oss-20b:free`                | Darkbloom; 131,072 context, 32,768 max completion        | Exact endpoint data policy/retention was not established from public endpoint metadata                                                                                           | Fail closed. This is also the smallest current candidate context window.                                                                          |

Relevant model pages:
[Gemma 4 31B free](https://openrouter.ai/google/gemma-4-31b-it%3Afree),
[Nemotron 3 Super free](https://openrouter.ai/nvidia/nemotron-3-super-120b-a12b%3Afree),
[Ling 3 Flash free](https://openrouter.ai/inclusionai/ling-3.0-flash%3Afree), and
[GPT OSS 20B free](https://openrouter.ai/openai/gpt-oss-20b%3Afree).

There is no owner privacy choice to make yet because the code cannot enforce
the choice. After the narrow route-policy seam passes provider-free tests, the
real options are:

1. **Strict private/ZDR:** run only if two exact $0 endpoints independently
   prove the required no-training/no-logging/ZDR policy at launch. Current
   evidence does not establish such a pair, so this option is presently no-go.
2. **No training with declared retention:** accept a precisely bounded logging
   period and moderation policy, but only if two exact pinned free endpoints
   meet the same declared rule at launch. Only one candidate is presently even
   partially evidenced.
3. **Explicit nonconfidential pilot:** send only owner-approved public/synthetic
   context and accept route-specific logging/training. This may make more free
   routes viable, but must not silently redefine Oxford or resident history as
   nonconfidential.

Immediately before any future call, re-query the exact endpoints, verify $0,
context/output limits, provider identity, retention/training/ZDR policy, and
account privacy settings; fail closed on any drift. No winner/loser conclusion
is permitted from the resulting heterogeneous run.
