import { createHash } from 'node:crypto';

export const COGNITION_TRANSPORT_PROTOCOL = 'behold.cognition-transport.v1' as const;
export const COGNITION_ADMISSION_PROTOCOL = 'behold.cognition-admission.v1' as const;

export type CognitionPriority = 'urgent' | 'deliberative' | 'auxiliary';
export type CognitionPurpose = 'resident_decision' | 'loom_fold';

export type CognitionAdmissionEvidence = Readonly<{
  protocol: typeof COGNITION_ADMISSION_PROTOCOL;
  brokerId: string;
  brokerRequestId: string;
  clientRequestId: string;
  residentKey: string;
  model: string;
  bodySha256: string;
  priority: CognitionPriority;
  purpose: CognitionPurpose;
  urgentTriggerSequence: number | null;
  queuedAt: number;
  admittedAt: number;
  queueMs: number;
  queueDepthOnArrival: number;
  activeBeforeAdmission: number;
  concurrencyLimit: number;
  admissionOrdinal: number;
}>;

const HEADERS = Object.freeze({
  protocol: 'x-behold-cognition-protocol',
  requestId: 'x-behold-cognition-request-id',
  priority: 'x-behold-cognition-priority',
  purpose: 'x-behold-cognition-purpose',
  urgentTrigger: 'x-behold-cognition-urgent-trigger',
  brokerId: 'x-behold-cognition-broker-id',
  brokerRequestId: 'x-behold-cognition-broker-request-id',
  residentKey: 'x-behold-cognition-resident-key',
  model: 'x-behold-cognition-model',
  bodySha256: 'x-behold-cognition-body-sha256',
  queuedAt: 'x-behold-cognition-queued-at',
  admittedAt: 'x-behold-cognition-admitted-at',
  queueMs: 'x-behold-cognition-queue-ms',
  queueDepth: 'x-behold-cognition-queue-depth',
  activeBefore: 'x-behold-cognition-active-before',
  limit: 'x-behold-cognition-limit',
  ordinal: 'x-behold-cognition-admission-ordinal',
});

export function cognitionClientHeaders(input: {
  requestId: string;
  priority: CognitionPriority;
  purpose: CognitionPurpose;
  urgentTriggerSequence?: number | null;
}) {
  return {
    [HEADERS.protocol]: COGNITION_TRANSPORT_PROTOCOL,
    [HEADERS.requestId]: input.requestId,
    [HEADERS.priority]: input.priority,
    [HEADERS.purpose]: input.purpose,
    [HEADERS.urgentTrigger]:
      input.urgentTriggerSequence == null ? 'none' : String(input.urgentTriggerSequence),
  };
}

export function cognitionAdmissionHeaders(evidence: CognitionAdmissionEvidence) {
  return {
    [HEADERS.protocol]: evidence.protocol,
    [HEADERS.brokerId]: evidence.brokerId,
    [HEADERS.brokerRequestId]: evidence.brokerRequestId,
    [HEADERS.residentKey]: evidence.residentKey,
    [HEADERS.model]: evidence.model,
    [HEADERS.bodySha256]: evidence.bodySha256,
    [HEADERS.requestId]: evidence.clientRequestId,
    [HEADERS.priority]: evidence.priority,
    [HEADERS.purpose]: evidence.purpose,
    [HEADERS.urgentTrigger]:
      evidence.urgentTriggerSequence == null ? 'none' : String(evidence.urgentTriggerSequence),
    [HEADERS.queuedAt]: String(evidence.queuedAt),
    [HEADERS.admittedAt]: String(evidence.admittedAt),
    [HEADERS.queueMs]: String(evidence.queueMs),
    [HEADERS.queueDepth]: String(evidence.queueDepthOnArrival),
    [HEADERS.activeBefore]: String(evidence.activeBeforeAdmission),
    [HEADERS.limit]: String(evidence.concurrencyLimit),
    [HEADERS.ordinal]: String(evidence.admissionOrdinal),
  };
}

export function parseCognitionAdmission(headers: Headers): CognitionAdmissionEvidence | null {
  if (headers.get(HEADERS.protocol) !== COGNITION_ADMISSION_PROTOCOL) return null;
  const priority = headers.get(HEADERS.priority);
  const purpose = headers.get(HEADERS.purpose);
  if (!isPriority(priority) || !isPurpose(purpose)) return null;
  const evidence: CognitionAdmissionEvidence = {
    protocol: COGNITION_ADMISSION_PROTOCOL,
    brokerId: headers.get(HEADERS.brokerId) || '',
    brokerRequestId: headers.get(HEADERS.brokerRequestId) || '',
    clientRequestId: headers.get(HEADERS.requestId) || '',
    residentKey: headers.get(HEADERS.residentKey) || '',
    model: headers.get(HEADERS.model) || '',
    bodySha256: headers.get(HEADERS.bodySha256) || '',
    priority,
    purpose,
    urgentTriggerSequence: optionalSequenceHeader(headers, HEADERS.urgentTrigger),
    queuedAt: finiteHeader(headers, HEADERS.queuedAt),
    admittedAt: finiteHeader(headers, HEADERS.admittedAt),
    queueMs: finiteHeader(headers, HEADERS.queueMs),
    queueDepthOnArrival: integerHeader(headers, HEADERS.queueDepth),
    activeBeforeAdmission: integerHeader(headers, HEADERS.activeBefore),
    concurrencyLimit: integerHeader(headers, HEADERS.limit),
    admissionOrdinal: integerHeader(headers, HEADERS.ordinal),
  };
  if (
    !evidence.brokerId ||
    !evidence.brokerRequestId ||
    !evidence.clientRequestId ||
    !/^[a-f0-9]{64}$/.test(evidence.residentKey) ||
    !evidence.model ||
    !/^[a-f0-9]{64}$/.test(evidence.bodySha256) ||
    evidence.queueMs < 0 ||
    evidence.queueDepthOnArrival < 0 ||
    evidence.activeBeforeAdmission < 0 ||
    evidence.concurrencyLimit < 1 ||
    evidence.admissionOrdinal < 1 ||
    (evidence.urgentTriggerSequence != null && evidence.urgentTriggerSequence < 0) ||
    (evidence.priority === 'urgent') !== (evidence.urgentTriggerSequence != null)
  ) {
    return null;
  }
  return evidence;
}

export function cognitionResidentKey(runId: string, entityId: string) {
  return sha256(`${runId}\0${entityId}`);
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function isCognitionTransportEnabled(value: unknown) {
  return String(value || '') === COGNITION_TRANSPORT_PROTOCOL;
}

function isPriority(value: unknown): value is CognitionPriority {
  return value === 'urgent' || value === 'deliberative' || value === 'auxiliary';
}

function isPurpose(value: unknown): value is CognitionPurpose {
  return value === 'resident_decision' || value === 'loom_fold';
}

function finiteHeader(headers: Headers, name: string) {
  const value = Number(headers.get(name));
  return Number.isFinite(value) ? value : NaN;
}

function integerHeader(headers: Headers, name: string) {
  const value = finiteHeader(headers, name);
  return Number.isSafeInteger(value) ? value : -1;
}

function optionalSequenceHeader(headers: Headers, name: string) {
  const raw = headers.get(name);
  if (raw === 'none') return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : -1;
}

export const cognitionHeaderNames = HEADERS;
