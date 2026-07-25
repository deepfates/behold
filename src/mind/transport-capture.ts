import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { CognitionPriority, CognitionPurpose } from './cognition';

export const COGNITION_TRANSPORT_ATTEMPT_START_PROTOCOL =
  'behold.cognition-transport-attempt-start.v1' as const;
export const COGNITION_TRANSPORT_ATTEMPT_PROTOCOL =
  'behold.cognition-transport-attempt.v1' as const;
export const COGNITION_TRANSPORT_CAPTURE_REFERENCE_PROTOCOL =
  'behold.cognition-transport-capture-reference.v1' as const;

export type TransportContentReference = Readonly<{
  file: string;
  sha256: string;
  bytes: number;
  contentType: string;
}>;

export type CognitionTransportAttemptStart = Readonly<{
  protocol: typeof COGNITION_TRANSPORT_ATTEMPT_START_PROTOCOL;
  brokerId: string;
  brokerRequestId: string;
  clientRequestId: string;
  /** One-based physical attempt for this resident-owned logical request id. */
  logicalRequestAttempt: number;
  residentKey: string;
  admissionOrdinal: number;
  priority: CognitionPriority;
  purpose: CognitionPurpose;
  urgentTriggerSequence: number | null;
  requestedModel: string;
  route: Readonly<{
    method: 'POST';
    endpoint: string;
    origin: string;
    path: string;
    authentication: 'runner_bearer_not_retained';
  }>;
  request: TransportContentReference;
  timing: Readonly<{
    queuedAt: number;
    admittedAt: number;
    upstreamStartedAt: number;
    queueMs: number;
  }>;
  quota: Readonly<{
    accountId: string;
    purposeOrdinal: number;
    purposeLimit: number;
    purposeRemaining: number;
    ledgerFile: string;
    ledgerTipDigest: string;
  }> | null;
  digest: string;
}>;

export type CognitionTransportAttempt = Readonly<{
  protocol: typeof COGNITION_TRANSPORT_ATTEMPT_PROTOCOL;
  brokerId: string;
  brokerRequestId: string;
  admissionOrdinal: number;
  start: Readonly<{ file: string; sha256: string; digest: string }>;
  terminal:
    | 'success'
    | 'provider_error'
    | 'route_identity_mismatch'
    | 'network_error'
    | 'timeout'
    | 'cancelled';
  response: Readonly<{
    status: number;
    ok: boolean;
    content: TransportContentReference;
    id: string | null;
    model: string | null;
    provider: string | null;
    finishReason: string | null;
    nativeFinishReason: string | null;
    usage: Readonly<{
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      cost?: number;
    }> | null;
  }> | null;
  error: Readonly<{
    name: string;
    code: string | null;
    message: string;
    observedBodySha256?: string;
    observedBodyBytes?: number;
  }> | null;
  timing: Readonly<{
    completedAt: number;
    upstreamLatencyMs: number;
  }>;
  digest: string;
}>;

export type CognitionTransportCaptureReference = Readonly<{
  protocol: typeof COGNITION_TRANSPORT_CAPTURE_REFERENCE_PROTOCOL;
  file: string;
  sha256: string;
  digest: string;
  brokerRequestId: string;
  admissionOrdinal: number;
}>;

export type CognitionTransportCaptureHandle = Readonly<{
  start: CognitionTransportAttemptStart;
  startFile: string;
  startSha256: string;
}>;

export type CognitionTransportCaptureStore = Readonly<{
  directory: string;
  start(input: {
    brokerId: string;
    brokerRequestId: string;
    clientRequestId: string;
    logicalRequestAttempt: number;
    residentKey: string;
    admissionOrdinal: number;
    priority: CognitionPriority;
    purpose: CognitionPurpose;
    urgentTriggerSequence: number | null;
    requestedModel: string;
    upstreamEndpoint: string;
    requestBody: Buffer;
    queuedAt: number;
    admittedAt: number;
    upstreamStartedAt: number;
    queueMs: number;
    quota: CognitionTransportAttemptStart['quota'];
  }): CognitionTransportCaptureHandle;
  finish(
    handle: CognitionTransportCaptureHandle,
    input: {
      terminal: CognitionTransportAttempt['terminal'];
      completedAt: number;
      response?: Readonly<{
        status: number;
        ok: boolean;
        body: Buffer;
        contentType: string;
      }>;
      error?: unknown;
    },
  ): CognitionTransportCaptureReference;
}>;

