import type { ModelCallEvidence } from './evidence';

export type ResidentMindAction = {
  name: string;
  description?: string;
  inputSchema: unknown;
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
  observation: unknown;
  /** Bounded lived context. Adapters may project it into their own prompt form. */
  conversation: readonly unknown[];
  /** The exact actions admitted for this decision, including explicit yield. */
  actions: readonly ResidentMindAction[];
  /** A controller safety/lifecycle requirement, not a model suggestion. */
  requiredAction: string | null;
};

export type ResidentMindDecision = {
  protocol: 'behold.mind-decision.v1';
  disposition: 'act' | 'wait' | 'no_action';
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
