# First Life local installed-package start and resume

Date: 2026-08-22  
Behold commit: `963d4b52fd3ddc6259d725c287a330e2457c3798`  
Place Compiler package: `0.1.0-alpha.1`  
Place Compiler distribution: `91d4eeca4dd4a2c98e07d0b9774784d0e7f917b5bacd819c0be1faeec3d36843`

## Scope of this evolving report

The identities above and the opening claim describe the initial `963d4b5`
LM Studio exercise. Later sections preserve same-day and subsequent repetitions
rather than rewriting that result: [Tracked OpenRouter route](#tracked-openrouter-route)
records the tracked remote-provider treatment and its stale-route negative;
[Deterministic-entry starter repetition](#deterministic-entry-starter-repetition)
records the later entry-qualification-v2 run. Each section names the revision,
inputs, result, and nonclaims that apply to it. The file as a whole is a sequence
of bounded local exercises, not one run under the header's commit.

## Claim

A clean committed Behold checkout used a physical Place Compiler installation
outside either source checkout to recover a partially initialized local
session, start one model-backed resident in the qualified Oxford release,
expose its viewer and resident lens, save and stop cleanly, and then resume the
same world, body, resident revision, and private Lync life without re-supplying
the resident configuration.

This is a workshop-local exercise of the software path. It is not the tracked
OpenRouter example, a provider-free cognition path, an outsider clean-room run,
or a public artifact. The qualified release and alternate LM Studio resident
configuration remain private machine-local inputs.

## Inputs

- qualified release:
  `/Users/deepfates/Hacking/data/artifacts/place-compiler/qualification-candidates/oxford-v3-habitat-v1`
- release manifest SHA-256:
  `475aa98a6652932461709ca93628b8a7d9bac49ac5e48e12322ab21030090f23`
- source world tree SHA-256:
  `4160ae7e5a9c787bf727051f58dd147d96f52db33ad2a8ce0a6c440457acb91a`
- Minecraft server SHA-256:
  `1066970b09e9c671844572291c4a871cc1ac2b85838bf7004fa0e778e10f1358`
- local model: `google/gemma-4-12b@q4_k_m`, 7,556,570,932-byte
  artifact tree `8c1275bd8b7ec0555e3edc62b3932de57ac7aceead075dcab095137d5728d836`
- admitted LM Studio runtime:
  `llama.cpp-mac-arm64-apple-metal-advsimd@2.29.0`
- session evidence:
  `/Users/deepfates/Hacking/github/deepfates/behold/data/live/first-life-clean-entry-local`

The private resident set used `resident-v2`, semantic-only perception, four
resident-decision attempts and one auxiliary-context attempt per episode. No
secret is present in this report or the retained episode records.

## Commands

The successful first episode intentionally migrated the session's preserved
2.27.1 LM Studio plan to the currently admitted 2.29.0 runtime:

```sh
PATH='/Applications/LM Studio.app/Contents/Resources/app/.webpack':$PATH npm run live -- \
  /Users/deepfates/Hacking/data/artifacts/place-compiler/qualification-candidates/oxford-v3-habitat-v1 \
  --accept-eula \
  --residents .behold-runtime/first-life-gemma12-local.json \
  --change-minds \
  --session first-life-clean-entry-local \
  --duration 45 \
  --place-compiler-bin /var/folders/h6/q8syhnmx1mq07kl_hm4p5jx40000gn/T/tmp.3eFq7TMv8w/install/node_modules/.bin/place-compiler \
  --place-compiler-version 0.1.0-alpha.1 \
  --place-compiler-distribution-sha256 91d4eeca4dd4a2c98e07d0b9774784d0e7f917b5bacd819c0be1faeec3d36843 \
  --lmstudio-models-root /Users/deepfates/.lmstudio/models \
  --max-model-concurrency 1
```

Resume omitted both `--residents` and `--change-minds`:

```sh
PATH='/Applications/LM Studio.app/Contents/Resources/app/.webpack':$PATH npm run live -- \
  /Users/deepfates/Hacking/data/artifacts/place-compiler/qualification-candidates/oxford-v3-habitat-v1 \
  --accept-eula \
  --session first-life-clean-entry-local \
  --duration 30 \
  --place-compiler-bin /private/var/folders/h6/q8syhnmx1mq07kl_hm4p5jx40000gn/T/tmp.3eFq7TMv8w/install/node_modules/place-compiler/scripts/place-compiler/place.mjs \
  --place-compiler-version 0.1.0-alpha.1 \
  --place-compiler-distribution-sha256 91d4eeca4dd4a2c98e07d0b9774784d0e7f917b5bacd819c0be1faeec3d36843
```

## Observed result

Episode `000003` exposed native Minecraft at `127.0.0.1:25565`, the resident
POV at `127.0.0.1:3007`, and the authenticated resident lens. `LocalFirstLife`
spawned at `(1976, -48, 1409)`, chose two one-second forward movements, and
received two successful Minecraft body transitions of 4.2734 blocks each. Its
canonical Lync life ended at depth 2 and 62,098 bytes. The episode saved and
stopped with terminal world digest
`fb74970f2aa2f5b1efadc6bbb58a19dd7e3bcf5307f60a1c26e14e1e5bed7c8b`.

Episode `000004` reopened the same world ID
`oxford-a9fdd9dce68822f68f6db1134e8a83a86ae99272332d87343105c3a09cc7989f`,
the same Lync loom `lync:01a02a0e-95cd-759b-8ba9-64e016307456` with two prior
events, and body `LocalFirst` at the saved `(1976, -48, 1418)` position. It
committed three further turns: two interaction inputs against the exact focused
mud-bricks block and one short confirmed forward movement. The canonical life
advanced to depth 5 and 134,575 bytes. It saved and stopped with terminal world
digest `84982dc0ad926ecc2db1e8cfd3ce074b8fac0e94bfea080b37c465289494e9a0`.

Both episode records bind resident revision `000001`, digest
`cec309d1cffba60b3b50bc7caa5397cc4e062d883cc50274be7e5556aae51527`.
Both exhausted the deliberate four-attempt resident-decision quota; the final
HTTP 429 in each controller journal is the local Behold quota gate refusing an
additional call, not an upstream LM Studio failure. Every admitted attempt was
settled. After each episode, Place saved and stopped, the resident viewer and
Minecraft ports closed, and the LM Studio model unloaded.

## Fresh-clone adversarial repetition

The same user story was then repeated from a new disposable Git clone at
Behold commit `8aaa74851a8564889793c76bc0bf5398ccf9fbf6`. The clone began with no
dependencies, server JAR, runtime, world, session, or resident life. In that
clone the operator:

1. ran `npm ci`;
2. ran `npm run server:jar`, which downloaded and verified a new local copy of
   the pinned 1.21.4 server;
3. installed a newly packed Place Compiler tarball into a separate prefix;
4. passed `behold live --preflight` without creating the prospective session;
5. started episode `000001` through the same ordinary `behold live` interface;
6. stopped cleanly; and
7. resumed episode `000002` without supplying `--residents` again.

The repetition used Node `v26.7.0`, satisfying but differing from the documented
Node 22.13 floor. It still used the same private qualified release and private
LM Studio configuration on the same physical workstation, so it is a fresh
checkout exercise rather than an independent machine or person.

Both episodes used world
`oxford-7f3f3699f76cba143f9d6c30a074c3a7d13d02f49c476da4d1666924f17593e8`
and Lync loom `lync:01a02a1e-c6ff-7f52-b50c-b560f01f288c`. Episode `000001`
ended at depth 2, 62,643 bytes, and terminal world digest
`a9560fcb18d5e8282dad93e8b6ad28c5925b4d32b841f57b2d86ebbe1c2ed76d`.
Resume reopened the body at its prior saved position with two prior life events
and advanced the same life to depth 5, 157,505 bytes. Episode `000002` stopped
with terminal world digest
`004c5440da8954db04f554ee7ea7988d0a0ec6e4b0a0ba7e7e3fcb0b3c54db21`.
Every admitted cognition attempt settled, both viewers closed, Place saved and
stopped, and the local model unloaded.

The exact disposable session was retained as:

- archive:
  `/Users/deepfates/Hacking/data/artifacts/behold/first-life-clean-clone-20260822/clean-clone-first-life.session.tar.gz`
- archive SHA-256:
  `3c1d6713bce25d4f725ddccb4706d5fd403779ca16d0993f3d1dbb41b9b9c879`

The clean install also exposed one high-severity production Socket.IO parser
advisory in the resident viewer path and three high-severity development-tool
advisories. Compatible transitive updates now leave the complete source install
with six moderate upstream Minecraft authentication-chain advisories and no
high or critical findings. Those remaining reports are not represented as
fixed; npm's suggested resolution is an inapplicable downgrade to Mineflayer
1.4.0.

## Preceding negative evidence

This exercise was reached by preserving and retrying two useful failures. The
first ordinary attempt started Place before discovering that the LM Studio CLI
was absent from `PATH`; local cognition preflight now runs before Place. The
next retry exposed a resume verifier that accepted only Git-shaped Place
revisions even though installed mode deliberately persists
`npm:place-compiler@version#distribution`. Commit `963d4b5` admits those two
exact identity forms and rejects malformed package identities. The same partial
session then recovered successfully rather than being discarded.

## Tracked OpenRouter route

The disposable clone later advanced to Behold
`b5cb30c49087095bd2ed637dcbaa5983de5aed5c`, kept the same independently
installed Place package and private Oxford release, and ran the tracked
`examples/first-life.residents.json` through a real workshop OpenRouter
credential. The first attempt had failed honestly at the provider: the then
tracked `deepinfra/fp4` tag no longer named an endpoint for
`deepseek/deepseek-v4-flash`. All twelve configured attempts returned HTTP 404,
Minecraft still saved and stopped, and no provider tokens or resident turns
were claimed. The compact negative evidence is retained privately at
`/Users/deepfates/Hacking/data/artifacts/behold/first-life-openrouter-clean-clone-20260822/stale-fp4-negative-evidence.tar.gz`,
SHA-256
`6416256b714924e96c13a886cec77b5a97bcaf66bf290062ddcaa032cb6e8146`.

OpenRouter's current
[endpoint inventory](https://openrouter.ai/api/v1/models/deepseek/deepseek-v4-flash/endpoints)
identified DeepInfra as `deepinfra/fp8`. The tracked configuration and reference were revised without
changing the model, returned-provider requirement, no-fallback policy, strict
JSON contract, disabled reasoning, ZDR requirement, or denied data collection.
Episodes `000001` and `000002` then each reached the exact returned model and
provider and stopped cleanly, but the resident chose null from the unchanged
quiet scene. Because `resident-v2` does not fabricate action turns for null
intention, the same Lync loom correctly remained at depth zero.

Episode `000003` retained exact private provider bodies and ran for 130 seconds.
Two further quiet-scene decisions were null. An automated unmanaged Minecraft
client named `CleanRoomVisitor` then joined the ordinary native server, asked
“Hello FirstResident — what do you notice here?”, and left. The resident
witnessed that join and chat, chose a terrain-grounded reply, and Minecraft
recorded the reply. Its immediate continuation proposed another similar reply,
but the visitor had left before execution; Behold revalidated the world and
returned `no_other_players_online`. The resident then chose null. Those two
attempts became the first two canonical turns in loom
`lync:01a02a32-67f7-7ac5-80b1-ff04e7351a80`, 66,304 bytes, chain digest
`94c49e4e...40b88`. Five settled provider calls used 7,631 tokens and cost
$0.000531342. The episode stopped with world digest
`2d89bba3...25d10`.

Episode `000004` resumed without `--residents`, reopened that exact world, body
position, route, loom, and two prior turns, made two further settled null
decisions, and stopped with the same 66,304-byte Lync prefix and world digest
`ca8ac926...90e84`. Across all four successful-route episodes, nine settled
calls used 13,836 tokens and cost $0.000945936. Every viewer closed, Place saved
and stopped, and the Minecraft/viewer ports cleared.

The complete 497 MB private session, including episode `000003`'s exact model
bodies, is retained at
`/Users/deepfates/Hacking/data/artifacts/behold/first-life-openrouter-clean-clone-20260822/clean-clone-openrouter-first-life-fp8.session.tar.gz`,
SHA-256
`2dbe498da314655547894e11a0551692990e57b7360461849808c5e76e4348e9`.
No credential is stored in the archive.

The stale route also falsified the original preflight treatment: credential
presence could not establish provider availability. Behold
`11e21a521db1145d0c7cdb82d906206f4ff48776` now queries the exact OpenRouter
model endpoint inventory before Place authority, requires the configured tag,
returned provider, and healthy status, and still makes no inference or state
write. The disposable clone exercised that gate against `deepinfra/fp8`; its
prospective session remained absent.

## Remaining boundary

The mechanics required by the clean-checkout candidate have now been exercised
locally from both the working checkout and a fresh clone, including the tracked
remote-provider route, installed Place identity, one Minecraft-authoritative
social consequence, private continuity, and stop/resume. This does not count as
an outsider or native-human exercise: the clone, credential, private qualified
release, and automated visitor were all on the same workshop machine. The
public claim remains open until a small qualified release has a durable public
coordinate and another person or independent machine runs it. This result does
not close the repeated multi-day habitat telos.

## Deterministic-entry starter repetition

A later fresh-clone repetition used the no-raw-input Oxford starter qualified
under Place Compiler entry qualification v2. That policy fixes the world spawn
and sets Minecraft's spawn radius to zero, preventing the random rooftop entry
observed during adversarial requalification. Behold commit `091e20d` admits the
versioned v2 proof without weakening the remaining release checks.

The first real resident run crossed start, Minecraft consequence, clean stop,
and resume with the same world and Lync life. It also exposed a product defect:
one visitor interaction could provoke an extra reply merely because the
resident's own chat action completed. Commit `fc69028` ends that decision
sequence when no new meaningful world event has arrived.

The ordinary 90-second repetition at `fc69028` used an unmanaged Minecraft
client named `SocialVisitor`, which asked, “FirstResident, what do you see?”
FirstResident answered once: “I see you, SocialVisitor, standing on polished
andesite near end stone bricks and glass.” Minecraft recorded exactly one
resident chat. The resident made no further chat attempt after its own action
completed. Three provider decisions settled, using 4,271 tokens and
$0.000259956. Place saved and stopped cleanly.

This is evidence that the local vertical slice now behaves coherently for one
brief encounter. The visitor was automated and everything still ran on the
workshop machine; it is not independent-human or public-release evidence.
