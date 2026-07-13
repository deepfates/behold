import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import type { EngineOptions } from '../loop/engine';
import type { InhabitantObservation, TaskBrief } from '../agent/experience';
import type { CommandEffects } from '../agent/interpreter';
import { createWorldChangeAuthority, type WorldChangeGuard } from '../safety/world-change';

type EngineEvent = Parameters<NonNullable<EngineOptions['onEvent']>>[0];

export type ComeSeeDoReportProgress = {
  task: 'come-see-do-report';
  target: string;
  heardTarget: boolean;
  approachedTarget: boolean;
  closestVerifiedDistance: number | null;
  groundedReport: null | {
    text: string;
    evidence: string[];
    observationSequence: number;
    at: number;
  };
  explicitChangeRequest: null | { text: string; at: number };
  verifiedChanges: Array<{
    verb: string;
    position: { x: number; y: number; z: number };
    before: string | null;
    after: string | null;
    confirmationObservedAt: number;
    at: number;
    requestMatched: boolean;
    requestEvidence: string[];
    reference?: {
      position: { x: number; y: number; z: number };
      name: string | null;
    };
  }>;
  outcomeReported: boolean;
  outcomeReport: null | {
    text: string;
    evidence: string[];
    confirmationObservedAt: number;
    at: number;
  };
  safety: ReturnType<WorldChangeGuard['snapshot']>;
  success: boolean;
  missing: string[];
};

export type TaskActionAuthorization =
  | { ok: true }
  | {
      ok: false;
      error:
        | 'human_contact_required'
        | 'explicit_change_request_required'
        | 'ambiguous_change_request'
        | 'requested_action_mismatch'
        | 'requested_target_mismatch'
        | 'privileged_sensor_not_permitted'
        | 'command_effects_required'
        | 'block_mutation_not_permitted';
      reason: string;
    };

type RequestedChange = {
  text: string;
  kind: 'dig' | 'place' | 'either';
  targetEvidence: string[];
  effectEvidence: string[];
  coordinateRole: 'effect' | 'support';
};

type ChangeRequestClassification = {
  kind: RequestedChange['kind'];
  targetEvidence: string[];
  effectEvidence: string[];
  coordinateRole: 'effect' | 'support';
  specificTarget: boolean;
};

export function createComeSeeDoReportTask(target = 'importdf'): TaskBrief {
  return {
    id: 'come-see-do-report',
    goal: `Share the world with ${target}: listen to them, approach when asked, describe only grounded features of the shared scene, and perform at most one explicitly requested block change before reporting the outcome.`,
    successConditions: [
      `Hear and approach ${target} to conversational distance`,
      'Report at least one feature supported by the embodied observation',
      'Complete one explicitly requested block change and report its outcome',
    ],
    constraints: [
      `Wait for ${target} to speak before approaching or changing the world`,
      'Do not use survey_area unless the human explicitly permits privileged sensing',
      'Do not infer visual line of sight from proximity summaries',
      'Do not modify more than one block or modify outside eight blocks of the target',
      'Ask for clarification when the requested block or placement face is ambiguous',
    ],
    target,
  };
}

export function createComeSeeDoReportRuntime(bot: Bot, target = 'importdf') {
  const inspectBlock = (position: { x: number; y: number; z: number }) => {
    const block = (bot as any).blockAt?.(new Vec3(position.x, position.y, position.z));
    return block?.name == null ? null : String(block.name);
  };
  const worldChanges = createWorldChangeAuthority({
    budget: 1,
    radius: 8,
    anchor: () => targetPosition(bot, target),
  });
  const permissions = new ComeSeeDoReportPermissions(target, inspectBlock, () => {
    const held = (bot as any).heldItem;
    return held?.name == null ? null : String(held.name);
  });
  const verifier = new ComeSeeDoReportVerifier(target, worldChanges.guard, inspectBlock);
  return {
    task: createComeSeeDoReportTask(target),
    guard: worldChanges.guard,
    worldChangeExecutor: worldChanges.executor,
    permissions,
    verifier,
  };
}

/**
 * Deterministic task capabilities. This is part of the world boundary, not the
 * evaluator and not the resident's planner: it can deny an action, but it never
 * suggests one.
 */
