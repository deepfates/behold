# Qwen Oxford live and resume treatment

Date: 2026-07-26

## Verdict

The exact installed `qwen/qwen3-vl-4b@4bit` artifact passed the narrow fresh-wire
schema and latency screen, but it did **not** pass the living-world treatment.
An ordinary two-resident Oxford episode exposed a real prefix-readiness defect.
After that defect was corrected, an ordinary resume restored both residents and
produced 27 validator-clean actions with zero reported reasoning. Every action
was nevertheless the same `look_direction` camera sweep. The residents never
moved, spoke, manipulated the world, or responded socially. Under concurrent
live use, 25 of those 27 decisions also exceeded five seconds.

This is a mechanically successful live/resume/view/Textile aftermath and a
negative resident treatment. Qwen is not admitted as evidence of sustained
adaptive conduct. The unchanged treatment was not run again for another
receipt.

## Intended endpoint and treatment boundary

The endpoint was two independently configured resident lives in one ordinary
`behold live` Oxford session, followed by a clean stop, exact-session resume,
read-only first-person views, and a Textile-readable aftermath. The treatment
used:

- Place release
  `data/artifacts/place-compiler/oxford-v3-81fd4f4/oxford-v1-portable`;
- persistent session `oxford-living-qwen-v1`;
- world identity
  `oxford-dfb965a77922731739103b6bfb3816764968bb5a8d9c320b9d4507a45cef7087`;
- resident identities `OxfordWillow` and `OxfordRowan`, with bodies `Willow`
  and `Rowan`;
- `legible-resident-v1`, `minecraft-human-semantic-v1` body and action
  profiles, and `vanilla-player-v1` safety;
- exact model `qwen/qwen3-vl-4b@4bit`, artifact tree
  `28f19c53f352d1ffd6238f93c1ba26f0df363e18a5e2aa05a70390842e65332c`,
  template
  `3636d0f0bd6bef02654cdffdc447b79cb2cef8ab02cc75267345946291a489e4`,
  LM Studio `0.4.12+1`, CLI `0b2a176`, and MLX engine
  `mlx-llm-mac-arm64-apple-metal-advsimd@1.10.1`;
- 4,000 ms decision ticks, parallel cognition limit two, 64 resident-decision
  attempts and eight loom folds per resident; and
- loopback-only local inference, no provider route, no download, no reported
  cost, and no native-player treatment.

The two episodes used the same release, population, session, stopped world,
bodies, and lifelong Lync files. Each episode received a fresh experiment
release and quota scope, as required by the live contract.

## Episode 000001: useful failure

Episode `000001` released under
`9895054c95101da5a77aeb164613da8a8830b539828fc8c028c543e5260f3765`.
Rowan completed 20 model turns and 20 actions. All 20 actions were exactly:

```text
look_direction {"horizontal":"around","vertical":"same"}
```

Rowan's action-call latency ranged from 2,994 to 4,940 ms and averaged
4,281.1 ms. All 20 responses had empty `reasoning_content` and reported zero
reasoning tokens.

Willow completed no model turn. Its setup readiness was established before
Rowan joined, when the human-semantic communication tool contract did not yet
contain the final roster. Once Rowan existed, the exact action contract had
changed. The then-current singleton readiness record correctly refused action
inference but could not establish a later deliberative contract. Willow
therefore recorded 11 `model_call_failed` events with the exact error:

```text
LM Studio resident action contract drifted after prefix readiness; refusing action inference
```

This was a product defect, not candidate behavior. The episode was preserved
instead of being discarded or relabeled as a clean two-resident run.

The aftermath's internal digest is
`0f0cedb83840aa17984105a8076e5dd1880e1ed5007a47c3c2331b94f2d801a4`;
the `aftermath.json` file SHA-256 is
`4ec80dc61a3f1a96269755f0ed6f9c5fe2c8f41941bd31203e6f28449ff2f217`.
Its episode-local Textile union is 1,007,656 bytes with SHA-256
`e13cee8173a6bb148d84ec861e4c9491f4899ac3def70845fc94722db5d6712f`.

## Corrected readiness boundary

LM Studio readiness is now retained by exact stable-prefix and action-contract
identity rather than as one permanent body-level record. An urgent request
with an unseen identity refuses without inference or in-horizon repair. A
deliberative request whose roster-sensitive contract changed may perform a new
authority-free readiness before requesting an action. Readiness still has no
action authority and cannot be reused as a resident decision.

Focused tests exercise both sides: urgent contract drift performs no inference,
while deliberative contract drift performs one new readiness followed by the
action with matching identity hashes. This correction is commit `38ea1f5`. The
post-resume full `npm test` run passed 563 tests, skipped the one explicitly
environment-dependent Oxford admission test, and had zero failures.

## Episode 000002: recovery without conduct

