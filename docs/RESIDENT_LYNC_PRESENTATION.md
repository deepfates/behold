# Resident Lync presentation contract

Status: Behold-owned domain and storage-boundary contract. It does not
authorize a generic renderer to infer meaning from unknown JSON.

## Source and non-mutation boundary

The exact two-event Oxford fixture is
[`tests/fixtures/oxford-aster-human-semantic-v1.lync`](../tests/fixtures/oxford-aster-human-semantic-v1.lync).
It is the unchanged root plus first turn from OxfordAster's retained
provider-free Oxford V3 run. The fixture is the smallest causally closed slice:
the turn keeps its real parent, author, resident, circle, release, profile, and
observation identities. Its SHA-256 is
`f254829584b7597ab1e09e88e840be4efff631ee84ee7a595c4ee44cba069305`.

A presenter MUST keep the stored event bytes and full-tree source export
unchanged. Presentation is a derived view. Every derived section MUST retain
the source event `id`, `parents`, `author`, `kind`, and one or more exact JSON
source paths. Presentation MUST NOT rewrite, replace, append to, or repair the
source loom.

For new model turns using `minecraft-human-semantic-v1`, the public
`observation` and `nextObservation` paths are the exact versioned semantic
projections prepared at the admitted request and authenticated terminal frame.
The private controller frames remain unchanged under
`privateCausalFrames` (`behold.entity-turn-private-causal-frames.v1`). An
`observationBinding` (`behold.entity-turn-observation-binding.v1`) hashes both
representations and binds them to the turn/entity/circle, body/action profiles,
experiment release, and complete admitted resident-mind request hash. Behold
verifies this binding before restoring private frames for replay or evaluation.
Textile continues to read only the public allowlisted paths and must not recurse
into `privateCausalFrames`.

Older retained lives are not silently rewritten. A legacy turn that stores a
raw `behold.inhabitant.v2` frame on the public path remains exact source
evidence and receives Textile's named unsupported-observation diagnostic until
an explicitly derived, non-mutating projection is requested.

## Dispatch boundary

Behold resident presentation is admitted only when both conditions hold:

1. The root is `kind: "lync/loom"` with
   `payload.meta.protocol: "behold.entity-loom.v1"` and a supported exact
   profile: `org.behold.inhabitant.v1` for retained lives or the additive
   `org.behold.inhabitant.v2` for new lives.
2. A child is `kind: "lync/turn"` with
   `payload.meta.protocol: "behold.entity-turn-link.v1"` and
   `payload.payload.protocol: "behold.entity-turn.v1"`.

`payload.payload.profiles.body` and `.actions` select the versioned domain
allowlist below. An unsupported or missing profile is a named diagnostic, not a
reason to inspect arbitrary nested strings. Unknown top-level kinds and
unknown Behold protocols likewise remain accounted for and unpresented.

## Derived view shape

The transport-neutral result is conceptually:

```ts
type ResidentPresentation = {
  protocol:
    'org.behold.presentation.inhabitant-turn.v1' | 'org.behold.presentation.inhabitant-turn.v2';
  source: {
    id: string;
    parents: string[];
    author: { actor: string; via?: string };
    kind: 'lync/turn';
  };
  structure: {
    entityId: string;
    circleId: string;
    sequence: number;
    model: string;
    profiles: { policy: string; body: string; actions: string; safety: string };
    releaseId?: string;
    releaseDigest?: string;
    startedAt?: number;
    completedAt?: number;
  };
  sections: Array<{
    role: 'perception' | 'utterance' | 'action' | 'outcome';
    text: string;
    sourcePaths: string[];
  }>;
  diagnostics: Array<{ code: string; sourcePath: string }>;
};
```

Textile may choose its own internal type names. The semantic requirements are
the source references, explicit section roles, and named diagnostics. Source
identity and experiment structure are metadata; they are not invented story
prose.

## Safe fields for `minecraft-human-semantic-v1`

Only the following fields are useful and safe to turn into resident-facing
prose for the exact body/action profile pair
`minecraft-human-semantic-v1`:

- `observation` and `nextObservation`, but only when their protocol is
  `behold.minecraft-human-semantic-observation.v1` and their body contract
  repeats the same profile. Present HUD-equivalent condition and inventory;
  player-list/chat/event information; visible entity kind, display name,
  proximity, relative direction, and visibility; focus; and the egocentric
  visual field's material/depth labels. Prefer semantic labels such as
  `nearby` over incidental numeric estimates.
- `utterance.assistant.content`, only when it is a nonempty string. This is the
  resident's public/visible utterance. Absence is not an error and must not be
  filled from another field.
- `action.name`, the versioned semantic `action.input`, `action.source`, and
  `action.kind`. Showing `source: script` in the Oxford fixture is important:
  it prevents scripted mechanics from being narrated as autonomous model
  behavior. Inputs may be rendered only through the action profile's known
  action-specific presenter, never by dumping arbitrary JSON.
- `outcome.ok` and `outcome.eventType`, plus action-specific result fields that
  the same versioned action presenter explicitly recognizes. Failure and
  rejection wording must remain distinct. Unknown result fields are retained
  in source export and diagnosed, not displayed by recursive discovery.

The structure block may expose the envelope identities; loom
`entityId`/`circleId`; turn `sequence`, `model`, `profiles`, and timing; and the
release ID/digest and resident-observed order. These fields establish whose
life, world, configuration, and release the account belongs to.

The additive v2 presenter keeps that same boundary while accounting for the
ordinary resident vocabulary demonstrated after v1 was frozen: public chat and
whisper input/results; `sound_heard`, `sound_sequence_heard`, and `time_passed`;
and action-specific bodily results and safe observed block changes. It may show
the semantic verb, material before/after, success or failure, and named
Minecraft confirmation source. It still withholds absolute positions, private
controller frames, provider material, and unrecognized nested fields. A new
profile extends presentation; it never relabels or regenerates a v1 life.

## Forbidden inference and private fields

The presenter MUST NOT:

- recurse through objects looking for `text`, `message`, or other plausible
  prose;
- render provider-private reasoning, reasoning details, raw model responses,
  request bodies, transport evidence, credentials, folds, controller state, or
  operator secrets;
- treat an older/non-human observation or action profile as safe merely
  because its shape resembles this one;
- expose absolute coordinates, hidden/stable target IDs, loaded geometry,
  navigation conclusions, injected projects/tasks/places, or evaluation state;
- collapse scripted, model, operator, native-human, fold, fallback, retry,
  rejection, cancellation, or provider-failure provenance into one generic
  "resident did" sentence; or
- synthesize missing utterance, intent, causality, simultaneity, or success.

The source may contain safe causal evidence that is too verbose for ordinary
reading. Omission from the derived view is permitted only when the source path
remains exportable and the presenter accounts for unsupported recognized
fields through diagnostics.

## Fixture-specific expected reading

The Oxford fixture should read approximately:

> OxfordAster saw Birch nearby and terrain including glass, polished andesite,
> and stone bricks. [script] OxfordAster looked left. The body confirmed a
> successful turn to face east. Birch then left the current view.

This is illustrative wording, not a canonical transcript. It must not say that
a model chose the action, that both residents acted simultaneously, or that a
world-space route/position was known. The exact source remains available beside
the readable projection.