type BrokerEventLike = Readonly<{
  type: string;
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
  data: any;
}>;

export function createCognitionTransportCapture(input: {
  directory: string;
  secretValues: readonly string[];
}): CognitionTransportCaptureStore {
  const directory = ensurePrivateDirectory(input.directory);
  const blobs = ensurePrivateDirectory(path.join(directory, 'blobs'));
  const secrets = Object.freeze(
    [...new Set(input.secretValues.map((value) => String(value || '')).filter(Boolean))].filter(
      (value) => value.length >= 8,
    ),
  );

  const start = (attempt: Parameters<CognitionTransportCaptureStore['start']>[0]) => {
    assertNoRetainedSecret(attempt.requestBody, secrets, 'provider request body');
    const request = writeContent(blobs, attempt.requestBody, 'application/json');
    const endpoint = safeEndpoint(attempt.upstreamEndpoint);
    const route = new URL(endpoint);
    const base = {
      protocol: COGNITION_TRANSPORT_ATTEMPT_START_PROTOCOL,
      brokerId: boundedText(attempt.brokerId, 'capture broker id', 300),
      brokerRequestId: boundedText(attempt.brokerRequestId, 'capture broker request id', 300),
      clientRequestId: boundedText(attempt.clientRequestId, 'capture client request id', 300),
      logicalRequestAttempt: positiveInteger(
        attempt.logicalRequestAttempt,
        'capture logical request attempt',
      ),
      residentKey: sha256Digest(attempt.residentKey, 'capture resident key'),
      admissionOrdinal: positiveInteger(attempt.admissionOrdinal, 'capture admission ordinal'),
      priority: attempt.priority,
      purpose: attempt.purpose,
      urgentTriggerSequence:
        attempt.urgentTriggerSequence == null
          ? null
          : nonnegativeInteger(attempt.urgentTriggerSequence, 'capture urgent trigger'),
      requestedModel: boundedText(attempt.requestedModel, 'capture requested model', 300),
      route: {
        method: 'POST' as const,
        endpoint,
        origin: route.origin,
        path: route.pathname,
        authentication: 'runner_bearer_not_retained' as const,
      },
      request,
      timing: {
        queuedAt: finiteNumber(attempt.queuedAt, 'capture queued time'),
        admittedAt: finiteNumber(attempt.admittedAt, 'capture admitted time'),
        upstreamStartedAt: finiteNumber(attempt.upstreamStartedAt, 'capture upstream start'),
        queueMs: nonnegativeNumber(attempt.queueMs, 'capture queue latency'),
      },
      quota: attempt.quota == null ? null : parseQuota(attempt.quota),
    };
    const record: CognitionTransportAttemptStart = deepFreeze({
      ...base,
      digest: sha256(stableJson(base)),
    });
    const startFile = path.join(directory, attemptFileName('start', record));
    writeImmutableJson(startFile, record);
    return deepFreeze({ start: record, startFile, startSha256: sha256File(startFile) });
  };

  const finish = (
    handle: CognitionTransportCaptureHandle,
    outcome: Parameters<CognitionTransportCaptureStore['finish']>[1],
  ) => {
    const response = outcome.response ? captureResponse(blobs, outcome.response, secrets) : null;
    const error = outcome.error == null ? null : captureError(outcome.error, secrets);
    if (
      ['success', 'provider_error', 'route_identity_mismatch'].includes(outcome.terminal) &&
      !response
    ) {
      throw codedError('transport_capture_invalid', 'response terminal requires response bytes');
    }
    if (outcome.terminal === 'success' && response?.ok !== true) {
      throw codedError('transport_capture_invalid', 'success terminal requires an ok response');
    }
    if (outcome.terminal === 'provider_error' && response?.ok !== false) {
      throw codedError(
        'transport_capture_invalid',
        'provider-error terminal requires a non-ok response',
      );
    }
    if (outcome.terminal === 'route_identity_mismatch' && response?.ok !== true) {
      throw codedError(
        'transport_capture_invalid',
        'route-identity terminal requires the original ok response',
      );
    }
    if (!['success', 'provider_error'].includes(outcome.terminal) && !error) {
      throw codedError('transport_capture_invalid', 'non-response terminal requires an error');
    }
    const completedAt = finiteNumber(outcome.completedAt, 'capture completion time');
    const base = {
      protocol: COGNITION_TRANSPORT_ATTEMPT_PROTOCOL,
      brokerId: handle.start.brokerId,
      brokerRequestId: handle.start.brokerRequestId,
      admissionOrdinal: handle.start.admissionOrdinal,
      start: {
        file: handle.startFile,
        sha256: handle.startSha256,
        digest: handle.start.digest,
      },
      terminal: outcome.terminal,
      response,
      error,
      timing: {
        completedAt,
        upstreamLatencyMs: Math.max(0, completedAt - handle.start.timing.upstreamStartedAt),
      },
    };
    const record: CognitionTransportAttempt = deepFreeze({
      ...base,
      digest: sha256(stableJson(base)),
    });
    const file = path.join(directory, attemptFileName('attempt', handle.start));
    writeImmutableJson(file, record);
    return deepFreeze({
      protocol: COGNITION_TRANSPORT_CAPTURE_REFERENCE_PROTOCOL,
      file,
      sha256: sha256File(file),
      digest: record.digest,
      brokerRequestId: record.brokerRequestId,
      admissionOrdinal: record.admissionOrdinal,
    });
  };

  return Object.freeze({ directory, start, finish });
}

