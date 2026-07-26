import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { ModelCallEvidence } from './evidence';
import type { ResidentMindDecision, ResidentMindRequest } from './interface';
import {
  createStrictLocalResidentSessionEnvelope,
  OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_PROTOCOL,
  OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_SHA256,
  parseStrictLocalJsonActionDecisionContent,
} from './ollama-json-action';

export const LMSTUDIO_LOCAL_POLICY_PROTOCOL = 'behold.lmstudio-local-policy.v1' as const;
export const LMSTUDIO_LOCAL_RESIDENT_SESSION_TRANSPORT_PROTOCOL =
  'behold.lmstudio-local-resident-session.v1' as const;
export const LMSTUDIO_LOCAL_PREFLIGHT_PROTOCOL = 'behold.lmstudio-local-preflight.v1' as const;
export const LMSTUDIO_LOCAL_REQUEST_IDENTITY_PROTOCOL =
  'behold.lmstudio-local-request-identity.v1' as const;

export type LmStudioLocalPolicy = Readonly<{
  protocol: typeof LMSTUDIO_LOCAL_POLICY_PROTOCOL;
  /** Exact loopback OpenAI-compatible structured-output endpoint. */
  endpoint: string;
  /** Exact load key, including a selected variant where the catalog has variants. */
  modelKey: string;
  /** Stable catalog key returned by the native model inventory. */
  catalogKey: string;
  /** Exact local LM Studio index identity, never a pathname. */
  indexedModelIdentifier: string;
  artifact: Readonly<{
    relativePath: string;
    treeSha256: string;
    sizeBytes: number;
  }>;
  transport: Readonly<{
    protocol: typeof LMSTUDIO_LOCAL_RESIDENT_SESSION_TRANSPORT_PROTOCOL;
    schemaProtocol: typeof OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_PROTOCOL;
    schemaSha256: typeof OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_SHA256;
    templateSha256: string;
  }>;
  runtime: Readonly<{
    appVersion: string;
    cliCommit: string;
    engine: string;
    format: 'mlx';
  }>;
  settings: Readonly<{
    contextTokens: number;
    maxOutputTokens: number;
    temperature: number;
  }>;
}>;

export type LmStudioLocalPreflight = Readonly<{
  protocol: typeof LMSTUDIO_LOCAL_PREFLIGHT_PROTOCOL;
  checkedAt: string;
  endpoint: string;
  runtime: LmStudioLocalPolicy['runtime'];
  models: readonly Readonly<{
    modelKey: string;
    catalogKey: string;
    indexedModelIdentifier: string;
    artifactTreeSha256: string;
    templateSha256: string;
    sizeBytes: number;
    architecture: string | null;
    maxContextTokens: number;
    trainedForToolUse: boolean;
  }>[];
  digest: string;
}>;

export type LmStudioLocalRequestIdentity = Readonly<{
  protocol: typeof LMSTUDIO_LOCAL_REQUEST_IDENTITY_PROTOCOL;
  transportProtocol: typeof LMSTUDIO_LOCAL_RESIDENT_SESSION_TRANSPORT_PROTOCOL;
  schemaProtocol: typeof OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_PROTOCOL;
  schemaSha256: typeof OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_SHA256;
  modelKey: string;
  catalogKey: string;
  indexedModelIdentifier: string;
  modelInstanceId: string;
  artifactTreeSha256: string;
  templateSha256: string;
  runtime: LmStudioLocalPolicy['runtime'];
  actionContractSha256: string;
  responseSchemaSha256: string;
  responseFormatSha256: string;
  messageLayoutProtocol: 'behold.ollama-local-resident-session-message-layout.v1';
  workingContinuityProtocol: 'behold.resident-working-continuity.v1';
  stablePrefixSha256: string;
}>;

export type LmStudioResidentSession = Readonly<{
  protocol: 'behold.lmstudio-resident-session.v1';
  endpointOrigin: string;
  preflightDigest: string;
  models: readonly Readonly<{
    modelKey: string;
    catalogKey: string;
    artifactTreeSha256: string;
    modelInstanceId: string;
    contextTokens: number;
  }>[];
  digest: string;
}>;

export type LmStudioCommandRunner = (args: readonly string[]) => string;

