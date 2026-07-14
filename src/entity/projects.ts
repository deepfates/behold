import type { EntityTurn } from './loom';

export const MANAGE_PROJECT_TOOL = 'manage_project';
export const RESIDENT_PROJECT_EVIDENCE_VALUES = [
  'world_change',
  'inventory_change',
  'crafted_item',
  'body_change',
  'place_reached',
  'time_elapsed',
  'social_event',
] as const;
// `space_enclosed` remains readable in immutable v1 histories and external
// evaluation evidence. It is not writable by a current resident because its
// only exact witness is a privileged loaded-block topology scan.
export const PROJECT_EVIDENCE_VALUES = [
  ...RESIDENT_PROJECT_EVIDENCE_VALUES,
  'space_enclosed',
] as const;
export type ProjectEvidence = (typeof PROJECT_EVIDENCE_VALUES)[number];
const ACTIVE_PROJECT_LIMIT = 1;
const LEGACY_REPLAY_LIMIT = 3;

export type InhabitantProject = {
  id: string;
  title: string;
  status: 'active_unfinished';
  nextStep: string;
  doneWhen: string | null;
  completionRequires: ProjectEvidence | null;
  needsDefinition: boolean;
  startedAtSequence: number;
  updatedAtSequence: number;
};

export type ProjectMemory = {
  snapshot: () => InhabitantProject[];
  propose: (input: unknown, observation?: any) => any;
  validate: (turn: EntityTurn) => void;
  record: (turn: EntityTurn) => void;
};

type ProjectChange =
  | {
      operation: 'start';
      id: string;
      title: string;
      nextStep: string;
      doneWhen?: string;
      evidence?: ProjectEvidence;
    }
  | {
      operation: 'update';
      id: string;
      title?: string;
      nextStep: string;
      doneWhen?: string;
      evidence?: ProjectEvidence;
    }
  | { operation: 'complete'; id: string }
  | { operation: 'abandon'; id: string };

/** A bounded projection rebuilt entirely from an inhabitant's own loom. */
export function createProjectMemory(entityId: string, history: EntityTurn[] = []): ProjectMemory {
  const active = new Map<string, InhabitantProject>();
  const turns = [...history];

  const snapshot = () =>
    [...active.values()]
      .map((project) => ({ ...project }))
      .sort((a, b) => a.startedAtSequence - b.startedAtSequence || a.id.localeCompare(b.id));

  const propose = (input: unknown, observation?: any) => {
    const parsed = parseChange(input, 'resident');
    if ('error' in parsed) return parsed;
    const issue = stateIssue(active, parsed.change, ACTIVE_PROJECT_LIMIT);
    if (issue) return { ok: false, ...issue, projects: snapshot() };
    const definition = definitionIssue(active, parsed.change);
    if (definition) return { ok: false, ...definition, projects: snapshot() };
    if (parsed.change.operation === 'complete' && !observation) {
      return {
        ok: false,
        error: 'project_completion_observation_required',
        project: { ...active.get(parsed.change.id) },
        projects: snapshot(),
      };
    }
    const evidence =
      parsed.change.operation === 'complete' && observation
        ? completionEvidence(active.get(parsed.change.id)!, turns, observation)
        : null;
    if (evidence && !evidence.satisfied) {
      return {
        ok: false,
        error: 'project_completion_unproven',
        expected: evidence.expected,
        observed: evidence.observed,
        project: { ...active.get(parsed.change.id) },
        projects: snapshot(),
      };
    }
    return {
      ok: true,
      operation: parsed.change.operation,
      project: preview(active, parsed.change),
      ...(evidence ? { evidence } : {}),
      ...(parsed.change.operation === 'complete'
        ? {
            conclusion: {
              authority: 'inhabitant',
              worldStateCertified: false,
              meaning:
                'The inhabitant concluded its commitment from its own post-start evidence; external evaluation may independently disagree.',
            },
          }
        : {}),
      persistence: 'own_entity_loom',
    };
  };

  const validate = (turn: EntityTurn) => {
    if (turn.entityId !== entityId) {
      throw new Error(`project memory expected ${entityId}, received ${turn.entityId}`);
    }
    if (turn.action.name !== MANAGE_PROJECT_TOOL || !turn.outcome.ok) return;
    const parsed = parseChange(turn.action.input, 'resident');
    if ('error' in parsed) throw new Error(`invalid committed project change: ${parsed.error}`);
    const issue = stateIssue(active, parsed.change, ACTIVE_PROJECT_LIMIT);
    if (issue) throw new Error(`invalid committed project change: ${issue.error}`);
    const definition = definitionIssue(active, parsed.change);
    if (definition) throw new Error(`invalid committed project change: ${definition.error}`);
    if (parsed.change.operation === 'complete') {
      const result = turn.outcome.result;
      if (
        result?.evidence?.satisfied !== true ||
        result?.conclusion?.authority !== 'inhabitant' ||
        result?.conclusion?.worldStateCertified !== false
      ) {
        throw new Error('invalid committed project change: project_completion_authority_required');
      }
    }
  };

  const record = (turn: EntityTurn) => {
    validate(turn);
    if (turn.action.name === MANAGE_PROJECT_TOOL && turn.outcome.ok) {
      const parsed = parseChange(turn.action.input, 'resident');
      if ('error' in parsed) throw new Error(parsed.error);
      apply(active, parsed.change, turn.sequence);
    }
    turns.push(turn);
  };

  // Older project turns predate doneWhen and evidence. Replay them faithfully,
  // then expose needsDefinition so the living controller can repair the
  // commitment with a new immutable turn rather than rewriting history.
  for (const turn of history) replay(turn);
  return { snapshot, propose, validate, record };

  function replay(turn: EntityTurn) {
    if (turn.entityId !== entityId) {
      throw new Error(`project memory expected ${entityId}, received ${turn.entityId}`);
    }
    if (turn.action.name !== MANAGE_PROJECT_TOOL || !turn.outcome.ok) return;
    const parsed = parseChange(turn.action.input, 'legacy');
    if ('error' in parsed) throw new Error(`invalid committed project change: ${parsed.error}`);
    const issue = stateIssue(active, parsed.change, LEGACY_REPLAY_LIMIT, true);
    if (issue) throw new Error(`invalid committed project change: ${issue.error}`);
    apply(active, parsed.change, turn.sequence);
  }
}

