import { createHash } from 'node:crypto';
import type { ModelCallEvidence } from './evidence';
import type { ResidentMindDecision, ResidentMindRequest } from './interface';
import type { OllamaLocalPolicy } from './ollama-local';
import { parseResidentMindRequest } from './request-artifact';

export const OLLAMA_LOCAL_JSON_ACTION_TRANSPORT_PROTOCOL =
  'behold.ollama-local-json-action.v1' as const;
export const OLLAMA_LOCAL_JSON_ACTION_SCHEMA_PROTOCOL =
  'behold.ollama-local-json-action-schema.v1' as const;
export const OLLAMA_LOCAL_JSON_ACTION_CONTRACT_PROTOCOL =
  'behold.ollama-local-json-action-contract.v1' as const;
export const OLLAMA_LOCAL_JSON_ACTION_REQUEST_IDENTITY_PROTOCOL =
  'behold.ollama-local-json-action-request-identity.v1' as const;

const CONTRACT_BEGIN = 'BEHOLD_LOCAL_JSON_ACTION_CONTRACT_V1_BEGIN\n';
const CONTRACT_END = '\nBEHOLD_LOCAL_JSON_ACTION_CONTRACT_V1_END';
const CONTRACT_INSTRUCTION =
  'Choose exactly one admitted action. Return only one JSON object with exactly the fields "action" and "arguments". Do not use tool calls, Markdown, prose, corrections, or multiple candidates.\n';

const schemaDescriptor = deepFreeze({
  protocol: OLLAMA_LOCAL_JSON_ACTION_SCHEMA_PROTOCOL,
  output: {
    type: 'object',
    alternatives: 'oneOf',
    discriminator: { field: 'action', value: 'exact admitted action name' },
    arguments: { field: 'arguments', schema: 'exact admitted action inputSchema' },
    required: ['action', 'arguments'],
    additionalProperties: false,
  },
});

export const OLLAMA_LOCAL_JSON_ACTION_SCHEMA_SHA256 = sha256(stableJson(schemaDescriptor));

export type OllamaLocalJsonActionTransport = Readonly<{
  protocol: typeof OLLAMA_LOCAL_JSON_ACTION_TRANSPORT_PROTOCOL;
  schemaProtocol: typeof OLLAMA_LOCAL_JSON_ACTION_SCHEMA_PROTOCOL;
  schemaSha256: string;
  /** Exact UTF-8 digest of the installed model template returned by `/api/show`. */
  templateSha256: string;
}>;

export type OllamaLocalJsonActionRequestIdentity = Readonly<{
  protocol: typeof OLLAMA_LOCAL_JSON_ACTION_REQUEST_IDENTITY_PROTOCOL;
  transportProtocol: typeof OLLAMA_LOCAL_JSON_ACTION_TRANSPORT_PROTOCOL;
  schemaProtocol: typeof OLLAMA_LOCAL_JSON_ACTION_SCHEMA_PROTOCOL;
  schemaSha256: string;
  modelTag: string;
  modelDigest: string;
  templateSha256: string;
  actionContractSha256: string;
  responseFormatSha256: string;
}>;

export function ollamaLocalJsonActionTransport(value: unknown): OllamaLocalJsonActionTransport {
  const record = exactRecord(
    value,
    ['protocol', 'schemaProtocol', 'schemaSha256', 'templateSha256'],
    'Ollama local JSON action transport',
  );
  if (record.protocol !== OLLAMA_LOCAL_JSON_ACTION_TRANSPORT_PROTOCOL) {
    throw new Error(
      `Ollama local action transport protocol must be ${OLLAMA_LOCAL_JSON_ACTION_TRANSPORT_PROTOCOL}`,
    );
  }
  if (record.schemaProtocol !== OLLAMA_LOCAL_JSON_ACTION_SCHEMA_PROTOCOL) {
    throw new Error(
      `Ollama local action schema protocol must be ${OLLAMA_LOCAL_JSON_ACTION_SCHEMA_PROTOCOL}`,
    );
  }
  if (record.schemaSha256 !== OLLAMA_LOCAL_JSON_ACTION_SCHEMA_SHA256) {
    throw new Error('Ollama local action schema digest differs from this transport implementation');
  }
  return deepFreeze({
    protocol: OLLAMA_LOCAL_JSON_ACTION_TRANSPORT_PROTOCOL,
    schemaProtocol: OLLAMA_LOCAL_JSON_ACTION_SCHEMA_PROTOCOL,
    schemaSha256: sha256Digest(record.schemaSha256, 'Ollama local action schema'),
    templateSha256: sha256Digest(record.templateSha256, 'Ollama installed template'),
  });
}