export class ComeSeeDoReportPermissions {
  private heardTarget = false;
  private explicitChangeRequest: RequestedChange | null = null;
  private ambiguousChangeRequest: string | null = null;
  private privilegedSurveyAllowed = false;

  constructor(
    private readonly target: string,
    private readonly inspectBlock:
      | ((position: { x: number; y: number; z: number }) => string | null)
      | null = null,
    private readonly inspectHeldItem: (() => string | null) | null = null,
  ) {}

  recordIncomingChat(from: string, text: string) {
    if (from.toLowerCase() !== this.target.toLowerCase()) return;
    this.heardTarget = true;
    if (isChangeRevocation(text)) {
      this.explicitChangeRequest = null;
      this.ambiguousChangeRequest = null;
      return;
    }
    const requested = classifyRequestedChange(text);
    if (requested?.specificTarget) {
      this.explicitChangeRequest = {
        text,
        kind: requested.kind,
        targetEvidence: requested.targetEvidence,
        effectEvidence: requested.effectEvidence,
        coordinateRole: requested.coordinateRole,
      };
      this.ambiguousChangeRequest = null;
    } else if (requested) {
      this.explicitChangeRequest = null;
      this.ambiguousChangeRequest = text;
    }
    if (isExplicitSurveyPermission(text)) this.privilegedSurveyAllowed = true;
  }

  authorizeAction(
    tool: string,
    input: any,
    effects: CommandEffects | null | undefined,
  ): TaskActionAuthorization {
    if (!effects) {
      return {
        ok: false,
        error: 'command_effects_required',
        reason: `The task cannot authorize ${tool} without its declared world effects.`,
      };
    }
    const requestedMutationTools = ['dig_block', 'place_against', 'place_block'];
    if (effects.blockMutation && !requestedMutationTools.includes(tool)) {
      return {
        ok: false,
        error: 'block_mutation_not_permitted',
        reason: `${tool} can mutate blocks but is not one of this task's single-change affordances.`,
      };
    }
    if (['move_to', 'approach_entity', 'set_control'].includes(tool) && !this.heardTarget) {
      return {
        ok: false,
        error: 'human_contact_required',
        reason: `Wait until ${this.target} has spoken before moving to meet them.`,
      };
    }
    if (requestedMutationTools.includes(tool) && !this.explicitChangeRequest) {
      if (this.ambiguousChangeRequest) {
        return {
          ok: false,
          error: 'ambiguous_change_request',
          reason: `${this.target} requested a block change but did not identify a block or surface precisely enough. Ask for clarification.`,
        };
      }
      return {
        ok: false,
        error: 'explicit_change_request_required',
        reason: `Wait for an explicit block-change request from ${this.target}.`,
      };
    }
    if (tool === 'dig_block' && this.explicitChangeRequest?.kind === 'place') {
      return {
        ok: false,
        error: 'requested_action_mismatch',
        reason: `${this.target} requested a placement, not a dig action.`,
      };
    }
    if (
      ['place_against', 'place_block'].includes(tool) &&
      this.explicitChangeRequest?.kind === 'dig'
    ) {
      return {
        ok: false,
        error: 'requested_action_mismatch',
        reason: `${this.target} requested a dig action, not a placement.`,
      };
    }
    if (
      requestedMutationTools.includes(tool) &&
      this.explicitChangeRequest &&
      !proposedTargetMatches(
        tool,
        input,
        this.explicitChangeRequest,
        this.inspectBlock,
        this.inspectHeldItem,
      )
    ) {
      return {
        ok: false,
        error: 'requested_target_mismatch',
        reason: `The proposed block or supporting surface does not match ${this.target}'s latest request. Ask for clarification instead of changing another block.`,
      };
    }
    if (tool === 'survey_area' && !this.privilegedSurveyAllowed) {
      return {
        ok: false,
        error: 'privileged_sensor_not_permitted',
        reason: `survey_area is privileged and ${this.target} has not permitted it.`,
      };
    }
    return { ok: true };
  }

