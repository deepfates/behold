# First Life local installed-package start and resume

Date: 2026-08-22  
Behold commit: `963d4b52fd3ddc6259d725c287a330e2457c3798`  
Place Compiler package: `0.1.0-alpha.1`  
Place Compiler distribution: `91d4eeca4dd4a2c98e07d0b9774784d0e7f917b5bacd819c0be1faeec3d36843`

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

## Remaining boundary

The mechanics required by the clean-checkout candidate have now been exercised
locally from both the working checkout and a fresh clone, including installed
Place identity and stop/resume continuity. The public claim remains open until
a small qualified release has a durable public coordinate and another person
or independent machine runs the tracked
`examples/first-life.residents.json` route (or an explicitly revised public
route). This result does not close the repeated multi-day habitat telos.
