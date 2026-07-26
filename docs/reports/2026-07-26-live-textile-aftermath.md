# Durable live Textile aftermath

Date: 2026-07-26

## Endpoint and defect

The intended endpoint is one ordinary `behold live` Oxford episode whose
aftermath remains readable after later resumes. Before this change the v2
aftermath recorded a hash and path for each resident's original `.lync` file.
Those files are lifelong append-only histories. A later episode can therefore
change the bytes at a path cited by an earlier aftermath, leaving the old hash
and its supposed Textile input stale.

This is an aftermath ownership defect, not a Textile presentation defect.
Textile already supports Behold's exact `org.behold.inhabitant.v1` profile and
must continue to derive presentation without rewriting the source history.

## Implemented boundary

At clean shutdown, before writing `aftermath.json`, `behold live` now:

1. copies every resident Lync file into the episode's
   `resident-lync/<entity>/` directory with exclusive creation;
2. verifies each copy's byte count and SHA-256 against the still-open source;
3. records the original and preserved paths under protocol
   `behold.live-lync-snapshot.v1`; and
4. concatenates the preserved files, in resident/source order and without
   rewriting a byte, into `textile-resident-lives.lync` under protocol
   `behold.live-textile-import.v1`.

The combined artifact records its own hash, size, source count, and ordered
source hashes. It is the single file an operator imports through Textile's
ordinary **Settings → Stories → Import Archive** path. Behold does not render,
summarize, or add causal claims to the histories. The authoritative Minecraft
server log remains a separate ecology source in the same v2 aftermath.

## Exercised evidence

The focused fixture passed four tests after a full TypeScript build. Its resume
case appended a later event to the original lifelong source and proved that
both the episode snapshot and combined Textile input retained their earlier
bytes. Typecheck and ESLint also passed.

The production preservation functions were then run, without modifying the
sources, against the two retained ordinary Oxford lives from
`oxford-living-lmstudio-v2`. They produced a 4,217,355-byte union with SHA-256
`79ebca9a6333d65b5c84da9e8bc101cbeb4d5fa8b2b53b29e056bb9a18735f42`
from source hashes
`34687920da622c7b3ca47f79f36e66449899284538f9d6790282b9a78ac86720`
and
`1f595baa9c1d9aee452f5d3d41c927d95e93f0d5d493367342e0fdf2e8fb0e7d`.

Textile's actual `projectRawLyncFile` adapter consumed that generated union:

- 83 source events;
- 81 readable resident turns and 2 structural roots;
- 0 unsupported events; and
- 0 nonconforming events.

No Minecraft server, resident controller, model runtime, or graphical client
was started for this exercise.

## Still open

The new v2 aftermath shape has fixture and retained-source evidence but has not
yet been emitted by a newly run ordinary `behold live` episode. It also does
not establish useful resident conduct, a persistent resident-authored world
consequence, independent witnessing, or native-human co-presence. The native
launcher exists and `behold live` prints the exact loopback endpoint, but the
foreground command still does not own an explicit native-human join treatment.
Those are separate acceptance conditions and remain open.
