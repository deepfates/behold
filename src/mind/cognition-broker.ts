import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import {
  openQuotaLedger,
  type QuotaCharge,
  type QuotaLedger,
  type QuotaLedgerSnapshot,
} from '../observability/quota-ledger';
import {
  COGNITION_ADMISSION_PROTOCOL,
  COGNITION_TRANSPORT_PROTOCOL,
  cognitionAdmissionHeaders,
  cognitionHeaderNames,
  type CognitionAdmissionEvidence,
  type CognitionPriority,
  type CognitionPurpose,
} from './cognition';
import {
  createCognitionTransportCapture,
  type CognitionTransportCaptureHandle,
  type CognitionTransportCaptureReference,
  type CognitionTransportCaptureStore,
} from './transport-capture';
import {
  assertOpenRouterRouteRequest,
  inspectOpenRouterResponseIdentity,
  openRouterRoutePolicy,
  type OpenRouterRoutePolicy,
} from './openrouter-route';
import {
  assertOllamaLocalRequest,
  exactOllamaChatEndpoint,
  inspectOllamaLocalResponseIdentity,
  ollamaAttemptIdentity,
  ollamaLocalPolicy,
  verifyOllamaPreflight,
  type OllamaLocalPolicy,
  type OllamaLocalPreflight,
} from './ollama-local';
import {
  assertLmStudioLocalPrefixReadinessWireRequest,
  assertLmStudioLocalLoomFoldWireRequest,
  assertLmStudioLocalWireRequest,
  exactLmStudioEndpoint,
  inspectLmStudioLocalResponseIdentity,
  lmStudioAttemptIdentity,
  lmStudioLocalPolicy,
  verifyLmStudioPreflight,
  type LmStudioLocalPolicy,
  type LmStudioLocalPreflight,
} from './lmstudio-local';

export const COGNITION_BROKER_EVENT_PROTOCOL = 'behold.cognition-broker-event.v1' as const;
export const COGNITION_ADMISSION_LIMIT_PROTOCOL = 'behold.cognition-admission-limit.v1' as const;
export const COGNITION_ADMISSION_LIMIT_SETTLEMENT_PROTOCOL =
  'behold.cognition-admission-limit-settlement.v1' as const;

export type CognitionAdmissionLimitEvidence = Readonly<{
  protocol: typeof COGNITION_ADMISSION_LIMIT_PROTOCOL;
  brokerId: string;
  accepted: number;
  limit: number;
  at: number;
}>;

export type CognitionAdmissionLimitSettlementEvidence = Readonly<{
  protocol: typeof COGNITION_ADMISSION_LIMIT_SETTLEMENT_PROTOCOL;
  brokerId: string;
  accepted: number;
  limit: number;
  terminal: number;
  completed: number;
  failed: number;
  cancelled: number;
  at: number;
}>;

export type CognitionBrokerEvent = Readonly<{
  protocol: typeof COGNITION_BROKER_EVENT_PROTOCOL;
  sequence: number;
  at: number;
  brokerId: string;
  type:
    | 'started'
    | 'accepted'
    | 'admitted'
    | 'completed'
    | 'cancel_requested'
    | 'cancelled'
    | 'rejected'
    | 'draining'
    | 'drained';
  request: Readonly<{
    brokerRequestId: string;
    clientRequestId: string;
    residentKey: string;
    priority: CognitionPriority;
    purpose: CognitionPurpose;
    urgentTriggerSequence: number | null;
    model: string;
    bodySha256: string;
    bodyBytes: number;
  }> | null;
  data: unknown;
  previousDigest: string | null;
  digest: string;
}>;

export type CognitionBrokerSnapshot = Readonly<{
  protocol: 'behold.cognition-broker-snapshot.v1';
  brokerId: string;
  concurrencyLimit: number;
  acceptedLimit: number | null;
  acceptedRemaining: number | null;
  active: number;
  queued: number;
  peakActive: number;
  peakQueued: number;
  accepted: number;
  acceptedByPurpose: Readonly<Record<CognitionPurpose, number>>;
  admitted: number;
  completed: number;
  failed: number;
  cancelled: number;
  rejected: number;
  totalQueueMs: number;
  admissionOrdinal: number;
  closing: boolean;
  healthy: boolean;
  accounting: Readonly<{ accounts: readonly QuotaLedgerSnapshot[] }> | null;
  journal: Readonly<{ file: string; tipDigest: string | null }> | null;
  transportCaptureDirectory: string | null;
}>;

export type CognitionBroker = Readonly<{
  protocol: typeof COGNITION_TRANSPORT_PROTOCOL;
  brokerId: string;
  endpoint: string;
  journalFile: string | null;
  transportCaptureDirectory: string | null;
  failed: Promise<Error>;
  admissionLimitReached: Promise<CognitionAdmissionLimitEvidence>;
  admissionLimitSettled: Promise<CognitionAdmissionLimitSettlementEvidence>;
  snapshot(): CognitionBrokerSnapshot;
  close(): Promise<CognitionBrokerSnapshot>;
}>;

export type CognitionBrokerOptions = Readonly<{
  upstreamEndpoint: string;
  /** Required for remote OpenRouter transport and forbidden for local runtimes. */
  upstreamApiKey?: string;
  /** Read-only loopback inventory/config evidence; required only for local Ollama. */
  ollamaPreflight?: OllamaLocalPreflight;
  /** Read-only exact runtime/model/artifact evidence; required only for local LM Studio. */
  lmStudioPreflight?: LmStudioLocalPreflight;
  clients: readonly Readonly<{
    bearer: string;
    residentKey: string;
    /** Default model retained for backwards-compatible configuration evidence. */
    model: string;
    /** Exact additional models this resident transport may request. */
    models?: readonly string[];
    /** Exact direct-provider routing/output contract admitted before upstream I/O. */
    routePolicy?: OpenRouterRoutePolicy;
    /** Exact Ollama transport/schema/tag/content/template/settings contract. */
    ollamaLocal?: OllamaLocalPolicy;
    /** Exact LM Studio runtime/artifact/instance/transport contract. */
    lmStudioLocal?: LmStudioLocalPolicy;
    /** Durable per-purpose provider-attempt quota owned by this resident account. */
    accounting?: Readonly<{
      scopeId: string;
      worldId: string;
      accountId: string;
      ledgerFile: string;
      limits: Readonly<{ resident_decision: number; loom_fold: number }>;
    }>;
  }>[];
  maxConcurrent: number;
  maxAccepted?: number;
  maxQueued?: number;
  maxQueuedPerResident?: number;
  maxBodyBytes?: number;
  maxResponseBytes?: number;
  maxCallMs?: number;
  maxUrgentBurst?: number;
  maxNonAuxiliaryBurst?: number;
  allowedUpstreamOrigins?: readonly string[];
  fetch?: typeof fetch;
  now?: () => number;
  journalFile?: string;
  /** Private raw provider-attempt evidence. No authentication headers are retained. */
  transportCaptureDirectory?: string;
  onEvent?: (event: CognitionBrokerEvent) => void;
}>;

type Client = Readonly<{
  bearer: string;
  residentKey: string;
  model: string;
  models: readonly string[];
  routePolicy: OpenRouterRoutePolicy | null;
  ollamaLocal: OllamaLocalPolicy | null;
  lmStudioLocal: LmStudioLocalPolicy | null;
  accounting: CognitionBrokerOptions['clients'][number]['accounting'] | null;
}>;

type Job = {
  state: 'queued' | 'active' | 'cancelling' | 'completed' | 'cancelled';
  brokerRequestId: string;
  clientRequestId: string;
  logicalRequestAttempt: number | null;
  client: Client;
  model: string;
  priority: CognitionPriority;
  purpose: CognitionPurpose;
  urgentTriggerSequence: number | null;
  body: Buffer;
  bodySha256: string;
  queuedAt: number;
  queueDepthOnArrival: number;
  request: IncomingMessage;
  response: ServerResponse;
  upstreamAbort: AbortController | null;
  admission: CognitionAdmissionEvidence | null;
  quotaCharge: QuotaCharge | null;
  transportCaptureHandle: CognitionTransportCaptureHandle | null;
  transportCaptureReference: CognitionTransportCaptureReference | null;
};

const PRIORITIES: readonly CognitionPriority[] = ['urgent', 'deliberative', 'auxiliary'];

/**
 * Strict loopback transport gate for independently running resident minds.
 * It schedules raw OpenAI-compatible JSON requests but never interprets a
 * resident observation, proposal, or world action.
 */