export function createOllamaLocalJsonActionRequest(
  requestValue: ResidentMindRequest,
  policy: OllamaLocalPolicy,
) {
  const request = parseResidentMindRequest(requestValue);
  if (request.model !== policy.modelTag) {
    throw new Error('Ollama request model differs from the admitted local model tag');
  }
  assertHumanSemanticProfiles(request);
  const contract = actionContract(request);
  const contractJson = stableJson(contract);
  const format = responseFormat(contract.actions, contract.requiredAction);
  const messages = [
    ...cloneJson(request.conversation),
    {
      role: 'user' as const,
      content: `${CONTRACT_INSTRUCTION}${CONTRACT_BEGIN}${contractJson}${CONTRACT_END}`,
    },
  ];
  const body = deepFreeze({
    model: policy.modelTag,
    messages,
    format,
    stream: false as const,
    options: {
      num_ctx: policy.settings.contextTokens,
      num_predict: policy.settings.maxOutputTokens,
      temperature: policy.settings.temperature,
    },
    keep_alive: policy.settings.keepAlive,
  });
  const identity = requestIdentity(policy, contractJson, format);
  return deepFreeze({ body, identity });
}

export function assertOllamaLocalJsonActionRequest(
  value: unknown,
  expectedModel: string,
  policy: OllamaLocalPolicy,
): OllamaLocalJsonActionRequestIdentity {
  const record = exactRecord(
    value,
    ['model', 'messages', 'format', 'stream', 'options', 'keep_alive'],
    'Ollama local JSON action request body',
  );
  if (expectedModel !== policy.modelTag || record.model !== policy.modelTag) {
    throw new Error('Ollama request model differs from the admitted model tag');
  }
  if (!Array.isArray(record.messages) || record.messages.length < 1) {
    throw new Error('Ollama request messages must be a nonempty array');
  }
  if (record.stream !== false) throw new Error('Ollama streaming must be exactly false');
  if (record.keep_alive !== policy.settings.keepAlive) {
    throw new Error('Ollama keep_alive differs from the admitted load setting');
  }
  const options = exactRecord(
    record.options,
    ['num_ctx', 'num_predict', 'temperature'],
    'Ollama request options',
  );
  if (
    options.num_ctx !== policy.settings.contextTokens ||
    options.num_predict !== policy.settings.maxOutputTokens ||
    options.temperature !== policy.settings.temperature
  ) {
    throw new Error('Ollama request options differ from the admitted settings');
  }

  const contractMessage = exactRecord(
    record.messages.at(-1),
    ['role', 'content'],
    'Ollama local action contract message',
  );
  if (contractMessage.role !== 'user' || typeof contractMessage.content !== 'string') {
    throw new Error('Ollama local action contract message is invalid');
  }
  const content = contractMessage.content;
  if (
    !content.startsWith(`${CONTRACT_INSTRUCTION}${CONTRACT_BEGIN}`) ||
    !content.endsWith(CONTRACT_END)
  ) {
    throw new Error('Ollama local action contract markers are invalid');
  }
  const contractJson = content.slice(
    CONTRACT_INSTRUCTION.length + CONTRACT_BEGIN.length,
    content.length - CONTRACT_END.length,
  );
  let contractValue: unknown;
  try {
    contractValue = JSON.parse(contractJson);
  } catch {
    throw new Error('Ollama local action contract is not valid JSON');
  }
  const contract = parseActionContract(contractValue);
  if (contractJson !== stableJson(contract)) {
    throw new Error('Ollama local action contract is not exact canonical JSON');
  }
  const format = responseFormat(contract.actions, contract.requiredAction);
  if (stableJson(record.format) !== stableJson(format)) {
    throw new Error('Ollama response format differs from the exact action contract');
  }
  return requestIdentity(policy, contractJson, format);
}