The exact same live command resumed episode `000002` under release
`c6204048e4dbc4eafc1d63489d9b97063d059558011211b0dd83c67451bf1be7`.
Rowan loaded 20 prior EntityTurns from its lifelong Lync. Willow correctly
loaded zero, because episode one had admitted no Willow action.

The corrected boundary recovered Willow: it performed a second, authority-free
readiness for the final roster-sensitive contract and then acted. Rowan's
already matching contract needed only its setup readiness. The complete
released behavior was:

| Resident | Completed model turns | Completed actions | Distinct actions |
| -------- | --------------------: | ----------------: | ---------------: |
| Rowan    |                    14 |                14 |                1 |
| Willow   |                    13 |                13 |                1 |

All 27 actions were the same `look_direction` call shown above. There was no
resident chat, movement, inventory use, digging, placement, or other public or
world-directed action. Although egocentric terrain changed as the camera
turned and ordinary Minecraft ecology continued, the resident records contain
no adaptive continuation or resident-authored world consequence.

The action-call timing was:

| Resident |  Minimum |   Maximum |       Mean |
| -------- | -------: | --------: | ---------: |
| Rowan    | 4,250 ms |  8,220 ms | 7,126.5 ms |
| Willow   | 7,014 ms | 12,582 ms | 8,133.1 ms |

All 27 exceeded the 4,000 ms decision cadence, and 25 exceeded the configured
5,000 ms urgent-decision timeout used as the bodily deadline elsewhere in the
runtime. These were deliberative turns, so the controller did not misreport
them as urgent deadline successes.

The broker admitted 32 physical requests: three prefix-readiness calls and 29
resident-decision calls. It completed the three readiness calls and 27 actions;
the final in-flight decision for each resident was cancelled during the clean
duration stop. Both resident accounts settled exactly 16 attempts with zero
unsettled work and zero reported cost. No action or readiness response contained
nonempty reasoning content or reported a reasoning token.

The aftermath's internal digest is
`f9ed5f0564ec18aa1ca11cd47f41667f4333dc3eb6955c70b6a1ac059f6018d6`;
the `aftermath.json` file SHA-256 is
`0ab2168377c6113ce363d156aa793ff2e6a2b0b49b9e29d44616cb3d82474dc3`.
The broker journal SHA-256 is
`a8a2e5bf288674bec4f196b280fd06dd1b5eb7f60b92ac7ae645f59e398312b9`.

## View and Textile aftermath

Both ordinary read-only first-person viewers came up at loopback ports 3007 and
3008 and were closed by the clean stop. Both aftermaths record
`authority: operator_only`, `state: closed`, and `nativeHuman: null`.

Episode `000002` preserved the cumulative resident lives into a 2,335,249-byte
ordered byte union with SHA-256
`4702754d51fd34744ceaddfb57217759f3b2fc1b28eefc14fce1fa306841228b`.
Textile's real, provider-free `projectRawLyncFile` application adapter consumed
both episode-local unions without rewriting them:

| Episode | Source events | Readable turns | Structural roots | Unsupported | Nonconforming |
| ------- | ------------: | -------------: | ---------------: | ----------: | ------------: |
| 000001  |            22 |             20 |                2 |           0 |             0 |
| 000002  |            49 |             47 |                2 |           0 |             0 |

The second projection is cumulative: 34 Rowan turns plus 13 Willow turns. The
actual presentation adapter was exercised non-mutatingly; no claim is made that
a person clicked through Textile's graphical reader.

At final inspection, the Minecraft server port and both viewer ports were
closed, `lms ps` reported no loaded models, and LM Studio's ordinary loopback
service remained available on port 1234. The episode-two ecology snapshot is
byte-preserved at SHA-256
`f5683be286c3fa236a83208905c9488f712bbe9994fb2caf3818e0494a7d0ac0`.

## Acceptance boundary and remaining unknowns

The implemented mechanics now support prefix preparation, roster-sensitive
refresh, two-body live operation, clean stop, exact resume continuity,
read-only viewing, immutable episode snapshots, quota settlement, and an
ordinary Textile projection. Those mechanics were actually exercised here.

They do not establish the intended product endpoint. No installed compact
candidate has demonstrated sustained adaptive Minecraft conduct,
consequence-sensitive continuation, resident-authored world change, or useful
cross-resident interaction. Qwen's shared live latency also failed to retain
the narrow fresh-wire timing under the real two-body workload. A camera-loop
breaker that selects another action would change the treatment and risks action
steering; it was not introduced to rescue this candidate. Native-human
co-presence remains an explicit owner-held treatment and was not attempted.

Finally, the runtime binds artifact, template, schema, context length, output
cap, temperature, and engine identity, but it still does not bind every model
default such as seed, top-p, top-k, min-p, or repetition controls. Those values
remain unmeasured here.
