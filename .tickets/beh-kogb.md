---
id: beh-kogb
status: closed
deps: []
links: []
created: 2026-08-01T09:35:31Z
type: feature
priority: 0
assignee: deepfates
parent: beh-06av
tags: [observability, ethogram, operator, live]
---

# Make sustained resident life legible to an operator

Give an operator a compact truthful view of a running habitat so they can understand and manage lives without reading giant event streams or steering conduct.

## Design

Project canonical Minecraft, controller, lifecycle, and Lync truth. Do not create another writable evidence store. Begin with questions an operator actually asks: who is present, what each body can perceive and do, when each mind decided, what it attempted, what Minecraft returned, what materially changed, whether history is advancing, and whether the runtime is healthy. Add an ethogram only as a provenance-preserving summary of observed action and consequence patterns, never a score or intention inference.

## Acceptance Criteria

During an ordinary long-running episode, one documented watch surface shows resident presence and body state, decision cadence and latency, last choice and exact terminal, recent material and social consequences, Lync tip progress, world and lifecycle health, and explicit missing or stale data. The operator can pause, resume, and stop through owned controls. Every detail links or traces to canonical source facts; restarting the view changes no resident, world, history, or evaluation state.

## Notes

**2026-08-01T09:38:45Z**

Selected as the first telos frontier because sustained operation is unsafe and scientifically opaque if an operator cannot tell whether bodies, decisions, consequences, histories, and lifecycle are advancing. First action is a read-only audit of the existing behold live output, causal lens/watch surfaces, episode records, Lync sources, and Textile projections against the ticket questions. Do not implement a dashboard or new store until that audit identifies the smallest missing view.

**2026-08-01T10:05:25Z**

Implemented the smallest missing management layer in commit 3ecb0fe: a disposable habitat projection over existing managed lifecycle and resident journals, an exact-count ethogram with no score or intention inference, Lync tip/staleness visibility, embedded POVs, and capability-authenticated loopback pause/resume/stop controls through already-owned runtime boundaries. Full check at that commit passed 651 tests with one intentional environment skip.

Ordinary exercise: session `oxford-living-resident-v2-gemma12-presenter-v2`, episode 000004, run `oxford-c7e...-3`, 2026-08-01T09:57:38Z–10:01:30Z. One Gemma 4 12B LM Studio weight instance served isolated OxfordElm/OxfordPine controllers and Lync lives. Pause was acknowledged by both controllers at 09:58:42.535Z and held until resume at 09:59:22.385Z. Each already-admitted decision settled authentically by 09:58:44.906Z; neither resident scheduled another decision or committed a turn during the remaining 37.479 seconds. Resume scheduled both within 12 ms and both continued. Lens stop requested `resident_lens_stop`; both controllers exited zero, Minecraft acknowledged `Saved the game`, terminal digest `783997263ea3ad3b178cfb47ca4adc80b8a098847c649c7a6f3d469af8a454e5` was recorded, control and listeners cleared, and the owned model unloaded. Posthoc lens replay found no lifecycle or journal gaps: Elm 13 decisions/12 turns, Pine 10 decisions/8 turns. This short episode had no verified material change and is not being stretched into behavioral evidence. Textile's real `projectRawLyncFile` read the exact 1,454,748-byte frozen union as 37 source events, 35 readable turns, and two structural roots with zero unsupported, nonconforming, or warning results.

Long-run replay: applying the same projection to ordinary 30.96-minute episode 000039 reconstructed a clean two-resident lifecycle; 173/169 scheduled decisions, 172/168 committed actions (340 total), 159/149 successful actions (308 total), and 1/3 Minecraft-verified digs, with no journal or lifecycle gaps. This establishes compatibility with retained long-run truth, not that the new watch/control surface was operated live for that entire run. Keep beh-kogb open until a genuinely long-running ordinary episode uses the surface live.

Falsification found and repaired one projection-only defect after the exercise: a terminal habitat said phase stopped while retaining the last cognition value running. The lens now derives cognition stopped from authoritative `run_stopped`; focused and complete compiled tests pass. Failed pre-authority attempt 000003 contains only a zero-byte Place control file and is not a completed episode.

**2026-08-01T11:06:19Z**

Episodes 000007-000008 exercised the current habitat lens through a 35-minute ordinary resident-v2 run and clean three-minute resume. The real browser rendered lifecycle, two resident causal stages, body state, decision cadence/latency, action terminals, Lync tips, ethograms, source freshness, and both POVs. Browser pause held Elm at 67 committed/68 scheduled and Pine at 37/37 for 30 seconds after in-flight settlement; browser resume immediately scheduled both. The long run reached 145/80 resident attempts with zero unsettled calls, 13 Minecraft-confirmed digs, no stale source, authenticated native-human presence, clean controller/model/listener shutdown, save acknowledgement, and terminal digest 27bc24486fc3194c345d22521d6d27cd84ecad3ca733e825829d7e79786c5c49. Textile read its 337-event frozen union as 335 readable events plus two roots with zero diagnostics. Episode 000008 reopened the same surface and stopped cleanly. The view remained a read-only projection; controls used the owned cognition and Place lifecycle. Acceptance met.
