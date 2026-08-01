---
id: beh-13z3
status: closed
deps: []
links: []
created: 2026-08-01T01:58:02Z
type: bug
priority: 0
assignee: deepfates
parent: beh-n4fe
tags: [lync, durability, reproducibility]
---

# Pin the repaired Lync runtime reproducibly

Behold's green checks and retained Iris/Moss lives currently use a manually installed @deepfates/lync 0.4.0 candidate, while package.json/package-lock still resolve ^0.3.0 / registry 0.3.0. npm ls marks the actual install invalid, and a fresh install would restore the older line with reproduced file-log durability defects. Bind the verified clean Lync 0.4.0 candidate through a portable local release-candidate artifact without publishing or machine-local paths.

## Acceptance Criteria

package.json and package-lock identify one portable exact Lync 0.4.0 artifact from clean owning revision cb4f45f; a fresh npm ci installs it with npm ls clean; Lync verify and Behold full check pass; current canonical Iris/Moss bytes remain unchanged; README/ROADMAP/beh-n4fe state the temporary local RC boundary and do not imply publication.

## Notes

**2026-08-01T02:00:44Z**

Reproduced the mismatch: npm ls marked manually installed Lync 0.4.0 invalid while package-lock selected registry 0.3.0. Verified clean owning Lync revision cb4f45f with pnpm verify (163 tests, typecheck, examples). Two independent npm pack runs produced identical 142,927-byte SHA-256 5768e1c8df7084b54b5f1a01eb9ca2208ab5bdcb99e800abddfc9c98ef8d1316. Behold now tracks that immutable tarball, package.json/package-lock resolve it through file:vendor/deepfates-lync-0.4.0.tgz with npm integrity sha512-1SO4cNAW3A0QXIstQ96Qai3Rq7XFnrT6bEMGHcTC1iCpGc46hHEn1EG+RdNbUoTM4P+fBBHhHg7G9E9Tb6r7Cw==, and npm ci plus npm ls succeeds from the canonical lock. Full Behold check passed 607 tests with one environment skip and zero failures after the clean install. Current Iris/Moss canonical hashes remained f5643a...b6b2 / 5de8cb...573. README, ROADMAP, and vendor provenance now state the temporary non-published boundary.