export async function startCognitionBroker(
  options: CognitionBrokerOptions,
): Promise<CognitionBroker> {
  const clients = normalizeClients(options.clients);
  const ollamaClients = clients.filter((client) => client.ollamaLocal != null);
  const lmStudioClients = clients.filter((client) => client.lmStudioLocal != null);
  const localClientCount = ollamaClients.length + lmStudioClients.length;
  if (
    (ollamaClients.length > 0 && ollamaClients.length !== clients.length) ||
    (lmStudioClients.length > 0 && lmStudioClients.length !== clients.length) ||
    localClientCount > clients.length
  ) {
    throw new Error('one cognition broker cannot mix OpenRouter, Ollama, and LM Studio clients');
  }
  const usesOllama = ollamaClients.length > 0;
  const usesLmStudio = lmStudioClients.length > 0;
  const usesLocalRuntime = usesOllama || usesLmStudio;
  const upstream = usesOllama
    ? exactOllamaChatEndpoint(options.upstreamEndpoint)
    : usesLmStudio
      ? exactLmStudioEndpoint(options.upstreamEndpoint)
      : exactUpstreamEndpoint(
          options.upstreamEndpoint,
          options.allowedUpstreamOrigins ?? ['https://openrouter.ai'],
        );
  const upstreamApiKey = String(options.upstreamApiKey || '').trim();
  if (usesOllama) {
    if (upstreamApiKey) throw new Error('local Ollama transport forbids an upstream API key');
    if (options.lmStudioPreflight) {
      throw new Error('local Ollama transport forbids LM Studio preflight');
    }
    if (!options.ollamaPreflight) throw new Error('local Ollama transport requires preflight');
    verifyOllamaPreflight(
      options.ollamaPreflight,
      ollamaClients.map((client) => client.ollamaLocal!),
    );
  } else if (usesLmStudio) {
    if (upstreamApiKey) throw new Error('local LM Studio transport forbids an upstream API key');
    if (options.ollamaPreflight) {
      throw new Error('local LM Studio transport forbids Ollama preflight');
    }
    if (!options.lmStudioPreflight) {
      throw new Error('local LM Studio transport requires preflight');
    }
    verifyLmStudioPreflight(
      options.lmStudioPreflight,
      lmStudioClients.map((client) => client.lmStudioLocal!),
    );
  } else {
    if (options.ollamaPreflight || options.lmStudioPreflight) {
      throw new Error('remote cognition transport forbids local runtime preflight');
    }
    if (upstreamApiKey.length < 12) {
      throw new Error('cognition broker requires an upstream API key');
    }
  }
  const maxConcurrent = positiveInteger(options.maxConcurrent, 'maxConcurrent', 1_024);
  const maxAccepted =
    options.maxAccepted == null
      ? null
      : positiveInteger(options.maxAccepted, 'maxAccepted', 100_000_000);
  if (maxAccepted != null && clients.some((client) => client.accounting != null)) {
    throw new Error('purpose-specific cognition accounting cannot be combined with maxAccepted');
  }
  const maxQueued = positiveInteger(options.maxQueued ?? 256, 'maxQueued', 100_000);
  const maxQueuedPerResident = positiveInteger(
    options.maxQueuedPerResident ?? 2,
    'maxQueuedPerResident',
    1_024,
  );
  const maxBodyBytes = positiveInteger(
    options.maxBodyBytes ?? 4 * 1024 * 1024,
    'maxBodyBytes',
    64 * 1024 * 1024,
  );
  const maxResponseBytes = positiveInteger(
    options.maxResponseBytes ?? 16 * 1024 * 1024,
    'maxResponseBytes',
    128 * 1024 * 1024,
  );
  const maxCallMs = positiveInteger(options.maxCallMs ?? 60_000, 'maxCallMs', 10 * 60_000);
  const maxUrgentBurst = positiveInteger(options.maxUrgentBurst ?? 4, 'maxUrgentBurst', 1_024);
  const maxNonAuxiliaryBurst = positiveInteger(
    options.maxNonAuxiliaryBurst ?? 8,
    'maxNonAuxiliaryBurst',
    4_096,
  );
  const now = options.now ?? Date.now;
  const accountingLedgers = openAccountingLedgers(clients, now);
  const callFetch = options.fetch ?? globalThis.fetch;
  const brokerId = `cognition-${randomUUID()}`;
  const journalFile = options.journalFile ? path.resolve(options.journalFile) : null;
  const transportCaptureDirectory = options.transportCaptureDirectory
    ? path.resolve(options.transportCaptureDirectory)
    : null;
  let journalDescriptor: number | null = null;
  let journalTipDigest: string | null = null;
  let journalFailure: Error | null = null;
  let resolveFailure!: (error: Error) => void;
  const failed = new Promise<Error>((resolve) => {
    resolveFailure = resolve;
  });
  let resolveAdmissionLimit!: (evidence: CognitionAdmissionLimitEvidence) => void;
  const admissionLimitReached = new Promise<CognitionAdmissionLimitEvidence>((resolve) => {
    resolveAdmissionLimit = resolve;
  });
  let admissionLimitEvidence: CognitionAdmissionLimitEvidence | null = null;
  let resolveAdmissionLimitSettlement!: (
    evidence: CognitionAdmissionLimitSettlementEvidence,
  ) => void;
  const admissionLimitSettled = new Promise<CognitionAdmissionLimitSettlementEvidence>(
    (resolve) => {
      resolveAdmissionLimitSettlement = resolve;
    },
  );
  let admissionLimitSettlementEvidence: CognitionAdmissionLimitSettlementEvidence | null = null;
  const recordFatalFailure = (error: unknown) => {
    const failure = error instanceof Error ? error : new Error(String(error));
    if (!journalFailure) {
      journalFailure = failure;
      closing = true;
      resolveFailure(failure);
    }
    return failure;
  };
  if (journalFile) {
    ensureDurableDirectory(path.dirname(journalFile));
    try {
      journalDescriptor = fs.openSync(journalFile, 'wx', 0o600);
      fsyncDirectory(path.dirname(journalFile));
    } catch (error) {
      if (journalDescriptor != null) fs.closeSync(journalDescriptor);
      closeAccountingLedgers(accountingLedgers);
      throw error;
    }
  }
  let transportCapture: CognitionTransportCaptureStore | null = null;
  if (transportCaptureDirectory) {
    try {
      transportCapture = createCognitionTransportCapture({
        directory: transportCaptureDirectory,
        secretValues: [upstreamApiKey, ...clients.map((client) => client.bearer)],
      });
    } catch (error) {
      if (journalDescriptor != null) fs.closeSync(journalDescriptor);
      closeAccountingLedgers(accountingLedgers);
      throw error;
    }
  }
  const queues = new Map<CognitionPriority, Job[]>(PRIORITIES.map((priority) => [priority, []]));
  const activeJobs = new Set<Job>();
  const activeResidents = new Set<string>();
  const logicalRequestAttempts = new Map<string, number>();
  let sequence = 0;
  let active = 0;
  let urgentBurst = 0;
  let nonAuxiliaryBurst = 0;
  let closing = false;
  let closePromise: Promise<CognitionBrokerSnapshot> | null = null;
  let requestClose: (() => Promise<CognitionBrokerSnapshot>) | null = null;
  const containAsyncFailure = (error: unknown) => {
    recordFatalFailure(error);
    queueMicrotask(() => {
      void requestClose?.().catch(() => undefined);
    });
  };
  const drainWaiters = new Set<() => void>();
  const metrics = {
    peakActive: 0,
    peakQueued: 0,
    accepted: 0,
    admitted: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    rejected: 0,
    totalQueueMs: 0,
    admissionOrdinal: 0,
  };
  const acceptedByPurpose: Record<CognitionPurpose, number> = {
    resident_decision: 0,
    resident_prefix_readiness: 0,
    loom_fold: 0,
  };

  const emit = (type: CognitionBrokerEvent['type'], job: Job | null, data: unknown = {}) => {
    const base = {
      protocol: COGNITION_BROKER_EVENT_PROTOCOL,
      sequence: ++sequence,
      at: now(),
      brokerId,
      type,
      request: job
        ? Object.freeze({
            brokerRequestId: job.brokerRequestId,
            clientRequestId: job.clientRequestId,
            residentKey: job.client.residentKey,
            priority: job.priority,
            purpose: job.purpose,
            urgentTriggerSequence: job.urgentTriggerSequence,
            model: job.model,
            bodySha256: job.bodySha256,
            bodyBytes: job.body.byteLength,
          })
        : null,
      data,
      previousDigest: journalTipDigest,
    };
    const event: CognitionBrokerEvent = Object.freeze({
      ...base,
      digest: sha256(Buffer.from(JSON.stringify(base))),
    });
    if (journalDescriptor != null) {
      try {
        fs.writeSync(journalDescriptor, `${JSON.stringify(event)}\n`);
        fs.fsyncSync(journalDescriptor);
        journalTipDigest = event.digest;
      } catch (error: any) {
        throw recordFatalFailure(error);
      }
    }
    try {
      options.onEvent?.(event);
    } catch {}
  };

  const server = http.createServer((request, response) => {
    void accept(request, response).catch((error: any) => {
      if (!response.headersSent && !response.destroyed) {
        writeError(response, 500, 'broker_internal_error', error?.message || String(error));
      } else if (!response.destroyed) response.destroy();
    });
  });
  server.keepAliveTimeout = 1_000;
  server.headersTimeout = 10_000;
  server.requestTimeout = 120_000;

  async function accept(request: IncomingMessage, response: ServerResponse) {
    if (closing) return reject(response, 503, 'broker_closing', 'cognition broker is closing');
    if (request.method !== 'POST' || !acceptedPath(request.url)) {
      return reject(
        response,
        404,
        'unsupported_route',
        'only POST /v1/chat/completions is admitted',
      );
    }
    if (String(request.headers['content-encoding'] || 'identity') !== 'identity') {
      return reject(response, 415, 'content_encoding_unsupported', 'compressed bodies are refused');
    }
    if (
      !String(request.headers['content-type'] || '')
        .toLowerCase()
        .startsWith('application/json')
    ) {
      return reject(response, 415, 'content_type_invalid', 'application/json is required');
    }
    const client = authenticate(request.headers.authorization, clients);
    if (!client) return reject(response, 401, 'client_unauthorized', 'unknown resident bearer');
    if (request.headers[cognitionHeaderNames.protocol] !== COGNITION_TRANSPORT_PROTOCOL) {
      return reject(response, 400, 'transport_protocol_invalid', 'cognition protocol is required');
    }
    const clientRequestId = boundedHeader(request.headers[cognitionHeaderNames.requestId], 1, 200);
    const priority = request.headers[cognitionHeaderNames.priority];
    const purpose = request.headers[cognitionHeaderNames.purpose];
    const urgentTriggerSequence = parseUrgentTrigger(
      request.headers[cognitionHeaderNames.urgentTrigger],
    );
    if (
      !clientRequestId ||
      !isPriority(priority) ||
      !isPurpose(purpose) ||
      (purpose === 'resident_prefix_readiness' && !client.lmStudioLocal) ||
      urgentTriggerSequence === 'invalid' ||
      (priority === 'urgent') !== (urgentTriggerSequence != null)
    ) {
      return reject(response, 400, 'scheduling_headers_invalid', 'scheduling headers are invalid');
    }
    let body: Buffer;
    let model: string;
    try {
      body = await readBody(request, maxBodyBytes);
      const requestValue = validateRequestBody(body);
      model = client.lmStudioLocal ? client.model : requestValue.model;
      if (!client.lmStudioLocal && !client.models.includes(model)) {
        throw codedError('request_model_not_admitted', 'resident requested an unbound model');
      }
      if (client.routePolicy) {
        if (purpose !== 'resident_decision') {
          throw codedError(
            'request_route_policy_mismatch',
            'route-controlled clients admit direct resident decisions only',
          );
        }
        try {
          assertOpenRouterRouteRequest(requestValue, model, client.routePolicy);
        } catch (error: any) {
          throw codedError(
            'request_route_policy_mismatch',
            error?.message || 'request route policy differs from the admitted policy',
          );
        }
      }
      if (client.ollamaLocal) {
        if (purpose !== 'resident_decision') {
          throw codedError(
            'request_ollama_policy_mismatch',
            'local Ollama clients admit direct resident decisions only',
          );
        }
        try {
          assertOllamaLocalRequest(requestValue, model, client.ollamaLocal);
        } catch (error: any) {
          throw codedError(
            'request_ollama_policy_mismatch',
            error?.message || 'request differs from the admitted Ollama policy',
          );
        }
      }
      if (client.lmStudioLocal) {
        try {
          assertLmStudioRequestForPurpose(requestValue, client.lmStudioLocal, purpose);
        } catch (error: any) {
          throw codedError(
            'request_lmstudio_policy_mismatch',
            error?.message || 'request differs from the admitted LM Studio policy',
          );
        }
      }
    } catch (error: any) {
      const status = error?.code === 'body_too_large' ? 413 : 400;
      return reject(response, status, error?.code || 'request_body_invalid', error?.message);
    }
    if (maxAccepted != null && metrics.accepted >= maxAccepted) {
      return reject(
        response,
        429,
        'cognition_admission_limit_exhausted',
        'cognition admission limit is exhausted',
      );
    }
    if (queuedCount() >= maxQueued) {
      return reject(response, 429, 'queue_capacity_exhausted', 'cognition queue is full');
    }
    if (residentQueuedCount(client.residentKey) >= maxQueuedPerResident) {
      return reject(
        response,
        429,
        'resident_queue_capacity_exhausted',
        'resident cognition queue is full',
      );
    }
    const queuedAt = now();
    const job: Job = {
      state: 'queued',
      brokerRequestId: `broker-${randomUUID()}`,
      clientRequestId,
      logicalRequestAttempt: null,
      client,
      model,
      priority,
      purpose,
      urgentTriggerSequence,
      body,
      bodySha256: sha256(body),
      queuedAt,
      queueDepthOnArrival: queuedCount(),
      request,
      response,
      upstreamAbort: null,
      admission: null,
      quotaCharge: null,
      transportCaptureHandle: null,
      transportCaptureReference: null,
    };
    metrics.accepted += 1;
    acceptedByPurpose[purpose] += 1;
    queues.get(priority)!.push(job);
    metrics.peakQueued = Math.max(metrics.peakQueued, queuedCount());
    try {
      emit('accepted', job, {
        active,
        queued: queuedCount(),
        accepted: metrics.accepted,
        acceptedLimit: maxAccepted,
        acceptedRemaining: maxAccepted == null ? null : maxAccepted - metrics.accepted,
      });
      if (
        maxAccepted != null &&
        metrics.accepted === maxAccepted &&
        admissionLimitEvidence == null
      ) {
        admissionLimitEvidence = Object.freeze({
          protocol: COGNITION_ADMISSION_LIMIT_PROTOCOL,
          brokerId,
          accepted: metrics.accepted,
          limit: maxAccepted,
          at: now(),
        });
        resolveAdmissionLimit(admissionLimitEvidence);
      }
    } catch (error) {
      job.state = 'cancelled';
      metrics.cancelled += 1;
      throw error;
    }
    const cancel = () => {
      try {
        cancelJob(job, 'client_disconnected');
      } catch (error) {
        containAsyncFailure(error);
      }
    };
    request.once('aborted', cancel);
    response.once('close', () => {
      if (!response.writableEnded) cancel();
    });
    pump();
    maybeSettleAdmissionLimit();
  }

  function reject(response: ServerResponse, status: number, code: string, message: string) {
    metrics.rejected += 1;
    emit('rejected', null, { status, code });
    writeError(response, status, code, message);
  }

  function cancelJob(job: Job, reason: string) {
    if (job.state === 'completed' || job.state === 'cancelled' || job.state === 'cancelling') {
      return;
    }
    if (job.state === 'queued') {
      job.state = 'cancelled';
      metrics.cancelled += 1;
      emit('cancelled', job, {
        reason,
        admitted: false,
        queueMs: Math.max(0, now() - job.queuedAt),
        activeBeforeRelease: null,
      });
    } else {
      job.state = 'cancelling';
      try {
        emit('cancel_requested', job, {
          reason,
          admitted: true,
          queueMs: job.admission?.queueMs ?? 0,
          activeBeforeRelease: active,
        });
      } finally {
        job.upstreamAbort?.abort(new Error(reason));
      }
    }
    pump();
    maybeSettleAdmissionLimit();
  }

  function pump() {
    if (closing) return;
    while (active < maxConcurrent) {
      const job = nextJob();
      if (!job) return;
      const accounting = accountingLedgers.get(job.client.residentKey);
      if (accounting) {
        let charged: ReturnType<QuotaLedger['charge']>;
        try {
          const quotaPurpose =
            job.purpose === 'resident_prefix_readiness' ? 'resident_decision' : job.purpose;
          charged = accounting.charge(quotaPurpose, job.brokerRequestId, {
            clientRequestId: job.clientRequestId,
            residentKey: job.client.residentKey,
            priority: job.priority,
            purpose: job.purpose,
            quotaPurpose,
            urgentTriggerSequence: job.urgentTriggerSequence,
            model: job.model,
            bodySha256: job.bodySha256,
            bodyBytes: job.body.byteLength,
          });
        } catch (error) {
          throw recordFatalFailure(error);
        }
        if (charged.ok === false) {
          job.state = 'completed';
          metrics.failed += 1;
          metrics.rejected += 1;
          emit('completed', job, {
            status: 429,
            ok: false,
            error: 'resident_purpose_quota_exhausted',
            quota: charged,
            admitted: false,
          });
          if (!job.response.destroyed) {
            writeError(
              job.response,
              429,
              'resident_purpose_quota_exhausted',
              `resident ${job.purpose} provider-attempt quota is exhausted`,
            );
          }
          maybeSettleAdmissionLimit();
          continue;
        }
        job.quotaCharge = charged;
      }
      const admittedAt = now();
      const activeBeforeAdmission = active;
      const logicalAttemptKey = `${job.client.residentKey}\0${job.clientRequestId}`;
      job.logicalRequestAttempt = (logicalRequestAttempts.get(logicalAttemptKey) ?? 0) + 1;
      logicalRequestAttempts.set(logicalAttemptKey, job.logicalRequestAttempt);
      const admission: CognitionAdmissionEvidence = Object.freeze({
        protocol: COGNITION_ADMISSION_PROTOCOL,
        brokerId,
        brokerRequestId: job.brokerRequestId,
        clientRequestId: job.clientRequestId,
        residentKey: job.client.residentKey,
        model: job.model,
        bodySha256: job.bodySha256,
        priority: job.priority,
        purpose: job.purpose,
        urgentTriggerSequence: job.urgentTriggerSequence,
        queuedAt: job.queuedAt,
        admittedAt,
        queueMs: Math.max(0, admittedAt - job.queuedAt),
        queueDepthOnArrival: job.queueDepthOnArrival,
        activeBeforeAdmission,
        concurrencyLimit: maxConcurrent,
        admissionOrdinal: ++metrics.admissionOrdinal,
      });
      job.state = 'active';
      job.admission = admission;
      job.upstreamAbort = new AbortController();
      active += 1;
      activeJobs.add(job);
      activeResidents.add(job.client.residentKey);
      metrics.admitted += 1;
      metrics.totalQueueMs += admission.queueMs;
      metrics.peakActive = Math.max(metrics.peakActive, active);
      try {
        emit('admitted', job, {
          ...admission,
          logicalRequestAttempt: job.logicalRequestAttempt,
          quota: job.quotaCharge
            ? {
                scopeId: job.client.accounting!.scopeId,
                accountId: job.client.accounting!.accountId,
                purposeOrdinal: job.quotaCharge.ordinal,
                purposeLimit: job.quotaCharge.limit,
                purposeRemaining: job.quotaCharge.remaining,
                ledgerFile: accounting!.file,
                ledgerTipDigest: job.quotaCharge.event.digest,
              }
            : null,
        });
      } catch (error) {
        job.state = 'cancelled';
        metrics.cancelled += 1;
        job.upstreamAbort.abort(error);
        active = Math.max(0, active - 1);
        activeJobs.delete(job);
        activeResidents.delete(job.client.residentKey);
        notifyDrained();
        throw error;
      }
      void execute(job)
        .catch((error) => {
          recordFatalFailure(error);
          if (!job.response.destroyed && !job.response.headersSent) {
            writeError(job.response, 500, 'broker_internal_error', 'cognition broker failed');
          }
        })
        .finally(() => {
          active = Math.max(0, active - 1);
          activeJobs.delete(job);
          activeResidents.delete(job.client.residentKey);
          if (!closing) pump();
          else notifyDrained();
          maybeSettleAdmissionLimit();
        })
        .catch(containAsyncFailure);
    }
  }

  function nextJob(): Job | null {
    discardCancelledHeads();
    const hasUrgent = hasEligible('urgent');
    const hasDeliberative = hasEligible('deliberative');
    const hasAuxiliary = hasEligible('auxiliary');
    if (!hasUrgent && !hasDeliberative && !hasAuxiliary) return null;

    let selected: CognitionPriority;
    if (hasAuxiliary && nonAuxiliaryBurst >= maxNonAuxiliaryBurst) selected = 'auxiliary';
    else if (hasUrgent && (!hasDeliberative || urgentBurst < maxUrgentBurst)) selected = 'urgent';
    else if (hasDeliberative) selected = 'deliberative';
    else if (hasUrgent) selected = 'urgent';
    else selected = 'auxiliary';

    if (selected === 'urgent') {
      urgentBurst += 1;
      nonAuxiliaryBurst += 1;
    } else if (selected === 'deliberative') {
      urgentBurst = 0;
      nonAuxiliaryBurst += 1;
    } else {
      urgentBurst = 0;
      nonAuxiliaryBurst = 0;
    }
    return takeEligible(selected);
  }

  function discardCancelledHeads() {
    for (const queue of queues.values()) {
      while (queue[0]?.state === 'cancelled') queue.shift();
    }
  }

  function hasEligible(priority: CognitionPriority) {
    return queues
      .get(priority)!
      .some((job) => job.state === 'queued' && !activeResidents.has(job.client.residentKey));
  }

  function takeEligible(priority: CognitionPriority) {
    const queue = queues.get(priority)!;
    const index = queue.findIndex(
      (job) => job.state === 'queued' && !activeResidents.has(job.client.residentKey),
    );
    if (index < 0) return null;
    return queue.splice(index, 1)[0];
  }

  async function execute(job: Job) {
    const upstreamStartedAt = now();
    if (transportCapture) {
      const quota = job.quotaCharge
        ? {
            accountId: job.client.accounting!.accountId,
            purposeOrdinal: job.quotaCharge.ordinal,
            purposeLimit: job.quotaCharge.limit,
            purposeRemaining: job.quotaCharge.remaining,
            ledgerFile: accountingLedgers.get(job.client.residentKey)!.file,
            ledgerTipDigest: job.quotaCharge.event.digest,
          }
        : null;
      try {
        job.transportCaptureHandle = transportCapture.start({
          brokerId,
          brokerRequestId: job.brokerRequestId,
          clientRequestId: job.clientRequestId,
          logicalRequestAttempt: job.logicalRequestAttempt!,
          residentKey: job.client.residentKey,
          admissionOrdinal: job.admission!.admissionOrdinal,
          priority: job.priority,
          purpose: job.purpose,
          urgentTriggerSequence: job.urgentTriggerSequence,
          requestedModel: job.model,
          upstreamEndpoint: upstream,
          ...(job.client.ollamaLocal || job.client.lmStudioLocal
            ? { upstreamAuthentication: 'none_loopback' as const }
            : {}),
          ...(job.client.ollamaLocal
            ? {
                ollamaIdentity: ollamaAttemptIdentity(
                  job.client.ollamaLocal,
                  options.ollamaPreflight!,
                  parseJsonObject(job.body),
                ),
              }
            : {}),
          ...(job.client.lmStudioLocal
            ? {
                lmStudioIdentity: lmStudioAttemptIdentity(
                  job.client.lmStudioLocal,
                  options.lmStudioPreflight!,
                  assertLmStudioRequestForPurpose(
                    parseJsonObject(job.body),
                    job.client.lmStudioLocal,
                    job.purpose,
                  ),
                ),
              }
            : {}),
          requestBody: job.body,
          queuedAt: job.queuedAt,
          admittedAt: job.admission!.admittedAt,
          upstreamStartedAt,
          queueMs: job.admission!.queueMs,
          quota,
        });
      } catch (error) {
        throw recordFatalFailure(error);
      }
    }
    const admissionHeaders = cognitionAdmissionHeaders(job.admission!);
    const timeout = setTimeout(() => {
      job.upstreamAbort?.abort(codedError('upstream_timeout', 'model upstream timed out'));
    }, maxCallMs);
    timeout.unref?.();
    try {
      const upstreamResponse = await callFetch(upstream, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(usesLocalRuntime ? {} : { authorization: `Bearer ${upstreamApiKey}` }),
        },
        // Admission rejects non-canonical UTF-8, so this is byte-preserving.
        body: job.body.toString('utf8'),
        signal: job.upstreamAbort!.signal,
      });
      const responseBody = await readResponseBody(upstreamResponse, maxResponseBytes);
      const contentType = upstreamResponse.headers.get('content-type') || 'application/json';
      if (job.state === 'cancelling' || job.state === 'cancelled' || job.response.destroyed) {
        recordInflightCancellation(job, 'client_disconnected_after_upstream', {
          status: upstreamResponse.status,
          ok: upstreamResponse.ok,
          body: responseBody,
          contentType,
        });
        return;
      }
      const routeIdentity =
        upstreamResponse.ok && job.client.routePolicy
          ? inspectOpenRouterResponseIdentity(
              parseJsonObject(responseBody),
              job.model,
              job.client.routePolicy,
            )
          : null;
      const localIdentity =
        upstreamResponse.ok && job.client.ollamaLocal
          ? inspectOllamaLocalResponseIdentity(
              parseJsonObject(responseBody),
              job.client.ollamaLocal,
            )
          : null;
      const lmStudioIdentity =
        upstreamResponse.ok && job.client.lmStudioLocal
          ? inspectLmStudioLocalResponseIdentity(
              parseJsonObject(responseBody),
              job.client.lmStudioLocal,
            )
          : null;
      if (routeIdentity && !routeIdentity.ok) {
        const failure = codedError(
          'route_identity_mismatch',
          `upstream route identity did not match the admitted policy: ${routeIdentity.reason}`,
        );
        const transportCapture = finishTransportCapture(job, {
          terminal: 'route_identity_mismatch',
          completedAt: now(),
          response: {
            status: upstreamResponse.status,
            ok: upstreamResponse.ok,
            body: responseBody,
            contentType,
          },
          error: failure,
        });
        settleProviderCharge(job, {
          outcome: 'route_identity_mismatch',
          status: upstreamResponse.status,
          ok: false,
          responseBytes: responseBody.byteLength,
          responseSha256: sha256(responseBody),
          usage: providerUsage(responseBody),
          routeIdentity,
          transportCapture,
        });
        job.state = 'completed';
        metrics.failed += 1;
        emit('completed', job, {
          status: 502,
          ok: false,
          error: failure.code,
          upstreamStatus: upstreamResponse.status,
          responseBytes: responseBody.byteLength,
          queueMs: job.admission!.queueMs,
          activeBeforeRelease: active,
          routeIdentity,
          transportCapture,
        });
        writeError(
          job.response,
          502,
          failure.code,
          'model upstream returned an unadmitted route identity',
          admissionHeaders,
        );
        return;
      }
      if (localIdentity && !localIdentity.ok) {
        const failure = codedError(
          'ollama_identity_mismatch',
          `Ollama response model did not match the admitted local identity: ${localIdentity.reason}`,
        );
        const transportCapture = finishTransportCapture(job, {
          terminal: 'ollama_identity_mismatch',
          completedAt: now(),
          response: {
            status: upstreamResponse.status,
            ok: upstreamResponse.ok,
            body: responseBody,
            contentType,
          },
          error: failure,
        });
        settleProviderCharge(job, {
          outcome: 'ollama_identity_mismatch',
          status: upstreamResponse.status,
          ok: false,
          responseBytes: responseBody.byteLength,
          responseSha256: sha256(responseBody),
          usage: providerUsage(responseBody),
          localIdentity,
          transportCapture,
        });
        job.state = 'completed';
        metrics.failed += 1;
        emit('completed', job, {
          status: 502,
          ok: false,
          error: failure.code,
          upstreamStatus: upstreamResponse.status,
          responseBytes: responseBody.byteLength,
          queueMs: job.admission!.queueMs,
          activeBeforeRelease: active,
          localIdentity,
          transportCapture,
        });
        writeError(
          job.response,
          502,
          failure.code,
          'Ollama returned an unadmitted model identity',
          admissionHeaders,
        );
        return;
      }
      if (lmStudioIdentity && !lmStudioIdentity.ok) {
        const failure = codedError(
          'lmstudio_identity_mismatch',
          `LM Studio response model did not match the admitted local identity: ${lmStudioIdentity.reason}`,
        );
        const transportCapture = finishTransportCapture(job, {
          terminal: 'lmstudio_identity_mismatch',
          completedAt: now(),
          response: {
            status: upstreamResponse.status,
            ok: upstreamResponse.ok,
            body: responseBody,
            contentType,
          },
          error: failure,
        });
        settleProviderCharge(job, {
          outcome: 'lmstudio_identity_mismatch',
          status: upstreamResponse.status,
          ok: false,
          responseBytes: responseBody.byteLength,
          responseSha256: sha256(responseBody),
          usage: providerUsage(responseBody),
          lmStudioIdentity,
          transportCapture,
        });
        job.state = 'completed';
        metrics.failed += 1;
        emit('completed', job, {
          status: 502,
          ok: false,
          error: failure.code,
          upstreamStatus: upstreamResponse.status,
          responseBytes: responseBody.byteLength,
          queueMs: job.admission!.queueMs,
          activeBeforeRelease: active,
          lmStudioIdentity,
          transportCapture,
        });
        writeError(
          job.response,
          502,
          failure.code,
          'LM Studio returned an unadmitted model instance identity',
          admissionHeaders,
        );
        return;
      }
      const transportCapture = finishTransportCapture(job, {
        terminal: upstreamResponse.ok ? 'success' : 'provider_error',
        completedAt: now(),
        response: {
          status: upstreamResponse.status,
          ok: upstreamResponse.ok,
          body: responseBody,
          contentType,
        },
      });
      settleProviderCharge(job, {
        outcome: 'upstream_response',
        status: upstreamResponse.status,
        ok: upstreamResponse.ok,
        responseBytes: responseBody.byteLength,
        responseSha256: sha256(responseBody),
        usage: providerUsage(responseBody),
        transportCapture,
      });
      job.state = 'completed';
      if (upstreamResponse.ok) metrics.completed += 1;
      else metrics.failed += 1;
      emit('completed', job, {
        status: upstreamResponse.status,
        ok: upstreamResponse.ok,
        responseBytes: responseBody.byteLength,
        queueMs: job.admission!.queueMs,
        activeBeforeRelease: active,
        transportCapture,
      });
      job.response.writeHead(upstreamResponse.status, {
        'content-type': contentType,
        'content-length': String(responseBody.byteLength),
        ...admissionHeaders,
      });
      job.response.end(responseBody);
    } catch (error: any) {
      if (error?.code === 'provider_accounting_failed') throw error;
      if (job.state === 'cancelling' || job.upstreamAbort?.signal.aborted) {
        const timeout = (job.upstreamAbort?.signal.reason as any)?.code === 'upstream_timeout';
        if (timeout && job.state !== 'cancelling') {
          recordTimeout(job);
        } else {
          recordInflightCancellation(job, timeout ? 'upstream_timeout' : 'upstream_abort_settled');
        }
        return;
      }
      if (job.state === 'cancelled') return;
      if (job.state === 'completed') {
        if (!job.response.destroyed && !job.response.headersSent) {
          writeError(job.response, 500, 'broker_evidence_failed', 'cognition evidence failed');
        }
        return;
      }
      settleProviderCharge(job, {
        outcome: 'upstream_failure',
        status: null,
        ok: false,
        error: error?.code || error?.message || String(error),
        usage: null,
        transportCapture: finishTransportCapture(job, {
          terminal: 'network_error',
          completedAt: now(),
          error,
        }),
      });
      metrics.failed += 1;
      job.state = 'completed';
      emit('completed', job, {
        status: null,
        ok: false,
        error: error?.code || error?.message || String(error),
        queueMs: job.admission!.queueMs,
        activeBeforeRelease: active,
        transportCapture: job.transportCaptureReference,
      });
      if (!job.response.destroyed) {
        writeError(
          job.response,
          error?.code === 'response_too_large' ? 502 : 502,
          error?.code || 'upstream_failed',
          'model upstream failed',
          admissionHeaders,
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  function recordInflightCancellation(
    job: Job,
    reason: string,
    response?: Readonly<{
      status: number;
      ok: boolean;
      body: Buffer;
      contentType: string;
    }>,
  ) {
    if (job.state === 'cancelled') return;
    job.state = 'cancelled';
    const transportCapture = finishTransportCapture(
      job,
      response
        ? { terminal: 'cancelled', completedAt: now(), response, error: new Error(reason) }
        : { terminal: 'cancelled', completedAt: now(), error: new Error(reason) },
    );
    settleProviderCharge(job, {
      outcome: 'cancelled',
      status: null,
      ok: false,
      reason,
      usage: null,
      transportCapture,
    });
    metrics.cancelled += 1;
    if (!journalFailure) {
      emit('cancelled', job, {
        reason,
        admitted: true,
        queueMs: job.admission?.queueMs ?? 0,
        activeBeforeRelease: active,
        transportCapture,
      });
    }
  }

  function recordTimeout(job: Job) {
    if (job.state === 'completed' || job.state === 'cancelled') return;
    job.state = 'completed';
    const transportCapture = finishTransportCapture(job, {
      terminal: 'timeout',
      completedAt: now(),
      error: codedError('upstream_timeout', 'model upstream timed out'),
    });
    settleProviderCharge(job, {
      outcome: 'upstream_timeout',
      status: null,
      ok: false,
      error: 'upstream_timeout',
      usage: null,
      transportCapture,
    });
    metrics.failed += 1;
    if (!journalFailure) {
      emit('completed', job, {
        status: null,
        ok: false,
        error: 'upstream_timeout',
        queueMs: job.admission?.queueMs ?? 0,
        activeBeforeRelease: active,
        transportCapture,
      });
    }
    if (!job.response.destroyed) {
      writeError(
        job.response,
        504,
        'upstream_timeout',
        'model upstream timed out',
        cognitionAdmissionHeaders(job.admission!),
      );
    }
  }

  function queuedCount() {
    let count = 0;
    for (const queue of queues.values()) {
      count += queue.reduce((total, job) => total + (job.state === 'queued' ? 1 : 0), 0);
    }
    return count;
  }

  function residentQueuedCount(residentKey: string) {
    let count = 0;
    for (const queue of queues.values()) {
      count += queue.reduce(
        (total, job) =>
          total + (job.state === 'queued' && job.client.residentKey === residentKey ? 1 : 0),
        0,
      );
    }
    return count;
  }

  function settleProviderCharge(job: Job, data: unknown) {
    if (!job.quotaCharge) return;
    const ledger = accountingLedgers.get(job.client.residentKey);
    if (!ledger) throw codedError('provider_accounting_failed', 'provider quota ledger is missing');
    try {
      ledger.settle(job.brokerRequestId, data);
    } catch (error: any) {
      const failure = codedError(
        'provider_accounting_failed',
        error?.message || 'provider quota settlement failed',
      );
      recordFatalFailure(failure);
      throw failure;
    }
  }

  function finishTransportCapture(
    job: Job,
    outcome: Parameters<CognitionTransportCaptureStore['finish']>[1],
  ) {
    if (job.transportCaptureReference) return job.transportCaptureReference;
    if (!transportCapture) return null;
    if (!job.transportCaptureHandle) {
      throw recordFatalFailure(
        codedError('transport_capture_missing_start', 'provider attempt capture has no start'),
      );
    }
    try {
      job.transportCaptureReference = transportCapture.finish(job.transportCaptureHandle, outcome);
      return job.transportCaptureReference;
    } catch (error) {
      throw recordFatalFailure(error);
    }
  }

  function snapshot(): CognitionBrokerSnapshot {
    return Object.freeze({
      protocol: 'behold.cognition-broker-snapshot.v1',
      brokerId,
      concurrencyLimit: maxConcurrent,
      acceptedLimit: maxAccepted,
      acceptedRemaining: maxAccepted == null ? null : Math.max(0, maxAccepted - metrics.accepted),
      acceptedByPurpose: Object.freeze({ ...acceptedByPurpose }),
      active,
      queued: queuedCount(),
      ...metrics,
      closing,
      healthy: journalFailure == null,
      accounting:
        accountingLedgers.size > 0
          ? {
              accounts: Object.freeze(
                [...accountingLedgers.values()]
                  .map((ledger) => ledger.snapshot())
                  .sort((left, right) => left.accountId.localeCompare(right.accountId)),
              ),
            }
          : null,
      journal: journalFile ? { file: journalFile, tipDigest: journalTipDigest } : null,
      transportCaptureDirectory,
    });
  }

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
  } catch (error) {
    if (journalDescriptor != null) fs.closeSync(journalDescriptor);
    closeAccountingLedgers(accountingLedgers);
    throw error;
  }
  let endpoint: string;
  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('cognition broker has no TCP port');
    }
    endpoint = `http://127.0.0.1:${address.port}/v1/chat/completions`;
    emit('started', null, {
      endpoint,
      upstreamTransport: usesOllama
        ? 'ollama_local_native_chat'
        : usesLmStudio
          ? 'lmstudio_local_openai_structured_output'
          : 'openrouter_chat_completions',
      ...(usesOllama ? { ollamaPreflight: options.ollamaPreflight } : {}),
      ...(usesLmStudio ? { lmStudioPreflight: options.lmStudioPreflight } : {}),
      concurrencyLimit: maxConcurrent,
      acceptedLimit: maxAccepted,
      maxCallMs,
      transportCapture: transportCapture
        ? {
            protocol: 'behold.cognition-transport-attempt.v1',
            directory: transportCapture.directory,
            authenticationHeadersRetained: false,
          }
        : null,
      accounting:
        accountingLedgers.size > 0
          ? [...accountingLedgers.values()]
              .map((ledger) => ledger.snapshot())
              .sort((left, right) => left.accountId.localeCompare(right.accountId))
          : null,
    });
  } catch (error) {
    await closeListeningServer();
    closeJournal();
    closeAccountingLedgers(accountingLedgers);
    throw error;
  }
  server.on('error', (error) => {
    if (closing) return;
    containAsyncFailure(error);
  });

  const close = () => {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      closing = true;
      let closeFailure: Error | null = journalFailure;
      const rememberFailure = (error: unknown) => {
        closeFailure ??= error instanceof Error ? error : new Error(String(error));
      };
      try {
        if (!journalFailure) {
          try {
            emit('draining', null, snapshot());
          } catch (error) {
            rememberFailure(error);
          }
        }
        for (const queue of queues.values()) {
          for (const job of queue) {
            if (job.state !== 'queued') continue;
            job.state = 'cancelled';
            metrics.cancelled += 1;
            if (!job.response.destroyed) {
              writeError(job.response, 503, 'broker_closing', 'cognition broker is closing');
            }
            if (!journalFailure) {
              try {
                emit('cancelled', job, { reason: 'broker_closing', admitted: false });
              } catch (error) {
                rememberFailure(error);
              }
            }
          }
        }
        for (const job of activeJobs) {
          try {
            cancelJob(job, 'broker_closing');
          } catch (error) {
            rememberFailure(error);
          }
        }
        maybeSettleAdmissionLimit();
        await waitUntilDrained();
        maybeSettleAdmissionLimit();
        if (!journalFailure) {
          try {
            emit('drained', null, snapshot());
          } catch (error) {
            rememberFailure(error);
          }
        }
      } finally {
        try {
          closeJournal();
        } catch (error) {
          rememberFailure(error);
        }
        for (const ledger of accountingLedgers.values()) {
          try {
            ledger.close();
          } catch (error) {
            rememberFailure(error);
          }
        }
        try {
          await closeListeningServer();
        } catch (error) {
          rememberFailure(error);
        }
      }
      if (journalFailure) throw journalFailure;
      if (closeFailure) throw closeFailure;
      return snapshot();
    })();
    return closePromise;
  };
  requestClose = close;

  return Object.freeze({
    protocol: COGNITION_TRANSPORT_PROTOCOL,
    brokerId,
    endpoint,
    journalFile,
    transportCaptureDirectory,
    failed,
    admissionLimitReached,
    admissionLimitSettled,
    snapshot,
    close,
  });

  function waitUntilDrained() {
    if (active === 0 && queuedCount() === 0) return Promise.resolve();
    return new Promise<void>((resolve) => drainWaiters.add(resolve));
  }

  function notifyDrained() {
    if (active !== 0 || queuedCount() !== 0) return;
    for (const resolve of drainWaiters) resolve();
    drainWaiters.clear();
  }

  function maybeSettleAdmissionLimit() {
    if (
      admissionLimitEvidence == null ||
      admissionLimitSettlementEvidence != null ||
      active !== 0 ||
      queuedCount() !== 0
    ) {
      return;
    }
    const terminal = metrics.completed + metrics.failed + metrics.cancelled;
    if (terminal !== metrics.accepted) return;
    admissionLimitSettlementEvidence = Object.freeze({
      protocol: COGNITION_ADMISSION_LIMIT_SETTLEMENT_PROTOCOL,
      brokerId,
      accepted: metrics.accepted,
      limit: admissionLimitEvidence.limit,
      terminal,
      completed: metrics.completed,
      failed: metrics.failed,
      cancelled: metrics.cancelled,
      at: now(),
    });
    resolveAdmissionLimitSettlement(admissionLimitSettlementEvidence);
  }

  function closeJournal() {
    if (journalDescriptor == null) return;
    try {
      fs.closeSync(journalDescriptor);
    } finally {
      journalDescriptor = null;
    }
  }

  function closeListeningServer() {
    return new Promise<void>((resolve) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close(() => resolve());
      server.closeIdleConnections();
      server.closeAllConnections();
    });
  }
}

