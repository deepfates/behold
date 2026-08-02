import { assertStrictLocalResidentSessionEnvelope } from './ollama-json-action';
import { assertNativeToolResidentSessionEnvelope } from './direct-native-tools';
import type { ResidentPolicyProfile } from '../policy/profile';
import { assertResidentChronologicalWireOwner } from './resident-transcript';

export const OPENROUTER_ROUTE_POLICY_PROTOCOL = 'behold.openrouter-route-policy.v1' as const;
export const OPENROUTER_ROUTE_POLICY_V2_PROTOCOL = 'behold.openrouter-route-policy.v2' as const;
export const OPENROUTER_ROUTE_POLICY_V3_PROTOCOL = 'behold.openrouter-route-policy.v3' as const;
export const OPENROUTER_ROUTE_POLICY_V4_PROTOCOL = 'behold.openrouter-route-policy.v4' as const;
export const OPENROUTER_ROUTE_POLICY_V5_PROTOCOL = 'behold.openrouter-route-policy.v5' as const;

export type OpenRouterRoutePolicyV1 = Readonly<{
  protocol: typeof OPENROUTER_ROUTE_POLICY_PROTOCOL;
  /** Exact OpenRouter provider names/slugs in the order they may be attempted. */
  order: readonly string[];
  /** This version deliberately cannot authorize OpenRouter's unlisted fallbacks. */
  allowFallbacks: false;
  /** Exact provider output ceiling rendered as `max_tokens`. */
  maxOutputTokens: number;
}>;

export type OpenRouterRoutePolicyV2 = Readonly<{
  protocol: typeof OPENROUTER_ROUTE_POLICY_V2_PROTOCOL;
  /** Request endpoint slugs and the distinct provider names returned by OpenRouter. */
  routes: readonly Readonly<{ requestTag: string; responseProvider: string }>[];
  allowFallbacks: false;
  maxOutputTokens: number;
}>;

export type OpenRouterRoutePolicyV3 = Readonly<{
  protocol: typeof OPENROUTER_ROUTE_POLICY_V3_PROTOCOL;
  routes: readonly Readonly<{ requestTag: string; responseProvider: string }>[];
  allowFallbacks: false;
  maxOutputTokens: number;
  /** Explicitly selects the provider-native resident decision envelope. */
  residentDecisionFormat: 'native_tools';
  /** Exact reasoning setting admitted for this provider route. */
  reasoningEffort: 'none';
}>;

export type OpenRouterRoutePolicyV4 = Readonly<{
  protocol: typeof OPENROUTER_ROUTE_POLICY_V4_PROTOCOL;
  routes: readonly Readonly<{ requestTag: string; responseProvider: string }>[];
  allowFallbacks: false;
  maxOutputTokens: number;
  residentDecisionFormat: 'strict_json';
  reasoningEnabled: false;
  zdr: true;
  dataCollection: 'deny';
}>;

export type OpenRouterRoutePolicyV5 = Readonly<{
  protocol: typeof OPENROUTER_ROUTE_POLICY_V5_PROTOCOL;
  routes: readonly Readonly<{ requestTag: string; responseProvider: string }>[];
  allowFallbacks: false;
  maxOutputTokens: number;
  /** Verified provider/model context window; wire bytes are admitted conservatively as tokens. */
  contextWindowTokens: number;
  residentDecisionFormat: 'strict_json';
  reasoningEnabled: false;
  zdr: true;
  dataCollection: 'deny';
}>;

export type OpenRouterRoutePolicy =
  | OpenRouterRoutePolicyV1
  | OpenRouterRoutePolicyV2
  | OpenRouterRoutePolicyV3
  | OpenRouterRoutePolicyV4
  | OpenRouterRoutePolicyV5;

export type OpenRouterResponseIdentity = Readonly<{
  ok: boolean;
  requestedModel: string;
  returnedModel: string | null;
  returnedProvider: string | null;
  admittedProviders: readonly string[];
  reason: 'matched' | 'model_missing' | 'model_mismatch' | 'provider_missing' | 'provider_mismatch';
}>;

