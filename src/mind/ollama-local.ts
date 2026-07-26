import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertOllamaLocalJsonActionRequest,
  ollamaLocalJsonActionTransport,
  usesOllamaResidentSessionTransport,
  type OllamaLocalJsonActionRequestIdentity,
  type OllamaLocalJsonActionTransport,
} from './ollama-json-action';

export const OLLAMA_LOCAL_POLICY_PROTOCOL = 'behold.ollama-local-policy.v2' as const;
export const OLLAMA_LOCAL_PREFLIGHT_PROTOCOL = 'behold.ollama-local-preflight.v2' as const;

export type OllamaLocalPolicy = Readonly<{
  protocol: typeof OLLAMA_LOCAL_POLICY_PROTOCOL;
  /** Exact loopback native-chat endpoint; no DNS or remote origin is admitted. */
  endpoint: string;
  /** Exact installed Ollama tag used on every request and checked on every response. */
  modelTag: string;
  /** Content digest reported by Ollama's installed-model inventory. */
  modelDigest: string;
  /** Separately versioned strict JSON action transport; native tools are never admitted. */
  transport: OllamaLocalJsonActionTransport;
  settings: Readonly<{
    contextTokens: number;
    maxOutputTokens: number;
    temperature: number;
    /** Exact request-scoped model residency setting rendered as `keep_alive`. */
    keepAlive: string;
  }>;
}>;

export type OllamaLocalResponseIdentity = Readonly<{
  ok: boolean;
  requestedModel: string;
  returnedModel: string | null;
  installedDigest: string;
  reason: 'matched' | 'model_missing' | 'model_mismatch';
}>;

export type OllamaLocalPreflight = Readonly<{
  protocol: typeof OLLAMA_LOCAL_PREFLIGHT_PROTOCOL;
  checkedAt: string;
  endpoint: string;
  server: Readonly<{ version: string; cloudDisabled: true; cloudConfigSha256: string }>;
  models: readonly Readonly<{
    modelTag: string;
    modelDigest: string;
    templateSha256: string;
    capabilities: readonly string[];
    contextLength: number;
    family: string | null;
    parameterSize: string | null;
    quantizationLevel: string | null;
  }>[];
  loaded: readonly Readonly<{
    modelTag: string;
    modelDigest: string | null;
    contextLength: number | null;
    sizeBytes: number | null;
    sizeVramBytes: number | null;
  }>[];
  digest: string;
}>;

export type OllamaAttemptIdentity = Readonly<{
  protocol: 'behold.ollama-attempt-identity.v2';
  policy: OllamaLocalPolicy;
  request: OllamaLocalJsonActionRequestIdentity;
  preflightDigest: string;
  serverVersion: string;
}>;

export type OllamaResidentSession = Readonly<{
  protocol: 'behold.ollama-resident-session.v1';
  endpoint: string;
  keepAlive: string;
  preflightDigest: string;
  models: readonly Readonly<{
    modelTag: string;
    modelDigest: string;
    loadDurationNs: number | null;
    totalDurationNs: number | null;
  }>[];
  loaded: OllamaLocalPreflight['loaded'];
  digest: string;
}>;

const MAX_CONTEXT_TOKENS = 262_144;
const MAX_OUTPUT_TOKENS = 32_768;
const MAX_PREFLIGHT_BYTES = 8 * 1024 * 1024;