const MAX_CONTEXT_TOKENS = 262_144;
const MAX_OUTPUT_TOKENS = 32_768;
const MAX_CLI_BYTES = 8 * 1024 * 1024;

export function lmStudioLocalPolicy(value: unknown): LmStudioLocalPolicy {
  const record = exactRecord(
    value,
    [
      'protocol',
      'endpoint',
      'modelKey',
      'catalogKey',
      'indexedModelIdentifier',
      'artifact',
      'transport',
      'runtime',
      'settings',
    ],
    'LM Studio local policy',
  );
  if (record.protocol !== LMSTUDIO_LOCAL_POLICY_PROTOCOL) {
    throw new Error(`LM Studio policy protocol must be ${LMSTUDIO_LOCAL_POLICY_PROTOCOL}`);
  }
  const artifact = exactRecord(
    record.artifact,
    ['relativePath', 'treeSha256', 'sizeBytes'],
    'LM Studio artifact identity',
  );
  const transport = exactRecord(
    record.transport,
    ['protocol', 'schemaProtocol', 'schemaSha256', 'templateSha256'],
    'LM Studio resident transport',
  );
  if (transport.protocol !== LMSTUDIO_LOCAL_RESIDENT_SESSION_TRANSPORT_PROTOCOL) {
    throw new Error(
      `LM Studio transport protocol must be ${LMSTUDIO_LOCAL_RESIDENT_SESSION_TRANSPORT_PROTOCOL}`,
    );
  }
  if (
    transport.schemaProtocol !== OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_PROTOCOL ||
    transport.schemaSha256 !== OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_SHA256
  ) {
    throw new Error('LM Studio transport must preserve the exact strict resident schema v2');
  }
  const runtime = exactRecord(
    record.runtime,
    ['appVersion', 'cliCommit', 'engine', 'format'],
    'LM Studio runtime identity',
  );
  if (runtime.format !== 'mlx') {
    throw new Error('LM Studio resident session v1 admits only the MLX runtime');
  }
  const settings = exactRecord(
    record.settings,
    ['contextTokens', 'maxOutputTokens', 'temperature'],
    'LM Studio resident settings',
  );
  const contextTokens = boundedInteger(
    settings.contextTokens,
    'LM Studio contextTokens',
    512,
    MAX_CONTEXT_TOKENS,
  );
  const maxOutputTokens = boundedInteger(
    settings.maxOutputTokens,
    'LM Studio maxOutputTokens',
    1,
    MAX_OUTPUT_TOKENS,
  );
  if (maxOutputTokens > contextTokens) {
    throw new Error('LM Studio maxOutputTokens cannot exceed contextTokens');
  }
  const temperature = Number(settings.temperature);
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    throw new Error('LM Studio temperature must be from 0 through 2');
  }
  const modelKey = boundedIdentity(record.modelKey, 'LM Studio model key');
  const catalogKey = boundedIdentity(record.catalogKey, 'LM Studio catalog key');
  const indexedModelIdentifier = boundedIdentity(
    record.indexedModelIdentifier,
    'LM Studio indexed model identity',
  );
  const relativePath = exactRelativePath(artifact.relativePath);
  if (
    indexedModelIdentifier !== relativePath &&
    !indexedModelIdentifier.endsWith(`@${relativePath}`)
  ) {
    throw new Error('LM Studio indexed identity does not name the admitted artifact path');
  }
  if (modelKey !== catalogKey && !modelKey.startsWith(`${catalogKey}@`)) {
    throw new Error('LM Studio selected model key does not belong to its catalog key');
  }
  return deepFreeze({
    protocol: LMSTUDIO_LOCAL_POLICY_PROTOCOL,
    endpoint: exactLmStudioEndpoint(record.endpoint),
    modelKey,
    catalogKey,
    indexedModelIdentifier,
    artifact: {
      relativePath,
      treeSha256: sha256Digest(artifact.treeSha256, 'LM Studio artifact tree'),
      sizeBytes: boundedInteger(
        artifact.sizeBytes,
        'LM Studio artifact size',
        1,
        Number.MAX_SAFE_INTEGER,
      ),
    },
    transport: {
      protocol: LMSTUDIO_LOCAL_RESIDENT_SESSION_TRANSPORT_PROTOCOL,
      schemaProtocol: OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_PROTOCOL,
      schemaSha256: OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_SHA256,
      templateSha256: sha256Digest(transport.templateSha256, 'LM Studio template'),
    },
    runtime: {
      appVersion: boundedText(runtime.appVersion, 'LM Studio app version', 80),
      cliCommit: boundedText(runtime.cliCommit, 'LM Studio CLI commit', 80),
      engine: boundedIdentity(runtime.engine, 'LM Studio engine'),
      format: 'mlx',
    },
    settings: { contextTokens, maxOutputTokens, temperature },
  });
}