export function assertOpenRouterResidentTreatment(
  policyProfile: ResidentPolicyProfile,
  policyValue: OpenRouterRoutePolicy,
) {
  const policy = openRouterRoutePolicy(policyValue);
  if (
    (policyProfile === 'resident-v4' || policyProfile === 'resident-v3') &&
    policy.protocol !== OPENROUTER_ROUTE_POLICY_V5_PROTOCOL
  ) {
    throw new Error(
      `${policyProfile} requires the context-bound private OpenRouter resident route v5`,
    );
  }
  if (
    policyProfile === 'resident-v2' &&
    policy.protocol !== OPENROUTER_ROUTE_POLICY_V2_PROTOCOL &&
    policy.protocol !== OPENROUTER_ROUTE_POLICY_V4_PROTOCOL
  ) {
    throw new Error('resident-v2 requires OpenRouter resident-session route v2');
  }
  if (
    policyProfile === 'legible-resident-v1' &&
    policy.protocol !== OPENROUTER_ROUTE_POLICY_V2_PROTOCOL &&
    policy.protocol !== OPENROUTER_ROUTE_POLICY_V3_PROTOCOL
  ) {
    throw new Error('legible-resident-v1 requires OpenRouter resident-session route v2 or v3');
  }
}

const MAX_PROVIDERS = 16;
const MAX_PROVIDER_LENGTH = 200;
const MAX_OUTPUT_TOKENS = 32_768;

export function openRouterRoutePolicy(value: unknown): OpenRouterRoutePolicy {
  if (!plainRecord(value)) throw new Error('OpenRouter route policy must be an object');
  const keys = Object.keys(value).sort();
  const routed =
    value.protocol === OPENROUTER_ROUTE_POLICY_V2_PROTOCOL ||
    value.protocol === OPENROUTER_ROUTE_POLICY_V3_PROTOCOL ||
    value.protocol === OPENROUTER_ROUTE_POLICY_V4_PROTOCOL ||
    value.protocol === OPENROUTER_ROUTE_POLICY_V5_PROTOCOL;
  const nativeTools = value.protocol === OPENROUTER_ROUTE_POLICY_V3_PROTOCOL;
  const disabledStrictJson =
    value.protocol === OPENROUTER_ROUTE_POLICY_V4_PROTOCOL ||
    value.protocol === OPENROUTER_ROUTE_POLICY_V5_PROTOCOL;
  const contextBound = value.protocol === OPENROUTER_ROUTE_POLICY_V5_PROTOCOL;
  const expected = (
    routed
      ? [
          'allowFallbacks',
          'maxOutputTokens',
          'protocol',
          ...(nativeTools ? ['reasoningEffort', 'residentDecisionFormat'] : []),
          ...(disabledStrictJson
            ? ['dataCollection', 'reasoningEnabled', 'residentDecisionFormat', 'zdr']
            : []),
          ...(contextBound ? ['contextWindowTokens'] : []),
          'routes',
        ]
      : ['allowFallbacks', 'maxOutputTokens', 'order', 'protocol']
  ).sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)) {
    throw new Error('OpenRouter route policy fields do not match the versioned contract');
  }
  if (
    value.protocol !== OPENROUTER_ROUTE_POLICY_PROTOCOL &&
    value.protocol !== OPENROUTER_ROUTE_POLICY_V2_PROTOCOL &&
    value.protocol !== OPENROUTER_ROUTE_POLICY_V3_PROTOCOL &&
    value.protocol !== OPENROUTER_ROUTE_POLICY_V4_PROTOCOL &&
    value.protocol !== OPENROUTER_ROUTE_POLICY_V5_PROTOCOL
  ) {
    throw new Error(
      `OpenRouter route policy protocol must be ${OPENROUTER_ROUTE_POLICY_PROTOCOL}, ${OPENROUTER_ROUTE_POLICY_V2_PROTOCOL}, ${OPENROUTER_ROUTE_POLICY_V3_PROTOCOL}, ${OPENROUTER_ROUTE_POLICY_V4_PROTOCOL}, or ${OPENROUTER_ROUTE_POLICY_V5_PROTOCOL}`,
    );
  }
  if (nativeTools && value.residentDecisionFormat !== 'native_tools') {
    throw new Error('OpenRouter v3 residentDecisionFormat must be native_tools');
  }
  if (nativeTools && value.reasoningEffort !== 'none') {
    throw new Error('OpenRouter v3 reasoningEffort must be none');
  }
  if (
    disabledStrictJson &&
    (value.residentDecisionFormat !== 'strict_json' ||
      value.reasoningEnabled !== false ||
      value.zdr !== true ||
      value.dataCollection !== 'deny')
  ) {
    throw new Error(
      'OpenRouter v4 must bind strict JSON, disabled reasoning, ZDR, and denied data collection',
    );
  }
  if (
    contextBound &&
    (!Number.isSafeInteger(value.contextWindowTokens) ||
      Number(value.contextWindowTokens) < 4_096 ||
      Number(value.contextWindowTokens) > 16_777_216)
  ) {
    throw new Error(
      'OpenRouter v5 contextWindowTokens must be an integer from 4096 through 16777216',
    );
  }
  if (value.allowFallbacks !== false) {
    throw new Error('OpenRouter route policy allowFallbacks must be exactly false');
  }
  const order = routed ? null : providerNames(value.order, 'order');
  const routes = routed ? parseRoutes(value.routes) : null;
  if (
    !Number.isSafeInteger(value.maxOutputTokens) ||
    Number(value.maxOutputTokens) < 1 ||
    Number(value.maxOutputTokens) > MAX_OUTPUT_TOKENS
  ) {
    throw new Error(
      `OpenRouter route policy maxOutputTokens must be an integer from 1 through ${MAX_OUTPUT_TOKENS}`,
    );
  }
  if (nativeTools) {
    return deepFreeze({
      protocol: OPENROUTER_ROUTE_POLICY_V3_PROTOCOL,
      routes: routes!,
      allowFallbacks: false as const,
      maxOutputTokens: Number(value.maxOutputTokens),
      residentDecisionFormat: 'native_tools' as const,
      reasoningEffort: 'none' as const,
    });
  }
  if (disabledStrictJson) {
    if (contextBound) {
      return deepFreeze({
        protocol: OPENROUTER_ROUTE_POLICY_V5_PROTOCOL,
        routes: routes!,
        allowFallbacks: false as const,
        maxOutputTokens: Number(value.maxOutputTokens),
        contextWindowTokens: Number(value.contextWindowTokens),
        residentDecisionFormat: 'strict_json' as const,
        reasoningEnabled: false as const,
        zdr: true as const,
        dataCollection: 'deny' as const,
      });
    }
    return deepFreeze({
      protocol: OPENROUTER_ROUTE_POLICY_V4_PROTOCOL,
      routes: routes!,
      allowFallbacks: false as const,
      maxOutputTokens: Number(value.maxOutputTokens),
      residentDecisionFormat: 'strict_json' as const,
      reasoningEnabled: false as const,
      zdr: true as const,
      dataCollection: 'deny' as const,
    });
  }
  if (routed) {
    return deepFreeze({
      protocol: OPENROUTER_ROUTE_POLICY_V2_PROTOCOL,
      routes: routes!,
      allowFallbacks: false as const,
      maxOutputTokens: Number(value.maxOutputTokens),
    });
  }
  return deepFreeze({
    protocol: OPENROUTER_ROUTE_POLICY_PROTOCOL,
    order: order!,
    allowFallbacks: false as const,
    maxOutputTokens: Number(value.maxOutputTokens),
  });
}