export function ollamaLocalPolicy(value: unknown): OllamaLocalPolicy {
  const record = exactRecord(
    value,
    ['protocol', 'endpoint', 'modelTag', 'modelDigest', 'transport', 'settings'],
    'Ollama local policy',
  );
  if (record.protocol !== OLLAMA_LOCAL_POLICY_PROTOCOL) {
    throw new Error(`Ollama local policy protocol must be ${OLLAMA_LOCAL_POLICY_PROTOCOL}`);
  }
  const settings = exactRecord(
    record.settings,
    ['contextTokens', 'maxOutputTokens', 'temperature', 'keepAlive'],
    'Ollama local settings',
  );
  const contextTokens = boundedInteger(
    settings.contextTokens,
    'Ollama contextTokens',
    512,
    MAX_CONTEXT_TOKENS,
  );
  const maxOutputTokens = boundedInteger(
    settings.maxOutputTokens,
    'Ollama maxOutputTokens',
    1,
    MAX_OUTPUT_TOKENS,
  );
  if (maxOutputTokens > contextTokens) {
    throw new Error('Ollama maxOutputTokens cannot exceed contextTokens');
  }
  const temperature = Number(settings.temperature);
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    throw new Error('Ollama temperature must be from 0 through 2');
  }
  const keepAlive = boundedText(settings.keepAlive, 'Ollama keepAlive', 40);
  if (!/^(?:0|[1-9][0-9]{0,5})(?:ms|s|m|h)$/.test(keepAlive)) {
    throw new Error('Ollama keepAlive must be an explicit bounded duration such as 0s or 5m');
  }
  const transport = ollamaLocalJsonActionTransport(record.transport);
  if (usesOllamaResidentSessionTransport({ transport }) && /^0(?:ms|s|m|h)$/.test(keepAlive)) {
    throw new Error('Ollama resident session requires nonzero keepAlive');
  }
  return deepFreeze({
    protocol: OLLAMA_LOCAL_POLICY_PROTOCOL,
    endpoint: exactOllamaChatEndpoint(record.endpoint),
    modelTag: boundedText(record.modelTag, 'Ollama model tag', 300),
    modelDigest: sha256Digest(record.modelDigest, 'Ollama model digest'),
    transport,
    settings: { contextTokens, maxOutputTokens, temperature, keepAlive },
  });
}

export function ollamaLocalPolicyFromEnvironment(value: unknown) {
  if (value == null || String(value).trim() === '') return null;
  const source = String(value);
  if (source.length > 8_192) throw new Error('Ollama local policy environment is too large');
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error('Ollama local policy environment is not valid JSON');
  }
  return ollamaLocalPolicy(parsed);
}

export function serializeOllamaLocalPolicy(value: OllamaLocalPolicy) {
  return JSON.stringify(ollamaLocalPolicy(value));
}

export function exactOllamaChatEndpoint(value: unknown) {
  const url = new URL(String(value || ''));
  if (
    url.protocol !== 'http:' ||
    (url.hostname !== '127.0.0.1' && url.hostname !== '[::1]') ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/api/chat' ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'Ollama endpoint must be exact http://127.0.0.1:<port>/api/chat or http://[::1]:<port>/api/chat',
    );
  }
  return url.toString();
}

export function assertOllamaLocalRequest(
  value: unknown,
  expectedModel: string,
  expectedPolicy: OllamaLocalPolicy,
) {
  const policy = ollamaLocalPolicy(expectedPolicy);
  return assertOllamaLocalJsonActionRequest(value, expectedModel, policy);
}

export function inspectOllamaLocalResponseIdentity(
  value: unknown,
  expectedPolicy: OllamaLocalPolicy,
): OllamaLocalResponseIdentity {
  const policy = ollamaLocalPolicy(expectedPolicy);
  const returnedModel = plainRecord(value) ? optionalText(value.model) : null;
  const reason: OllamaLocalResponseIdentity['reason'] =
    returnedModel == null
      ? 'model_missing'
      : returnedModel === policy.modelTag
        ? 'matched'
        : 'model_mismatch';
  return deepFreeze({
    ok: reason === 'matched',
    requestedModel: policy.modelTag,
    returnedModel,
    installedDigest: policy.modelDigest,
    reason,
  });
}

/**
 * Read-only local admission. This endpoint inventory/show/ps pass never calls
 * `/api/chat`, pulls a model, or asks Ollama to load model weights.
 */
