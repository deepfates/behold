# Resident transcript

`behold.resident-continuous-transcript.v1` is the model-facing projection of one
resident's private life. It is not another memory store. Canonical Lync remains
the history and Minecraft remains the authority for bodily consequences.

For one resident charter `C`, committed private turns `T`, and the current
first-person experience `E`, the conversation is:

```text
C · experience(T1) · assistant(T1) · outcome(T1)
  · experience(T2) · assistant(T2) · outcome(T2)
  · ...
  · E
```

- `experience(Tn)` is the exact safe observation admitted for that turn.
- `assistant(Tn)` is the resident's own chosen action in the current canonical
  action-response syntax.
- `outcome(Tn)` is the Minecraft-authoritative terminal settlement.
- `E` contains every resident-perceivable event since the preceding boundary
  and a fresh current first-person view.

The transcript contains no broker admissions, intent-queue stages, provider
accounting, digests, selected anchors, inferred goals, or another resident's
private life. Successive requests share the preceding conversation as an exact
prefix. V1 does not fold or truncate a life that fits the configured and
verified model context; it must fail visibly at a real context boundary rather
than create an inaccessible middle.

Context admission is part of the treatment, not an adapter afterthought.
Resident-v3 OpenRouter sessions use route v5 to bind a declared provider/model
context window and count the complete UTF-8 request conservatively before
launch. LM Studio binds the exact loaded instance and now applies that model's
prompt template to the final OpenAI-compatible message body, counts the result
with the same loaded tokenizer, verifies the loaded context length, and reserves
the configured maximum output before sending the broker request. Camera input
is represented through LM Studio's own image-file placeholder in that template.
The admission and formatted-prompt digest are retained with the model-call
evidence. This follows LM Studio's documented procedure:
<https://lmstudio.ai/docs/typescript/tokenization>. It authorizes the complete
transcript or fails; it never grants permission to truncate.

The earlier UTF-8-byte upper bound was safe but materially premature. Against
the installed Qwen 3.6 35B-A3B 262,144-token instance, the complete stopped
Oxford camera lives through episode 000007 measured about 172,695 and 148,085
prompt tokens before the small current contract/view increment, despite their
canonical Lync files being 10 and 8.5 MiB. Those same mature lives therefore
still fit complete chronology; they should cross resident-v3 before an explicit
finite-context epoch is introduced.

Episode 000009 established the operational boundary that token capacity alone
does not express. The complete 148k–173k-token lives fit Qwen's 262,144-token
window, but four calls reached the 60-second upstream deadline and five more
were cancelled by newer bodily evidence or shutdown before any choice could
commit. Exact chronology remained physically admissible and was nevertheless
unusable at Minecraft time.

## Explicit finite context

`resident-v4` introduces `behold.resident-context-epoch.v1`. Adopting that
treatment is itself an explicit boundary: the resident is told that the life
before the boundary remains complete canonical private history, receives the
exact archived turn and Lync chain digest, and begins a new active inference
epoch. Nothing is silently selected, summarized, or described as forgotten.
The boundary contains only immutable identity; the active chronological turns
that follow it show how far the epoch has grown. Rebuilding after stop/resume
therefore produces the same boundary bytes from the first canonical
`resident-v4` turn and its predecessor.

The current resident-v4 treatment carries at most eight prior turns in an
active request. At a boundary, the last archived turn remains once as an exact
causal handoff so the resident cannot lose the choice and outcome immediately
preceding its next decision. The handoff is explicitly named in the boundary;
the remaining active suffix grows behind it. Boundaries therefore change
before the next model request and reconstruct identically after restart rather
than rewriting which context a committed choice appeared to use.

The eight-turn ceiling is an empirical runtime constraint, not a claim about
cognition in general. A no-world sweep using the retained mature Sedge text
trajectory and the installed Qwen 3.6 35B-A3B 4-bit LM Studio runtime measured:

