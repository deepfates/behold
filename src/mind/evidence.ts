import type { CognitionAdmissionEvidence } from './cognition';
import type { RequestByteAttribution } from './request-attribution';

export type MindProgramIdentity = {
  protocol: 'behold.mind-program-identity.v1';
  name: string;
  artifactProtocol: string;
  artifactSha256: string;
  signatureSha256: string;
  runtime: {
    name: string;
    version: string;
  };
};

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
  /** Immutable cognitive program selected before this request was made. */
  program?: MindProgramIdentity;
  request: {
    model: string;
    /** Exact canonical identity of the framework-level ResidentMindRequest. */
    mindRequestSha256?: string;
    /** Opt-in framework input retained for exact replay; may contain private lived context. */
    mindRequest?: unknown;
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