export async function preflightOllamaLocal(input: {
  policies: readonly OllamaLocalPolicy[];
  cloudConfigFile: string;
  fetch?: typeof fetch;
  now?: () => Date;
}): Promise<OllamaLocalPreflight> {
  if (!Array.isArray(input.policies) || input.policies.length < 1) {
    throw new Error('Ollama preflight requires at least one resident policy');
  }
  const policies = input.policies.map(ollamaLocalPolicy);
  const endpoints = new Set(policies.map((policy) => policy.endpoint));
  if (endpoints.size !== 1) throw new Error('Ollama residents must share one exact endpoint');
  const settings = new Set(policies.map((policy) => stableJson(policy.settings)));
  if (settings.size !== 1) {
    throw new Error(
      'Ollama residents must share exact output, context, temperature, and load settings',
    );
  }
  const transports = new Set(
    policies.map((policy) =>
      stableJson({
        protocol: policy.transport.protocol,
        schemaProtocol: policy.transport.schemaProtocol,
        schemaSha256: policy.transport.schemaSha256,
      }),
    ),
  );
  if (transports.size !== 1) {
    throw new Error('Ollama residents must share one exact JSON action transport and schema');
  }
  const policiesByModel = new Map<string, OllamaLocalPolicy>();
  for (const policy of policies) {
    const prior = policiesByModel.get(policy.modelTag);
    if (prior && prior.modelDigest !== policy.modelDigest) {
      throw new Error(`Ollama residents disagree on installed digest for ${policy.modelTag}`);
    }
    policiesByModel.set(policy.modelTag, policy);
  }

  const cloudConfigFile = plainFile(input.cloudConfigFile, 'Ollama cloud configuration');
  const cloudConfigBytes = fs.readFileSync(cloudConfigFile);
  let cloudConfig: unknown;
  try {
    cloudConfig = JSON.parse(cloudConfigBytes.toString('utf8'));
  } catch {
    throw new Error('Ollama cloud configuration is not valid JSON');
  }
  if (!plainRecord(cloudConfig) || cloudConfig.disable_ollama_cloud !== true) {
    throw new Error('Ollama cloud must be explicitly disabled before local admission');
  }

  const callFetch = input.fetch ?? globalThis.fetch;
  const endpoint = policies[0].endpoint;
  const origin = new URL(endpoint).origin;
  const [versionValue, tagsValue, psValue] = await Promise.all([
    readLocalJson(callFetch, `${origin}/api/version`, { method: 'GET' }),
    readLocalJson(callFetch, `${origin}/api/tags`, { method: 'GET' }),
    readLocalJson(callFetch, `${origin}/api/ps`, { method: 'GET' }),
  ]);
  const version = boundedText(
    plainRecord(versionValue) ? versionValue.version : null,
    'Ollama server version',
    100,
  );
  const installed =
    plainRecord(tagsValue) && Array.isArray(tagsValue.models) ? tagsValue.models : [];
  const modelEvidence = [] as Array<OllamaLocalPreflight['models'][number]>;
  for (const policy of policiesByModel.values()) {
    const tag = installed.find(
      (entry) =>
        plainRecord(entry) && (entry.model === policy.modelTag || entry.name === policy.modelTag),
    );
    if (!plainRecord(tag)) throw new Error(`Ollama model is not installed: ${policy.modelTag}`);
    if (tag.digest !== policy.modelDigest) {
      throw new Error(`Ollama installed digest differs for ${policy.modelTag}`);
    }
    const show = await readLocalJson(callFetch, `${origin}/api/show`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: policy.modelTag, verbose: false }),
    });
    if (
      !plainRecord(show) ||
      !Array.isArray(show.capabilities) ||
      typeof show.template !== 'string'
    ) {
      throw new Error(`Ollama show response is invalid for ${policy.modelTag}`);
    }
    const capabilities = show.capabilities.map((capability) => String(capability)).sort();
    if (!capabilities.includes('completion')) {
      throw new Error(`Ollama model does not advertise completion capability: ${policy.modelTag}`);
    }
    const templateSha256 = sha256(Buffer.from(show.template, 'utf8'));
    if (templateSha256 !== policy.transport.templateSha256) {
      throw new Error(`Ollama installed template differs for ${policy.modelTag}`);
    }
    const contextLength = ollamaContextLength(show.model_info);
    if (contextLength < policy.settings.contextTokens) {
      throw new Error(
        `Ollama model context is smaller than the admitted setting for ${policy.modelTag}`,
      );
    }
    const details = plainRecord(show.details) ? show.details : {};
    modelEvidence.push(
      deepFreeze({
        modelTag: policy.modelTag,
        modelDigest: policy.modelDigest,
        templateSha256,
        capabilities: Object.freeze(capabilities),
        contextLength,
        family: optionalText(details.family),
        parameterSize: optionalText(details.parameter_size),
        quantizationLevel: optionalText(details.quantization_level),
      }),
    );
  }
  const loaded =
    plainRecord(psValue) && Array.isArray(psValue.models)
      ? psValue.models.map((entry: unknown) => {
          const record = plainRecord(entry) ? entry : {};
          return deepFreeze({
            modelTag: boundedText(record.model ?? record.name, 'loaded Ollama model tag', 300),
            modelDigest:
              record.digest == null ? null : sha256Digest(record.digest, 'loaded Ollama digest'),
            contextLength: optionalNonnegativeInteger(record.context_length),
            sizeBytes: optionalNonnegativeInteger(record.size),
            sizeVramBytes: optionalNonnegativeInteger(record.size_vram),
          });
        })
      : [];
  const base = {
    protocol: OLLAMA_LOCAL_PREFLIGHT_PROTOCOL,
    checkedAt: (input.now?.() ?? new Date()).toISOString(),
    endpoint,
    server: {
      version,
      cloudDisabled: true as const,
      cloudConfigSha256: sha256(cloudConfigBytes),
    },
    models: Object.freeze(modelEvidence),
    loaded: Object.freeze(loaded),
  };
  return deepFreeze({ ...base, digest: sha256(stableJson(base)) });
}