export function createLmStudioLocalJsonActionRequest(
  requestValue: ResidentMindRequest,
  policyValue: LmStudioLocalPolicy,
  modelInstanceId: string,
) {
  const policy = lmStudioLocalPolicy(policyValue);
  if (requestValue.model !== policy.modelKey) {
    throw new Error('LM Studio request model differs from the admitted model key');
  }
  const instanceId = exactInstanceId(modelInstanceId);
  const envelope = createStrictLocalResidentSessionEnvelope(requestValue);
  const responseFormat = deepFreeze({
    type: 'json_schema' as const,
    json_schema: {
      name: 'behold_resident_action_v2',
      strict: true as const,
      schema: envelope.responseSchema,
    },
  });
  const body = deepFreeze({
    model: instanceId,
    messages: envelope.messages,
    response_format: responseFormat,
    temperature: policy.settings.temperature,
    max_tokens: policy.settings.maxOutputTokens,
    stream: false as const,
  });
  const identity: LmStudioLocalRequestIdentity = deepFreeze({
    protocol: LMSTUDIO_LOCAL_REQUEST_IDENTITY_PROTOCOL,
    transportProtocol: LMSTUDIO_LOCAL_RESIDENT_SESSION_TRANSPORT_PROTOCOL,
    schemaProtocol: envelope.schemaProtocol,
    schemaSha256: envelope.schemaSha256,
    modelKey: policy.modelKey,
    catalogKey: policy.catalogKey,
    indexedModelIdentifier: policy.indexedModelIdentifier,
    modelInstanceId: instanceId,
    artifactTreeSha256: policy.artifact.treeSha256,
    templateSha256: policy.transport.templateSha256,
    runtime: policy.runtime,
    actionContractSha256: envelope.actionContractSha256,
    responseSchemaSha256: envelope.responseSchemaSha256,
    responseFormatSha256: sha256(stableJson(responseFormat)),
    messageLayoutProtocol: envelope.messageLayoutProtocol,
    workingContinuityProtocol: envelope.workingContinuityProtocol,
    stablePrefixSha256: envelope.stablePrefixSha256,
  });
  return deepFreeze({ body, identity });
}

export function assertLmStudioLocalJsonActionRequest(
  value: unknown,
  request: ResidentMindRequest,
  policyValue: LmStudioLocalPolicy,
  modelInstanceId: string,
) {
  const expected = createLmStudioLocalJsonActionRequest(request, policyValue, modelInstanceId);
  if (stableJson(value) !== stableJson(expected.body)) {
    throw new Error('LM Studio wire request differs from the exact admitted resident request');
  }
  return expected.identity;
}

export function parseLmStudioLocalJsonActionDecision(
  data: unknown,
  request: ResidentMindRequest,
  call: ModelCallEvidence,
  policyValue: LmStudioLocalPolicy,
  modelInstanceId: string,
): ResidentMindDecision {
  const policy = lmStudioLocalPolicy(policyValue);
  const instanceId = exactInstanceId(modelInstanceId);
  const response = plainRecord(data) ? data : null;
  if (!response) throw new Error('LM Studio response was not an object');
  if (response.model !== instanceId) {
    throw new Error('LM Studio response model instance differs from the admitted instance');
  }
  if (!Array.isArray(response.choices) || response.choices.length !== 1) {
    throw new Error('LM Studio response must contain exactly one choice');
  }
  const choice = plainRecord(response.choices[0]) ? response.choices[0] : null;
  const message = choice && plainRecord(choice.message) ? choice.message : null;
  if (!message || message.role !== 'assistant') {
    throw new Error('LM Studio response contained no assistant message');
  }
  if (
    message.tool_calls != null &&
    (!Array.isArray(message.tool_calls) || message.tool_calls.length > 0)
  ) {
    throw new Error('LM Studio strict resident response used forbidden tool calls');
  }
  if (typeof message.content !== 'string') {
    throw new Error('LM Studio strict resident response content was not text');
  }
  if (request.model !== policy.modelKey) {
    throw new Error('LM Studio response was decoded under another resident model policy');
  }
  return parseStrictLocalJsonActionDecisionContent(message.content, message, request, call, 2);
}

