import type { CognitionAdmissionEvidence } from './cognition';
import type { RequestByteAttribution } from './request-attribution';

export type ModelCallEvidence = {
  protocol: 'behold.model-call.v1';
  requestId: string;
  endpoint: string;
  startedAt: number;
  completedAt: number;
  latencyMs: number;
  /** Aggregate compute admission(s), including adapter retries, when centrally scheduled. */
  admissions?: readonly CognitionAdmissionEvidence[];
  adapter?: {
    name: string;
    version?: string;
  };
  request: {
    model: string;
    messageCount: number;
    toolCount: number;
    toolChoice: unknown;
    bodySha256: string;
    messagesSha256: string;
    toolsSha256: string;
    /** Exact serialized bytes for provider requests or adapter input when known. */
    bodyBytes?: number;
    /** `provider_request` is exact wire input; `mind_input` is adapter input. */
    kind?: 'provider_request' | 'mind_input';
    /** Content-free exact partition of a provider request when available. */
    byteAttribution?: RequestByteAttribution;
    body?: unknown;
  };
  response: {
    id: string | null;
    model: string | null;
    provider: string | null;
    finishReason: string | null;
    nativeFinishReason: string | null;
    usage: unknown;
    raw?: unknown;
  };
};

export type ModelCallFailureEvidence = Omit<ModelCallEvidence, 'response'> & {
  response: {
    status: number | null;
    bodyPreview: string | null;
  };
};

export class ResidentMindCallError extends Error {
  constructor(
    message: string,
    readonly call: ModelCallFailureEvidence,
  ) {
    super(message);
    this.name = 'ResidentMindCallError';
  }
}
