---
id: beh-9cu5
status: closed
deps: [beh-p6ti]
links: []
created: 2026-07-13T22:02:30Z
type: feature
priority: 1
assignee: place-compiler
parent: beh-wx6g
---

# Measure the runtime performance frontier

Sweep named view distance, simulation distance, chunk activity, and entity or load budgets on the available machine while recording tick, CPU, memory, and responsiveness evidence.

## Acceptance

Results identify stable and unstable operating points for cinematic, playable, and living profiles and publish smart defaults plus the hardware fingerprint and measurement method.

## Notes

**2026-07-13T22:48:05Z**

Starting real-server cinematic/playable/living performance matrix for both fixtures; 6000-tick sprints, two repetitions per profile, hardware/process evidence.

**2026-07-13T22:56:56Z**

Completed canonical matrix: .behold-artifacts/place-benchmarks/living-places-v1/performance-two-place-v1. 12/12 real-server cases (2 places × 3 named profiles × 2 reps) completed cleanly and above the 20 TPS stability floor. Median TPS SF: cinematic 2156, playable 466.5, living 463.5; Manhattan: 1940.5, 394.5, 418. Minimum realtime headroom 19.5×; max observed RSS 5.60 GB; startup medians 3.74–4.14s. No unstable named operating point was observed, so v1 establishes a lower bound rather than the ultimate concurrency boundary. Hardware/method/process samples and case digests recorded.