export function verifyCognitionTransportCapture(
  directoryValue: string,
  events: readonly BrokerEventLike[],
) {
  const directory = plainDirectory(directoryValue, 'transport capture');
  const admittedEvents = events.filter((event) => event.type === 'admitted');
  const terminalEvents = events.filter(
    (event) =>
      (event.type === 'completed' || event.type === 'cancelled') &&
      event.request &&
      admittedEvents.some(
        (admitted) => admitted.request?.brokerRequestId === event.request?.brokerRequestId,
      ),
  );
  const starts = protocolFiles(directory, /^start-[0-9]{8}-[A-Za-z0-9._:-]+\.json$/);
  const attempts = protocolFiles(directory, /^attempt-[0-9]{8}-[A-Za-z0-9._:-]+\.json$/);
  if (
    starts.length !== admittedEvents.length ||
    attempts.length !== admittedEvents.length ||
    terminalEvents.length !== admittedEvents.length
  ) {
    throw new Error('transport capture does not exactly cover every admitted provider attempt');
  }

  const startsByRequest = new Map<string, CognitionTransportAttemptStart>();
  const attemptsByRequest = new Map<string, CognitionTransportAttempt>();
  const referencedBlobs = new Set<string>();
  for (const file of starts) {
    const record = parseStart(readJson(file));
    if (startsByRequest.has(record.brokerRequestId)) {
      throw new Error('transport capture contains a duplicate attempt start');
    }
    verifyContent(record.request, directory);
    referencedBlobs.add(record.request.file);
    startsByRequest.set(record.brokerRequestId, record);
  }
  for (const file of attempts) {
    const record = parseAttempt(readJson(file));
    const start = startsByRequest.get(record.brokerRequestId);
    if (
      !start ||
      record.brokerId !== start.brokerId ||
      record.admissionOrdinal !== start.admissionOrdinal ||
      record.start.file !== path.join(directory, attemptFileName('start', start)) ||
      record.start.sha256 !== sha256File(record.start.file) ||
      record.start.digest !== start.digest
    ) {
      throw new Error('transport attempt does not match its immutable start record');
    }
    if (record.response) {
      verifyContent(record.response.content, directory);
      referencedBlobs.add(record.response.content.file);
    }
    attemptsByRequest.set(record.brokerRequestId, record);
  }

  for (const admitted of admittedEvents) {
    const request = admitted.request!;
    const start = startsByRequest.get(request.brokerRequestId);
    const attempt = attemptsByRequest.get(request.brokerRequestId);
    const terminal = terminalEvents.find(
      (event) => event.request?.brokerRequestId === request.brokerRequestId,
    );
    const reference = terminal?.data?.transportCapture as
      CognitionTransportCaptureReference | undefined;
    if (
      !start ||
      !attempt ||
      start.clientRequestId !== request.clientRequestId ||
      start.logicalRequestAttempt !== Number(admitted.data?.logicalRequestAttempt) ||
      start.residentKey !== request.residentKey ||
      start.priority !== request.priority ||
      start.purpose !== request.purpose ||
      start.urgentTriggerSequence !== request.urgentTriggerSequence ||
      start.requestedModel !== request.model ||
      start.request.sha256 !== request.bodySha256 ||
      start.request.bytes !== request.bodyBytes ||
      start.admissionOrdinal !== Number(admitted.data?.admissionOrdinal) ||
      !reference ||
      reference.protocol !== COGNITION_TRANSPORT_CAPTURE_REFERENCE_PROTOCOL ||
      reference.file !== path.join(directory, attemptFileName('attempt', start)) ||
      reference.sha256 !== sha256File(reference.file) ||
      reference.digest !== attempt.digest ||
      reference.brokerRequestId !== request.brokerRequestId ||
      reference.admissionOrdinal !== start.admissionOrdinal
    ) {
      throw new Error(`transport capture mismatches broker request ${request.brokerRequestId}`);
    }
  }

  const logicalOrdinals = new Map<string, number>();
  for (const start of [...startsByRequest.values()].sort(
    (left, right) => left.admissionOrdinal - right.admissionOrdinal,
  )) {
    const key = `${start.residentKey}\0${start.clientRequestId}`;
    const expected = (logicalOrdinals.get(key) ?? 0) + 1;
    if (start.logicalRequestAttempt !== expected) {
      throw new Error('transport capture logical-request attempt sequence is incomplete');
    }
    logicalOrdinals.set(key, expected);
  }

  const blobDirectory = plainDirectory(path.join(directory, 'blobs'), 'transport capture blobs');
  const actualBlobs = protocolFiles(blobDirectory, /^[a-f0-9]{64}\.bin$/);
  if (
    actualBlobs.length !== referencedBlobs.size ||
    actualBlobs.some((file) => !referencedBlobs.has(file))
  ) {
    throw new Error('transport capture contains unreferenced or missing content blobs');
  }
  const records = [...attemptsByRequest.values()].sort(
    (left, right) => left.admissionOrdinal - right.admissionOrdinal,
  );
  const startRecords = [...startsByRequest.values()].sort(
    (left, right) => left.admissionOrdinal - right.admissionOrdinal,
  );
  return deepFreeze({
    protocol: 'behold.cognition-transport-capture-verification.v1' as const,
    directory,
    attempts: records.length,
    responses: records.filter((record) => record.response != null).length,
    successfulResponses: records.filter((record) => record.terminal === 'success').length,
    providerFailures: records.filter((record) => record.terminal === 'provider_error').length,
    identityFailures: records.filter((record) => record.terminal === 'route_identity_mismatch')
      .length,
    transportErrors: records.filter(
      (record) => record.response == null && record.terminal !== 'cancelled',
    ).length,
    cancellations: records.filter((record) => record.terminal === 'cancelled').length,
    correctionAttempts: startRecords.filter((record) => record.logicalRequestAttempt > 1).length,
    usage: summarizeUsage(records),
    starts: Object.freeze(startRecords),
    records: Object.freeze(records),
  });
}

