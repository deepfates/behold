---
id: beh-kogb
status: in_progress
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

**2026-08-01T11:32:00Z**

A current six-hour ordinary Qwen 3.6 camera run exposed a projection-only ethogram defect: perceived events were counted from the terminal nextObservation, which is retained for causal audit but is not shown to the resident in that turn. This made day-phase visibility depend on event timing and could count a terminal event before it became resident experience. The lens now counts only the safe observation that actually informed the model choice. Posthoc replay over the live OxfordAshCamera and OxfordReedCamera journals reconstructed exactly two admitted phase transitions for each resident (day→dusk and dusk→night), plus their admitted time pulses; raw model/Lync context was not duplicating the transitions. Focused lens tests pass 8/8 and the full suite passes 652 with one intentional skip. The live process remains on its previously loaded projection until its ordinary boundary; no resident, world, or Lync state was changed.

**2026-08-01T16:02:04Z**

2026-08-01 projection falsification: the current six-hour Qwen camera habitat exposed a distinction the existing lens hid. Both independent Prismarine viewer canvases on ports 3007/3008 rendered uniformly pale blue, while semantic observations described nearby structure and resident camera capture reported successful bound frames. A direct read of the latest cognition transport request start-00002301 / blob d513fb...bin confirmed its admitted 512x512 JPEG visibly contains nearby brick, stone, glass, leaves, and pavement. The resident perception path is therefore working; the lens incorrectly embedded an independent renderer as though it were the frame admitted to cognition. Reopened for the bounded projection-only repair on candidate branch agent/beh-kogb-admitted-frame. Scope: one process-memory latest admitted frame per camera resident, loopback read-only digest-locked projection, explicit binding/timing/staleness/unavailable truth, and a more legible causal presentation. No perception, prompt, model input, action, Minecraft, Lync, checkpoint, journal, provider, or live-world mutation. The separate 284 MB cognition transport retention observed around 4h07m is not part of this ticket.

**2026-08-01T16:03:57Z**

2026-08-01 candidate implementation complete on agent/beh-kogb-admitted-frame (based on integration/beh-resume-candidate daf1894). The resident policy now publishes a frame only after exact camera admission succeeds. Each owning resident viewer retains at most that one latest parsed frame in process memory and serves loopback metadata plus digest-locked image bytes; replacement makes the prior digest unavailable, and close releases the frame. The parent lens polls only this read-only projection, verifies exact entity/body/managed-run, digest path, observation, and capture timing binding, and exposes available/unavailable/stale age truth without copying image data into its JSON or any journal, checkpoint, episode, or Lync source. The UI no longer embeds the independent Prismarine canvas as resident POV; it renders the exact admitted image and labels its observation, capture interval, age, stale state, digest, binding, and renderer. The five raw JSON columns are replaced by compact canonical-field summaries with raw projected detail still available under disclosure controls. Semantic-only and legacy viewer sources remain supported and explicitly say camera not configured. Focused compiled tests passed 89/89. Final npm run check passed 672 tests with one intentional environment skip and no failures (673 total). Tests cover post-admission publication, no publication on failed capture/admission path, latest-only replacement, source binding, caller-input non-mutation, digest-locked bytes, unavailable/stale display state, and legacy source compatibility. Implemented and mechanically exercised only; an ordinary camera live/resume has not yet loaded this candidate, so beh-kogb remains in progress.
