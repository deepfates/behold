import type { ModelCallEvidence } from './evidence';

export type ResidentMindAction = {
  name: string;
  description?: string;
  inputSchema: unknown;
};

export type ResidentAttention = {
  mode: 'deliberative' | 'urgent';
  context: 'bounded_loom' | 'current_body_and_continuity';
  /** Wall-clock budget for this urgent choice; the controller enforces it. */
  decisionBudgetMs?: number;
  /** Present while a critical body condition still constrains attention and maintenance. */
  continuingCondition?: 'critical_body_condition';
  triggers: readonly {
    sequence: number;
    type: string;
    salience: 'urgent';
  }[];
};

export type ResidentAttentionInterruption = {
  protocol: 'behold.attention-interruption.v1';
  reason: 'urgent_world_attention';
  startedAt: number;
  interruptedAt: number;
  latencyMs: number;
  observationSequence: number;
  from: ResidentAttention;
  to: ResidentAttention;
};

/**
 * One bounded cognitive choice. The resident lifecycle remains outside this
 * boundary: Behold owns waking, memory, authorization, execution, and the
 * independently observed consequence.
 */
export type ResidentMindRequest = {
  protocol: 'behold.mind-request.v1';
  entityId: string;
  model: string;
  /** Versioned controller behavior. Optional only for reading legacy captures. */
  policyProfile?: string;
  /** Versioned action catalog selection. Optional only for reading legacy captures. */
  actionProfile?: string;
  /** Versioned world/body risk policy. Optional only for reading legacy captures. */
  safetyProfile?: string;
  observation: unknown;
  /** Bounded lived context. Adapters may project it into their own prompt form. */
  conversation: readonly unknown[];
  /** The exact actions admitted for this decision, including explicit yield. */
  actions: readonly ResidentMindAction[];
  /** A controller safety/lifecycle requirement, not a model suggestion. */
  requiredAction: string | null;
  /** Working-memory mode only; it never selects, ranks, or executes an action. */
  attention?: ResidentAttention;
};

export type ResidentMindDecision = {
  protocol: 'behold.mind-decision.v1';
  disposition: 'act' | 'wait' | 'no_action';
  /** Short public intention retained in the entity loom; never provider-private reasoning. */
  utterance: string | null;
  action: {
    name: string;
    input: unknown;
    callId?: string | null;
  } | null;
  /** Opaque adapter output retained for audit; Behold never trusts it for action admission. */
  adapterRecord?: unknown;
  call: ModelCallEvidence;
};

export type ResidentMind = {
  id: string;
  decide: (
    request: Readonly<ResidentMindRequest>,
    options: Readonly<{ signal: AbortSignal }>,
  ) => Promise<ResidentMindDecision>;
};