function captureResponse(
  blobs: string,
  response: Readonly<{ status: number; ok: boolean; body: Buffer; contentType: string }>,
  secrets: readonly string[],
) {
  try {
    assertNoRetainedSecret(response.body, secrets, 'provider response body');
  } catch (error: any) {
    throw Object.assign(error, {
      observedBodySha256: sha256(response.body),
      observedBodyBytes: response.body.byteLength,
    });
  }
  const content = writeContent(blobs, response.body, response.contentType);
  const metadata = responseMetadata(response.body);
  return deepFreeze({
    status: nonnegativeInteger(response.status, 'capture response status'),
    ok: response.ok === true,
    content,
    ...metadata,
  });
}

function responseMetadata(body: Buffer) {
  let value: any;
  try {
    value = JSON.parse(body.toString('utf8'));
  } catch {
    value = null;
  }
  return {
    id: optionalText(value?.id),
    model: optionalText(value?.model),
    provider: optionalText(value?.provider),
    finishReason: optionalText(value?.choices?.[0]?.finish_reason),
    nativeFinishReason: optionalText(value?.choices?.[0]?.native_finish_reason),
    usage: providerUsage(value?.usage),
  };
}

function providerUsage(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const usage = value as Record<string, unknown>;
  const result: Record<string, number> = {};
  for (const field of ['prompt_tokens', 'completion_tokens', 'total_tokens', 'cost']) {
    if (usage[field] == null || usage[field] === '') continue;
    const number = Number(usage[field]);
    if (Number.isFinite(number) && number >= 0) result[field] = number;
  }
  return Object.keys(result).length > 0 ? deepFreeze(result) : null;
}

