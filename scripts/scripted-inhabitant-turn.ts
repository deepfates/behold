import type { InhabitantExperience } from '../src/agent/experience';
import type { EntityTurn, openEntityLoom } from '../src/entity/loom';
import type { EngineEvent, createEngine } from '../src/loop/engine';

/**
 * Exercise one admitted inhabitant action through the production engine while
 * leaving the choice of action to a deterministic proof driver. The resulting
 * turn has the same observation, authority, terminal-lifecycle, and Lync path
 * as a model turn; only the proposal source differs.
 */
export async function executeScriptedInhabitantTurn(input: {
  entityId: string;
  loom: Awaited<ReturnType<typeof openEntityLoom>>;
  experience: InhabitantExperience;
  engine: ReturnType<typeof createEngine>;
  events: EngineEvent[];
  name: string;
  input: any;
  model?: string;
}) {
  const sequence = input.loom.turns().length + 1;
  const parentId = input.loom.turns().at(-1)?.id ?? null;
  const observation = input.experience.observe();
  const eventStart = input.events.length;
  const startedAt = Date.now();
  const intentId = `${input.entityId}:script:${sequence}`;
  const accepted = input.engine.enqueueIntent({
    id: intentId,
    source: 'script',
    tool: input.name,
    input: input.input,
    observationSequence: observation.sequence,
    decidedAt: startedAt,
  });
  if (!accepted) throw new Error(`engine refused ${input.name}`);
  const result = await input.engine.tick();
  const actionEvents = input.events.slice(eventStart);
  const terminal = actionEvents.find(
    (event) =>
      (event.type === 'action_completed' || event.type === 'action_failed') &&
      event.data?.intent?.id === intentId,
  );
  if (!terminal) throw new Error(`${input.name} produced no authentic terminal lifecycle event`);
  const nextObservation = input.experience.observe();
  const turn: EntityTurn = {
    protocol: 'behold.entity-turn.v1',
    circleId: input.loom.circleId ?? undefined,
    id: `${input.entityId}:turn:${sequence}`,
    entityId: input.entityId,
    sequence,
    parentId,
    model: input.model || 'script/behold-owned-world-proof-v1',
    startedAt,
    completedAt: Date.now(),
    observation,
    utterance: { assistant: null },
    action: {
      id: intentId,
      name: input.name,
      input: input.input,
      source: 'script',
      kind: 'exclusive',
      toolCallId: null,
    },
    outcome: {
      ok: terminal.type === 'action_completed',
      eventType: terminal.type,
      result: terminal.data?.result ?? result,
      ...(terminal.type === 'action_failed'
        ? { error: String(terminal.data?.error || 'action_failed') }
        : {}),
    },
    nextObservation,
  };
  await input.loom.append(turn);
  return {
    turnId: turn.id,
    action: turn.action,
    result: turn.outcome.result,
    events: actionEvents,
  };
}