  snapshot() {
    return {
      heardTarget: this.heardTarget,
      explicitChangeRequest: this.explicitChangeRequest ? { ...this.explicitChangeRequest } : null,
      ambiguousChangeRequest: this.ambiguousChangeRequest,
      privilegedSurveyAllowed: this.privilegedSurveyAllowed,
    };
  }
}

export class ComeSeeDoReportVerifier {
  private heardTarget = false;
  private heardTargetAt: number | null = null;
  private approachedTarget = false;
  private closestVerifiedDistance: number | null = null;
  private groundedReport: ComeSeeDoReportProgress['groundedReport'] = null;
  private explicitChangeRequest: ComeSeeDoReportProgress['explicitChangeRequest'] = null;
  private approachedAt: number | null = null;
  private verifiedChanges: ComeSeeDoReportProgress['verifiedChanges'] = [];
  private outcomeReport: ComeSeeDoReportProgress['outcomeReport'] = null;
  private readonly recordedWorldOutcomes = new Set<string>();
  private readonly controllerObservations = new Map<string, InhabitantObservation>();
  private eventSourceBound: boolean;
  private acceptEngineEvent: (event: EngineEvent) => boolean;

  constructor(
    private readonly target: string,
    private readonly guard: WorldChangeGuard,
    private readonly inspectBlock:
      | ((position: { x: number; y: number; z: number }) => string | null)
      | null = null,
    acceptEngineEvent?: (event: EngineEvent) => boolean,
  ) {
    this.acceptEngineEvent = acceptEngineEvent ?? (() => false);
    this.eventSourceBound = acceptEngineEvent != null;
  }

  bindEngineEventSource(accept: (event: EngineEvent) => boolean) {
    if (this.eventSourceBound) throw new Error('Come–See–Do–Report event source already bound');
    this.acceptEngineEvent = accept;
    this.eventSourceBound = true;
  }

  recordIncomingChat(from: string, text: string, at = Date.now()) {
    if (from.toLowerCase() !== this.target.toLowerCase()) return;
    this.heardTarget = true;
    this.heardTargetAt = this.heardTargetAt == null ? at : Math.min(this.heardTargetAt, at);
    if (isChangeRevocation(text)) {
      if (this.verifiedChanges.length === 0) this.explicitChangeRequest = null;
      return;
    }
    if (isExplicitChangeRequest(text)) {
      this.explicitChangeRequest = { text, at };
    } else if (classifyRequestedChange(text) && this.verifiedChanges.length === 0) {
      this.explicitChangeRequest = null;
    }
  }

  recordControllerDecision(intent: any, observation: InhabitantObservation) {
    if (
      intent?.source !== 'llm' ||
      intent?.tool !== 'chat' ||
      !intent?.id ||
      Number(intent?.observationSequence) !== Number(observation?.sequence)
    ) {
      return;
    }
    this.controllerObservations.set(String(intent.id), structuredClone(observation));
  }