type CompletionEvidence = {
  satisfied: boolean;
  expected: ProjectEvidence;
  observed: string;
  witness?: any;
};

/**
 * A model may interpret a natural-language doneWhen, but it may not declare
 * completion without a corresponding Minecraft consequence after the project
 * began. This deliberately verifies the evidence channel, not arbitrary prose.
 */
function completionEvidence(
  project: InhabitantProject,
  turns: EntityTurn[],
  current: any,
): CompletionEvidence {
  const expected = project.completionRequires!;
  const start = turns.find((turn) => turn.sequence === project.startedAtSequence);
  const sinceAt = start?.completedAt ?? 0;
  const afterStart = turns.filter((turn) => turn.sequence > project.startedAtSequence);
  const baseline = start?.observation ?? null;
  const events = observedEvents(afterStart, current, sinceAt);
  const successful = afterStart.filter((turn) => turn.outcome.ok);

  if (expected === 'world_change') {
    const action = successful.find(
      (turn) => WORLD_MUTATION_TOOLS.has(String(turn.action.name)) && hasWorldMutationWitness(turn),
    );
    if (action) {
      return {
        satisfied: true,
        expected,
        observed: `verified ${action.action.name}`,
        witness: actionWitness(action),
      };
    }
    return missing(
      expected,
      'no successful own action with an independently witnessed block or container consequence',
    );
  }

  if (expected === 'space_enclosed') {
    const action = [...successful]
      .reverse()
      .find((turn) => turn.action.name === 'inspect_reachable_space');
    const result = action?.outcome.result as any;
    if (
      action &&
      result?.sealed === true &&
      result?.fullyCovered === true &&
      result?.sharedCapacity === true &&
      Number(result?.closableEntranceCount) >= 1
    ) {
      return {
        satisfied: true,
        expected,
        observed: `${result.reachableCellCount} reachable body cells are sealed, covered, and served by a closable entrance`,
        witness: actionWitness(action),
      };
    }
    return missing(
      expected,
      action
        ? `latest reachable-space inspection reported sealed=${String(result?.sealed)}, fullyCovered=${String(result?.fullyCovered)}, sharedCapacity=${String(result?.sharedCapacity)}, closableEntranceCount=${String(result?.closableEntranceCount)}`
        : 'no successful inspect_reachable_space action after the project began',
    );
  }

  if (expected === 'inventory_change') {
    const event = events.find((candidate) => candidate.type === 'inventory_changed');
    const changed = inventoryChanged(baseline?.self?.inventory, current?.self?.inventory);
    if (event || changed) {
      return {
        satisfied: true,
        expected,
        observed: event ? 'inventory_changed event' : 'inventory differs from project start',
        witness: event ?? {
          before: baseline?.self?.inventory ?? [],
          after: current?.self?.inventory ?? [],
        },
      };
    }
    return missing(expected, 'inventory still matches the project-start observation');
  }

  if (expected === 'crafted_item') {
    const action = successful.find((turn) => turn.action.name === 'craft_item');
    if (action) {
      return {
        satisfied: true,
        expected,
        observed: 'craft_item succeeded after the project began',
        witness: actionWitness(action),
      };
    }
    return missing(expected, 'no successful craft_item action after the project began');
  }

  if (expected === 'body_change') {
    const event = events.find((candidate) => BODY_EVENT_TYPES.has(String(candidate.type)));
    const changed = bodyChanged(baseline, current);
    if (event || changed) {
      return {
        satisfied: true,
        expected,
        observed: event ? String(event.type) : 'body condition differs from project start',
        witness: event ?? {
          before: baseline?.self?.condition ?? null,
          after: current?.self?.condition ?? null,
        },
      };
    }
    return missing(expected, 'no observed health, food, oxygen, sleep, or dimension change');
  }

  if (expected === 'place_reached') {
    const before = positionOf(baseline);
    const after = positionOf(current);
    const displacement = before && after ? distance(before, after) : 0;
    if (before && after && displacement >= 0.5) {
      return {
        satisfied: true,
        expected,
        observed: `body moved ${round(displacement)} blocks from the project-start position`,
        witness: { before, after, displacement: round(displacement) },
      };
    }
    return missing(
      expected,
      before && after
        ? `body moved only ${round(displacement)} blocks from the project-start position`
        : 'a project-start or current body position is unavailable',
    );
  }

  if (expected === 'time_elapsed') {
    return timeBoundaryEvidence(project, baseline, current, events, sinceAt);
  }

  const social = events.find((candidate) => SOCIAL_EVENT_TYPES.has(String(candidate.type)));
  if (social) {
    return {
      satisfied: true,
      expected,
      observed: String(social.type),
      witness: social,
    };
  }
  return missing(expected, 'no new player, chat, or nearby social event after the project began');
}

