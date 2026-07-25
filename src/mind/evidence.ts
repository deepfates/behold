import type { CognitionAdmissionEvidence } from './cognition';
import type { RequestByteAttribution } from './request-attribution';

export type ModelCallTerminal =
  | 'success'
  | 'provider_error'
  | 'transport_error'
  | 'timeout'
  | 'cancelled'
  | 'malformed_output'
  | 'adapter_rejected'
  | 'admission_rejected';

export type ModelAdapterIntervention = Readonly<{
  protocol: 'behold.model-adapter-intervention.v1';
  kind: 'output_correction_attempt';
  physicalAttemptOrdinal: number;
  brokerRequestId: string;
  admissionOrdinal: number;
}>;

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
  /** Named adapter-created attempts. Exact bytes live in raw transport capture. */
  interventions?: readonly ModelAdapterIntervention[];
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
    terminal?: 'success';
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
    terminal?: Exclude<ModelCallTerminal, 'success'>;
    status: number | null;
    bodyPreview: string | null;
    /** Opt-in adapter/provider attempt evidence retained for diagnosis. */
    raw?: unknown;
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