/**
 * Load every admitted local resident model before world release, then prove
 * that all exact content digests are simultaneously resident. Empty-message
 * Ollama chat requests perform model loading only; they are setup operations,
 * not resident decisions and never enter a resident quota account.
 */
export async function prepareOllamaResidentSession(input: {
  policies: readonly OllamaLocalPolicy[];
  preflight: OllamaLocalPreflight;
  fetch?: typeof fetch;
}): Promise<OllamaResidentSession> {
  const policies = uniqueOllamaPolicies(input.policies);
  verifyOllamaPreflight(input.preflight, policies);
  if (policies.some((policy) => !usesOllamaResidentSessionTransport(policy))) {
    throw new Error('Ollama resident session setup requires the resident-session transport');
  }
  const keepAlive = policies[0].settings.keepAlive;
  if (/^0(?:ms|s|m|h)$/.test(keepAlive)) {
    throw new Error('Ollama resident session requires nonzero model residency');
  }
  if (
    input.preflight.loaded.some((loaded) =>
      policies.some((policy) => policy.modelTag === loaded.modelTag),
    )
  ) {
    throw new Error('Ollama resident session will not claim ownership of an already loaded model');
  }

  const callFetch = input.fetch ?? globalThis.fetch;
  const loadedByThisSetup: OllamaLocalPolicy[] = [];
  const modelEvidence: Array<OllamaResidentSession['models'][number]> = [];
  try {
    for (const policy of policies) {
      // The load request must establish the same runtime envelope later used
      // by resident attempts. Omitting num_ctx lets Ollama select a model-wide
      // default and can reserve radically more KV memory than the admitted
      // session identity says it owns.
      loadedByThisSetup.push(policy);
      const response = await readLocalJson(callFetch, policy.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: policy.modelTag,
          messages: [],
          stream: false,
          options: {
            num_ctx: policy.settings.contextTokens,
            num_predict: policy.settings.maxOutputTokens,
            temperature: policy.settings.temperature,
          },
          keep_alive: keepAlive,
        }),
      });
      if (
        !plainRecord(response) ||
        response.model !== policy.modelTag ||
        response.done !== true ||
        response.done_reason !== 'load' ||
        !plainRecord(response.message) ||
        response.message.role !== 'assistant' ||
        response.message.content !== ''
      ) {
        throw new Error(`Ollama load response identity is invalid for ${policy.modelTag}`);
      }
      modelEvidence.push(
        deepFreeze({
          modelTag: policy.modelTag,
          modelDigest: policy.modelDigest,
          loadDurationNs: optionalNonnegativeInteger(response.load_duration),
          totalDurationNs: optionalNonnegativeInteger(response.total_duration),
        }),
      );
    }
    const loaded = await readLoadedOllamaModels(callFetch, policies[0].endpoint);
    for (const policy of policies) {
      const active = loaded.find((model) => model.modelTag === policy.modelTag);
      if (
        !active ||
        active.modelDigest !== policy.modelDigest ||
        active.contextLength == null ||
        active.contextLength !== policy.settings.contextTokens
      ) {
        throw new Error(`Ollama did not retain the admitted resident model ${policy.modelTag}`);
      }
    }
    const base = {
      protocol: 'behold.ollama-resident-session.v1' as const,
      endpoint: policies[0].endpoint,
      keepAlive,
      preflightDigest: input.preflight.digest,
      models: Object.freeze(modelEvidence),
      loaded,
    };
    return deepFreeze({ ...base, digest: sha256(stableJson(base)) });
  } catch (error) {
    await unloadOllamaPolicies(callFetch, loadedByThisSetup).catch(() => undefined);
    throw error;
  }
}

