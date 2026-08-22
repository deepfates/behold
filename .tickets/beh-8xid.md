---
id: beh-8xid
status: open
deps: []
links: []
created: 2026-08-22T14:56:48Z
type: task
priority: 0
assignee: deepfates
tags: [first-life, onboarding, distribution]
---

# Make first resident life reproducible from a clean checkout

Turn the real Behold kernel into one honest outsider-runnable First Life candidate: a person can take a clean checkout plus explicitly named external inputs, start one resident in a qualified Place, watch it, stop it, and resume the same world and life. This is a shareability milestone, not the multi-day habitat acceptance and not a promise to publish artifacts without owner direction.

## Design

Restore the repository gate first and classify failures at their owning boundary. Keep behold live and the exact installed Place Compiler seam; do not invent a scripted resident or weaken living qualification. Add the smallest tracked resident example and preflight/walkthrough that expose required provider, package, release, server, and clean-checkout identities. Exercise the path with retained evidence, then separate what a collaborator can reproduce from private workshop artifacts and owner-held publication decisions.

## Acceptance Criteria

The full repository check passes from a clean blessed Behold commit. A tracked one-resident configuration and compact clean-checkout walkthrough name every required external input and use an exact installed Place Compiler version/distribution identity. A preflight or equivalent early validation fails clearly before world authority when the package, release qualification, server jar, model/provider, or repository state is wrong. One bounded ordinary episode starts through behold live, exposes the lens, saves/stops cleanly, and resumes the same world, body, and private life; exact commands and nonclaims are retained. The docs do not call the private artifact publicly reproducible, do not claim provider-free cognition, and do not close beh-06av or beh-xzc6.

## Notes

**2026-08-22T14:57:53Z**

2026-08-22 first ratchet: the pre-existing full-check failure was a test/integration defect, not a lens product defect. The SSE test assumed one fetch reader chunk contained an entire initial habitat+residents snapshot; the server correctly writes two named SSE events and transport chunking is not an event boundary. The test now parses complete SSE frames and waits for the named residents event with the expected phase. Focused lens suite passes 4/4. Full repository check passes 738 tests with one intentional environment skip, plus typecheck and lint.
