# First Life clean-checkout candidate

This is the shortest supported path toward starting one new resident, watching
it, stopping cleanly, and resuming the same world and private life. The software
path is real, but the required qualified Place release is not publicly hosted
yet. Until it is, this is a release candidate for workshop and partner
clean-room exercise, not a repository-only public demo.

## Required inputs

- a clean Behold checkout at a named commit, Node.js 22.13 or newer, and `npm ci`;
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
npm install --prefix /absolute/path/to/place-install /absolute/path/to/place-compiler-0.1.0-alpha.1.tgz
/absolute/path/to/place-install/node_modules/.bin/place-compiler version --json
```

Keep the returned `version` and `distributionSha256`; Behold deliberately
requires both. In the clean Behold checkout:

```sh
npm ci
npm run check
npm run server:jar
```

## Read-only admission

Set `OPENROUTER_API_KEY`, then run the exact prospective command with
`--preflight`:

```sh
npm run live -- /absolute/path/to/qualified-release \
  --accept-eula \
  --preflight \
  --residents examples/first-life.residents.json \
  --session first-life \
  --place-compiler-bin /absolute/path/to/place-install/node_modules/.bin/place-compiler \
  --place-compiler-version 0.1.0-alpha.1 \
  --place-compiler-distribution-sha256 <distributionSha256-from-version-json>
```

Preflight verifies the clean Behold commit, resident configuration and exact
current OpenRouter model/provider endpoint inventory, exact installed Place
package, current release integrity, living-entry qualification, and server JAR
without creating session state. It does not make a provider inference, load a
local model, start Minecraft, or make a resident decision.

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
  --place-compiler-version 0.1.0-alpha.1 \
  --place-compiler-distribution-sha256 <distributionSha256-from-version-json>
```

The foreground process prints the loopback resident lens URL. Use its stop
control or press Ctrl-C; both drain cognition, save Minecraft, and stop the
owned processes. The final output prints the exact resume command. Run that
command without `--residents`; the persistent session already binds the world,
body, private Lync life, resident configuration, and exact Place package.

## What remains before public release

The workshop has now exercised the installed Place path from both the working
checkout and a fresh clone on the same machine. Both crossed a bounded local
one-resident start, lens exposure, clean stop, and resume of the same world,
body, resident revision, and private Lync life. See the
[local installed-package receipt](reports/2026-08-22-first-life-local-installed-resume.md).
That exercise used a private LM Studio configuration, not the tracked
OpenRouter example above, so it is not an outsider clean-room receipt. A small
qualified release still needs a durable public download coordinate, and a new
person or independent machine must run the tracked route (or an explicitly
revised public route). Passing that remaining candidate will prove an
outsider-runnable First Life alpha; it will not prove the separate repeated
multi-day habitat telos, resident competence, model quality, native-human entry,
or cross-platform support.
