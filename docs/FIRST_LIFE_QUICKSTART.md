# First Life ordinary entry

This is the one supported ordinary path for starting a new resident, watching
it, stopping cleanly, and resuming the same world and private life. The software
path is real, but the required qualified Place release is not publicly hosted.
This is therefore a workshop and partner clean-room candidate, not a
repository-only public demo.

Place Compiler is an unpublished sibling project with no public clone or
package coordinate. An authorized operator must receive its source checkout
separately. In that supplied checkout, its owning `README.md` section “Build
and enter a place” covers installation and setup, and
`docs/place-compiler/TUTORIAL.md` section “Verify elsewhere and enter” owns the
verification and `living-entry` qualification workflow. The inspected workshop
source is `/Users/deepfates/Hacking/github/deepfates/place-compiler`; that
machine-local path is evidence, not a distribution coordinate. There is
deliberately no repository link until the owner publishes one.

## Required inputs

- a clean Behold checkout at a named commit, Node.js 22.13 or newer, and `npm ci`;
- Java 21 or newer capable of running the pinned Minecraft 1.21.4 server;
- a physical Place Compiler tarball installed outside its source checkout;
- one schema-v3 Place release whose `living-entry` status is `qualified`;
- the pinned Minecraft 1.21.4 server JAR created by `npm run server:jar`; and
- an OpenRouter key with access to the exact model/provider route in
  [`examples/first-life.residents.json`](../examples/first-life.residents.json).

The example is semantic-only and uses a real remote model. It is not
provider-free or scripted. Provider inventories can change; changing the model
or route is an explicit resident configuration revision, not an invisible
fallback.

## Install and inspect the two programs

In the Place Compiler checkout, create its physical package:

```sh
npm ci
npm run release:check
npm pack
```

Install that tarball into any separate prefix and ask the installed executable
for its identity:

```sh
npm install --prefix /absolute/path/to/place-install /absolute/path/to/place-compiler-<version>.tgz
/absolute/path/to/place-install/node_modules/.bin/place-compiler version --json
```

Keep the returned `version` and `distributionSha256`; Behold deliberately
requires both. In the clean Behold checkout:

```sh
npm ci
npm run check
npm run server:jar
export SERVER_JAVA=/absolute/path/to/java
"$SERVER_JAVA" -version
```

Set `SERVER_JAVA` for the later `npm run live` commands if `java` on `PATH` is
not the intended runtime. When it is unset, current source uses the
Launcher-managed Java on the exercised macOS layout when present, then falls
back to `java` on `PATH`. The workshop server path has been exercised with the
Launcher-managed Java reported by the preserved local dry run; that does not
establish other Java distributions or platforms.

## Preflight admission

The `--preflight` operation creates no Behold session or mutable world state
and makes no provider inference. The documented `npm run live` wrapper does
first rebuild ignored local `dist/` artifacts and apply Behold's pinned local
viewer patch; “preflight” does not mean the source checkout receives no local
build writes.

Set `OPENROUTER_API_KEY`, then run the exact prospective command with
`--preflight`:

```sh
npm run live -- /absolute/path/to/qualified-release \
  --accept-eula \
  --preflight \
  --residents examples/first-life.residents.json \
  --session first-life \
  --place-compiler-bin /absolute/path/to/place-install/node_modules/.bin/place-compiler \
  --place-compiler-version <version-from-version-json> \
  --place-compiler-distribution-sha256 <distributionSha256-from-version-json>
```

Preflight verifies the clean Behold commit, resident configuration and exact
current OpenRouter model/provider endpoint inventory, exact installed Place
package, current release integrity, living-entry qualification, and server JAR
without creating session or world state. It does not make a provider inference,
load a local model, start Minecraft, or make a resident decision.

## Start, watch, stop, and resume

Remove `--preflight`, add a short bounded duration, and repeat the otherwise
exact command:

```sh
npm run live -- /absolute/path/to/qualified-release \
  --accept-eula \
  --residents examples/first-life.residents.json \
  --session first-life \
  --duration 60 \
  --place-compiler-bin /absolute/path/to/place-install/node_modules/.bin/place-compiler \
  --place-compiler-version <version-from-version-json> \
  --place-compiler-distribution-sha256 <distributionSha256-from-version-json>
```

The foreground process prints the loopback resident lens URL. Use its stop
control or press Ctrl-C; both drain cognition, save Minecraft, and stop the
owned processes. The final output prints the exact resume command. Run that
command without `--residents`; the persistent session already binds the world,
body, private Lync life, resident configuration, and exact Place package.

## Evidence and remaining boundary

The workshop has exercised this installed Place seam from a fresh clone on the
same machine. The latest tracked-route repetition exposed the lens and native
server, accepted one question from an automated unmanaged Minecraft client,
recorded one grounded resident reply, stopped, and resumed the same world,
body, route, and private life. See the [dated report](reports/2026-08-22-first-life-local-installed-resume.md).

That exercise used a workshop credential, private qualified release, automated
visitor, and the same physical workstation. A small qualified release still
needs a durable public coordinate and another person or independent machine
must run this entry. Even that would not prove the separate repeated multi-day
habitat telos, resident competence, model quality, native-human entry, or
cross-platform support.