/** Release only model loads created by prepareOllamaResidentSession. */
export async function releaseOllamaResidentSession(input: {
  session: OllamaResidentSession;
  policies: readonly OllamaLocalPolicy[];
  fetch?: typeof fetch;
}) {
  const policies = uniqueOllamaPolicies(input.policies);
  const { digest, ...base } = input.session;
  if (
    input.session.protocol !== 'behold.ollama-resident-session.v1' ||
    sha256Digest(digest, 'Ollama resident session digest') !== sha256(stableJson(base)) ||
    input.session.endpoint !== policies[0].endpoint ||
    input.session.models.length !== policies.length ||
    policies.some(
      (policy) =>
        !usesOllamaResidentSessionTransport(policy) ||
        !input.session.models.some(
          (model) => model.modelTag === policy.modelTag && model.modelDigest === policy.modelDigest,
        ),
    )
  ) {
    throw new Error('Ollama resident session release identity is invalid');
  }
  const callFetch = input.fetch ?? globalThis.fetch;
  await unloadOllamaPolicies(callFetch, [...policies].reverse());
  const loaded = await waitForOllamaModelsUnloaded(callFetch, policies[0].endpoint, policies);
  return deepFreeze({
    protocol: 'behold.ollama-resident-session-release.v1' as const,
    sessionDigest: input.session.digest,
    unloadedModels: Object.freeze(policies.map((policy) => policy.modelTag)),
    loadedAfter: loaded,
  });
}

export function ollamaAttemptIdentity(
  policyValue: OllamaLocalPolicy,
  preflight: OllamaLocalPreflight,
  requestValue: unknown,
): OllamaAttemptIdentity {
  const policy = ollamaLocalPolicy(policyValue);
  verifyOllamaPreflight(preflight, [policy]);
  return deepFreeze({
    protocol: 'behold.ollama-attempt-identity.v2',
    policy,
    request: assertOllamaLocalRequest(requestValue, policy.modelTag, policy),
    preflightDigest: preflight.digest,
    serverVersion: preflight.server.version,
  });
}

export function verifyOllamaPreflight(
  value: OllamaLocalPreflight,
  policiesValue: readonly OllamaLocalPolicy[],
) {
  if (!plainRecord(value) || value.protocol !== OLLAMA_LOCAL_PREFLIGHT_PROTOCOL) {
    throw new Error('Ollama preflight protocol is invalid');
  }
  const { digest, ...base } = value;
  if (sha256Digest(digest, 'Ollama preflight digest') !== sha256(stableJson(base))) {
    throw new Error('Ollama preflight content identity is invalid');
  }
  const policies = policiesValue.map(ollamaLocalPolicy);
  if (policies.some((policy) => policy.endpoint !== value.endpoint)) {
    throw new Error('Ollama preflight endpoint differs from resident admission');
  }
  if (!value.server || value.server.cloudDisabled !== true) {
    throw new Error('Ollama preflight does not prove cloud-disabled local operation');
  }
  for (const policy of policies) {
    const model = value.models?.find((candidate) => candidate.modelTag === policy.modelTag);
    if (
      !model ||
      model.modelDigest !== policy.modelDigest ||
      model.templateSha256 !== policy.transport.templateSha256 ||
      !model.capabilities.includes('completion') ||
      model.contextLength < policy.settings.contextTokens
    ) {
      throw new Error(`Ollama preflight does not admit ${policy.modelTag}`);
    }
  }
  return value;
}

function uniqueOllamaPolicies(values: readonly OllamaLocalPolicy[]) {
  if (!Array.isArray(values) || values.length < 1) {
    throw new Error('Ollama resident session requires at least one policy');
  }
  const policies = values.map(ollamaLocalPolicy);
  const unique = new Map<string, OllamaLocalPolicy>();
  for (const policy of policies) {
    const prior = unique.get(policy.modelTag);
    if (prior && stableJson(prior) !== stableJson(policy)) {
      throw new Error(`Ollama resident session policies disagree for ${policy.modelTag}`);
    }
    unique.set(policy.modelTag, policy);
  }
  return [...unique.values()];
}

async function unloadOllamaPolicies(
  callFetch: typeof fetch,
  policies: readonly OllamaLocalPolicy[],
) {
  const failures: string[] = [];
  for (const policy of policies) {
    try {
      const response = await readLocalJson(callFetch, policy.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: policy.modelTag,
          messages: [],
          stream: false,
          keep_alive: 0,
        }),
      });
      if (
        !plainRecord(response) ||
        response.model !== policy.modelTag ||
        response.done !== true ||
        !['unload', 'load'].includes(String(response.done_reason || ''))
      ) {
        throw new Error('unload response identity is invalid');
      }
    } catch (error: any) {
      failures.push(`${policy.modelTag}: ${error?.message || String(error)}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Ollama resident session unload failed: ${failures.join('; ')}`);
  }
}