function assertLmStudioRequestForPurpose(
  value: unknown,
  policy: LmStudioLocalPolicy,
  purpose: CognitionPurpose,
) {
  if (purpose === 'loom_fold') return assertLmStudioLocalLoomFoldWireRequest(value, policy);
  if (purpose === 'resident_prefix_readiness') {
    return assertLmStudioLocalPrefixReadinessWireRequest(value, policy);
  }
  return assertLmStudioLocalWireRequest(value, policy);
}

function normalizeClients(values: CognitionBrokerOptions['clients']): readonly Client[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('cognition broker requires at least one client');
  }
  const bearers = new Set<string>();
  const residents = new Set<string>();
  return Object.freeze(
    values.map((value, index) => {
      const bearer = String(value?.bearer || '');
      const residentKey = String(value?.residentKey || '');
      const model = String(value?.model || '').trim();
      const models = [
        ...new Set([model, ...(value?.models ?? []).map((item) => String(item).trim())]),
      ];
      const accounting = value.accounting
        ? Object.freeze({
            scopeId: String(value.accounting.scopeId || ''),
            worldId: String(value.accounting.worldId || ''),
            accountId: String(value.accounting.accountId || ''),
            ledgerFile: path.resolve(String(value.accounting.ledgerFile || '')),
            limits: Object.freeze({ ...value.accounting.limits }),
          })
        : null;
      let routePolicy: OpenRouterRoutePolicy | null = null;
      try {
        routePolicy = value.routePolicy ? openRouterRoutePolicy(value.routePolicy) : null;
      } catch {
        throw new Error(`invalid cognition client route policy at index ${index}`);
      }
      let ollamaLocal: OllamaLocalPolicy | null = null;
      try {
        ollamaLocal = value.ollamaLocal ? ollamaLocalPolicy(value.ollamaLocal) : null;
      } catch {
        throw new Error(`invalid cognition client Ollama policy at index ${index}`);
      }
      let lmStudioLocal: LmStudioLocalPolicy | null = null;
      try {
        lmStudioLocal = value.lmStudioLocal ? lmStudioLocalPolicy(value.lmStudioLocal) : null;
      } catch {
        throw new Error(`invalid cognition client LM Studio policy at index ${index}`);
      }
      if ([routePolicy, ollamaLocal, lmStudioLocal].filter(Boolean).length > 1) {
        throw new Error(
          `cognition client cannot combine OpenRouter, Ollama, and LM Studio policy at index ${index}`,
        );
      }
      if (ollamaLocal && (ollamaLocal.modelTag !== model || models.length !== 1)) {
        throw new Error(`cognition client Ollama policy model differs at index ${index}`);
      }
      if (lmStudioLocal && (lmStudioLocal.modelKey !== model || models.length !== 1)) {
        throw new Error(`cognition client LM Studio policy model differs at index ${index}`);
      }
      if (
        bearer.length < 32 ||
        bearer.length > 512 ||
        !/^[a-f0-9]{64}$/.test(residentKey) ||
        !model ||
        model.length > 300 ||
        models.length > 16 ||
        models.some((item) => !item || item.length > 300) ||
        (accounting != null &&
          (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(accounting.scopeId) ||
            !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(accounting.worldId) ||
            !/^[a-f0-9]{64}$/.test(accounting.accountId) ||
            !path.isAbsolute(accounting.ledgerFile) ||
            Object.keys(accounting.limits).sort().join(',') !== 'loom_fold,resident_decision'))
      ) {
        throw new Error(`invalid cognition client at index ${index}`);
      }
      if (bearers.has(bearer) || residents.has(residentKey)) {
        throw new Error(`duplicate cognition client at index ${index}`);
      }
      bearers.add(bearer);
      residents.add(residentKey);
      return Object.freeze({
        bearer,
        residentKey,
        model,
        models: Object.freeze(models),
        routePolicy,
        ollamaLocal,
        lmStudioLocal,
        accounting,
      });
    }),
  );
}