export function parseOllamaLocalJsonActionDecision(
  data: unknown,
  requestValue: ResidentMindRequest,
  call: ModelCallEvidence,
): ResidentMindDecision {
  const request = parseResidentMindRequest(requestValue);
  const response = plainRecord(data) ? data : null;
  const message = plainRecord(response?.message) ? response!.message : null;
  if (!message) throw new Error('Ollama response contained no assistant message');
  if (message.tool_calls != null) {
    throw new Error('Ollama local JSON action response used forbidden native tool calls');
  }
  if (typeof message.content !== 'string') {
    throw new Error('Ollama local JSON action response content was not text');
  }
  let output: unknown;
  try {
    output = JSON.parse(message.content);
  } catch {
    throw new Error('Ollama local JSON action response content was not valid JSON');
  }
  const decision = exactRecord(output, ['action', 'arguments'], 'Ollama local JSON action output');
  if (typeof decision.action !== 'string' || !decision.action) {
    throw new Error('Ollama local JSON action output action was not nonempty text');
  }
  if (!plainRecord(decision.arguments)) {
    throw new Error('Ollama local JSON action output arguments were not an object');
  }
  if (!request.actions.some((action) => action.name === decision.action)) {
    throw new Error(
      `Ollama local JSON action output selected unadmitted action ${decision.action}`,
    );
  }
  if (request.requiredAction && decision.action !== request.requiredAction) {
    throw new Error(
      `Ollama local JSON action output selected ${decision.action} while ${request.requiredAction} was required`,
    );
  }
  return deepFreeze({
    protocol: 'behold.mind-decision.v1',
    disposition: decision.action === 'wait_for_event' ? 'wait' : 'act',
    utterance: null,
    action: {
      name: decision.action,
      input: cloneJson(decision.arguments),
      callId: null,
    },
    adapterRecord: cloneJson(message),
    call,
  });
}

function actionContract(request: Readonly<ResidentMindRequest>) {
  if (request.actions.length < 1) throw new Error('Ollama local action contract is empty');
  return deepFreeze({
    protocol: OLLAMA_LOCAL_JSON_ACTION_CONTRACT_PROTOCOL,
    bodyProfile: request.bodyProfile,
    actionProfile: request.actionProfile,
    safetyProfile: request.safetyProfile,
    actions: cloneJson(request.actions),
    requiredAction: request.requiredAction,
    responseProtocol: OLLAMA_LOCAL_JSON_ACTION_SCHEMA_PROTOCOL,
  });
}