function summarizeUsage(records: readonly CognitionTransportAttempt[]) {
  const fields = ['prompt_tokens', 'completion_tokens', 'total_tokens', 'cost'] as const;
  return deepFreeze(
    Object.fromEntries(
      fields.map((field) => {
        const reports = records
          .map((record) => record.response?.usage?.[field])
          .filter((value): value is number => Number.isFinite(value));
        return [
          field,
          { value: reports.reduce((sum, value) => sum + value, 0), reports: reports.length },
        ];
      }),
    ),
  );
}

function captureError(error: any, secrets: readonly string[]) {
  const message = redactSecrets(
    String(error?.message || error || 'transport attempt failed'),
    secrets,
  );
  const code = optionalText(error?.code);
  return deepFreeze({
    name: boundedText(error?.name || 'Error', 'capture error name', 100),
    code: code ? boundedText(code, 'capture error code', 200) : null,
    message: boundedText(message || 'transport attempt failed', 'capture error message', 1_000),
    ...(error?.observedBodySha256
      ? { observedBodySha256: sha256Digest(error.observedBodySha256, 'observed body') }
      : {}),
    ...(Number.isSafeInteger(error?.observedBodyBytes) && error.observedBodyBytes >= 0
      ? { observedBodyBytes: Number(error.observedBodyBytes) }
      : {}),
  });
}

function parseStart(value: any): CognitionTransportAttemptStart {
  assertProtocolDigest(value, COGNITION_TRANSPORT_ATTEMPT_START_PROTOCOL, 'attempt start');
  return deepFreeze(value);
}

function parseAttempt(value: any): CognitionTransportAttempt {
  assertProtocolDigest(value, COGNITION_TRANSPORT_ATTEMPT_PROTOCOL, 'attempt');
  if (
    (['success', 'provider_error', 'route_identity_mismatch'].includes(value.terminal) &&
      value.response == null) ||
    (!['success', 'provider_error'].includes(value.terminal) && value.error == null)
  ) {
    throw new Error('transport attempt terminal and response disagree');
  }
  return deepFreeze(value);
}

function assertProtocolDigest(value: any, protocol: string, label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.protocol !== protocol) {
    throw new Error(`invalid transport ${label} protocol`);
  }
  const { digest, ...base } = value;
  if (!/^[a-f0-9]{64}$/.test(String(digest || '')) || digest !== sha256(stableJson(base))) {
    throw new Error(`invalid transport ${label} digest`);
  }
}

function verifyContent(reference: TransportContentReference, root: string) {
  if (!reference || typeof reference !== 'object') throw new Error('invalid capture content');
  const file = plainFile(reference.file, 'transport capture content');
  if (!pathIsWithin(root, file) || path.dirname(file) !== path.join(root, 'blobs')) {
    throw new Error('transport capture content escaped its private blob directory');
  }
  const bytes = fs.readFileSync(file);
  if (
    bytes.byteLength !== reference.bytes ||
    sha256(bytes) !== reference.sha256 ||
    path.basename(file) !== `${reference.sha256}.bin`
  ) {
    throw new Error('transport capture content hash or length is invalid');
  }
}

function writeContent(directory: string, bytes: Buffer, contentType: string) {
  const digest = sha256(bytes);
  const file = path.join(directory, `${digest}.bin`);
  try {
    writeImmutableBytes(file, bytes);
  } catch (error: any) {
    if (error?.code !== 'EEXIST' || sha256File(file) !== digest) throw error;
  }
  return deepFreeze({
    file,
    sha256: digest,
    bytes: bytes.byteLength,
    contentType: boundedText(
      String(contentType || 'application/octet-stream').split(';')[0],
      'capture content type',
      200,
    ),
  });
}

function writeImmutableJson(file: string, value: unknown) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
  try {
    writeImmutableBytes(file, bytes);
  } catch (error: any) {
    if (error?.code !== 'EEXIST' || !fs.readFileSync(file).equals(bytes)) throw error;
  }
}