  recordEngineEvent(event: EngineEvent, observation: InhabitantObservation) {
    if (!this.acceptEngineEvent(event)) return;
    if (event.type !== 'action_completed') return;
    const intent = event.data?.intent;
    const authorization = event.data?.authorization;
    if (
      intent?.source !== 'llm' ||
      authorization?.ok !== true ||
      authorization?.authority !== 'come-see-do-report-task'
    ) {
      return;
    }
    const result = event.data?.result;
    if (intent?.tool === 'approach_entity') {
      const target = String(result?.target || intent?.input?.name || '').toLowerCase();
      const finalDistance = finiteOrNull(result?.finalDistance);
      const observedTarget = observation.scene.entities.find(
        (entity) => entity.name.toLowerCase() === this.target.toLowerCase(),
      );
      const observedDistance = finiteOrNull(observedTarget?.distance);
      if (
        target === this.target.toLowerCase() &&
        result?.status === 'arrived' &&
        this.heardTargetAt != null &&
        event.at >= this.heardTargetAt &&
        finalDistance != null &&
        observedDistance != null &&
        observedDistance <= 3.5
      ) {
        this.closestVerifiedDistance =
          this.closestVerifiedDistance == null
            ? observedDistance
            : Math.min(this.closestVerifiedDistance, observedDistance);
        if (finalDistance <= 3.5) {
          this.approachedTarget = true;
          this.approachedAt = event.at;
        }
      }
    }

    const worldVerb =
      intent?.tool === 'dig_block'
        ? 'dig'
        : ['place_against', 'place_block'].includes(intent?.tool)
          ? 'place'
          : null;
    const changes = worldVerb && Array.isArray(result?.changes) ? result.changes : [];
    for (const change of changes) {
      if (
        !change?.position ||
        change?.verified !== true ||
        change?.confirmation?.source !== 'mineflayer:blockUpdate'
      ) {
        continue;
      }
      const guarded = this.guard
        .snapshot()
        .changes.find(
          (candidate) =>
            candidate.verified === true &&
            candidate.status === 'verified' &&
            candidate.verb === worldVerb &&
            samePosition(candidate.position, change.position) &&
            (candidate.before ?? null) === (change.before ?? null) &&
            (candidate.after ?? null) === (change.after ?? null) &&
            candidate.evidence?.source === 'mineflayer:blockUpdate',
        );
      if (!guarded) continue;
      const outcomeKey = `${String(intent?.id || '')}:${worldVerb}:${change.position.x}:${change.position.y}:${change.position.z}`;
      if (this.recordedWorldOutcomes.has(outcomeKey)) continue;
      this.recordedWorldOutcomes.add(outcomeKey);
      this.verifiedChanges.push({
        verb: worldVerb,
        position: change.position,
        before: change.before ?? null,
        after: change.after ?? null,
        confirmationObservedAt: Number(change.confirmation.observedAt),
        at: event.at,
        ...(change?.context?.reference ? { reference: change.context.reference } : {}),
        ...requestMatch(this.explicitChangeRequest?.text || '', {
          verb: worldVerb,
          position: change.position,
          before: change.before ?? null,
          after: change.after ?? null,
          reference: change?.context?.reference,
        }),
      });
    }

    if (intent?.tool === 'chat') {
      const text = String(intent?.input?.text || '');
      const proposalObservation = this.controllerObservations.get(String(intent?.id || '')) ?? null;
      if (
        !this.groundedReport &&
        this.approachedAt != null &&
        event.at >= this.approachedAt &&
        this.verifiedChanges.length === 0 &&
        proposalObservation
      ) {
        const evidence = groundedEvidence(text, proposalObservation);
        if (evidence.length) {
          this.groundedReport = {
            text,
            evidence,
            observationSequence: proposalObservation.sequence,
            at: event.at,
          };
        }
      }
      const latestChange = this.verifiedChanges.at(-1);
      if (
        !this.outcomeReport &&
        latestChange &&
        event.at >= latestChange.at &&
        worldChangeStillPresent(latestChange, this.inspectBlock)
      ) {
        const evidence = outcomeEvidence(text, latestChange);
        if (evidence.length) {
          this.outcomeReport = {
            text,
            evidence,
            confirmationObservedAt: latestChange.confirmationObservedAt,
            at: event.at,
          };
        }
      }
      this.controllerObservations.delete(String(intent?.id || ''));
    }
  }