export function openRouterRoutePolicyFromEnvironment(value: unknown) {
  if (value == null || String(value).trim() === '') return null;
  const source = String(value);
  if (source.length > 4_096) throw new Error('OpenRouter route policy environment is too large');
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error('OpenRouter route policy environment is not valid JSON');
  }
  return openRouterRoutePolicy(parsed);
}

export function serializeOpenRouterRoutePolicy(value: OpenRouterRoutePolicy) {
  return JSON.stringify(openRouterRoutePolicy(value));
}

export function openRouterWirePolicy(value: OpenRouterRoutePolicy) {
  const policy = openRouterRoutePolicy(value);
  const order =
    policy.protocol !== OPENROUTER_ROUTE_POLICY_PROTOCOL
      ? policy.routes.map((route) => route.requestTag)
      : policy.order;
  return deepFreeze({
    max_tokens: policy.maxOutputTokens,
    provider: deepFreeze({
      order,
      allow_fallbacks: false as const,
      // OpenRouter's live OpenAI endpoint metadata omits parallel_tool_calls
      // even though the endpoint accepts it. V3 pins one exact endpoint and
      // validates its returned identity/output instead of trusting that
      // incomplete metadata filter.
      require_parameters: policy.protocol === OPENROUTER_ROUTE_POLICY_V3_PROTOCOL ? false : true,
      ...(policy.protocol === OPENROUTER_ROUTE_POLICY_V4_PROTOCOL ||
      policy.protocol === OPENROUTER_ROUTE_POLICY_V5_PROTOCOL
        ? { zdr: true as const, data_collection: 'deny' as const }
        : {}),
    }),
  });
}

