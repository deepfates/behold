import { createHash } from 'node:crypto';
import type { ResidentAttention, ResidentMindAction, ResidentMindRequest } from './interface';

export const RESIDENT_MIND_REQUEST_ARTIFACT_PROTOCOL = 'behold.mind-request-artifact.v1' as const;

export type ResidentMindRequestArtifact = Readonly<{
  protocol: typeof RESIDENT_MIND_REQUEST_ARTIFACT_PROTOCOL;
  requestSha256: string;
  request: Readonly<ResidentMindRequest>;
}>;

const REQUEST_FIELDS = new Set([
  'protocol',
  'entityId',
  'model',
  'policyProfile',
  'actionProfile',
  'safetyProfile',
  'observation',
  'conversation',
  'actions',
  'requiredAction',
  'attention',
]);
const REQUIRED_REQUEST_FIELDS = [
  'protocol',
  'entityId',
  'model',
  'observation',
  'conversation',
  'actions',
  'requiredAction',
] as const;

/**
 * Admit the exact, world-neutral input to one replaceable mind. The parser is
 * intentionally strict at the framework boundary while observation and action
 * schemas remain world-owned JSON.
 */
export function parseResidentMindRequest(value: unknown): Readonly<ResidentMindRequest> {
  const request = plainObject(value, 'resident mind request');
  assertAllowedFields(request, REQUEST_FIELDS, 'resident mind request');
  for (const field of REQUIRED_REQUEST_FIELDS) {
    if (!(field in request)) throw new Error(`resident mind request is missing field ${field}`);
  }
  if (request.protocol !== 'behold.mind-request.v1') {
    throw new Error('unsupported resident mind request protocol');
  }

  const observation = cloneJson(request.observation, 'resident observation');
  if (!Array.isArray(request.conversation)) {
    throw new Error('resident mind conversation must be an array');
  }
  const conversation = request.conversation.map((message, index) =>
    cloneJson(message, `resident conversation message ${index}`),
  );
  if (!Array.isArray(request.actions)) throw new Error('resident mind actions must be an array');
  const actionNames = new Set<string>();
  const actions = request.actions.map((action, index) => {
    const parsed = parseAction(action, index);
    if (actionNames.has(parsed.name)) {
      throw new Error(`resident mind action ${parsed.name} is duplicated`);
    }
    actionNames.add(parsed.name);
    return parsed;
  });

  const requiredAction = request.requiredAction;
  if (requiredAction !== null && typeof requiredAction !== 'string') {
    throw new Error('resident required action must be a string or null');
  }
  if (typeof requiredAction === 'string' && !actionNames.has(requiredAction)) {
    throw new Error(`resident required action ${requiredAction} is not admitted`);
  }

  const parsed: ResidentMindRequest = {
    protocol: 'behold.mind-request.v1',
    entityId: nonEmpty(request.entityId, 'resident entity id'),
    model: nonEmpty(request.model, 'resident model'),
    ...(request.policyProfile == null
      ? {}
      : { policyProfile: nonEmpty(request.policyProfile, 'resident policy profile') }),
    ...(request.actionProfile == null
      ? {}
      : { actionProfile: nonEmpty(request.actionProfile, 'resident action profile') }),
    ...(request.safetyProfile == null
      ? {}
      : { safetyProfile: nonEmpty(request.safetyProfile, 'resident safety profile') }),
    observation,
    conversation,
    actions,
    requiredAction,
    ...(request.attention == null ? {} : { attention: parseAttention(request.attention) }),
  };
  return deepFreeze(parsed);
}

export function residentMindRequestSha256(value: unknown): string {
  return sha256(stableJson(parseResidentMindRequest(value)));
}

export function createResidentMindRequestArtifact(value: unknown): ResidentMindRequestArtifact {
  const request = parseResidentMindRequest(value);
  return deepFreeze({
    protocol: RESIDENT_MIND_REQUEST_ARTIFACT_PROTOCOL,
    requestSha256: sha256(stableJson(request)),
    request,
  });
}

export function parseResidentMindRequestArtifact(value: unknown): ResidentMindRequestArtifact {
  const artifact = plainObject(value, 'resident mind request artifact');
  assertExactFields(
    artifact,
    new Set(['protocol', 'requestSha256', 'request']),
    'resident mind request artifact',
  );
  if (artifact.protocol !== RESIDENT_MIND_REQUEST_ARTIFACT_PROTOCOL) {
    throw new Error('unsupported resident mind request artifact protocol');
  }
  const request = parseResidentMindRequest(artifact.request);
  const requestSha256 = digest(artifact.requestSha256, 'resident mind request');
  if (requestSha256 !== sha256(stableJson(request))) {
    throw new Error('resident mind request artifact digest does not match its request');
  }
  return deepFreeze({
    protocol: RESIDENT_MIND_REQUEST_ARTIFACT_PROTOCOL,
    requestSha256,
    request,
  });
}