/**
 * Read-only admission: exact loopback server inventory, app/CLI/engine revision,
 * local model index, and complete artifact bytes. It never loads or calls a model.
 */
export async function preflightLmStudioLocal(input: {
  policies: readonly LmStudioLocalPolicy[];
  modelsRoot: string;
  appInfoPlist?: string;
  fetch?: typeof fetch;
  runLms?: LmStudioCommandRunner;
  readAppVersion?: () => string;
  now?: () => Date;
}): Promise<LmStudioLocalPreflight> {
  const policies = uniquePolicies(input.policies);
  const commonRuntime = policies[0].runtime;
  if (policies.some((policy) => stableJson(policy.runtime) !== stableJson(commonRuntime))) {
    throw new Error('LM Studio residents must bind one exact app/CLI/engine runtime');
  }
  const modelsRoot = path.resolve(input.modelsRoot);
  const rootStat = await fs.promises.lstat(modelsRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('LM Studio models root must be a real directory');
  }
  const runLms = input.runLms ?? defaultLmsRunner;
  const versionOutput = boundedCliOutput(runLms(['--version']));
  const cliCommit = /^CLI commit:\s*([^\s]+)\s*$/.exec(versionOutput)?.[1] ?? null;
  if (cliCommit !== commonRuntime.cliCommit) {
    throw new Error('LM Studio CLI revision differs from the admitted runtime');
  }
  const runtimeOutput = boundedCliOutput(runLms(['runtime', 'ls']));
  const selectedEngines = runtimeOutput
    .split(/\r?\n/)
    .filter((line) => line.includes('✓'))
    .map((line) => line.trim().split(/\s+/)[0]);
  if (!selectedEngines.includes(commonRuntime.engine)) {
    throw new Error('LM Studio selected MLX engine differs from the admitted runtime');
  }
  const readAppVersion =
    input.readAppVersion ?? (() => defaultLmStudioAppVersion(input.appInfoPlist));
  if (readAppVersion().trim() !== commonRuntime.appVersion) {
    throw new Error('LM Studio app version differs from the admitted runtime');
  }
  const indexed = parseJsonArray(boundedCliOutput(runLms(['ls', '--json'])), 'LM Studio index');
  const loaded = parseJsonArray(
    boundedCliOutput(runLms(['ps', '--json'])),
    'LM Studio process list',
  );
  const callFetch = input.fetch ?? globalThis.fetch;
  const inventory = await readLocalJson(
    callFetch,
    `${new URL(policies[0].endpoint).origin}/api/v1/models`,
    {
      method: 'GET',
    },
  );
  const inventoryModels =
    plainRecord(inventory) && Array.isArray(inventory.models) ? inventory.models : [];
  const models: LmStudioLocalPreflight['models'][number][] = [];
  for (const policy of policies) {
    const catalogIndexEntry = indexed.find(
      (entry) => plainRecord(entry) && entry.modelKey === policy.catalogKey,
    );
    const variantEntries =
      policy.modelKey === policy.catalogKey
        ? []
        : parseJsonArray(
            boundedCliOutput(runLms(['ls', policy.catalogKey, '--json'])),
            `LM Studio variants for ${policy.catalogKey}`,
          );
    const exactIndexEntry =
      policy.modelKey === policy.catalogKey
        ? catalogIndexEntry
        : variantEntries.find((entry) => plainRecord(entry) && entry.modelKey === policy.modelKey);
    if (
      !plainRecord(catalogIndexEntry) ||
      !plainRecord(exactIndexEntry) ||
      exactIndexEntry.indexedModelIdentifier !== policy.indexedModelIdentifier ||
      exactIndexEntry.format !== 'safetensors' ||
      Number(exactIndexEntry.sizeBytes) !== policy.artifact.sizeBytes ||
      (policy.modelKey !== policy.catalogKey &&
        catalogIndexEntry.selectedVariant !== policy.modelKey)
    ) {
      throw new Error(`LM Studio index identity differs for ${policy.modelKey}`);
    }
    if (
      loaded.some(
        (entry) =>
          plainRecord(entry) &&
          (entry.identifier === residentInstanceId(policy) ||
            entry.modelKey === policy.modelKey ||
            entry.modelKey === policy.catalogKey),
      )
    ) {
      throw new Error(`LM Studio preflight will not claim an already loaded ${policy.modelKey}`);
    }
    const inventoryEntry = inventoryModels.find(
      (entry) => plainRecord(entry) && entry.key === policy.catalogKey,
    );
    if (
      !plainRecord(inventoryEntry) ||
      inventoryEntry.type !== 'llm' ||
      inventoryEntry.format !== 'mlx' ||
      Number(inventoryEntry.size_bytes) !== policy.artifact.sizeBytes ||
      (policy.modelKey !== policy.catalogKey &&
        inventoryEntry.selected_variant !== policy.modelKey) ||
      !Array.isArray(inventoryEntry.loaded_instances) ||
      inventoryEntry.loaded_instances.length !== 0
    ) {
      throw new Error(`LM Studio native inventory differs for ${policy.modelKey}`);
    }
    const artifactRoot = path.join(modelsRoot, policy.artifact.relativePath);
    assertInside(modelsRoot, artifactRoot, 'LM Studio artifact');
    const artifactTreeSha256 = await digestRegularFileTree(artifactRoot);
    if (artifactTreeSha256 !== policy.artifact.treeSha256) {
      throw new Error(`LM Studio artifact bytes differ for ${policy.modelKey}`);
    }
    const templateFile = path.join(artifactRoot, 'chat_template.jinja');
    assertInside(artifactRoot, templateFile, 'LM Studio chat template');
    const templateSha256 = await digestFile(templateFile);
    if (templateSha256 !== policy.transport.templateSha256) {
      throw new Error(`LM Studio template bytes differ for ${policy.modelKey}`);
    }
    const capabilities = plainRecord(inventoryEntry.capabilities)
      ? inventoryEntry.capabilities
      : {};
    const maxContextTokens = boundedInteger(
      inventoryEntry.max_context_length,
      `LM Studio ${policy.modelKey} max context`,
      1,
      MAX_CONTEXT_TOKENS,
    );
    if (maxContextTokens < policy.settings.contextTokens) {
      throw new Error(`LM Studio ${policy.modelKey} cannot admit the configured context`);
    }
    models.push(
      deepFreeze({
        modelKey: policy.modelKey,
        catalogKey: policy.catalogKey,
        indexedModelIdentifier: policy.indexedModelIdentifier,
        artifactTreeSha256,
        templateSha256,
        sizeBytes: policy.artifact.sizeBytes,
        architecture: optionalText(inventoryEntry.architecture),
        maxContextTokens,
        trainedForToolUse: capabilities.trained_for_tool_use === true,
      }),
    );
  }
  const base = {
    protocol: LMSTUDIO_LOCAL_PREFLIGHT_PROTOCOL,
    checkedAt: (input.now ?? (() => new Date()))().toISOString(),
    endpoint: policies[0].endpoint,
    runtime: commonRuntime,
    models: Object.freeze(models),
  };
  return deepFreeze({ ...base, digest: sha256(stableJson(base)) });
}

