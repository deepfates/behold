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
  snapshot(): CognitionBrokerSnapshot;
  close(): Promise<CognitionBrokerSnapshot>;
}>;

export type CognitionBrokerOptions = Readonly<{
  upstreamEndpoint: string;
  upstreamApiKey: string;
  clients: readonly Readonly<{ bearer: string; residentKey: string; model: string }>[];
  maxConcurrent: number;
  maxQueued?: number;
  maxQueuedPerResident?: number;
  maxBodyBytes?: number;
  maxResponseBytes?: number;
  maxUrgentBurst?: number;
  maxNonAuxiliaryBurst?: number;
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
  const upstream = exactUpstreamEndpoint(options.upstreamEndpoint);
  const upstreamApiKey = String(options.upstreamApiKey || '').trim();
  if (upstreamApiKey.length < 12) throw new Error('cognition broker requires an upstream API key');
  const clients = normalizeClients(options.clients);
  const maxConcurrent = positiveInteger(options.maxConcurrent, 'maxConcurrent', 1_024);
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
  if (journalFile) {
    fs.mkdirSync(path.dirname(journalFile), { recursive: true });
    journalDescriptor = fs.openSync(journalFile, 'wx', 0o600);
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
        journalFailure = error instanceof Error ? error : new Error(String(error));
        closing = true;
        resolveFailure(journalFailure);
        throw journalFailure;
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
    if (active >= maxConcurrent && queuedCount() >= maxQueued) {
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
    emit('accepted', job, { active, queued: queuedCount() });
    const cancel = () => cancelJob(job, 'client_disconnected');
    request.once('aborted', cancel);
    response.once('close', () => {
      if (!response.writableEnded) cancel();
    });
    pump();
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
      emit('cancel_requested', job, {
        reason,
        admitted: true,
        queueMs: job.admission?.queueMs ?? 0,
        activeBeforeRelease: active,
      });
      job.upstreamAbort?.abort(new Error(reason));
    }
    pump();
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
      emit('admitted', job, admission);
      void execute(job).finally(() => {
        active = Math.max(0, active - 1);
        activeJobs.delete(job);
        activeResidents.delete(job.client.residentKey);
        if (!closing) pump();
        else notifyDrained();
      });
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
    try {
      const upstreamResponse = await callFetch(upstream, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${upstreamApiKey}`,
        },
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
        recordInflightCancellation(job, 'upstream_abort_settled');
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
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('cognition broker has no TCP port');
  const endpoint = `http://127.0.0.1:${address.port}/v1/chat/completions`;
  server.on('error', (error) => {
    if (closing) return;
    closing = true;
    resolveFailure(error);
  });
  emit('started', null, { endpoint, concurrencyLimit: maxConcurrent });

  const close = () => {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      closing = true;
      if (!journalFailure) emit('draining', null, snapshot());
      for (const queue of queues.values()) {
        for (const job of queue) {
          if (job.state !== 'queued') continue;
          job.state = 'cancelled';
          metrics.cancelled += 1;
          if (!job.response.destroyed) {
            writeError(job.response, 503, 'broker_closing', 'cognition broker is closing');
          }
          if (!journalFailure)
            emit('cancelled', job, { reason: 'broker_closing', admitted: false });
        }
      }
      for (const job of activeJobs) cancelJob(job, 'broker_closing');
      await waitUntilDrained();
      if (!journalFailure) emit('drained', null, snapshot());
      if (journalDescriptor != null) {
        fs.closeSync(journalDescriptor);
        journalDescriptor = null;
      }
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections();
        server.closeAllConnections();
      });
      if (journalFailure) throw journalFailure;
      return snapshot();
    })();
    return closePromise;
  };

  return Object.freeze({
    protocol: COGNITION_TRANSPORT_PROTOCOL,
    brokerId,
    endpoint,
    journalFile,
    failed,
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
        !residentKey ||
        residentKey.length > 200 ||
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

function exactUpstreamEndpoint(value: string) {
  const url = new URL(String(value || ''));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error('invalid cognition upstream endpoint');
  }
  if (!acceptedPath(url.pathname) || url.search) {
    throw new Error('cognition upstream must be an exact chat-completions endpoint');
  }
  return url.toString();
}

function validateRequestBody(body: Buffer) {
  let value: any;
  try {
    value = JSON.parse(body.toString('utf8'));
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
  if (value.stream === true) {
    throw codedError('request_streaming_unsupported', 'streaming requests are not admitted');
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
  let active = 0;
  let peakActive = 0;
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
    const requestId = event.request?.brokerRequestId ?? null;
    if (event.type === 'accepted') {
      if (!requestId || accepted.has(requestId)) {
        throw new Error(`duplicate or absent accepted request at line ${index + 1}: ${file}`);
      }
      accepted.add(requestId);
    } else if (event.type === 'admitted') {
      if (!requestId || !accepted.has(requestId) || admitted.has(requestId)) {
        throw new Error(`invalid admitted request at line ${index + 1}: ${file}`);
      }
      admitted.add(requestId);
      active += 1;
      peakActive = Math.max(peakActive, active);
    } else if (event.type === 'completed' || event.type === 'cancelled') {
      if (!requestId || !accepted.has(requestId) || terminal.has(requestId)) {
        throw new Error(`invalid terminal request at line ${index + 1}: ${file}`);
      }
      terminal.add(requestId);
      if (admitted.has(requestId)) active -= 1;
      if (active < 0) {
        throw new Error(`negative cognition concurrency at line ${index + 1}: ${file}`);
      }
    } else if (event.type === 'cancel_requested') {
      if (!requestId || !admitted.has(requestId) || terminal.has(requestId)) {
        throw new Error(`invalid cancellation request at line ${index + 1}: ${file}`);
      }
    }
    events.push(event);
    previousDigest = digest;
  }
  if (events[0]?.type !== 'started' || events.at(-1)?.type !== 'drained') {
    throw new Error(`cognition broker journal is not cleanly bounded: ${file}`);
  }
  if (active !== 0 || terminal.size !== accepted.size) {
    throw new Error(`cognition broker journal has unterminated requests: ${file}`);
  }
  return Object.freeze({
    protocol: 'behold.cognition-broker-verification.v1' as const,
    file,
    brokerId,
    events: Object.freeze(events),
    tipDigest: previousDigest,
    accepted: accepted.size,
    admitted: admitted.size,
    terminal: terminal.size,
    peakActive,
  });
}