export function assertOpenRouterRouteRequest(
  value: unknown,
  expectedModel: string,
  expectedPolicy: OpenRouterRoutePolicy,
  residentIdentity?: string | null,
  expectedPolicyProfile?: ResidentPolicyProfile | null,
) {
  const policy = openRouterRoutePolicy(expectedPolicy);
  if (!plainRecord(value)) throw new Error('request body must be an object');
  if (
    policy.protocol === OPENROUTER_ROUTE_POLICY_V2_PROTOCOL ||
    policy.protocol === OPENROUTER_ROUTE_POLICY_V4_PROTOCOL ||
    policy.protocol === OPENROUTER_ROUTE_POLICY_V5_PROTOCOL
  ) {
    const generationFields = expectedModel.includes('gpt-5') ? [] : ['temperature'];
    const record = exactRecord(
      value,
      [
        'model',
        'messages',
        'response_format',
        'reasoning',
        ...generationFields,
        'stream',
        'max_tokens',
        'provider',
      ],
      'OpenRouter resident-session request',
    );
    if (
      record.stream !== false ||
      (expectedModel.includes('gpt-5')
        ? record.temperature !== undefined
        : record.temperature !== 0.2)
    ) {
      throw new Error('OpenRouter resident-session generation settings differ');
    }
    const reasoning =
      policy.protocol === OPENROUTER_ROUTE_POLICY_V4_PROTOCOL ||
      policy.protocol === OPENROUTER_ROUTE_POLICY_V5_PROTOCOL
        ? exactRecord(
            record.reasoning,
            ['enabled', 'exclude'],
            'OpenRouter resident-session reasoning',
          )
        : exactRecord(
            record.reasoning,
            ['effort', 'exclude'],
            'OpenRouter resident-session reasoning',
          );
    if (
      reasoning.exclude !== true ||
      (policy.protocol === OPENROUTER_ROUTE_POLICY_V4_PROTOCOL ||
      policy.protocol === OPENROUTER_ROUTE_POLICY_V5_PROTOCOL
        ? reasoning.enabled !== false
        : reasoning.effort !== 'minimal')
    ) {
      throw new Error('OpenRouter resident-session reasoning differs');
    }
    const responseFormat = exactRecord(
      record.response_format,
      ['type', 'json_schema'],
      'OpenRouter resident-session response format',
    );
    const jsonSchema = exactRecord(
      responseFormat.json_schema,
      ['name', 'strict', 'schema'],
      'OpenRouter resident-session JSON schema',
    );
    if (
      responseFormat.type !== 'json_schema' ||
      !['behold_resident_action_v1', 'behold_resident_action_v2'].includes(
        String(jsonSchema.name),
      ) ||
      jsonSchema.strict !== true
    ) {
      throw new Error('OpenRouter resident-session schema wrapper differs');
    }
    const envelope = assertStrictLocalResidentSessionEnvelope(record.messages, jsonSchema.schema);
    const expectedSchemaName =
      envelope.schemaProtocol === 'behold.ollama-local-json-action-schema.v1'
        ? 'behold_resident_action_v1'
        : 'behold_resident_action_v2';
    if (jsonSchema.name !== expectedSchemaName) {
      throw new Error('OpenRouter response schema name differs from its resident treatment');
    }
    if (
      (expectedPolicyProfile === 'resident-v2' &&
        envelope.schemaProtocol !== 'behold.ollama-local-json-action-schema.v1') ||
      ((expectedPolicyProfile === 'resident-v4' || expectedPolicyProfile === 'resident-v3') &&
        (envelope.schemaProtocol !== 'behold.ollama-local-json-action-schema.v1' ||
          envelope.messageLayoutProtocol !==
            (expectedPolicyProfile === 'resident-v4'
              ? 'behold.ollama-local-resident-session-message-layout.v3'
              : 'behold.ollama-local-resident-session-message-layout.v2'))) ||
      (expectedPolicyProfile === 'legible-resident-v1' &&
        envelope.schemaProtocol !== 'behold.ollama-local-json-action-schema.v2')
    ) {
      throw new Error('OpenRouter resident treatment differs from the admitted policy profile');
    }
    if (residentIdentity != null) assertResidentWireOwner(record.messages, residentIdentity);
  }
  if (policy.protocol === OPENROUTER_ROUTE_POLICY_V3_PROTOCOL) {
    if (expectedPolicyProfile != null && expectedPolicyProfile !== 'legible-resident-v1') {
      throw new Error('OpenRouter native-tools treatment requires legible-resident-v1');
    }
    const generationFields = expectedModel.includes('gpt-5') ? [] : ['temperature'];
    const record = exactRecord(
      value,
      [
        'model',
        'messages',
        'tools',
        'tool_choice',
        'parallel_tool_calls',
        'reasoning',
        ...generationFields,
        'stream',
        'max_tokens',
        'provider',
      ],
      'OpenRouter native-tool resident-session request',
    );
    if (
      record.stream !== false ||
      record.parallel_tool_calls !== false ||
      (expectedModel.includes('gpt-5')
        ? record.temperature !== undefined
        : record.temperature !== 0.2)
    ) {
      throw new Error('OpenRouter native-tool resident generation settings differ');
    }
    const reasoning = exactRecord(
      record.reasoning,
      ['effort', 'exclude'],
      'OpenRouter native-tool resident reasoning',
    );
    if (reasoning.effort !== policy.reasoningEffort || reasoning.exclude !== true) {
      throw new Error('OpenRouter native-tool resident reasoning differs');
    }
    assertNativeToolResidentSessionEnvelope(record.messages, record.tools, record.tool_choice);
    if (residentIdentity != null) assertResidentWireOwner(record.messages, residentIdentity);
  }
  if (value.model !== expectedModel) throw new Error('request model differs from admitted model');
  if (value.max_tokens !== policy.maxOutputTokens || value.max_completion_tokens !== undefined) {
    throw new Error('request output cap differs from admitted max_tokens');
  }
  if (!plainRecord(value.provider)) {
    throw new Error('request provider policy is missing');
  }
  const providerKeys = Object.keys(value.provider).sort();
  const expectedProviderKeys = [
    'allow_fallbacks',
    ...(policy.protocol === OPENROUTER_ROUTE_POLICY_V4_PROTOCOL ||
    policy.protocol === OPENROUTER_ROUTE_POLICY_V5_PROTOCOL
      ? ['data_collection']
      : []),
    'order',
    'require_parameters',
    ...(policy.protocol === OPENROUTER_ROUTE_POLICY_V4_PROTOCOL ||
    policy.protocol === OPENROUTER_ROUTE_POLICY_V5_PROTOCOL
      ? ['zdr']
      : []),
  ].sort();
  if (JSON.stringify(providerKeys) !== JSON.stringify(expectedProviderKeys)) {
    throw new Error('request provider fields differ from admitted route contract');
  }
  if (value.provider.allow_fallbacks !== false) {
    throw new Error('request provider fallbacks are not disabled');
  }
  if (
    (policy.protocol === OPENROUTER_ROUTE_POLICY_V4_PROTOCOL ||
      policy.protocol === OPENROUTER_ROUTE_POLICY_V5_PROTOCOL) &&
    (value.provider.zdr !== true || value.provider.data_collection !== 'deny')
  ) {
    throw new Error('request provider privacy policy differs from the admitted route contract');
  }
  if (policy.protocol === OPENROUTER_ROUTE_POLICY_V5_PROTOCOL) {
    const conservativeInputTokens = Buffer.byteLength(JSON.stringify(value), 'utf8');
    if (conservativeInputTokens + policy.maxOutputTokens > policy.contextWindowTokens) {
      throw new Error(
        `request exceeds the admitted context window: ${conservativeInputTokens} conservative input tokens + ${policy.maxOutputTokens} output > ${policy.contextWindowTokens}`,
      );
    }
  }
  const expectedRequireParameters =
    policy.protocol === OPENROUTER_ROUTE_POLICY_V3_PROTOCOL ? false : true;
  if (value.provider.require_parameters !== expectedRequireParameters) {
    throw new Error('request provider parameter filter differs from the admitted route contract');
  }
  if (
    !Array.isArray(value.provider.order) ||
    value.provider.order.length !== expectedRequestTags(policy).length ||
    value.provider.order.some((provider, index) => provider !== expectedRequestTags(policy)[index])
  ) {
    throw new Error('request provider order differs from admitted order');
  }
}