export function verifyLmStudioPreflight(
  value: LmStudioLocalPreflight,
  policiesValue: readonly LmStudioLocalPolicy[],
) {
  const policies = uniquePolicies(policiesValue);
  const { digest, ...base } = value;
  if (
    value.protocol !== LMSTUDIO_LOCAL_PREFLIGHT_PROTOCOL ||
    value.endpoint !== policies[0].endpoint ||
    value.models.length !== policies.length ||
    digest !== sha256(stableJson(base))
  ) {
    throw new Error('LM Studio preflight identity is invalid');
  }
  for (const policy of policies) {
    const admitted = value.models.find((model) => model.modelKey === policy.modelKey);
    if (
      !admitted ||
      admitted.artifactTreeSha256 !== policy.artifact.treeSha256 ||
      admitted.templateSha256 !== policy.transport.templateSha256 ||
      admitted.indexedModelIdentifier !== policy.indexedModelIdentifier
    ) {
      throw new Error(`LM Studio preflight does not admit ${policy.modelKey}`);
    }
  }
  return value;
}

export async function prepareLmStudioResidentSession(input: {
  policies: readonly LmStudioLocalPolicy[];
  preflight: LmStudioLocalPreflight;
  runLms?: LmStudioCommandRunner;
  fetch?: typeof fetch;
}): Promise<LmStudioResidentSession> {
  const policies = uniquePolicies(input.policies);
  verifyLmStudioPreflight(input.preflight, policies);
  const runLms = input.runLms ?? defaultLmsRunner;
  const callFetch = input.fetch ?? globalThis.fetch;
  const origin = new URL(policies[0].endpoint).origin;
  const hostArgs = lmsHostArgs(origin);
  const loadedByThisSession: LmStudioLocalPolicy[] = [];
  try {
    for (const policy of policies) {
      loadedByThisSession.push(policy);
      boundedCliOutput(
        runLms([
          'load',
          // LM Studio's CLI loads through the catalog alias even when its
          // read-only index exposes a selected variant key. The preflight
          // binds that variant to exact artifact bytes before this locator is
          // used; the custom instance id prevents later JIT substitution.
          policy.catalogKey,
          '--context-length',
          String(policy.settings.contextTokens),
          '--parallel',
          '1',
          '--identifier',
          residentInstanceId(policy),
          '--yes',
          ...hostArgs,
        ]),
      );
    }
    const inventory = await readLocalJson(callFetch, `${origin}/api/v1/models`, { method: 'GET' });
    const models =
      plainRecord(inventory) && Array.isArray(inventory.models) ? inventory.models : [];
    for (const policy of policies) {
      const catalog = models.find((entry) => plainRecord(entry) && entry.key === policy.catalogKey);
      const instance =
        plainRecord(catalog) && Array.isArray(catalog.loaded_instances)
          ? catalog.loaded_instances.find(
              (entry: unknown) => plainRecord(entry) && entry.id === residentInstanceId(policy),
            )
          : null;
      const config = plainRecord(instance) && plainRecord(instance.config) ? instance.config : null;
      if (
        !config ||
        config.context_length !== policy.settings.contextTokens ||
        config.parallel !== 1
      ) {
        throw new Error(`LM Studio did not retain exact resident instance ${policy.modelKey}`);
      }
    }
    const base = {
      protocol: 'behold.lmstudio-resident-session.v1' as const,
      endpointOrigin: origin,
      preflightDigest: input.preflight.digest,
      models: Object.freeze(
        policies.map((policy) =>
          deepFreeze({
            modelKey: policy.modelKey,
            catalogKey: policy.catalogKey,
            artifactTreeSha256: policy.artifact.treeSha256,
            modelInstanceId: residentInstanceId(policy),
            contextTokens: policy.settings.contextTokens,
          }),
        ),
      ),
    };
    return deepFreeze({ ...base, digest: sha256(stableJson(base)) });
  } catch (error) {
    for (const policy of [...loadedByThisSession].reverse()) {
      try {
        runLms(['unload', residentInstanceId(policy), ...hostArgs]);
      } catch {
        // The owning error remains primary; a caller must verify cleanup.
      }
    }
    throw error;
  }
}