function parseAction(value: unknown, index: number): Readonly<ResidentMindAction> {
  const action = plainObject(value, `resident mind action ${index}`);
  const allowed = new Set(['name', 'description', 'inputSchema']);
  assertAllowedFields(action, allowed, `resident mind action ${index}`);
  for (const field of ['name', 'inputSchema']) {
    if (!(field in action))
      throw new Error(`resident mind action ${index} is missing field ${field}`);
  }
  return deepFreeze({
    name: nonEmpty(action.name, `resident mind action ${index} name`),
    ...(action.description == null
      ? {}
      : { description: nonEmpty(action.description, `resident mind action ${index} description`) }),
    inputSchema: cloneJson(action.inputSchema, `resident mind action ${index} schema`),
  });
}

function parseAttention(value: unknown): ResidentAttention {
  const attention = plainObject(value, 'resident attention');
  assertAllowedFields(
    attention,
    new Set(['mode', 'context', 'decisionBudgetMs', 'continuingCondition', 'triggers']),
    'resident attention',
  );
  for (const field of ['mode', 'context', 'triggers']) {
    if (!(field in attention)) throw new Error(`resident attention is missing field ${field}`);
  }
  if (attention.mode !== 'deliberative' && attention.mode !== 'urgent') {
    throw new Error('resident attention mode is invalid');
  }
  if (attention.context !== 'bounded_loom' && attention.context !== 'current_body_and_continuity') {
    throw new Error('resident attention context is invalid');
  }
  if (!Array.isArray(attention.triggers)) {
    throw new Error('resident attention triggers must be an array');
  }
  const triggers = attention.triggers.map((value: unknown, index: number) => {
    const trigger = plainObject(value, `resident attention trigger ${index}`);
    assertExactFields(
      trigger,
      new Set(['sequence', 'type', 'salience']),
      `resident attention trigger ${index}`,
    );
    if (!Number.isSafeInteger(trigger.sequence) || trigger.sequence < 0) {
      throw new Error(`resident attention trigger ${index} sequence is invalid`);
    }
    if (trigger.salience !== 'urgent') {
      throw new Error(`resident attention trigger ${index} salience is invalid`);
    }
    return deepFreeze({
      sequence: trigger.sequence,
      type: nonEmpty(trigger.type, `resident attention trigger ${index} type`),
      salience: 'urgent' as const,
    });
  });
  if (
    attention.decisionBudgetMs != null &&
    (!Number.isSafeInteger(attention.decisionBudgetMs) || attention.decisionBudgetMs < 1)
  ) {
    throw new Error('resident attention decision budget is invalid');
  }
  if (
    attention.continuingCondition != null &&
    attention.continuingCondition !== 'critical_body_condition'
  ) {
    throw new Error('resident attention continuing condition is invalid');
  }
  return deepFreeze({
    mode: attention.mode,
    context: attention.context,
    ...(attention.decisionBudgetMs == null ? {} : { decisionBudgetMs: attention.decisionBudgetMs }),
    ...(attention.continuingCondition == null
      ? {}
      : { continuingCondition: 'critical_body_condition' as const }),
    triggers,
  });
}

function cloneJson(value: unknown, label: string): any {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => cloneJson(item, label));
  if (value && typeof value === 'object') {
    const object = plainObject(value, label);
    return Object.fromEntries(
      Object.entries(object).map(([key, item]) => [key, cloneJson(item, `${label}.${key}`)]),
    );
  }
  throw new Error(`${label} must contain only JSON values`);
}

function plainObject(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must be a plain object`);
  }
  return value as Record<string, any>;
}

function assertAllowedFields(value: Record<string, unknown>, allowed: Set<string>, label: string) {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) throw new Error(`${label} has unknown field ${field}`);
  }
}

function assertExactFields(value: Record<string, unknown>, fields: Set<string>, label: string) {
  assertAllowedFields(value, fields, label);
  for (const field of fields) {
    if (!(field in value)) throw new Error(`${label} is missing field ${field}`);
  }
}

function nonEmpty(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a string`);
  return value;
}

function digest(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} digest is invalid`);
  }
  return value;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  }
  return value;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