function assertResidentWireOwner(messagesValue: unknown, residentIdentity: string) {
  if (!Array.isArray(messagesValue) || messagesValue.length < 3) {
    throw new Error('OpenRouter resident-session messages are incomplete');
  }
  const current = exactRecord(
    messagesValue.at(-1),
    ['role', 'content'],
    'OpenRouter resident current observation',
  );
  if (current.role !== 'user' || typeof current.content !== 'string') {
    throw new Error('OpenRouter resident current observation is malformed');
  }
  const jsonStart = current.content.indexOf('{');
  const reminderStart = current.content.lastIndexOf('\n\nRespond now with');
  const jsonEnd = reminderStart >= 0 ? reminderStart : current.content.length;
  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    throw new Error('OpenRouter resident current observation is missing its body identity');
  }
  let observation: unknown;
  try {
    observation = JSON.parse(current.content.slice(jsonStart, jsonEnd));
  } catch {
    throw new Error('OpenRouter resident current observation is not valid JSON');
  }
  const record = plainRecord(observation) ? observation : null;
  const self = record && plainRecord(record.self) ? record.self : null;
  if (
    record?.protocol !== 'behold.minecraft-human-semantic-observation.v1' ||
    self?.identity !== residentIdentity
  ) {
    throw new Error('OpenRouter resident request belongs to another resident');
  }
  assertResidentChronologicalWireOwner(messagesValue, residentIdentity);
}