function openAccountingLedgers(clients: readonly Client[], now: () => number) {
  const ledgers = new Map<string, QuotaLedger>();
  const files = new Set<string>();
  const accounts = new Set<string>();
  try {
    for (const client of clients) {
      if (!client.accounting) continue;
      if (files.has(client.accounting.ledgerFile) || accounts.has(client.accounting.accountId)) {
        throw new Error('cognition accounting files and account ids must be unique per client');
      }
      files.add(client.accounting.ledgerFile);
      accounts.add(client.accounting.accountId);
      ledgers.set(
        client.residentKey,
        openQuotaLedger({
          file: client.accounting.ledgerFile,
          scopeId: client.accounting.scopeId,
          worldId: client.accounting.worldId,
          accountId: client.accounting.accountId,
          layer: 'provider',
          limits: client.accounting.limits,
          now,
        }),
      );
    }
    return ledgers;
  } catch (error) {
    closeAccountingLedgers(ledgers);
    throw error;
  }
}

function closeAccountingLedgers(ledgers: ReadonlyMap<string, QuotaLedger>) {
  for (const ledger of ledgers.values()) ledger.close();
}

function authenticate(value: string | undefined, clients: readonly Client[]) {
  if (!value?.startsWith('Bearer ')) return null;
  const candidate = value.slice('Bearer '.length);
  for (const client of clients) {
    const left = Buffer.from(candidate);
    const right = Buffer.from(client.bearer);
    if (left.byteLength === right.byteLength && timingSafeEqual(left, right)) return client;
  }
  return null;
}

