import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import {
  COGNITION_ADMISSION_PROTOCOL,
  COGNITION_TRANSPORT_PROTOCOL,
  cognitionAdmissionHeaders,
  cognitionHeaderNames,
  type CognitionAdmissionEvidence,
  type CognitionPriority,
  type CognitionPurpose,
} from './cognition';

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
  admitted: number;
  completed: number;
  failed: number;
  cancelled: number;
  rejected: number;
  totalQueueMs: number;
  admissionOrdinal: number;
  closing: boolean;
  healthy: boolean;
  journal: Readonly<{ file: string; tipDigest: string | null }> | null;
}>;

export type CognitionBroker = Readonly<{
  protocol: typeof COGNITION_TRANSPORT_PROTOCOL;
  brokerId: string;
  endpoint: string;
  journalFile: string | null;
  failed: Promise<Error>;
  admissionLimitReached: Promise<CognitionAdmissionLimitEvidence>;
  admissionLimitSettled: Promise<CognitionAdmissionLimitSettlementEvidence>;
  snapshot(): CognitionBrokerSnapshot;
  close(): Promise<CognitionBrokerSnapshot>;
}>;

export type CognitionBrokerOptions = Readonly<{
  upstreamEndpoint: string;
  upstreamApiKey: string;
  clients: readonly Readonly<{ bearer: string; residentKey: string; model: string }>[];
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
  onEvent?: (event: CognitionBrokerEvent) => void;
}>;

type Client = Readonly<{ bearer: string; residentKey: string; model: string }>;

type Job = {
  state: 'queued' | 'active' | 'cancelling' | 'completed' | 'cancelled';
  brokerRequestId: string;
  clientRequestId: string;
  client: Client;
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
  const upstream = exactUpstreamEndpoint(
    options.upstreamEndpoint,
    options.allowedUpstreamOrigins ?? ['https://openrouter.ai'],
  );
  const upstreamApiKey = String(options.upstreamApiKey || '').trim();
  if (upstreamApiKey.length < 12) throw new Error('cognition broker requires an upstream API key');
  const clients = normalizeClients(options.clients);
  const maxConcurrent = positiveInteger(options.maxConcurrent, 'maxConcurrent', 1_024);
  const maxAccepted =
    options.maxAccepted == null
      ? null
      : positiveInteger(options.maxAccepted, 'maxAccepted', 100_000_000);
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
  const callFetch = options.fetch ?? globalThis.fetch;
  const brokerId = `cognition-${randomUUID()}`;
  const journalFile = options.journalFile ? path.resolve(options.journalFile) : null;
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
      throw error;
    }
  }
  const queues = new Map<CognitionPriority, Job[]>(PRIORITIES.map((priority) => [priority, []]));
  const activeJobs = new Set<Job>();
  const activeResidents = new Set<string>();
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
            model: job.client.model,
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
      urgentTriggerSequence === 'invalid' ||
      (priority === 'urgent') !== (urgentTriggerSequence != null)
    ) {
      return reject(response, 400, 'scheduling_headers_invalid', 'scheduling headers are invalid');
    }
    let body: Buffer;
    try {
      body = await readBody(request, maxBodyBytes);
      const model = validateRequestBody(body);
      if (model !== client.model) {
        throw codedError('request_model_not_admitted', 'resident requested an unbound model');
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
      client,
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
    };
    metrics.accepted += 1;
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
      const admittedAt = now();
      const activeBeforeAdmission = active;
      const admission: CognitionAdmissionEvidence = Object.freeze({
        protocol: COGNITION_ADMISSION_PROTOCOL,
        brokerId,
        brokerRequestId: job.brokerRequestId,
        clientRequestId: job.clientRequestId,
        residentKey: job.client.residentKey,
        model: job.client.model,
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
        emit('admitted', job, admission);
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
          authorization: `Bearer ${upstreamApiKey}`,
        },
        // Admission rejects non-canonical UTF-8, so this is byte-preserving.
        body: job.body.toString('utf8'),
        signal: job.upstreamAbort!.signal,
      });
      const responseBody = await readResponseBody(upstreamResponse, maxResponseBytes);
      if (job.state === 'cancelling' || job.state === 'cancelled' || job.response.destroyed) {
        recordInflightCancellation(job, 'client_disconnected_after_upstream');
        return;
      }
      const contentType = upstreamResponse.headers.get('content-type') || 'application/json';
      job.state = 'completed';
      if (upstreamResponse.ok) metrics.completed += 1;
      else metrics.failed += 1;
      emit('completed', job, {
        status: upstreamResponse.status,
        ok: upstreamResponse.ok,
        responseBytes: responseBody.byteLength,
        queueMs: job.admission!.queueMs,
        activeBeforeRelease: active,
      });
      job.response.writeHead(upstreamResponse.status, {
        'content-type': contentType,
        'content-length': String(responseBody.byteLength),
        ...admissionHeaders,
      });
      job.response.end(responseBody);
    } catch (error: any) {
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
      metrics.failed += 1;
      job.state = 'completed';
      emit('completed', job, {
        status: null,
        ok: false,
        error: error?.code || error?.message || String(error),
        queueMs: job.admission!.queueMs,
        activeBeforeRelease: active,
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

  function recordInflightCancellation(job: Job, reason: string) {
    if (job.state === 'cancelled') return;
    job.state = 'cancelled';
    metrics.cancelled += 1;
    if (!journalFailure) {
      emit('cancelled', job, {
        reason,
        admitted: true,
        queueMs: job.admission?.queueMs ?? 0,
        activeBeforeRelease: active,
      });
    }
  }

  function recordTimeout(job: Job) {
    if (job.state === 'completed' || job.state === 'cancelled') return;
    job.state = 'completed';
    metrics.failed += 1;
    if (!journalFailure) {
      emit('completed', job, {
        status: null,
        ok: false,
        error: 'upstream_timeout',
        queueMs: job.admission?.queueMs ?? 0,
        activeBeforeRelease: active,
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

  function snapshot(): CognitionBrokerSnapshot {
    return Object.freeze({
      protocol: 'behold.cognition-broker-snapshot.v1',
      brokerId,
      concurrencyLimit: maxConcurrent,
      acceptedLimit: maxAccepted,
      acceptedRemaining: maxAccepted == null ? null : Math.max(0, maxAccepted - metrics.accepted),
      active,
      queued: queuedCount(),
      ...metrics,
      closing,
      healthy: journalFailure == null,
      journal: journalFile ? { file: journalFile, tipDigest: journalTipDigest } : null,
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
      concurrencyLimit: maxConcurrent,
      acceptedLimit: maxAccepted,
      maxCallMs,
    });
  } catch (error) {
    await closeListeningServer();
    closeJournal();
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
      if (
        bearer.length < 32 ||
        bearer.length > 512 ||
        !/^[a-f0-9]{64}$/.test(residentKey) ||
        !model ||
        model.length > 300
      ) {
        throw new Error(`invalid cognition client at index ${index}`);
      }
      if (bearers.has(bearer) || residents.has(residentKey)) {
        throw new Error(`duplicate cognition client at index ${index}`);
      }
      bearers.add(bearer);
      residents.add(residentKey);
      return Object.freeze({ bearer, residentKey, model });
    }),
  );
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
  return value.model;
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
  return value === 'resident_decision' || value === 'loom_fold';
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