  snapshot(observation: InhabitantObservation): ComeSeeDoReportProgress {
    const target = observation.scene.entities.find(
      (entity) => entity.name.toLowerCase() === this.target.toLowerCase(),
    );
    if (target) {
      this.closestVerifiedDistance =
        this.closestVerifiedDistance == null
          ? target.distance
          : Math.min(this.closestVerifiedDistance, target.distance);
    }

    const missing: string[] = [];
    if (!this.heardTarget) missing.push(`hear ${this.target}`);
    if (!this.approachedTarget) missing.push(`approach ${this.target} within 3.5 blocks`);
    if (!this.groundedReport)
      missing.push('send a report grounded in current observed entities or materials');
    if (
      this.groundedReport &&
      (this.approachedAt == null || this.groundedReport.at < this.approachedAt)
    ) {
      missing.push('send the grounded report only after the verified approach');
    }
    if (!this.explicitChangeRequest)
      missing.push('receive an explicit block-change request from the target');
    if (this.verifiedChanges.length !== 1)
      missing.push('complete exactly one verified block change');
    if (this.verifiedChanges.some((change) => !change.requestMatched)) {
      missing.push('make the verified change match the human request');
    }
    if (
      this.verifiedChanges.some((change) => !worldChangeStillPresent(change, this.inspectBlock))
    ) {
      missing.push('keep the verified block change present through the report checkpoint');
    }
    if (
      this.verifiedChanges.some(
        (change) => !this.explicitChangeRequest || change.at < this.explicitChangeRequest.at,
      )
    ) {
      missing.push('perform the block change only after the explicit request');
    }
    const safety = this.guard.snapshot();
    if (safety.used !== 1 || safety.changes.filter((change) => change.verified).length !== 1) {
      missing.push('record exactly one safety-authorized, verified world change');
    }
    if (!this.outcomeReport)
      missing.push('report the verified block-change outcome with supporting detail');
    if (
      this.outcomeReport &&
      this.verifiedChanges.length > 0 &&
      this.outcomeReport.at < this.verifiedChanges.at(-1)!.at
    ) {
      missing.push('report the outcome only after the verified block change');
    }

    return {
      task: 'come-see-do-report',
      target: this.target,
      heardTarget: this.heardTarget,
      approachedTarget: this.approachedTarget,
      closestVerifiedDistance: this.closestVerifiedDistance,
      groundedReport: this.groundedReport,
      explicitChangeRequest: this.explicitChangeRequest,
      verifiedChanges: [...this.verifiedChanges],
      outcomeReported: this.outcomeReport != null,
      outcomeReport: this.outcomeReport,
      safety,
      success: missing.length === 0,
      missing,
    };
  }
}

export function groundedEvidence(text: string, observation: InhabitantObservation) {
  if (containsClaimNegation(text)) return [];
  const normalized = normalize(text);
  const candidates = new Set<string>();
  for (const entity of observation.scene.entities) candidates.add(entity.name);
  for (const material of observation.scene.terrain.materials) candidates.add(material.name);
  if (observation.scene.focus?.name) candidates.add(observation.scene.focus.name);
  return [...candidates]
    .map((candidate) => ({ candidate, phrase: normalize(candidate) }))
    .filter(
      ({ phrase }) =>
        phrase.length >= 3 &&
        normalized.includes(phrase) &&
        hasAffirmativeSceneClaim(normalized, phrase),
    )
    .map(({ candidate }) => candidate);
}

function isExplicitChangeRequest(text: string) {
  return classifyRequestedChange(text)?.specificTarget === true;
}