const WORLD_MUTATION_TOOLS = new Set([
  'dig_block',
  'place_against',
  'place_block',
  'toggle_block',
  'deposit_in_container',
  'withdraw_from_container',
]);

function hasWorldMutationWitness(turn: EntityTurn) {
  const result: any = turn.outcome.result;
  if (['dig_block', 'place_against', 'place_block'].includes(turn.action.name)) {
    return Boolean(
      Array.isArray(result?.changes) &&
      result.changes.some(
        (change: any) =>
          change?.verified === true && change?.confirmation?.source === 'mineflayer:blockUpdate',
      ),
    );
  }
  if (turn.action.name === 'toggle_block') {
    return result?.verified === true && result?.confirmation?.source === 'mineflayer:blockUpdate';
  }
  if (['deposit_in_container', 'withdraw_from_container'].includes(turn.action.name)) {
    const requested = Number(result?.requested);
    if (
      result?.confirmation !== 'mineflayer:container_inventory_delta' ||
      !Number.isFinite(requested) ||
      requested <= 0
    ) {
      return false;
    }
    return turn.action.name === 'deposit_in_container'
      ? result?.bodyRemoved === requested && result?.containerAdded === requested
      : result?.bodyAdded === requested && result?.containerRemoved === requested;
  }
  return false;
}

const BODY_EVENT_TYPES = new Set([
  'condition_changed',
  'self_hurt',
  'died',
  'fell_asleep',
  'woke_up',
  'dimension_changed',
]);

const SOCIAL_EVENT_TYPES = new Set([
  'chat_received',
  'entity_appeared_nearby',
  'entity_left_nearby',
  'nearby_player_collected_item',
  'nearby_player_equipment_changed',
]);

