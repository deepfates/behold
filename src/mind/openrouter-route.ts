export const OPENROUTER_ROUTE_POLICY_PROTOCOL = 'behold.openrouter-route-policy.v1' as const;

export type OpenRouterRoutePolicy = Readonly<{
  protocol: typeof OPENROUTER_ROUTE_POLICY_PROTOCOL;
  /** Exact OpenRouter provider names/slugs in the order they may be attempted. */
  order: readonly string[];
  /** This version deliberately cannot authorize OpenRouter's unlisted fallbacks. */
  allowFallbacks: false;
  /** Exact provider output ceiling rendered as `max_tokens`. */
  maxOutputTokens: number;
}>;

export type OpenRouterResponseIdentity = Readonly<{
  ok: boolean;
  requestedModel: string;
  returnedModel: string | null;
  returnedProvider: string | null;
  admittedProviders: readonly string[];
  reason: 'matched' | 'model_missing' | 'model_mismatch' | 'provider_missing' | 'provider_mismatch';
}>;

const MAX_PROVIDERS = 16;
const MAX_PROVIDER_LENGTH = 200;
const MAX_OUTPUT_TOKENS = 32_768;

export function openRouterRoutePolicy(value: unknown): OpenRouterRoutePolicy {
  if (!plainRecord(value)) throw new Error('OpenRouter route policy must be an object');
  const keys = Object.keys(value).sort();
  const expected = ['allowFallbacks', 'maxOutputTokens', 'order', 'protocol'];
  if (JSON.stringify(keys) !== JSON.stringify(expected)) {
    throw new Error('OpenRouter route policy fields do not match the versioned contract');
  }
  if (value.protocol !== OPENROUTER_ROUTE_POLICY_PROTOCOL) {
    throw new Error(`OpenRouter route policy protocol must be ${OPENROUTER_ROUTE_POLICY_PROTOCOL}`);
  }
  if (value.allowFallbacks !== false) {
    throw new Error('OpenRouter route policy allowFallbacks must be exactly false');
  }
  if (!Array.isArray(value.order) || value.order.length < 1 || value.order.length > MAX_PROVIDERS) {
    throw new Error(
      `OpenRouter route policy order must contain 1 through ${MAX_PROVIDERS} providers`,
    );
  }
  const order = value.order.map((provider, index) => {
    if (typeof provider !== 'string') {
      throw new Error(`OpenRouter route policy provider ${index} must be text`);
    }
    const normalized = provider.trim();
    if (!normalized || normalized.length > MAX_PROVIDER_LENGTH || normalized !== provider) {
      throw new Error(
        `OpenRouter route policy provider ${index} must be nonempty trimmed text no longer than ${MAX_PROVIDER_LENGTH}`,
      );
    }
    return normalized;
  });
  if (new Set(order).size !== order.length) {
    throw new Error('OpenRouter route policy order contains a duplicate provider');
  }
  if (
    !Number.isSafeInteger(value.maxOutputTokens) ||
    Number(value.maxOutputTokens) < 1 ||
    Number(value.maxOutputTokens) > MAX_OUTPUT_TOKENS
  ) {
    throw new Error(
      `OpenRouter route policy maxOutputTokens must be an integer from 1 through ${MAX_OUTPUT_TOKENS}`,
    );
  }
  return deepFreeze({
    protocol: OPENROUTER_ROUTE_POLICY_PROTOCOL,
    order,
    allowFallbacks: false,
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
  return deepFreeze({
    max_tokens: policy.maxOutputTokens,
    provider: deepFreeze({ order: policy.order, allow_fallbacks: false as const }),
  });
}

export function assertOpenRouterRouteRequest(
  value: unknown,
  expectedModel: string,
  expectedPolicy: OpenRouterRoutePolicy,
) {
  const policy = openRouterRoutePolicy(expectedPolicy);
  if (!plainRecord(value)) throw new Error('request body must be an object');
  if (value.model !== expectedModel) throw new Error('request model differs from admitted model');
  if (value.max_tokens !== policy.maxOutputTokens || value.max_completion_tokens !== undefined) {
    throw new Error('request output cap differs from admitted max_tokens');
  }
  if (!plainRecord(value.provider)) {
    throw new Error('request provider policy is missing');
  }
  const providerKeys = Object.keys(value.provider).sort();
  if (JSON.stringify(providerKeys) !== JSON.stringify(['allow_fallbacks', 'order'])) {
    throw new Error('request provider fields differ from admitted route contract');
  }
  if (value.provider.allow_fallbacks !== false) {
    throw new Error('request provider fallbacks are not disabled');
  }
  if (
    !Array.isArray(value.provider.order) ||
    value.provider.order.length !== policy.order.length ||
    value.provider.order.some((provider, index) => provider !== policy.order[index])
  ) {
    throw new Error('request provider order differs from admitted order');
  }
}

export function inspectOpenRouterResponseIdentity(
  value: unknown,
  requestedModel: string,
  expectedPolicy: OpenRouterRoutePolicy,
): OpenRouterResponseIdentity {
  const policy = openRouterRoutePolicy(expectedPolicy);
  const returnedModel = plainRecord(value) ? optionalText(value.model) : null;
  const returnedProvider = plainRecord(value) ? optionalText(value.provider) : null;
  let reason: OpenRouterResponseIdentity['reason'] = 'matched';
  if (returnedModel == null) reason = 'model_missing';
  else if (returnedModel !== requestedModel) reason = 'model_mismatch';
  else if (returnedProvider == null) reason = 'provider_missing';
  else if (!policy.order.includes(returnedProvider)) reason = 'provider_mismatch';
  return deepFreeze({
    ok: reason === 'matched',
    requestedModel,
    returnedModel,
    returnedProvider,
    admittedProviders: policy.order,
    reason,
  });
}

function plainRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