export async function releaseLmStudioResidentSession(input: {
  session: LmStudioResidentSession;
  policies: readonly LmStudioLocalPolicy[];
  runLms?: LmStudioCommandRunner;
  fetch?: typeof fetch;
}) {
  const policies = uniquePolicies(input.policies);
  const { digest, ...base } = input.session;
  if (
    digest !== sha256(stableJson(base)) ||
    input.session.models.length !== policies.length ||
    policies.some(
      (policy) =>
        !input.session.models.some(
          (model) =>
            model.modelKey === policy.modelKey &&
            model.modelInstanceId === residentInstanceId(policy) &&
            model.artifactTreeSha256 === policy.artifact.treeSha256,
        ),
    )
  ) {
    throw new Error('LM Studio resident session release identity is invalid');
  }
  const runLms = input.runLms ?? defaultLmsRunner;
  const origin = new URL(policies[0].endpoint).origin;
  const hostArgs = lmsHostArgs(origin);
  const failures: string[] = [];
  for (const policy of [...policies].reverse()) {
    try {
      boundedCliOutput(runLms(['unload', residentInstanceId(policy), ...hostArgs]));
    } catch (error: any) {
      failures.push(`${policy.modelKey}: ${error?.message || String(error)}`);
    }
  }
  const callFetch = input.fetch ?? globalThis.fetch;
  const inventory = await readLocalJson(callFetch, `${origin}/api/v1/models`, { method: 'GET' });
  const models = plainRecord(inventory) && Array.isArray(inventory.models) ? inventory.models : [];
  const survivors = policies.filter((policy) =>
    models.some(
      (entry) =>
        plainRecord(entry) &&
        entry.key === policy.catalogKey &&
        Array.isArray(entry.loaded_instances) &&
        entry.loaded_instances.some(
          (instance: unknown) =>
            plainRecord(instance) && instance.id === residentInstanceId(policy),
        ),
    ),
  );
  if (failures.length || survivors.length) {
    throw new Error(
      `LM Studio resident session unload failed: ${[
        ...failures,
        ...survivors.map((policy) => `${policy.modelKey}: instance remained loaded`),
      ].join('; ')}`,
    );
  }
  return deepFreeze({
    protocol: 'behold.lmstudio-resident-session-release.v1' as const,
    sessionDigest: input.session.digest,
    unloadedInstances: Object.freeze(policies.map(residentInstanceId)),
  });
}