function parseActionContract(value: unknown): ReturnType<typeof actionContract> {
  const record = exactRecord(
    value,
    [
      'protocol',
      'bodyProfile',
      'actionProfile',
      'safetyProfile',
      'actions',
      'requiredAction',
      'responseProtocol',
    ],
    'Ollama local action contract',
  );
  if (record.protocol !== OLLAMA_LOCAL_JSON_ACTION_CONTRACT_PROTOCOL) {
    throw new Error('Ollama local action contract protocol is invalid');
  }
  if (record.responseProtocol !== OLLAMA_LOCAL_JSON_ACTION_SCHEMA_PROTOCOL) {
    throw new Error('Ollama local action response schema protocol is invalid');
  }
  if (
    record.bodyProfile !== 'minecraft-human-semantic-v1' ||
    record.actionProfile !== 'minecraft-human-semantic-v1' ||
    record.safetyProfile !== 'vanilla-player-v1'
  ) {
    throw new Error('Ollama local action contract profiles are not human-semantic v1');
  }
  if (!Array.isArray(record.actions) || record.actions.length < 1) {
    throw new Error('Ollama local action contract actions must be a nonempty array');
  }
  const names = new Set<string>();
  const actions = record.actions.map((value: unknown, index: number) => {
    const action = exactRecord(
      value,
      plainRecord(value) && Object.hasOwn(value, 'description')
        ? ['name', 'description', 'inputSchema']
        : ['name', 'inputSchema'],
      `Ollama local action contract action ${index}`,
    );
    if (typeof action.name !== 'string' || !action.name || names.has(action.name)) {
      throw new Error(`Ollama local action contract action ${index} name is invalid`);
    }
    if (
      action.description != null &&
      (typeof action.description !== 'string' || !action.description)
    ) {
      throw new Error(`Ollama local action contract action ${index} description is invalid`);
    }
    if (!plainRecord(action.inputSchema)) {
      throw new Error(`Ollama local action contract action ${index} schema is invalid`);
    }
    names.add(action.name);
    return deepFreeze({
      name: action.name,
      ...(action.description == null ? {} : { description: action.description }),
      inputSchema: cloneJson(action.inputSchema),
    });
  });
  if (
    record.requiredAction !== null &&
    (typeof record.requiredAction !== 'string' || !names.has(record.requiredAction))
  ) {
    throw new Error('Ollama local action contract required action is invalid');
  }
  return actionContract({
    protocol: 'behold.mind-request.v1',
    entityId: 'transport-contract',
    model: 'transport-contract',
    bodyProfile: record.bodyProfile,
    actionProfile: record.actionProfile,
    safetyProfile: record.safetyProfile,
    observation: null,
    conversation: [],
    actions,
    requiredAction: record.requiredAction,
  });
}

function responseFormat(actions: ResidentMindRequest['actions'], requiredAction: string | null) {
  const selected = requiredAction
    ? actions.filter((action) => action.name === requiredAction)
    : actions;
  if (selected.length < 1) throw new Error('Ollama local response format has no action variant');
  return deepFreeze({
    oneOf: selected.map((action) => ({
      ...(action.description == null ? {} : { description: action.description }),
      type: 'object',
      properties: {
        action: { const: action.name },
        arguments: cloneJson(action.inputSchema),
      },
      required: ['action', 'arguments'],
      additionalProperties: false,
    })),
  });
}

function requestIdentity(
  policy: OllamaLocalPolicy,
  contractJson: string,
  format: unknown,
): OllamaLocalJsonActionRequestIdentity {
  return deepFreeze({
    protocol: OLLAMA_LOCAL_JSON_ACTION_REQUEST_IDENTITY_PROTOCOL,
    transportProtocol: policy.transport.protocol,
    schemaProtocol: policy.transport.schemaProtocol,
    schemaSha256: policy.transport.schemaSha256,
    modelTag: policy.modelTag,
    modelDigest: policy.modelDigest,
    templateSha256: policy.transport.templateSha256,
    actionContractSha256: sha256(contractJson),
    responseFormatSha256: sha256(stableJson(format)),
  });
}

function assertHumanSemanticProfiles(request: Readonly<ResidentMindRequest>) {
  if (
    request.bodyProfile !== 'minecraft-human-semantic-v1' ||
    request.actionProfile !== 'minecraft-human-semantic-v1' ||
    request.safetyProfile !== 'vanilla-player-v1'
  ) {
    throw new Error(
      'Ollama local JSON action transport requires minecraft-human-semantic-v1 body/actions and vanilla-player-v1 safety',
    );
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

function sha256Digest(value: unknown, label: string) {
  const text = String(value || '');
  if (!/^[a-f0-9]{64}$/.test(text)) throw new Error(`${label} must be a SHA-256 digest`);
  return text;
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function cloneJson(value: unknown): any {
  return value == null ? value : JSON.parse(JSON.stringify(value));
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
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}