async function readLoadedOllamaModels(
  callFetch: typeof fetch,
  endpoint: string,
): Promise<OllamaLocalPreflight['loaded']> {
  const value = await readLocalJson(callFetch, `${new URL(endpoint).origin}/api/ps`, {
    method: 'GET',
  });
  const models = plainRecord(value) && Array.isArray(value.models) ? value.models : [];
  return Object.freeze(
    models.map((entry: unknown) => {
      const record = plainRecord(entry) ? entry : {};
      return deepFreeze({
        modelTag: boundedText(record.model ?? record.name, 'loaded Ollama model tag', 300),
        modelDigest:
          record.digest == null ? null : sha256Digest(record.digest, 'loaded Ollama digest'),
        contextLength: optionalNonnegativeInteger(record.context_length),
        sizeBytes: optionalNonnegativeInteger(record.size),
        sizeVramBytes: optionalNonnegativeInteger(record.size_vram),
      });
    }),
  );
}

async function waitForOllamaModelsUnloaded(
  callFetch: typeof fetch,
  endpoint: string,
  policies: readonly OllamaLocalPolicy[],
) {
  const deadline = Date.now() + 10_000;
  let loaded: OllamaLocalPreflight['loaded'] = Object.freeze([]);
  do {
    loaded = await readLoadedOllamaModels(callFetch, endpoint);
    const survivors = loaded.filter((model) =>
      policies.some((policy) => policy.modelTag === model.modelTag),
    );
    if (survivors.length === 0) return loaded;
    if (Date.now() >= deadline) {
      throw new Error(
        `Ollama resident session models remained loaded: ${survivors.map((model) => model.modelTag).join(', ')}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (true);
}

async function readLocalJson(callFetch: typeof fetch, endpoint: string, init: RequestInit) {
  const url = new URL(endpoint);
  if (
    url.protocol !== 'http:' ||
    (url.hostname !== '127.0.0.1' && url.hostname !== '[::1]') ||
    !url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('Ollama preflight escaped the admitted loopback origin');
  }
  const response = await callFetch(url.toString(), init);
  if (!response.ok) throw new Error(`Ollama preflight ${url.pathname} returned ${response.status}`);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_PREFLIGHT_BYTES) {
    throw new Error(`Ollama preflight ${url.pathname} exceeded the response budget`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_PREFLIGHT_BYTES) {
    throw new Error(`Ollama preflight ${url.pathname} exceeded the response budget`);
  }
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`Ollama preflight ${url.pathname} returned malformed JSON`);
  }
}

function ollamaContextLength(value: unknown) {
  if (!plainRecord(value)) throw new Error('Ollama model_info is missing');
  const lengths = Object.entries(value)
    .filter(([key]) => key.endsWith('.context_length'))
    .map(([, length]) => Number(length))
    .filter((length) => Number.isSafeInteger(length) && length > 0);
  if (lengths.length !== 1) throw new Error('Ollama model context length is ambiguous');
  return lengths[0];
}

function exactRecord(value: unknown, fields: readonly string[], label: string) {
  if (!plainRecord(value)) throw new Error(`${label} must be an object`);
  if (Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) {
    throw new Error(`${label} fields do not match the versioned contract`);
  }
  return value;
}

function plainRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function plainFile(value: string, label: string) {
  const file = path.resolve(String(value || ''));
  const stats = fs.lstatSync(file);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`${label} must be a plain file`);
  return file;
}

function boundedText(value: unknown, label: string, maximum: number) {
  if (typeof value !== 'string') throw new Error(`${label} must be text`);
  const text = value.trim();
  if (!text || text !== value || text.length > maximum) {
    throw new Error(`${label} must be nonempty trimmed text no longer than ${maximum}`);
  }
  return text;
}

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}`);
  }
  return Number(value);
}

function optionalNonnegativeInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function sha256Digest(value: unknown, label: string) {
  const text = String(value || '');
  if (!/^[a-f0-9]{64}$/.test(text)) throw new Error(`${label} must be a SHA-256 digest`);
  return text;
}

function optionalText(value: unknown) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text || null;
}

function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
