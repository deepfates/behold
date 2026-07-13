---
id: beh-jzcv
status: closed
deps: [beh-p6ti]
links: []
created: 2026-07-13T22:02:30Z
type: feature
priority: 1
assignee: place-compiler
parent: beh-wx6g
---

# Run native Minecraft ecology soaks

Run bounded disposable living-profile clones with native time, weather, random ticks, spawning, crops, mobs, and villagers where present. Observe changes externally instead of implementing a parallel ecology.

## Acceptance

Both places complete a bounded soak with recorded starting artifact, server and profile version, duration or ticks, observed ecological changes, failures, and clean shutdown. Minecraft remains authoritative.

## Notes

**2026-07-13T22:29:51Z**

Starting bounded one-Minecraft-day native ecology soak on APFS-cloned living-profile runtimes; immutable accepted artifacts remain untouched.

**2026-07-13T22:48:05Z**

Completed canonical two-place native ecology run: .behold-artifacts/place-benchmarks/living-places-v1/ecology-two-place-v2. Both living-profile clones advanced >=24,014 ticks with doDaylightCycle/doWeatherCycle/doMobSpawning=true and randomTickSpeed=3, real entity turnover, immutable sources unlocked, and clean exit 0. SF: 19→78 entities, 70 hostile, 8 animals, 487 effective sprint TPS. Manhattan: 29→55 entities, 48 hostile, 3 animals, 422 TPS; observer died/respawned 17 times, mostly witch magic—a high-severity spawn habitability finding. Focused tests 8/8 pass.
