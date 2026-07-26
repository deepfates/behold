# Native-human ordinary live entry

Date: 2026-07-26

## Intended treatment

The living-world endpoint includes a human who can join the same running
Oxford Minecraft ecology through the ordinary native client. A loopback
endpoint alone is a mechanism, not evidence that co-presence happened. At the
same time, Behold must not infer that every unmanaged Minecraft connection is a
human or silently classify operator intervention as resident conduct.

## Implemented boundary

`behold live` now accepts `--native-player USERNAME`. This is an explicit
operator declaration that one safe offline Minecraft username identifies the
native-human treatment. It must not collide, case-insensitively, with any
managed resident body.

After all residents are ready, the foreground entry prints the exact
`NATIVE_MC_SERVER` and `NATIVE_MC_USERNAME` settings and the existing
`npm run native` launcher. It does not open a graphical client without that
human action.

At clean stop, the treatment is accepted only when both are true:

1. the byte-preserved Place-owned Minecraft server log records the declared
   player joining; and
2. every independently journaled resident records its own
   `behold.external-player-intervention.v1` joined event for that player after
   experiment release.

The aftermath stores the operator declaration, endpoint and launcher settings,
server-log line references, per-resident journal event references, named
assertions, and the resulting assessment under
`behold.live-native-human.v1`. Raw resident events keep their conservative
`native_human_or_unmanaged_player` classification. The operator declaration is
the only reason the treatment-level record says native human.

If the declared player is not authoritatively joined and witnessed by every
resident, `behold live` still saves/stops the world and writes the complete
aftermath, then exits nonzero with that aftermath path. It does not fabricate
co-presence from a requested flag.

## Exercised and open

The focused fixture exercises the passing two-resident case, one missing
resident witness, authoritative server evidence without full witnessing, and
managed-body username collision. Build, focused tests, typecheck, ESLint, and
the ordinary `live --help` surface pass.

No graphical client, private account, Minecraft server, resident, or model was
started. Therefore the explicit treatment is implemented but has not yet been
exercised in a real Oxford episode. It also does not by itself establish
sustained resident conduct, meaningful interaction, or a persistent
resident-authored consequence. Those remain separate acceptance conditions.