export function lmStudioAttemptIdentity(
  policyValue: LmStudioLocalPolicy,
  preflight: LmStudioLocalPreflight,
  request: LmStudioLocalRequestIdentity,
) {
  const policy = lmStudioLocalPolicy(policyValue);
  const { digest, ...base } = preflight;
  const admitted = preflight.models.find((model) => model.modelKey === policy.modelKey);
  if (
    preflight.protocol !== LMSTUDIO_LOCAL_PREFLIGHT_PROTOCOL ||
    preflight.endpoint !== policy.endpoint ||
    digest !== sha256(stableJson(base)) ||
    !admitted ||
    admitted.artifactTreeSha256 !== policy.artifact.treeSha256 ||
    admitted.templateSha256 !== policy.transport.templateSha256 ||
    admitted.indexedModelIdentifier !== policy.indexedModelIdentifier
  ) {
    throw new Error(`LM Studio preflight does not admit ${policy.modelKey}`);
  }
  return deepFreeze({
    protocol: 'behold.lmstudio-attempt-identity.v1' as const,
    policy,
    request,
    preflightDigest: preflight.digest,
  });
}

export async function digestRegularFileTree(rootValue: string) {
  const root = path.resolve(rootValue);
  const rootStat = await fs.promises.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('LM Studio artifact root must be a real directory');
  }
  const files: string[] = [];
  async function walk(directory: string) {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => Buffer.from(a.name).compare(Buffer.from(b.name)));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('LM Studio artifact may not contain symlinks');
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) files.push(absolute);
      else throw new Error('LM Studio artifact may contain only regular files and directories');
    }
  }
  await walk(root);
  if (!files.length) throw new Error('LM Studio artifact contains no files');
  files.sort((a, b) =>
    Buffer.from(path.relative(root, a)).compare(Buffer.from(path.relative(root, b))),
  );
  const aggregate = createHash('sha256');
  for (const file of files) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    aggregate.update(`${await digestFile(file)}  ./${relative}\n`);
  }
  return aggregate.digest('hex');
}

async function digestFile(file: string) {
  const stat = await fs.promises.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('LM Studio artifact member must be a regular file');
  }
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

function uniquePolicies(values: readonly LmStudioLocalPolicy[]) {
  if (!Array.isArray(values) || values.length < 1) {
    throw new Error('LM Studio resident session requires at least one policy');
  }
  const policies = values.map(lmStudioLocalPolicy);
  const unique = new Map<string, LmStudioLocalPolicy>();
  for (const policy of policies) {
    const prior = unique.get(policy.modelKey);
    if (prior && stableJson(prior) !== stableJson(policy)) {
      throw new Error(`LM Studio resident policies disagree for ${policy.modelKey}`);
    }
    unique.set(policy.modelKey, policy);
  }
  if (new Set(policies.map((policy) => policy.endpoint)).size !== 1) {
    throw new Error('LM Studio resident policies must use one exact loopback endpoint');
  }
  return [...unique.values()];
}