function observedEvents(turns: EntityTurn[], current: any, sinceAt: number) {
  const observations = turns.flatMap((turn) => [turn.observation, turn.nextObservation]);
  observations.push(current);
  const seen = new Set<string>();
  const result: any[] = [];
  for (const observation of observations) {
    for (const event of Array.isArray(observation?.events) ? observation.events : []) {
      if (Number(event?.at || 0) < sinceAt) continue;
      const key = `${event?.sequence ?? ''}:${event?.at ?? ''}:${event?.type ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(event);
    }
  }
  return result;
}

function inventoryChanged(before: any, after: any) {
  const normalized = (items: any) =>
    (Array.isArray(items) ? items : [])
      .map((item: any) => `${String(item?.name || '')}:${Number(item?.count || 0)}`)
      .sort()
      .join('|');
  return normalized(before) !== normalized(after);
}

function bodyChanged(before: any, after: any) {
  const left = before?.self?.condition;
  const right = after?.self?.condition;
  if (!left || !right) return false;
  return ['health', 'food', 'oxygen', 'dimension'].some((key) => left[key] !== right[key]);
}

function positionOf(observation: any) {
  const position = observation?.self?.pose?.position;
  if (![position?.x, position?.y, position?.z].every(Number.isFinite)) return null;
  return { x: Number(position.x), y: Number(position.y), z: Number(position.z) };
}

function distance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function actionWitness(turn: EntityTurn) {
  return {
    sequence: turn.sequence,
    action: turn.action.name,
    input: turn.action.input,
    result: turn.outcome.result,
    world: {
      circleId: turn.circleId ?? null,
      dimension:
        turn.nextObservation?.self?.condition?.dimension ??
        turn.observation?.self?.condition?.dimension ??
        null,
    },
  };
}

function missing(expected: ProjectEvidence, observed: string): CompletionEvidence {
  return { satisfied: false, expected, observed };
}

function timeBoundaryEvidence(
  project: InhabitantProject,
  baseline: any,
  current: any,
  events: any[],
  sinceAt: number,
): CompletionEvidence {
  const language = `${project.title} ${project.doneWhen || ''}`.toLowerCase();
  const phaseEvents = events.filter((event) => event.type === 'day_phase_changed');
  const wantsDay = /\b(?:dawn|daylight|sunrise|morning|midday)\b/.test(language);
  const wantsNight = /\b(?:sunset|dusk|nightfall|midnight)\b/.test(language);

  if (wantsDay) {
    const event = phaseEvents.find((candidate) =>
      /^(?:dawn|day)$/.test(String(candidate?.data?.current || '').toLowerCase()),
    );
    const crossed =
      baseline?.self?.condition?.isDay === false && current?.self?.condition?.isDay === true;
    if (event || crossed) {
      return {
        satisfied: true,
        expected: 'time_elapsed',
        observed: event
          ? `day phase changed to ${event.data.current}`
          : 'night crossed into daylight',
        witness: event ?? {
          beforeIsDay: false,
          afterIsDay: true,
        },
      };
    }
    return missing('time_elapsed', 'dawn/daylight has not been observed since the project began');
  }

  if (wantsNight) {
    const event = phaseEvents.find((candidate) =>
      /^(?:dusk|night)$/.test(String(candidate?.data?.current || '').toLowerCase()),
    );
    const crossed =
      baseline?.self?.condition?.isDay === true && current?.self?.condition?.isDay === false;
    if (event || crossed) {
      return {
        satisfied: true,
        expected: 'time_elapsed',
        observed: event ? `day phase changed to ${event.data.current}` : 'day crossed into night',
        witness: event ?? {
          beforeIsDay: true,
          afterIsDay: false,
        },
      };
    }
    return missing('time_elapsed', 'dusk/night has not been observed since the project began');
  }

  const durationMs = namedDurationMs(project.doneWhen || '');
  const elapsedMs = Math.max(0, Number(current?.observedAt || Date.now()) - sinceAt);
  if (durationMs != null && elapsedMs >= durationMs) {
    return {
      satisfied: true,
      expected: 'time_elapsed',
      observed: `${elapsedMs}ms elapsed after project start`,
      witness: {
        sinceAt,
        observedAt: current?.observedAt ?? null,
        elapsedMs,
        requiredMs: durationMs,
      },
    };
  }
  return missing(
    'time_elapsed',
    durationMs == null
      ? 'the named time boundary has not been observed'
      : `${elapsedMs}ms elapsed; ${durationMs}ms required`,
  );
}

function namedDurationMs(text: string) {
  const match = text.match(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(seconds?|minutes?|hours?)\b/i,
  );
  if (!match) return null;
  const words: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };
  const count = words[match[1].toLowerCase()] ?? Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = unit.startsWith('second')
    ? 1000
    : unit.startsWith('minute')
      ? 60_000
      : 3_600_000;
  return count * multiplier;
}

type ProjectParseMode = 'resident' | 'legacy';

function parseChange(
  input: any,
  mode: ProjectParseMode,
): { ok: true; change: ProjectChange } | { ok: false; error: string } {
  const operation = String(input?.operation || '').toLowerCase();
  const id = boundedText(input?.id, 48)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-');
  if (!id) return { ok: false, error: 'project_id_required' };
  if (operation === 'complete') return { ok: true, change: { operation, id } };
  if (operation === 'abandon') return { ok: true, change: { operation, id } };
  if (operation !== 'start' && operation !== 'update') {
    return { ok: false, error: 'invalid_project_operation' };
  }
  const evidence = parseEvidence(input?.evidence, mode);
  if ('error' in evidence) return evidence;
  const nextStep = boundedText(input?.nextStep, 200);
  if (!nextStep) return { ok: false, error: 'project_next_step_required' };
  if (operation === 'start') {
    const title = boundedText(input?.title, 120);
    if (!title) return { ok: false, error: 'project_title_required' };
    const doneWhen = boundedText(input?.doneWhen, 240);
    return {
      ok: true,
      change: {
        operation,
        id,
        title,
        nextStep,
        ...(doneWhen ? { doneWhen } : {}),
        ...(evidence.value ? { evidence: evidence.value } : {}),
      },
    };
  }
  const title = boundedText(input?.title, 120);
  const doneWhen = boundedText(input?.doneWhen, 240);
  return {
    ok: true,
    change: {
      operation,
      id,
      ...(title ? { title } : {}),
      nextStep,
      ...(doneWhen ? { doneWhen } : {}),
      ...(evidence.value ? { evidence: evidence.value } : {}),
    },
  };
}

function stateIssue(
  active: Map<string, InhabitantProject>,
  change: ProjectChange,
  limit: number,
  replay = false,
) {
  if (change.operation === 'start') {
    if (active.has(change.id)) return { error: 'project_already_active', id: change.id };
    if (active.size >= limit) return { error: 'active_project_limit_reached', limit };
    return null;
  }
  if (!active.has(change.id)) return { error: 'active_project_not_found', id: change.id };
  if (!replay && active.size > ACTIVE_PROJECT_LIMIT && change.operation === 'update') {
    return {
      error: 'resolve_project_overlap_first',
      activeProjectIds: [...active.keys()],
      allowedOperations: ['complete', 'abandon'],
    };
  }
  return null;
}

function definitionIssue(active: Map<string, InhabitantProject>, change: ProjectChange) {
  if (change.operation === 'start' && !change.doneWhen) {
    return { error: 'project_done_when_required' };
  }
  if (change.operation === 'start' && !change.evidence) {
    return { error: 'project_evidence_required' };
  }
  if (change.operation === 'update' && !change.doneWhen && !active.get(change.id)?.doneWhen) {
    return { error: 'project_done_when_required' };
  }
  if (
    change.operation === 'update' &&
    !change.evidence &&
    !active.get(change.id)?.completionRequires
  ) {
    return { error: 'project_evidence_required' };
  }
  if (change.operation === 'complete') {
    return active.get(change.id)?.needsDefinition
      ? { error: 'project_definition_repair_required' }
      : null;
  }
  if (change.operation === 'abandon') return null;
  const previous = active.get(change.id);
  return projectDefinitionIssue({
    title: change.operation === 'start' ? change.title : change.title || previous!.title,
    nextStep: change.nextStep,
    doneWhen: change.doneWhen || previous?.doneWhen || null,
    completionRequires: change.evidence || previous?.completionRequires || null,
  });
}

function preview(active: Map<string, InhabitantProject>, change: ProjectChange) {
  if (change.operation === 'complete' || change.operation === 'abandon') {
    return { ...active.get(change.id), status: change.operation };
  }
  if (change.operation === 'start') {
    return {
      id: change.id,
      title: change.title,
      status: 'active_unfinished',
      nextStep: change.nextStep,
      doneWhen: change.doneWhen,
      completionRequires: change.evidence,
      needsDefinition: false,
    };
  }
  const previous = active.get(change.id)!;
  return {
    id: change.id,
    title: change.title || previous.title,
    status: 'active_unfinished',
    nextStep: change.nextStep,
    doneWhen: change.doneWhen || previous.doneWhen,
    completionRequires: change.evidence || previous.completionRequires,
    needsDefinition: false,
  };
}

function apply(active: Map<string, InhabitantProject>, change: ProjectChange, sequence: number) {
  if (change.operation === 'complete' || change.operation === 'abandon') {
    active.delete(change.id);
    return;
  }
  const previous = active.get(change.id);
  const project: InhabitantProject = {
    id: change.id,
    title: change.operation === 'start' ? change.title : change.title || previous!.title,
    status: 'active_unfinished',
    nextStep: change.nextStep,
    doneWhen: change.doneWhen || previous?.doneWhen || null,
    completionRequires: change.evidence || previous?.completionRequires || null,
    needsDefinition: false,
    startedAtSequence: previous?.startedAtSequence ?? sequence,
    updatedAtSequence: sequence,
  };
  project.needsDefinition = projectDefinitionIssue(project) !== null;
  active.set(change.id, project);
}

function projectDefinitionIssue(
  project: Pick<InhabitantProject, 'title' | 'nextStep' | 'doneWhen' | 'completionRequires'>,
) {
  if (!project.doneWhen) return { error: 'project_done_when_required' };
  if (!project.completionRequires) return { error: 'project_evidence_required' };
  if (project.completionRequires === 'space_enclosed') {
    return { error: 'project_evidence_external_only' };
  }

  const language = `${project.title} ${project.nextStep} ${project.doneWhen}`.toLowerCase();
  const namesEnclosure = /\b(?:shelter|room|refuge|home)\b|\benclos(?:e|ing|ed|ure)\b/.test(
    language,
  );
  const changesEnclosure =
    /\b(?:build|building|construct|constructing|create|creating|make|making|establish|establishing|repair|repairing|finish|finishing|complete|completing|expand|expanding|improve|improving|enclose|enclosing|seal|sealing|roof|roofing|wall|walling)\b/.test(
      language,
    );
  if (namesEnclosure && changesEnclosure && project.completionRequires !== 'world_change') {
    return { error: 'project_construction_requires_world_change' };
  }
  if (/\bidle\b|\bkeep still\b|\bnothing (?:needs|left)\b|\bno immediate hazard\b/.test(language)) {
    return { error: 'project_must_name_a_future_change' };
  }
  if (
    /\bnew (?:concrete )?(?:task|instruction|assignment)\b|\bwait(?:ing)? (?:for|until).{0,40}\b(?:task|instruction|assignment)\b|\b(?:task|instruction|assignment) (?:arrives|appears|is assigned)\b/.test(
      language,
    )
  ) {
    return { error: 'project_cannot_wait_for_assignment' };
  }
  if (project.completionRequires === 'time_elapsed' && !hasConcreteTimeBoundary(project.doneWhen)) {
    return { error: 'project_time_boundary_required' };
  }
  if (
    /\b(?:identify|identified|decide|decided|choose|chosen)\b.{0,80}\b(?:next|target|what to do)\b|\bknow what to do next\b/i.test(
      project.doneWhen,
    )
  ) {
    return { error: 'project_outcome_must_be_a_durable_state' };
  }
  if (
    project.completionRequires === 'place_reached' &&
    !/\b(?:reach|reached|arrive|arrived|stand|standing|return|returned|travel|traveled|located at)\b/i.test(
      project.doneWhen,
    )
  ) {
    return { error: 'project_place_completion_must_name_arrival' };
  }
  return null;
}

function hasConcreteTimeBoundary(doneWhen: string) {
  return (
    /\b(?:dawn|daylight|sunrise|sunset|dusk|nightfall|morning|midday|midnight|day|night)\b/i.test(
      doneWhen,
    ) ||
    /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:seconds?|minutes?|hours?|ticks?|days?|nights?)\b/i.test(
      doneWhen,
    )
  );
}

function parseEvidence(
  value: unknown,
  mode: ProjectParseMode,
): { ok: true; value?: ProjectEvidence } | { ok: false; error: string } {
  const evidence = boundedText(value, 32).toLowerCase();
  if (!evidence) return { ok: true };
  if (!(PROJECT_EVIDENCE_VALUES as readonly string[]).includes(evidence)) {
    return { ok: false, error: 'invalid_project_evidence' };
  }
  if (mode === 'resident' && evidence === 'space_enclosed') {
    return { ok: false, error: 'project_evidence_external_only' };
  }
  return { ok: true, value: evidence as ProjectEvidence };
}

function boundedText(value: unknown, limit: number) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}
