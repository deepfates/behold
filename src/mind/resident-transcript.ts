import type { EntityTurn } from '../entity/loom';

export const RESIDENT_CONTINUOUS_TRANSCRIPT_PROTOCOL =
  'behold.resident-continuous-transcript.v1' as const;

export type ResidentTranscriptMessage = Readonly<{
  role: 'user' | 'assistant';
  content: string;
}>;

export type ResidentTranscriptProjection = Readonly<{
  protocol: typeof RESIDENT_CONTINUOUS_TRANSCRIPT_PROTOCOL;
  entityId: string;
  throughTurn: number;
  messages: readonly ResidentTranscriptMessage[];
}>;

export function residentCurrentExperienceMessage(observation: unknown): ResidentTranscriptMessage {
  return deepFreeze({
    role: 'user',
    content: `What you experience:\n${stableJson(observation)}`,
  });
}

type ProjectionOptions = Readonly<{
  projectObservation?: (observation: any, turn: EntityTurn) => any;
  projectValue?: (value: any) => any;
  mayReplayTurn?: (turn: EntityTurn) => boolean;
}>;

/**
 * Reconstruct one resident's chronological model conversation from canonical
 * turns. Provider syntax and controller bookkeeping remain outside this seam.
 */
export function projectResidentTranscript(
  entityId: string,
  turns: readonly EntityTurn[],
  options: ProjectionOptions = {},
): ResidentTranscriptProjection {
  const messages: ResidentTranscriptMessage[] = [];
  let expectedSequence = 1;
  let parentId: string | null = null;

  for (const turn of turns) {
    assertTranscriptTurn(turn, entityId, expectedSequence, parentId);
    messages.push(...projectResidentTranscriptTurn(turn, options));
    expectedSequence += 1;
    parentId = turn.id;
  }

  return deepFreeze({
    protocol: RESIDENT_CONTINUOUS_TRANSCRIPT_PROTOCOL,
    entityId,
    throughTurn: expectedSequence - 1,
    messages,
  });
}

export function projectResidentTranscriptTurn(
  turn: EntityTurn,
  options: ProjectionOptions = {},
): readonly ResidentTranscriptMessage[] {
  const projectValue = options.projectValue ?? cloneJson;
  const admittedObservation = turn.observationPresentation?.observation;
  const observation = admittedObservation
    ? cloneJson(admittedObservation)
    : (options.projectObservation ?? ((value) => cloneJson(value)))(turn.observation, turn);
  const experience: ResidentTranscriptMessage = {
    role: 'user',
    content: `What you experience:\n${stableJson(observation)}`,
  };

  if (options.mayReplayTurn?.(turn) === false || turn.action.source !== 'llm') {
    return deepFreeze([
      experience,
      {
        role: 'user',
        content: `What happened through ${turn.action.source} control:\n${stableJson({
          action: {
            name: turn.action.name,
            ...(options.mayReplayTurn?.(turn) === false
              ? { inputUnavailable: true }
              : { arguments: projectValue(turn.action.input) }),
          },
          outcome: projectValue(turn.outcome),
        })}`,
      },
    ]);
  }

  const canonicalChoice = stableJson({
    action: turn.action.name,
    arguments: projectValue(turn.action.input),
  });
  const retainedContent = turn.utterance?.assistant?.content;
  const assistantContent =
    typeof retainedContent === 'string' && retainedContent.length > 0
      ? exactResidentChoice(
          retainedContent,
          stableJson({ action: turn.action.name, arguments: turn.action.input }),
          turn.sequence,
        )
      : canonicalChoice;

  return deepFreeze([
    experience,
    {
      role: 'assistant',
      content: assistantContent,
    },
    {
      role: 'user',
      content: `What Minecraft returned after your ${turn.action.name} attempt:\n${stableJson(
        projectValue(turn.outcome),
      )}`,
    },
  ]);
}

function exactResidentChoice(content: string, canonicalChoice: string, sequence: number) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`continuous resident transcript turn ${sequence} retained malformed response`);
  }
  if (stableJson(parsed) !== canonicalChoice) {
    throw new Error(
      `continuous resident transcript turn ${sequence} response differs from committed action`,
    );
  }
  return content;
}

function assertTranscriptTurn(
  turn: EntityTurn,
  entityId: string,
  expectedSequence: number,
  parentId: string | null,
) {
  if (turn.protocol !== 'behold.entity-turn.v1') {
    throw new Error('continuous resident transcript requires entity-turn v1');
  }
  if (turn.entityId !== entityId) {
    throw new Error(
      `continuous resident transcript expected ${entityId}, received ${turn.entityId}`,
    );
  }
  if (turn.sequence !== expectedSequence || turn.id !== `${entityId}:turn:${expectedSequence}`) {
    throw new Error(`continuous resident transcript is not contiguous at turn ${expectedSequence}`);
  }
  if (turn.parentId !== parentId) {
    throw new Error(`continuous resident transcript parent mismatch at turn ${expectedSequence}`);
  }
}

function stableJson(value: unknown) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: any): any {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortValue(value[key])]),
  );
}

function cloneJson(value: any): any {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}