function writeImmutableBytes(file: string, bytes: Buffer) {
  const descriptor = fs.openSync(
    file,
    fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW,
    0o600,
  );
  try {
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fsyncDirectory(path.dirname(file));
}

function attemptFileName(
  prefix: 'start' | 'attempt',
  record: Pick<CognitionTransportAttemptStart, 'admissionOrdinal' | 'brokerRequestId'>,
) {
  const requestId = boundedText(record.brokerRequestId, 'capture request file id', 300);
  if (!/^[A-Za-z0-9._:-]+$/.test(requestId)) throw new Error('capture request id is not file-safe');
  return `${prefix}-${String(record.admissionOrdinal).padStart(8, '0')}-${requestId}.json`;
}

function parseQuota(value: NonNullable<CognitionTransportAttemptStart['quota']>) {
  return deepFreeze({
    accountId: sha256Digest(value.accountId, 'capture quota account'),
    purposeOrdinal: positiveInteger(value.purposeOrdinal, 'capture quota ordinal'),
    purposeLimit: positiveInteger(value.purposeLimit, 'capture quota limit'),
    purposeRemaining: nonnegativeInteger(value.purposeRemaining, 'capture quota remaining'),
    ledgerFile: absolutePath(value.ledgerFile, 'capture quota ledger'),
    ledgerTipDigest: sha256Digest(value.ledgerTipDigest, 'capture quota tip'),
  });
}

function assertNoRetainedSecret(bytes: Buffer, secrets: readonly string[], label: string) {
  const text = bytes.toString('utf8');
  const found = secrets.find((secret) => text.includes(secret));
  if (found)
    throw codedError(
      'transport_capture_secret_detected',
      `${label} contained a transport credential`,
    );
}

function redactSecrets(value: string, secrets: readonly string[]) {
  let redacted = value.replace(/Bearer\s+[A-Za-z0-9._~+\/-]{8,}/gi, 'Bearer [REDACTED]');
  for (const secret of secrets) redacted = redacted.split(secret).join('[REDACTED]');
  return redacted;
}

function safeEndpoint(value: string) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('transport capture route must not contain credentials, query, or fragment');
  }
  return `${url.origin}${url.pathname}`;
}

function protocolFiles(directory: string, pattern: RegExp) {
  return fs
    .readdirSync(directory)
    .filter((name) => pattern.test(name))
    .map((name) => path.join(directory, name))
    .sort();
}

function ensurePrivateDirectory(value: string) {
  const directory = path.resolve(value);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stats = fs.lstatSync(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`transport capture directory is not plain: ${directory}`);
  }
  fs.chmodSync(directory, 0o700);
  return directory;
}

function plainDirectory(value: string, label: string) {
  const directory = path.resolve(value);
  const stats = fs.lstatSync(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error(`${label} is not plain`);
  return directory;
}

function plainFile(value: string, label: string) {
  const file = path.resolve(value);
  const stats = fs.lstatSync(file);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`${label} is not a plain file`);
  return file;
}

function readJson(file: string) {
  return JSON.parse(fs.readFileSync(plainFile(file, 'transport capture record'), 'utf8'));
}

function pathIsWithin(directory: string, file: string) {
  const relative = path.relative(path.resolve(directory), path.resolve(file));
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function absolutePath(value: unknown, label: string) {
  const text = String(value || '');
  if (!path.isAbsolute(text)) throw new Error(`${label} must be absolute`);
  return path.normalize(text);
}

function optionalText(value: unknown) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, 1_000) : null;
}

function boundedText(value: unknown, label: string, maximum: number) {
  const text = String(value || '').trim();
  if (!text || text.length > maximum) throw new Error(`${label} must be nonempty and bounded`);
  return text;
}

function finiteNumber(value: unknown, label: string) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
}

function nonnegativeNumber(value: unknown, label: string) {
  const number = finiteNumber(value, label);
  if (number < 0) throw new Error(`${label} must be nonnegative`);
  return number;
}

function positiveInteger(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw new Error(`${label} must be positive`);
  return Number(value);
}

function nonnegativeInteger(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new Error(`${label} must be nonnegative`);
  return Number(value);
}

function sha256Digest(value: unknown, label: string) {
  const text = String(value || '');
  if (!/^[a-f0-9]{64}$/.test(text)) throw new Error(`${label} must be a SHA-256 digest`);
  return text;
}

function codedError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

function fsyncDirectory(directory: string) {
  const descriptor = fs.openSync(directory, 'r');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as any)) deepFreeze(child);
  }
  return value;
}

function stableJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

function sha256File(file: string) {
  return sha256(fs.readFileSync(plainFile(file, 'transport capture file')));
}