function residentInstanceId(policy: LmStudioLocalPolicy) {
  return `behold-${sha256(
    stableJson({
      modelKey: policy.modelKey,
      artifactTreeSha256: policy.artifact.treeSha256,
      contextTokens: policy.settings.contextTokens,
    }),
  ).slice(0, 24)}`;
}

function exactInstanceId(value: unknown) {
  const text = boundedIdentity(value, 'LM Studio model instance');
  if (!/^behold-[a-f0-9]{24}$/.test(text)) {
    throw new Error('LM Studio resident model instance identity is invalid');
  }
  return text;
}

function exactLmStudioEndpoint(value: unknown) {
  const url = new URL(String(value || ''));
  if (
    url.protocol !== 'http:' ||
    (url.hostname !== '127.0.0.1' && url.hostname !== '[::1]') ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/v1/chat/completions' ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'LM Studio endpoint must be exact http://127.0.0.1:<port>/v1/chat/completions or http://[::1]:<port>/v1/chat/completions',
    );
  }
  return url.toString();
}

function lmsHostArgs(origin: string) {
  const url = new URL(origin);
  return ['--host', url.hostname.replace(/^\[(.*)\]$/, '$1'), '--port', url.port];
}

function defaultLmsRunner(args: readonly string[]) {
  const output = execFileSync('lms', [...args], {
    encoding: 'utf8',
    maxBuffer: MAX_CLI_BYTES,
    timeout: 180_000,
  });
  return output;
}

function defaultLmStudioAppVersion(appInfoPlist?: string) {
  const plist = appInfoPlist ?? '/Applications/LM Studio.app/Contents/Info.plist';
  return execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', plist], {
    encoding: 'utf8',
    maxBuffer: 16_384,
    timeout: 10_000,
  });
}

function boundedCliOutput(value: unknown) {
  const text = String(value ?? '');
  if (Buffer.byteLength(text, 'utf8') > MAX_CLI_BYTES) {
    throw new Error('LM Studio CLI output exceeded the admission boundary');
  }
  return text;
}

function parseJsonArray(text: string, label: string) {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${label} was not JSON`);
  }
  if (!Array.isArray(value)) throw new Error(`${label} was not an array`);
  return value;
}

async function readLocalJson(callFetch: typeof fetch, endpoint: string, init: RequestInit) {
  const url = new URL(endpoint);
  if (
    url.protocol !== 'http:' ||
    (url.hostname !== '127.0.0.1' && url.hostname !== '[::1]') ||
    !url.port
  ) {
    throw new Error('LM Studio admission attempted a non-loopback request');
  }
  const response = await callFetch(url, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`LM Studio local endpoint returned ${response.status}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('LM Studio local endpoint returned malformed JSON');
  }
}

function exactRelativePath(value: unknown) {
  const text = boundedText(value, 'LM Studio artifact relative path', 600);
  if (
    path.isAbsolute(text) ||
    text.includes('\\') ||
    text.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error('LM Studio artifact path must be a normalized relative path');
  }
  return text;
}

function assertInside(root: string, candidate: string, label: string) {
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay strictly inside its configured root`);
  }
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

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}`);
  }
  return number;
}

function boundedIdentity(value: unknown, label: string) {
  const text = boundedText(value, label, 600);
  if (!/^[A-Za-z0-9][A-Za-z0-9._@/+:-]*$/.test(text)) {
    throw new Error(`${label} contains unsupported characters`);
  }
  return text;
}

function boundedText(value: unknown, label: string, maximum: number) {
  const text = String(value ?? '').trim();
  if (!text || Buffer.byteLength(text, 'utf8') > maximum) {
    throw new Error(`${label} must be nonempty bounded text`);
  }
  return text;
}

function sha256Digest(value: unknown, label: string) {
  const text = String(value || '');
  if (!/^[a-f0-9]{64}$/.test(text)) throw new Error(`${label} must be a SHA-256 digest`);
  return text;
}

function optionalText(value: unknown) {
  return typeof value === 'string' && value ? value : null;
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}