function acceptedPath(value: string | undefined) {
  return value === '/v1/chat/completions' || value === '/chat/completions';
}

function exactUpstreamEndpoint(value: string, allowedOrigins: readonly string[]) {
  const url = new URL(String(value || ''));
  const normalizedOrigins = new Set(
    allowedOrigins.map((origin) => {
      const parsed = new URL(origin);
      if (
        parsed.username ||
        parsed.password ||
        parsed.pathname !== '/' ||
        parsed.search ||
        parsed.hash
      ) {
        throw new Error(`invalid cognition upstream origin: ${origin}`);
      }
      return parsed.origin;
    }),
  );
  if (
    !normalizedOrigins.has(url.origin) ||
    url.username ||
    url.password ||
    url.hash ||
    url.protocol !== 'https:'
  ) {
    throw new Error('invalid cognition upstream endpoint');
  }
  if (!acceptedUpstreamPath(url.pathname) || url.search) {
    throw new Error('cognition upstream must be an exact chat-completions endpoint');
  }
  return url.toString();
}

function acceptedUpstreamPath(value: string) {
  return acceptedPath(value) || value === '/api/v1/chat/completions';
}

function validateRequestBody(body: Buffer) {
  const text = body.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(body)) {
    throw codedError('request_utf8_invalid', 'request body must be canonical UTF-8');
  }
  let value: any;
  try {
    value = JSON.parse(text);
  } catch {
    throw codedError('request_json_invalid', 'request body is not valid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw codedError('request_shape_invalid', 'request body must be a JSON object');
  }
  if (typeof value.model !== 'string' || !value.model.trim()) {
    throw codedError('request_model_invalid', 'request model is required');
  }
  if (!Array.isArray(value.messages)) {
    throw codedError('request_messages_invalid', 'request messages must be an array');
  }
  if (value.stream !== undefined && value.stream !== false) {
    throw codedError('request_streaming_unsupported', 'streaming requests are not admitted');
  }
  if (value.n !== undefined && value.n !== 1) {
    throw codedError('request_choice_count_invalid', 'exactly one model choice is admitted');
  }
  for (const field of ['max_tokens', 'max_completion_tokens'] as const) {
    if (
      value[field] !== undefined &&
      (!Number.isSafeInteger(value[field]) || value[field] < 1 || value[field] > 32_768)
    ) {
      throw codedError(
        'request_output_budget_invalid',
        `${field} must be a positive integer no greater than 32768`,
      );
    }
  }
  return value as Record<string, any> & { model: string };
}

