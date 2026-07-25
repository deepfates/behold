---
id: beh-oxford-v3
status: open
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
  `oxford` / `oxford-v1`, schema version 3, portable release tree SHA-256
  `1cde506e1c2300db610d9111a8c36789eb970d8fc7a2e407403109d56167d48d`,
  world-tree SHA-256
  `4160ae7e5a9c787bf727051f58dd147d96f52db33ad2a8ce0a6c440457acb91a`,
  and world archive SHA-256
  `5d63e58f9dd6720560760c5be058270b7717f46424d31ed7818e681430af1a5b`.
- The report describes a disposable portable consumer proof; no stable Oxford
  release directory is presently discoverable under the mounted shared
  `.behold-artifacts` store. Admission must therefore take an explicit
  disposable/mounted release root and must not rewrite it, import source host
  paths, or assume checkout-relative artifact coordinates.

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