export function inspectOpenRouterResponseIdentity(
  value: unknown,
  requestedModel: string,
  expectedPolicy: OpenRouterRoutePolicy,
): OpenRouterResponseIdentity {
  const policy = openRouterRoutePolicy(expectedPolicy);
  const returnedModel = plainRecord(value) ? optionalText(value.model) : null;
  const returnedProvider = plainRecord(value) ? optionalText(value.provider) : null;
  const admittedProviders =
    policy.protocol !== OPENROUTER_ROUTE_POLICY_PROTOCOL
      ? policy.routes.map((route) => route.responseProvider)
      : policy.order;
  let reason: OpenRouterResponseIdentity['reason'] = 'matched';
  if (returnedModel == null) reason = 'model_missing';
  else if (returnedModel !== requestedModel) reason = 'model_mismatch';
  else if (returnedProvider == null) reason = 'provider_missing';
  else if (!admittedProviders.includes(returnedProvider)) reason = 'provider_mismatch';
  return deepFreeze({
    ok: reason === 'matched',
    requestedModel,
    returnedModel,
    returnedProvider,
    admittedProviders,
    reason,
  });
}

function expectedRequestTags(policy: OpenRouterRoutePolicy) {
  return policy.protocol !== OPENROUTER_ROUTE_POLICY_PROTOCOL
    ? policy.routes.map((route) => route.requestTag)
    : policy.order;
}

function providerNames(value: unknown, field: string) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PROVIDERS) {
    throw new Error(
      `OpenRouter route policy ${field} must contain 1 through ${MAX_PROVIDERS} providers`,
    );
  }
  const names = value.map((provider, index) => {
    if (typeof provider !== 'string') {
      throw new Error(`OpenRouter route policy ${field} ${index} must be text`);
    }
    const normalized = provider.trim();
    if (!normalized || normalized.length > MAX_PROVIDER_LENGTH || normalized !== provider) {
      throw new Error(
        `OpenRouter route policy ${field} ${index} must be nonempty trimmed text no longer than ${MAX_PROVIDER_LENGTH}`,
      );
    }
    return normalized;
  });
  if (new Set(names).size !== names.length) {
    throw new Error(`OpenRouter route policy ${field} contains a duplicate provider`);
  }
  return names;
}

function parseRoutes(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error('OpenRouter route policy routes must be an array');
  }
  if (value.length < 1 || value.length > MAX_PROVIDERS) {
    throw new Error(
      `OpenRouter route policy routes must contain 1 through ${MAX_PROVIDERS} routes`,
    );
  }
  const routes = value.map((candidate, index) => {
    if (!plainRecord(candidate)) {
      throw new Error(`OpenRouter route policy route ${index} must be an object`);
    }
    const keys = Object.keys(candidate).sort();
    if (JSON.stringify(keys) !== JSON.stringify(['requestTag', 'responseProvider'])) {
      throw new Error(`OpenRouter route policy route ${index} fields differ`);
    }
    return deepFreeze({
      requestTag: providerNames([candidate.requestTag], `route ${index} requestTag`)[0],
      responseProvider: providerNames(
        [candidate.responseProvider],
        `route ${index} responseProvider`,
      )[0],
    });
  });
  if (new Set(routes.map((route) => route.requestTag)).size !== routes.length) {
    throw new Error('OpenRouter route policy routes contain a duplicate request tag');
  }
  return routes;
}

function plainRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactRecord(value: unknown, keys: readonly string[], label: string) {
  if (!plainRecord(value)) throw new Error(`${label} must be an object`);
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`${label} fields differ`);
  }
  return value;
}

function optionalText(value: unknown) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text || null;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
