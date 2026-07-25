---
id: beh-oxford-v3
status: closed
deps: []
links: [beh-n4fe]
created: 2026-07-25T22:30:00Z
type: task
priority: 0
assignee: deepfates
tags: [place-compiler, admission, privacy, oxford]
---

# Admit the privacy-safe Place release contract without weakening it

Upgrade Behold's independently owned Place admission adapter to consume the
current privacy-safe schema-v3 release contract. Keep schema-v2 inspection and
admission explicitly legacy and ineligible for a privacy-safe pilot; do not
fall back to it merely because `scripts/place-epoch.ts` currently requires
`schemaVersion === 2`.

## Upstream dependency reference

- Place Compiler repository revision: `81fd4f4` (the V3 privacy contract was
  introduced by `baab3fd`, its URL/path distinction corrected by `b955693`, and
  the portable Minecraft 1.21.4 entry proof completed by `81fd4f4`).
- Canonical schema/verifier: Place Compiler
  `scripts/place-compiler/verify-release.mjs` and
  `scripts/place-compiler/release-core.mjs` at `81fd4f4`.
- Oxford evidence reference:
  `docs/reports/2026-07-25-portable-oxford-entry.md` at `81fd4f4`, place/run
  `oxford` / `oxford-v1`, schema version 3, artifact-preservation tree SHA-256
  `1cde506e1c2300db610d9111a8c36789eb970d8fc7a2e407403109d56167d48d`,
  world-tree SHA-256
  `4160ae7e5a9c787bf727051f58dd147d96f52db33ad2a8ce0a6c440457acb91a`,
  and world archive SHA-256
  `5d63e58f9dd6720560760c5be058270b7717f46424d31ed7818e681430af1a5b`.
- Stable read-only preservation (ignored workshop data):
  `/Users/deepfates/Hacking/data/artifacts/place-compiler/oxford-v3-81fd4f4/oxford-v1-portable`,
  with sidecar `../preservation.json`. Place Compiler verified the source,
  same-filesystem staging copy, and atomically renamed destination as
  `VERIFIED-PORTABLE`; the complete source/destination artifact trees match.
  Admission must take the mounted root explicitly and must not rewrite it,
  import its source host paths, or assume checkout-relative coordinates.

## Acceptance Criteria

Coordinate with the canonical Place verifier rather than implementing an
approximate second V3 parser. Validate the V3 manifest, exact checksum/archive
closure, nested path privacy, logical/redacted provenance, recipe/tool/input/
generator/world identities, and current-release privacy eligibility before
materializing a Behold epoch. Preserve the upstream release identity and
digests in Behold's admitted descriptor, world epoch, and history. Prove from a
disposable or mounted exact Oxford release that neither its files nor its path
coordinates are rewritten or imported. Prove legacy V2 remains separately
identified and cannot satisfy the privacy-safe pilot gate.

This ticket is a required technical integration for an Oxford-backed pilot. It
does not accept Oxford world quality, rename Place Compiler, authorize
publication, or close `beh-n4fe`.

## 2026-07-25 adapter checkpoint

The thin adapter now invokes the exact canonical verifier from Place Compiler
`81fd4f49de5306ed8fc79cd6561d8577056437e2`, rejects unavailable, changed, or
other-revision verifier checkouts, and records the canonical `verified` status,
privacy eligibility, disclosure count, and logical release identities. The
six-file aggregate is retained only as artifact-preservation evidence. New V2
admissions require the explicit `legacy-v2-integrity-only` contract and remain
privacy-ineligible.

The opt-in focused test consumed the stable read-only Oxford artifact, extracted
and materialized the `living` profile into disposable Behold state, re-snapshotted
the source before epoch creation, rejected every mounted/source coordinate from
the descriptor, and independently verified the admitted epoch. It first caught
and corrected a Behold type-domain error that treated the 40-character verifier
Git revision as a 64-character content digest. The unchanged rerun passed with:

- release identity SHA-256:
  `01c06fd10aa60c42ee691ab2562810a3ff79bd21f9fd0475aefba2995e842166`;
- epoch/world identity SHA-256:
  `b5899b49cfb2cfa38f3b4e1dbb039bba9e375db13e0c3df4fe3f56b67c2a6d60`;
- derived source tree SHA-256:
  `9806a3a5f1842240fad31a7748d683e1fb80b6ca751dce54cb7efc971a7d3c4b`;
- derived baseline tree SHA-256:
  `0dabff7dbb785fd16a35d114e564c6b3a0c5a22a491e462fdc9f3f9454baff2f`.

The adapter acceptance criteria are exercised. This ticket remains open only
until the separately requested provider-free real Minecraft start/stop proves
that Lync history uses this content-bound world identity across the server and
resident boundary.

## 2026-07-25 live boundary checkpoint

The remaining condition is now exercised. A fresh derived Oxford runtime ran
Minecraft 1.21.4 with two scripted Mineflayer residents behind the all-ready
barrier and `minecraft-human-semantic-v1`. Each resident retained four
authenticated turns (`look_direction`, `move_controls`, `chat`, and
`wait_for_event`) under the exact content-bound Oxford circle and one durable
release epoch. Both observed the other's public chat; all six physical/chat
actions succeeded. Broker, capture, quota, token, and cost evidence remained
zero. Both controllers and the server exited with code 0, control was released,
and the preserved V3 artifact re-snapshotted unchanged.

The full identities, observations, retained harness failures, and evidence
paths are in
`docs/reports/2026-07-25-oxford-v3-provider-free-live.md`. This closes only the
V3 admission adapter and real server/resident boundary. It does not close
`beh-n4fe`, authorize a provider pilot, or accept the owner watch/read product
experience.