function readBody(request: IncomingMessage, limit: number) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let failed = false;
    request.on('data', (chunk) => {
      if (failed) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > limit) {
        failed = true;
        reject(codedError('body_too_large', 'request body exceeded the byte budget'));
        return;
      }
      chunks.push(buffer);
    });
    request.once('end', () => {
      if (!failed) resolve(Buffer.concat(chunks));
    });
    request.once('error', reject);
    request.once('aborted', () => reject(codedError('client_aborted', 'client disconnected')));
  });
}

async function readResponseBody(response: Response, limit: number) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    await response.body?.cancel().catch(() => undefined);
    throw codedError('response_too_large', 'upstream response exceeded the byte budget');
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = Buffer.from(next.value);
      bytes += chunk.byteLength;
      if (bytes > limit) {
        await reader.cancel('response byte budget exceeded').catch(() => undefined);
        throw codedError('response_too_large', 'upstream response exceeded the byte budget');
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, bytes);
}

function providerUsage(body: Buffer) {
  let value: any;
  try {
    value = JSON.parse(body.toString('utf8'));
  } catch {
    return null;
  }
  const usage =
    value?.usage ??
    (value?.prompt_eval_count != null || value?.eval_count != null
      ? {
          prompt_tokens: value?.prompt_eval_count,
          completion_tokens: value?.eval_count,
          total_tokens:
            Number.isFinite(Number(value?.prompt_eval_count)) &&
            Number.isFinite(Number(value?.eval_count))
              ? Number(value.prompt_eval_count) + Number(value.eval_count)
              : undefined,
        }
      : null);
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;
  const fields = ['prompt_tokens', 'completion_tokens', 'total_tokens', 'cost'] as const;
  const reported: Partial<Record<(typeof fields)[number], number>> = {};
  for (const field of fields) {
    if (usage[field] == null || usage[field] === '') continue;
    const number = Number(usage[field]);
    if (Number.isFinite(number) && number >= 0) reported[field] = number;
  }
  return Object.keys(reported).length > 0 ? reported : null;
}