| Complete active epoch | Exact prompt tokens | Local response latency |
| --------------------: | ------------------: | ---------------------: |
|               8 turns |               8,499 |                 6.07 s |
|              16 turns |              14,354 |                11.88 s |
|              24 turns |              20,860 |                18.56 s |
|              32 turns |              30,088 |                23.89 s |

The empty transition request was 1,830 tokens and returned in 2.38 seconds.
This probe omitted the retained camera image, so actual camera-bound latency
still belongs to live acceptance; eight turns leaves room beneath the
15-second urgent horizon rather than pretending the table proves that path.

Archived history is available through the resident-owned cognitive action
`read_private_life(startSequence, endSequence)`. It accepts no entity, path,
Loom, or tip supplied by the model. The already-open EntityLoom resolves an
inclusive range against its selected private tip and returns only complete
canonical turns, with exact source bindings and a visible `nextSequence`. The
controller projects whole turns through the same resident-safe transcript
boundary until the final message array reaches its 128,000-byte cap. The
internal raw Lync scan has a separate eight-megabyte safety bound and is never
sent to the model. Resident-v4 admission checks every historical turn, and
commit checks every new turn, against both the raw-source and projected-turn
bounds. An inaccessible canonical turn therefore fails the treatment visibly
instead of entering a life that its resident can never read.

The resident receives the exact projected page immediately. Its canonical
turn records the requested and returned ranges, every source chain binding,
the projected byte and message counts, and the content digest—not another
recursive copy of old messages. While that turn remains in the active epoch,
restart reconstructs the exact page from those authenticated sources and
verifies the digest before a model call. If the resident later recalls the act
of recall, it receives this lossless source reference and can follow the
original ranges instead of accumulating nested copies of copied history. That
is lived, navigable recall without a second memory store or curator summary.

In the earlier no-world transition probe Qwen independently selected
`read_private_life(1, 163)`. Under the then-48,000-byte source-page treatment,
the real Sedge reader returned turns 1–2 (46,449 bytes) and continuation 3. The
current treatment separates raw source scanning from the larger final
resident-visible page; its deployment-shaped latency and continuation remain
part of live acceptance. Whether a resident follows continuation or uses
recalled experience well is conduct.

## Grounded failure specimen

Oxford V4 episode `000001`, Rowan request at
`2026-08-02T01:39:06.000Z`, is the design counterexample. The retained request
body was 29,432 bytes and contained five reconstructed messages: a charter, an
action-contract system message, a selected fold through turn 38, factual
continuity for turns 42–44, and the current world observation. It explicitly
said turns 39–41 were not represented and gave Rowan no way to read canonical
Lync. It contained no chronological assistant/outcome messages from Rowan's
own prior calls.

The same boundary also accumulated raw events 311–341. One request represented
events only through 330 and caught up on the following request. Continuous
transcript work must preserve both dimensions of continuity: the committed
private life before the call and the complete perceptual interval at its tail.

Projecting Rowan's canonical stopped life with v1 produces 156 chronological
messages from all 52 turns (178,916 JSON bytes). Turns 39–41 are ordinary
experience/assistant/outcome triples rather than an absent middle. Turn 44's
admitted observation begins at event 310 and its authenticated next observation
ends at 341; turn 45 begins at 341 and continues through 347. The current view
is appended only after those committed turns.

## Inclusion boundary

The projection includes the safe `observationPresentation.observation`, the
resident's exact admitted response when Lync retained it (or a canonical action
reconstruction for older lives whose adapter discarded those bytes), and the
typed Minecraft terminal. It retains chats, bodily state, visible changes, and
other events already admitted to that resident.

It excludes the private controller frame, raw provider accounting, request
admission and scheduler state, intent plumbing, fold records, inferred goals,
and another entity's private turns. Non-model controls are described as lived
facts; their private input is replayed only when resident visibility rules allow
it. These exclusions remove implementation authority the resident never had,
not world experience it could perceive.