function classifyRequestedChange(text: string): ChangeRequestClassification | null {
  if (/\b(don't|do not|never|avoid|without)\b/i.test(text)) return null;
  const dig = /\b(dig|mine|break|remove)\b/i.test(text);
  const place = /\b(place|put|set|build|add|install)\b/i.test(text);
  if (!dig && !place) return null;
  const kind = dig && place ? 'either' : dig ? 'dig' : 'place';
  const targetEvidence: string[] = [];
  if (requestedCoordinates(text)) {
    targetEvidence.push('coordinates');
  }
  const targetMaterial = text.match(
    /\b(stone|dirt|wood|plank|brick|concrete|glass|sand|gravel|wool|wall|floor|ground|ceiling|roof|door|fence|sign|flower|tree|log|platform|stair|slab)\b/i,
  )?.[0];
  if (targetMaterial) targetEvidence.push(normalize(targetMaterial));
  if (dig) {
    const dugObject = text.match(/\b(lantern|torch)\b/i)?.[0];
    if (dugObject) targetEvidence.push(normalize(dugObject));
  }
  const effectEvidence = place
    ? [text.match(/\b(lantern|torch)\b/i)?.[0]]
        .filter((value): value is string => !!value)
        .map(normalize)
    : [];
  return {
    kind,
    targetEvidence: [...new Set(targetEvidence)],
    effectEvidence: [...new Set(effectEvidence)],
    coordinateRole: place && coordinatesDescribeSupport(text) ? 'support' : 'effect',
    specificTarget: targetEvidence.length > 0 && (!place || effectEvidence.length > 0),
  };
}

function isChangeRevocation(text: string) {
  const cancellation = /\b(never mind|nevermind|cancel|forget (?:it|that)|stop|no longer)\b/i.test(
    text,
  );
  const prohibitedChange =
    /\b(don't|do not|never|avoid|without)\b/i.test(text) &&
    /\b(dig|mine|break|remove|place|put|set|build|add|install|change|anything)\b/i.test(text);
  return cancellation || prohibitedChange;
}

function proposedTargetMatches(
  tool: string,
  input: any,
  request: RequestedChange,
  inspectBlock: ((position: { x: number; y: number; z: number }) => string | null) | null,
  inspectHeldItem: (() => string | null) | null,
) {
  const proposed = proposedWorldTarget(tool, input, inspectBlock);
  if (!proposed) return false;
  const coordinates = requestedCoordinates(request.text);
  if (coordinates) {
    const proposedPosition =
      request.coordinateRole === 'support' ? proposed.targetPosition : proposed.effectPosition;
    if (!proposedPosition || !samePosition(coordinates, proposedPosition)) return false;
  }
  const materialEvidence = request.targetEvidence.filter((value) => value !== 'coordinates');
  if (
    materialEvidence.length > 0 &&
    (!proposed.targetMaterial ||
      !materialEvidence.some((value) => canonicalMaterialMatches(proposed.targetMaterial!, value)))
  ) {
    return false;
  }
  if (['place_against', 'place_block'].includes(tool) && request.effectEvidence.length > 0) {
    const placedMaterial = String(input?.name || inspectHeldItem?.() || '');
    if (
      !placedMaterial ||
      !request.effectEvidence.some((value) => normalize(placedMaterial).includes(value))
    ) {
      return false;
    }
  }
  return coordinates != null || materialEvidence.length > 0;
}

function proposedWorldTarget(
  tool: string,
  input: any,
  inspectBlock: ((position: { x: number; y: number; z: number }) => string | null) | null,
) {
  if (tool === 'dig_block') {
    const targetPosition = finitePosition(input);
    if (!targetPosition) return null;
    return {
      effectPosition: targetPosition,
      targetPosition,
      targetMaterial: inspectBlock?.(targetPosition) ?? null,
    };
  }
  if (tool === 'place_block') {
    const effectPosition = finitePosition(input);
    if (!effectPosition) return null;
    return {
      effectPosition,
      targetPosition: null,
      targetMaterial: null,
    };
  }
  if (tool !== 'place_against') return null;
  const targetPosition = finitePosition(input?.on);
  if (!targetPosition) return null;
  const offsets: Record<string, { x: number; y: number; z: number }> = {
    top: { x: 0, y: 1, z: 0 },
    bottom: { x: 0, y: -1, z: 0 },
    north: { x: 0, y: 0, z: -1 },
    south: { x: 0, y: 0, z: 1 },
    east: { x: 1, y: 0, z: 0 },
    west: { x: -1, y: 0, z: 0 },
  };
  const offset = offsets[String(input?.face || 'top')] ?? offsets.top;
  return {
    effectPosition: {
      x: targetPosition.x + offset.x,
      y: targetPosition.y + offset.y,
      z: targetPosition.z + offset.z,
    },
    targetPosition,
    targetMaterial: inspectBlock?.(targetPosition) ?? null,
  };
}

function finitePosition(value: any) {
  const x = Number(value?.x);
  const y = Number(value?.y);
  const z = Number(value?.z);
  if (![x, y, z].every(Number.isFinite)) return null;
  return { x, y, z };
}

function requestMatch(
  text: string,
  change: {
    verb: 'dig' | 'place';
    position: { x: number; y: number; z: number };
    before: string | null;
    after: string | null;
    reference?: {
      position: { x: number; y: number; z: number };
      name: string | null;
    };
  },
) {
  const requested = classifyRequestedChange(text);
  const evidence: string[] = [];
  if (
    !requested?.specificTarget ||
    (requested.kind !== 'either' && requested.kind !== change.verb)
  ) {
    return { requestMatched: false, requestEvidence: evidence };
  }
  evidence.push(change.verb);
  const coordinates = requestedCoordinates(text);
  let targetMatched = false;
  if (
    coordinates &&
    (requested.coordinateRole === 'effect'
      ? samePosition(coordinates, change.position)
      : !!change.reference && samePosition(coordinates, change.reference.position))
  ) {
    evidence.push('coordinates');
    targetMatched = true;
  }
  const worldTargetMaterials = [change.verb === 'dig' ? change.before : change.reference?.name]
    .filter((value): value is string => !!value && value !== 'air')
    .map(normalize);
  for (const targetEvidence of requested.targetEvidence) {
    if (targetEvidence === 'coordinates') continue;
    if (
      worldTargetMaterials.some((material) => canonicalMaterialMatches(material, targetEvidence))
    ) {
      evidence.push(targetEvidence);
      targetMatched = true;
    }
  }
  const effectMaterial = change.verb === 'dig' ? change.before : change.after;
  if (
    effectMaterial &&
    effectMaterial !== 'air' &&
    normalize(text).includes(normalize(effectMaterial))
  ) {
    evidence.push(effectMaterial);
  }
  const deictic = /\b(it|this|that|here|there|the block)\b/i.test(text);
  if (deictic) evidence.push('deictic-target');
  const effectMatched =
    change.verb !== 'place' ||
    (requested.effectEvidence.length > 0 &&
      requested.effectEvidence.some(
        (value) => !!change.after && normalize(change.after).includes(value),
      ));
  if (effectMatched && change.verb === 'place') evidence.push('placed-item');
  return {
    requestMatched: targetMatched && effectMatched,
    requestEvidence: evidence,
  };
}

function requestedCoordinates(text: string) {
  const labelled = text.match(
    /(?:^|\b)x\s*[:=]?\s*(-?\d+)\s*[, ]+\s*y\s*[:=]?\s*(-?\d+)\s*[, ]+\s*z\s*[:=]?\s*(-?\d+)\b/i,
  );
  if (labelled) {
    return { x: Number(labelled[1]), y: Number(labelled[2]), z: Number(labelled[3]) };
  }
  const match = text.match(/(?:^|[^\d-])(-?\d+)\s*[, ]\s*(-?\d+)\s*[, ]\s*(-?\d+)\b/);
  if (!match) return null;
  return { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) };
}

function coordinatesDescribeSupport(text: string) {
  const coordinateStart = coordinateStartIndex(text);
  if (coordinateStart < 0) return false;
  const prefix = text.slice(0, coordinateStart);
  return /\b(?:on|onto|against)\b[^.!?]{0,100}\b(?:block|surface|stone|dirt|grass|concrete|plank|wood|brick|glass|floor|ground)\b[^.!?]{0,40}(?:\bat\b\s*)?$/i.test(
    prefix,
  );
}

function coordinateStartIndex(text: string) {
  const labelled = /(?:^|\b)x\s*[:=]?\s*-?\d+/i.exec(text);
  if (labelled) return labelled.index;
  const plain = /(?:^|[^\d-])-?\d+\s*[, ]\s*-?\d+\s*[, ]\s*-?\d+\b/.exec(text);
  return plain?.index ?? -1;
}

function canonicalMaterialMatches(actual: string, requested: string) {
  const actualTokens = normalize(actual).split(' ');
  const requestedTokens = normalize(requested).split(' ');
  return requestedTokens.every((token) => actualTokens.includes(token));
}

function isExplicitSurveyPermission(text: string) {
  return (
    /\b(survey|scan)\b/i.test(text) &&
    /\b(please|may|can|use|do|okay|ok|permit|permission|allowed|go ahead)\b/i.test(text) &&
    !/\b(don't|do not|never|avoid|without)\b/i.test(text)
  );
}

function outcomeEvidence(text: string, change: ComeSeeDoReportProgress['verifiedChanges'][number]) {
  if (containsClaimNegation(text)) return [];
  const normalized = normalize(text);
  const materials: string[] = [];
  for (const material of [change.before, change.after]) {
    if (!material || material === 'air') continue;
    if (normalized.includes(normalize(material))) materials.push(material);
  }
  if (!hasControlledOutcomeClaim(text, change) || materials.length === 0) return [];
  return [...new Set([...materials, change.verb])];
}

function containsClaimNegation(text: string) {
  return /\b(no|not|never|without|absent|missing|unable|unsuccessful|failed?|failure|cannot|can't|couldn't|don't|doesn't|didn't|haven't|hasn't|isn't|aren't|wasn't|weren't)\b|\b(?:could|do|does|did|have|has|is|are|was|were)\s+not\b|\b(?:was|were)\s+unable\b/i.test(
    text,
  );
}

function hasAffirmativeSceneClaim(text: string, phrase: string) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return claimClauses(text).some((clause) =>
    [
      new RegExp(
        `^i (?:can )?(?:see|observe|notice|sense) (?:a |an |some |the )?${escaped} (?:here|nearby|around us|underfoot|ahead|behind|beside us)$`,
        'i',
      ),
      new RegExp(
        `^the (?:nearby )?terrain (?:includes|contains|has) (?:a |an |some |the )?${escaped}$`,
        'i',
      ),
      new RegExp(
        `^there (?:is|are) (?:a |an |some |the )?${escaped} (?:here|nearby|around us|underfoot|ahead|behind|beside us)$`,
        'i',
      ),
    ].some((pattern) => pattern.test(clause)),
  );
}

function hasControlledOutcomeClaim(
  text: string,
  change: ComeSeeDoReportProgress['verifiedChanges'][number],
) {
  const material = normalize(change.verb === 'dig' ? change.before || '' : change.after || '');
  if (!material) return false;
  const verbs = change.verb === 'dig' ? '(?:dug|mined|broke|removed)' : '(?:placed|put|set|added)';
  const support = change.reference?.name ? normalize(change.reference.name) : null;
  const position = change.position;
  const locationSuffixes = [
    '',
    ` at ${position.x} ${position.y} ${position.z}`,
    ` at x ${position.x} y ${position.y} z ${position.z}`,
    ...(support
      ? [
          ` on ${support}`,
          ` on the ${support}`,
          ` on ${support} at ${position.x} ${position.y} ${position.z}`,
          ` on ${support} at x ${position.x} y ${position.y} z ${position.z}`,
        ]
      : []),
  ];
  const allowed = new Set<string>();
  for (const suffix of locationSuffixes) {
    allowed.add(`i ${verbs} the ${material}${suffix}`);
    allowed.add(`i successfully ${verbs} the ${material}${suffix}`);
    allowed.add(`i ${verbs} the ${material}${suffix} successfully`);
  }
  const verbPattern = new RegExp(verbs, 'g');
  return claimClauses(text).some((clause) => {
    for (const template of allowed) {
      if (clause === template.replace(verbPattern, (match) => match)) return true;
    }
    const exact = new RegExp(
      `^i (?:successfully )?${verbs} the ${escapeRegex(material)}(?: (?:successfully))?(?: at (?:x )?${position.x}(?: y)? ${position.y}(?: z)? ${position.z}| on (?:the )?${support ? escapeRegex(support) : '(?!)'}(?: at (?:x )?${position.x}(?: y)? ${position.y}(?: z)? ${position.z})?)?$`,
      'i',
    );
    return exact.test(clause);
  });
}

function claimClauses(text: string) {
  return normalize(text)
    .split(/[;.!?]+/)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function worldChangeStillPresent(
  change: ComeSeeDoReportProgress['verifiedChanges'][number],
  inspectBlock: ((position: { x: number; y: number; z: number }) => string | null) | null,
) {
  if (!inspectBlock) return true;
  const current = inspectBlock(change.position);
  return normalize(String(current || '')) === normalize(String(change.after || ''));
}

function targetPosition(bot: Bot, target: string) {
  const wanted = target.toLowerCase();
  const entity = (Object.values((bot as any).entities || {}) as any[]).find(
    (candidate) =>
      candidate?.position &&
      String(candidate?.username || candidate?.name || '').toLowerCase() === wanted,
  );
  if (!entity?.position) return null;
  return { x: entity.position.x, y: entity.position.y, z: entity.position.z };
}

function samePosition(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
) {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

function normalize(value: string) {
  return String(value).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function finiteOrNull(value: any) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