function parseJsonObject(body: Buffer) {
  try {
    const value = JSON.parse(body.toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function writeError(
  response: ServerResponse,
  status: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
) {
  if (response.destroyed || response.writableEnded) return;
  const body = Buffer.from(JSON.stringify({ error: { code, message } }));
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': String(body.byteLength),
    ...headers,
  });
  response.end(body);
}

function boundedHeader(value: string | string[] | undefined, min: number, max: number) {
  if (typeof value !== 'string' || value.length < min || value.length > max) return null;
  return /^[A-Za-z0-9._:-]+$/.test(value) ? value : null;
}

function isPriority(value: unknown): value is CognitionPriority {
  return value === 'urgent' || value === 'deliberative' || value === 'auxiliary';
}

function isPurpose(value: unknown): value is CognitionPurpose {
  return (
    value === 'resident_decision' || value === 'resident_prefix_readiness' || value === 'loom_fold'
  );
}

function parseUrgentTrigger(value: string | string[] | undefined): number | null | 'invalid' {
  if (value === 'none') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 'invalid';
}

function positiveInteger(value: number, name: string, maximum: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be a positive safe integer no greater than ${maximum}`);
  }
  return value;
}

function codedError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

function sha256(value: Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

function fsyncDirectory(directory: string) {
  const descriptor = fs.openSync(directory, 'r');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function ensureDurableDirectory(directoryValue: string) {
  const directory = path.resolve(directoryValue);
  const missing: string[] = [];
  let cursor = directory;
  while (!fs.existsSync(cursor)) {
    missing.push(cursor);
    const parent = path.dirname(cursor);
    if (parent === cursor)
      throw new Error(`cannot create cognition journal directory: ${directory}`);
    cursor = parent;
  }
  const ancestor = fs.lstatSync(cursor);
  if (!ancestor.isDirectory() || ancestor.isSymbolicLink()) {
    throw new Error(`cognition journal ancestor is not a plain directory: ${cursor}`);
  }
  for (const next of missing.reverse()) {
    fs.mkdirSync(next, { mode: 0o700 });
    fsyncDirectory(next);
    fsyncDirectory(path.dirname(next));
  }
  const stats = fs.lstatSync(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`cognition journal directory is not plain: ${directory}`);
  }
}

export function verifyCognitionBrokerJournal(fileValue: string) {
  const file = path.resolve(fileValue);
  const stats = fs.lstatSync(file);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`cognition broker journal is not a plain file: ${file}`);
  }
  const lines = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0);
  if (lines.length === 0) throw new Error(`cognition broker journal is empty: ${file}`);
  const events: CognitionBrokerEvent[] = [];
  let previousDigest: string | null = null;
  let brokerId: string | null = null;
  const accepted = new Set<string>();
  const admitted = new Set<string>();
  const terminal = new Set<string>();
  const cancellationRequested = new Set<string>();
  const requestMetadata = new Map<string, string>();
  let draining = false;
  let startedCount = 0;
  let drainingCount = 0;
  let drainedCount = 0;
  let active = 0;
  let peakActive = 0;
  let acceptedLimit: number | null = null;
  for (const [index, line] of lines.entries()) {
    let event: CognitionBrokerEvent;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error(`invalid cognition broker JSON at line ${index + 1}: ${file}`);
    }
    const { digest, ...base } = event as any;
    const expectedDigest = sha256(Buffer.from(JSON.stringify(base)));
    if (
      event.protocol !== COGNITION_BROKER_EVENT_PROTOCOL ||
      event.sequence !== index + 1 ||
      event.previousDigest !== previousDigest ||
      !/^[a-f0-9]{64}$/.test(String(digest || '')) ||
      digest !== expectedDigest
    ) {
      throw new Error(`invalid cognition broker chain at line ${index + 1}: ${file}`);
    }
    if (brokerId == null) brokerId = event.brokerId;
    if (!brokerId || event.brokerId !== brokerId) {
      throw new Error(`cognition broker identity changed at line ${index + 1}: ${file}`);
    }
    if (
      ![
        'started',
        'accepted',
        'admitted',
        'completed',
        'cancel_requested',
        'cancelled',
        'rejected',
        'draining',
        'drained',
      ].includes(event.type)
    ) {
      throw new Error(`unknown cognition broker event at line ${index + 1}: ${file}`);
    }
    const requestId = event.request?.brokerRequestId ?? null;
    if (requestId) {
      const serialized = JSON.stringify(event.request);
      const prior = requestMetadata.get(requestId);
      if (prior != null && prior !== serialized) {
        throw new Error(`cognition request identity changed at line ${index + 1}: ${file}`);
      }
      requestMetadata.set(requestId, serialized);
    }
    if (event.type === 'started') {
      startedCount += 1;
      if (index !== 0 || event.request != null) {
        throw new Error(`invalid cognition broker start at line ${index + 1}: ${file}`);
      }
      const declaredLimit = (event.data as any)?.acceptedLimit;
      if (declaredLimit != null) {
        if (!Number.isSafeInteger(declaredLimit) || declaredLimit < 1) {
          throw new Error(`invalid cognition admission limit at line ${index + 1}: ${file}`);
        }
        acceptedLimit = declaredLimit;
      }
    } else if (event.type === 'draining') {
      drainingCount += 1;
      draining = true;
      if (event.request != null) {
        throw new Error(`invalid cognition drain at line ${index + 1}: ${file}`);
      }
    } else if (event.type === 'drained') {
      drainedCount += 1;
      if (!draining || event.request != null || index !== lines.length - 1) {
        throw new Error(`invalid cognition drained event at line ${index + 1}: ${file}`);
      }
    } else if (event.type === 'accepted') {
      if (draining || !requestId || accepted.has(requestId)) {
        throw new Error(`duplicate or absent accepted request at line ${index + 1}: ${file}`);
      }
      accepted.add(requestId);
    } else if (event.type === 'admitted') {
      if (draining || !requestId || !accepted.has(requestId) || admitted.has(requestId)) {
        throw new Error(`invalid admitted request at line ${index + 1}: ${file}`);
      }
      admitted.add(requestId);
      active += 1;
      peakActive = Math.max(peakActive, active);
    } else if (event.type === 'completed') {
      if (!requestId || !admitted.has(requestId) || terminal.has(requestId)) {
        throw new Error(`invalid completed request at line ${index + 1}: ${file}`);
      }
      terminal.add(requestId);
      active -= 1;
      if (active < 0) {
        throw new Error(`negative cognition concurrency at line ${index + 1}: ${file}`);
      }
    } else if (event.type === 'cancelled') {
      if (!requestId || !accepted.has(requestId) || terminal.has(requestId)) {
        throw new Error(`invalid terminal request at line ${index + 1}: ${file}`);
      }
      terminal.add(requestId);
      if (admitted.has(requestId)) active -= 1;
      if (active < 0) {
        throw new Error(`negative cognition concurrency at line ${index + 1}: ${file}`);
      }
    } else if (event.type === 'cancel_requested') {
      if (
        !requestId ||
        !admitted.has(requestId) ||
        terminal.has(requestId) ||
        cancellationRequested.has(requestId)
      ) {
        throw new Error(`invalid cancellation request at line ${index + 1}: ${file}`);
      }
      cancellationRequested.add(requestId);
    } else if (event.type === 'rejected' && event.request != null) {
      throw new Error(`invalid rejected request at line ${index + 1}: ${file}`);
    }
    events.push(event);
    previousDigest = digest;
  }
  if (
    startedCount !== 1 ||
    drainingCount !== 1 ||
    drainedCount !== 1 ||
    events[0]?.type !== 'started' ||
    events.at(-1)?.type !== 'drained'
  ) {
    throw new Error(`cognition broker journal is not cleanly bounded: ${file}`);
  }
  if (active !== 0 || terminal.size !== accepted.size) {
    throw new Error(`cognition broker journal has unterminated requests: ${file}`);
  }
  if (acceptedLimit != null && accepted.size > acceptedLimit) {
    throw new Error(`cognition broker journal exceeds its admission limit: ${file}`);
  }
  return Object.freeze({
    protocol: 'behold.cognition-broker-verification.v1' as const,
    file,
    brokerId,
    events: Object.freeze(events),
    tipDigest: previousDigest,
    acceptedLimit,
    acceptedRemaining: acceptedLimit == null ? null : acceptedLimit - accepted.size,
    accepted: accepted.size,
    admitted: admitted.size,
    terminal: terminal.size,
    peakActive,
  });
}
