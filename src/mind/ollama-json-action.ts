import { createHash } from 'node:crypto';
import type { ModelCallEvidence } from './evidence';
import type { ResidentMindDecision, ResidentMindRequest } from './interface';
import type { OllamaLocalPolicy } from './ollama-local';
import { RESIDENT_WORKING_CONTINUITY_PROTOCOL } from './observation-context';
import {
  RESIDENT_PUBLIC_ACTION_COMMITMENT_MAX_CHARS,
  RESIDENT_PUBLIC_ACTION_COMMITMENT_PROTOCOL,
  renderResidentPublicActionCommitment,
  residentPublicActionCommitment,
} from './public-commitment';
import { parseResidentMindRequest } from './request-artifact';

export const OLLAMA_LOCAL_JSON_ACTION_TRANSPORT_PROTOCOL =
  'behold.ollama-local-json-action.v1' as const;
export const OLLAMA_LOCAL_JSON_ACTION_SCHEMA_PROTOCOL =
  'behold.ollama-local-json-action-schema.v1' as const;
export const OLLAMA_LOCAL_JSON_ACTION_CONTRACT_PROTOCOL =
  'behold.ollama-local-json-action-contract.v1' as const;
export const OLLAMA_LOCAL_JSON_ACTION_REQUEST_IDENTITY_PROTOCOL =
  'behold.ollama-local-json-action-request-identity.v1' as const;
export const OLLAMA_LOCAL_JSON_ACTION_TRANSPORT_V2_PROTOCOL =
  'behold.ollama-local-json-action.v2' as const;
export const OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_PROTOCOL =
  'behold.ollama-local-json-action-schema.v2' as const;
export const OLLAMA_LOCAL_JSON_ACTION_CONTRACT_V2_PROTOCOL =
  'behold.ollama-local-json-action-contract.v2' as const;
export const OLLAMA_LOCAL_JSON_ACTION_REQUEST_IDENTITY_V2_PROTOCOL =
  'behold.ollama-local-json-action-request-identity.v2' as const;
export const OLLAMA_LOCAL_RESIDENT_SESSION_TRANSPORT_PROTOCOL =
  'behold.ollama-local-resident-session.v1' as const;
export const OLLAMA_LOCAL_RESIDENT_SESSION_REQUEST_IDENTITY_PROTOCOL =
  'behold.ollama-local-resident-session-request-identity.v1' as const;
export const OLLAMA_LOCAL_RESIDENT_SESSION_MESSAGE_LAYOUT_PROTOCOL =
  'behold.ollama-local-resident-session-message-layout.v1' as const;

const V1_CONTRACT_BEGIN = 'BEHOLD_LOCAL_JSON_ACTION_CONTRACT_V1_BEGIN\n';
const V1_CONTRACT_END = '\nBEHOLD_LOCAL_JSON_ACTION_CONTRACT_V1_END';
const V1_CONTRACT_INSTRUCTION =
  'Choose exactly one admitted action. Return only one JSON object with exactly the fields "action" and "arguments". Do not use tool calls, Markdown, prose, corrections, or multiple candidates.\n';
const V2_CONTRACT_BEGIN = 'BEHOLD_LOCAL_JSON_ACTION_CONTRACT_V2_BEGIN\n';
const V2_CONTRACT_END = '\nBEHOLD_LOCAL_JSON_ACTION_CONTRACT_V2_END';
const V2_CONTRACT_INSTRUCTION =
  'Choose exactly one admitted action. Return only one JSON object with exactly the fields "intention", "expectedObservableConsequence", "action", and "arguments". The first two fields are short public commitments, not private reasoning or claims of success. Do not use tool calls, Markdown, prose, corrections, or multiple candidates.\n';
const RESIDENT_SESSION_RESPONSE_REMINDER =
  'Respond now with one JSON object matching the resident action contract above. Publish a short intention and expected observable consequence, then choose exactly one admitted action. Do not repeat the contract or add prose.';

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

const schemaV2Descriptor = deepFreeze({
  protocol: OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_PROTOCOL,
  output: {
    type: 'object',
    alternatives: 'oneOf',
    publicCommitment: {
      protocol: RESIDENT_PUBLIC_ACTION_COMMITMENT_PROTOCOL,
      intention: {
        type: 'string',
        minLength: 1,
        maxLength: RESIDENT_PUBLIC_ACTION_COMMITMENT_MAX_CHARS,
        pattern: '^[^\\r\\n]+$',
      },
      expectedObservableConsequence: {
        type: 'string',
        minLength: 1,
        maxLength: RESIDENT_PUBLIC_ACTION_COMMITMENT_MAX_CHARS,
        pattern: '^[^\\r\\n]+$',
      },
    },
    discriminator: { field: 'action', value: 'exact admitted action name' },
    arguments: { field: 'arguments', schema: 'exact admitted action inputSchema' },
    required: ['intention', 'expectedObservableConsequence', 'action', 'arguments'],
    additionalProperties: false,
  },
});

export const OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_SHA256 = sha256(stableJson(schemaV2Descriptor));

export type OllamaLocalJsonActionTransport = Readonly<{
  protocol:
    | typeof OLLAMA_LOCAL_JSON_ACTION_TRANSPORT_PROTOCOL
    | typeof OLLAMA_LOCAL_JSON_ACTION_TRANSPORT_V2_PROTOCOL
    | typeof OLLAMA_LOCAL_RESIDENT_SESSION_TRANSPORT_PROTOCOL;
  schemaProtocol:
    | typeof OLLAMA_LOCAL_JSON_ACTION_SCHEMA_PROTOCOL
    | typeof OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_PROTOCOL;
  schemaSha256: string;
  /** Exact UTF-8 digest of the installed model template returned by `/api/show`. */
  templateSha256: string;
}>;

export type OllamaLocalJsonActionRequestIdentity = Readonly<{
  protocol:
    | typeof OLLAMA_LOCAL_JSON_ACTION_REQUEST_IDENTITY_PROTOCOL
    | typeof OLLAMA_LOCAL_JSON_ACTION_REQUEST_IDENTITY_V2_PROTOCOL
    | typeof OLLAMA_LOCAL_RESIDENT_SESSION_REQUEST_IDENTITY_PROTOCOL;
  transportProtocol:
    | typeof OLLAMA_LOCAL_JSON_ACTION_TRANSPORT_PROTOCOL
    | typeof OLLAMA_LOCAL_JSON_ACTION_TRANSPORT_V2_PROTOCOL
    | typeof OLLAMA_LOCAL_RESIDENT_SESSION_TRANSPORT_PROTOCOL;
  schemaProtocol:
    | typeof OLLAMA_LOCAL_JSON_ACTION_SCHEMA_PROTOCOL
    | typeof OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_PROTOCOL;
  schemaSha256: string;
  modelTag: string;
  modelDigest: string;
  templateSha256: string;
  actionContractSha256: string;
  responseFormatSha256: string;
  messageLayoutProtocol?: typeof OLLAMA_LOCAL_RESIDENT_SESSION_MESSAGE_LAYOUT_PROTOCOL;
  workingContinuityProtocol?: typeof RESIDENT_WORKING_CONTINUITY_PROTOCOL;
  stablePrefixSha256?: string;
}>;

/**
 * Runtime-independent strict resident-session material. Ollama and other local
 * engines may wrap these exact messages/schema in their native wire envelope,
 * but must not reinterpret the action contract or response.
 */
export type StrictLocalResidentSessionEnvelope = Readonly<{
  protocol: 'behold.strict-local-resident-session-envelope.v1';
  schemaProtocol: typeof OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_PROTOCOL;
  schemaSha256: typeof OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_SHA256;
  messageLayoutProtocol: typeof OLLAMA_LOCAL_RESIDENT_SESSION_MESSAGE_LAYOUT_PROTOCOL;
  workingContinuityProtocol: typeof RESIDENT_WORKING_CONTINUITY_PROTOCOL;
  messages: readonly unknown[];
  responseSchema: unknown;
  actionContractSha256: string;
  responseSchemaSha256: string;
  stablePrefixSha256: string;
}>;

export type StrictLocalResidentSessionEnvelopeIdentity = Readonly<
  Omit<StrictLocalResidentSessionEnvelope, 'protocol' | 'messages' | 'responseSchema'>
>;

export function ollamaLocalJsonActionTransport(value: unknown): OllamaLocalJsonActionTransport {
  const record = exactRecord(
    value,
    ['protocol', 'schemaProtocol', 'schemaSha256', 'templateSha256'],
    'Ollama local JSON action transport',
  );
  if (
    record.protocol !== OLLAMA_LOCAL_JSON_ACTION_TRANSPORT_PROTOCOL &&
    record.protocol !== OLLAMA_LOCAL_JSON_ACTION_TRANSPORT_V2_PROTOCOL &&
    record.protocol !== OLLAMA_LOCAL_RESIDENT_SESSION_TRANSPORT_PROTOCOL
  ) {
    throw new Error(
      `Ollama local action transport protocol must be ${OLLAMA_LOCAL_JSON_ACTION_TRANSPORT_PROTOCOL}, ${OLLAMA_LOCAL_JSON_ACTION_TRANSPORT_V2_PROTOCOL}, or ${OLLAMA_LOCAL_RESIDENT_SESSION_TRANSPORT_PROTOCOL}`,
    );
  }
  const expectedSchemaProtocol =
    record.protocol === OLLAMA_LOCAL_JSON_ACTION_TRANSPORT_V2_PROTOCOL ||
    record.protocol === OLLAMA_LOCAL_RESIDENT_SESSION_TRANSPORT_PROTOCOL
      ? OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_PROTOCOL
      : OLLAMA_LOCAL_JSON_ACTION_SCHEMA_PROTOCOL;
  const expectedSchemaSha256 =
    record.protocol === OLLAMA_LOCAL_JSON_ACTION_TRANSPORT_V2_PROTOCOL ||
    record.protocol === OLLAMA_LOCAL_RESIDENT_SESSION_TRANSPORT_PROTOCOL
      ? OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_SHA256
      : OLLAMA_LOCAL_JSON_ACTION_SCHEMA_SHA256;
  if (record.schemaProtocol !== expectedSchemaProtocol) {
    throw new Error(
      `Ollama local action schema protocol must be ${expectedSchemaProtocol} for ${record.protocol}`,
    );
  }
  if (record.schemaSha256 !== expectedSchemaSha256) {
    throw new Error('Ollama local action schema digest differs from this transport implementation');
  }
  return deepFreeze({
    protocol: record.protocol,
    schemaProtocol: expectedSchemaProtocol,
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
  assertTransportTreatment(request, policy);
  const version = transportVersion(policy);
  const residentSession = usesOllamaResidentSessionTransport(policy)
    ? createStrictLocalResidentSessionEnvelope(request)
    : null;
  const contract = actionContract(request, version);
  const contractJson = stableJson(contract);
  const format = residentSession
    ? residentSession.responseSchema
    : responseFormat(contract.actions, contract.requiredAction, version);
  const markers = contractMarkers(version);
  const contractContent = `${markers.instruction}${markers.begin}${contractJson}${markers.end}`;
  const messages = residentSession
    ? residentSession.messages
    : [
        ...cloneJson(request.conversation),
        {
          role: 'user' as const,
          content: contractContent,
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
  const identity = requestIdentity(policy, contractJson, format, messages);
  return deepFreeze({ body, identity });
}

export function createStrictLocalResidentSessionEnvelope(
  requestValue: ResidentMindRequest,
): StrictLocalResidentSessionEnvelope {
  const request = parseResidentMindRequest(requestValue);
  assertHumanSemanticProfiles(request);
  if (request.policyProfile !== 'legible-resident-v1') {
    throw new Error('Strict local resident session requires policyProfile legible-resident-v1');
  }
  const contract = actionContract(request, 2);
  const contractJson = stableJson(contract);
  const responseSchema = responseFormat(contract.actions, contract.requiredAction, 2);
  const markers = contractMarkers(2);
  const contractContent = `${markers.instruction}${markers.begin}${contractJson}${markers.end}`;
  const messages = residentSessionMessages(request.conversation, contractContent);
  assertResidentSessionMessageLayout(messages as unknown[]);
  return deepFreeze({
    protocol: 'behold.strict-local-resident-session-envelope.v1' as const,
    schemaProtocol: OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_PROTOCOL,
    schemaSha256: OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_SHA256,
    messageLayoutProtocol: OLLAMA_LOCAL_RESIDENT_SESSION_MESSAGE_LAYOUT_PROTOCOL,
    workingContinuityProtocol: RESIDENT_WORKING_CONTINUITY_PROTOCOL,
    messages,
    responseSchema,
    actionContractSha256: sha256(contractJson),
    responseSchemaSha256: sha256(stableJson(responseSchema)),
    stablePrefixSha256: sha256(stableJson(messages.slice(0, 2))),
  });
}

/**
 * Verify the backend-independent resident contract already serialized onto a
 * local runtime's wire. This proves the prompt contract and constrained schema
 * agree without reconstructing or normalizing the resident request.
 */
export function assertStrictLocalResidentSessionEnvelope(
  messagesValue: unknown,
  responseSchemaValue: unknown,
): StrictLocalResidentSessionEnvelopeIdentity {
  if (!Array.isArray(messagesValue) || messagesValue.length < 3) {
    throw new Error('Strict local resident session messages are incomplete');
  }
  const messages = messagesValue as unknown[];
  const contractMessage = exactRecord(
    messages[1],
    ['role', 'content'],
    'Strict local resident action contract message',
  );
  const markers = contractMarkers(2);
  if (
    contractMessage.role !== 'system' ||
    typeof contractMessage.content !== 'string' ||
    !contractMessage.content.startsWith(`${markers.instruction}${markers.begin}`) ||
    !contractMessage.content.endsWith(markers.end)
  ) {
    throw new Error('Strict local resident action contract markers are invalid');
  }
  const contractJson = contractMessage.content.slice(
    markers.instruction.length + markers.begin.length,
    contractMessage.content.length - markers.end.length,
  );
  let contractValue: unknown;
  try {
    contractValue = JSON.parse(contractJson);
  } catch {
    throw new Error('Strict local resident action contract is not valid JSON');
  }
  const contract = parseActionContract(contractValue, 2);
  if (contractJson !== stableJson(contract)) {
    throw new Error('Strict local resident action contract is not exact canonical JSON');
  }
  const expectedSchema = responseFormat(contract.actions, contract.requiredAction, 2);
  if (stableJson(responseSchemaValue) !== stableJson(expectedSchema)) {
    throw new Error('Strict local resident response schema differs from its action contract');
  }
  assertResidentSessionMessageLayout(messages);
  return deepFreeze({
    schemaProtocol: OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_PROTOCOL,
    schemaSha256: OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_SHA256,
    messageLayoutProtocol: OLLAMA_LOCAL_RESIDENT_SESSION_MESSAGE_LAYOUT_PROTOCOL,
    workingContinuityProtocol: RESIDENT_WORKING_CONTINUITY_PROTOCOL,
    actionContractSha256: sha256(contractJson),
    responseSchemaSha256: sha256(stableJson(expectedSchema)),
    stablePrefixSha256: sha256(stableJson(messages.slice(0, 2))),
  });
}

export function assertOllamaLocalJsonActionRequest(
  value: unknown,
  expectedModel: string,
  policy: OllamaLocalPolicy,
): OllamaLocalJsonActionRequestIdentity {
  const version = transportVersion(policy);
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

  const contractMessageIndex = usesOllamaResidentSessionTransport(policy) ? 1 : -1;
  const contractMessage = exactRecord(
    record.messages.at(contractMessageIndex),
    ['role', 'content'],
    'Ollama local action contract message',
  );
  const expectedContractRole = usesOllamaResidentSessionTransport(policy) ? 'system' : 'user';
  if (
    contractMessage.role !== expectedContractRole ||
    typeof contractMessage.content !== 'string'
  ) {
    throw new Error('Ollama local action contract message is invalid');
  }
  const content = contractMessage.content;
  const markers = contractMarkers(version);
  if (
    !content.startsWith(`${markers.instruction}${markers.begin}`) ||
    !content.endsWith(markers.end)
  ) {
    throw new Error('Ollama local action contract markers are invalid');
  }
  const contractJson = content.slice(
    markers.instruction.length + markers.begin.length,
    content.length - markers.end.length,
  );
  let contractValue: unknown;
  try {
    contractValue = JSON.parse(contractJson);
  } catch {
    throw new Error('Ollama local action contract is not valid JSON');
  }
  const contract = parseActionContract(contractValue, version);
  if (contractJson !== stableJson(contract)) {
    throw new Error('Ollama local action contract is not exact canonical JSON');
  }
  const format = responseFormat(contract.actions, contract.requiredAction, version);
  if (stableJson(record.format) !== stableJson(format)) {
    throw new Error('Ollama response format differs from the exact action contract');
  }
  if (usesOllamaResidentSessionTransport(policy)) {
    assertResidentSessionMessageLayout(record.messages);
  }
  return requestIdentity(policy, contractJson, format, record.messages);
}

export function parseOllamaLocalJsonActionDecision(
  data: unknown,
  requestValue: ResidentMindRequest,
  call: ModelCallEvidence,
  policy: OllamaLocalPolicy,
): ResidentMindDecision {
  const request = parseResidentMindRequest(requestValue);
  assertTransportTreatment(request, policy);
  const version = transportVersion(policy);
  const response = plainRecord(data) ? data : null;
  const message = plainRecord(response?.message) ? response!.message : null;
  if (!message) throw new Error('Ollama response contained no assistant message');
  if (message.tool_calls != null) {
    throw new Error('Ollama local JSON action response used forbidden native tool calls');
  }
  if (typeof message.content !== 'string') {
    throw new Error('Ollama local JSON action response content was not text');
  }
  return parseStrictLocalJsonActionDecisionContent(
    message.content,
    message,
    request,
    call,
    version,
  );
}

/** Decode one raw constrained-output string without repair or normalization. */
export function parseStrictLocalJsonActionDecisionContent(
  content: string,
  adapterRecord: unknown,
  requestValue: ResidentMindRequest,
  call: ModelCallEvidence,
  version: 1 | 2 = 2,
): ResidentMindDecision {
  const request = parseResidentMindRequest(requestValue);
  assertHumanSemanticProfiles(request);
  if (version === 2 && request.policyProfile !== 'legible-resident-v1') {
    throw new Error('Strict local JSON action v2 requires policyProfile legible-resident-v1');
  }
  if (typeof content !== 'string') {
    throw new Error('Strict local JSON action response content was not text');
  }
  let output: unknown;
  try {
    output = JSON.parse(content);
  } catch {
    throw new Error('Strict local JSON action response content was not valid JSON');
  }
  const decision = exactRecord(
    output,
    version === 2
      ? ['intention', 'expectedObservableConsequence', 'action', 'arguments']
      : ['action', 'arguments'],
    'Strict local JSON action output',
  );
  if (typeof decision.action !== 'string' || !decision.action) {
    throw new Error('Strict local JSON action output action was not nonempty text');
  }
  if (!plainRecord(decision.arguments)) {
    throw new Error('Strict local JSON action output arguments were not an object');
  }
  if (!request.actions.some((action) => action.name === decision.action)) {
    throw new Error(
      `Strict local JSON action output selected unadmitted action ${decision.action}`,
    );
  }
  if (request.requiredAction && decision.action !== request.requiredAction) {
    throw new Error(
      `Strict local JSON action output selected ${decision.action} while ${request.requiredAction} was required`,
    );
  }
  const publicCommitment =
    version === 2
      ? residentPublicActionCommitment({
          protocol: RESIDENT_PUBLIC_ACTION_COMMITMENT_PROTOCOL,
          policyProfile: 'legible-resident-v1',
          intention: decision.intention,
          expectedObservableConsequence: decision.expectedObservableConsequence,
        })
      : null;
  return deepFreeze({
    protocol: 'behold.mind-decision.v1',
    disposition: decision.action === 'wait_for_event' ? 'wait' : 'act',
    utterance: publicCommitment ? renderResidentPublicActionCommitment(publicCommitment) : null,
    ...(publicCommitment ? { publicCommitment } : {}),
    action: {
      name: decision.action,
      input: cloneJson(decision.arguments),
      callId: null,
    },
    adapterRecord: cloneJson(adapterRecord),
    call,
  });
}

function actionContract(request: Readonly<ResidentMindRequest>, version: 1 | 2) {
  if (request.actions.length < 1) throw new Error('Ollama local action contract is empty');
  return deepFreeze({
    protocol:
      version === 2
        ? OLLAMA_LOCAL_JSON_ACTION_CONTRACT_V2_PROTOCOL
        : OLLAMA_LOCAL_JSON_ACTION_CONTRACT_PROTOCOL,
    ...(version === 2 ? { policyProfile: request.policyProfile } : {}),
    bodyProfile: request.bodyProfile,
    actionProfile: request.actionProfile,
    safetyProfile: request.safetyProfile,
    actions: cloneJson(request.actions),
    requiredAction: request.requiredAction,
    responseProtocol:
      version === 2
        ? OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_PROTOCOL
        : OLLAMA_LOCAL_JSON_ACTION_SCHEMA_PROTOCOL,
  });
}

function parseActionContract(value: unknown, version: 1 | 2): ReturnType<typeof actionContract> {
  const record = exactRecord(
    value,
    version === 2
      ? [
          'protocol',
          'policyProfile',
          'bodyProfile',
          'actionProfile',
          'safetyProfile',
          'actions',
          'requiredAction',
          'responseProtocol',
        ]
      : [
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
  const expectedContractProtocol =
    version === 2
      ? OLLAMA_LOCAL_JSON_ACTION_CONTRACT_V2_PROTOCOL
      : OLLAMA_LOCAL_JSON_ACTION_CONTRACT_PROTOCOL;
  const expectedResponseProtocol =
    version === 2
      ? OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_PROTOCOL
      : OLLAMA_LOCAL_JSON_ACTION_SCHEMA_PROTOCOL;
  if (record.protocol !== expectedContractProtocol) {
    throw new Error('Ollama local action contract protocol is invalid');
  }
  if (record.responseProtocol !== expectedResponseProtocol) {
    throw new Error('Ollama local action response schema protocol is invalid');
  }
  if (version === 2 && record.policyProfile !== 'legible-resident-v1') {
    throw new Error('Ollama local action contract policy treatment is invalid');
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
  return actionContract(
    {
      protocol: 'behold.mind-request.v1',
      entityId: 'transport-contract',
      model: 'transport-contract',
      ...(version === 2 ? { policyProfile: record.policyProfile } : {}),
      bodyProfile: record.bodyProfile,
      actionProfile: record.actionProfile,
      safetyProfile: record.safetyProfile,
      observation: null,
      conversation: [],
      actions,
      requiredAction: record.requiredAction,
    },
    version,
  );
}

function responseFormat(
  actions: ResidentMindRequest['actions'],
  requiredAction: string | null,
  version: 1 | 2,
) {
  const selected = requiredAction
    ? actions.filter((action) => action.name === requiredAction)
    : actions;
  if (selected.length < 1) throw new Error('Ollama local response format has no action variant');
  return deepFreeze({
    oneOf: selected.map((action) => ({
      ...(action.description == null ? {} : { description: action.description }),
      type: 'object',
      properties: {
        ...(version === 2
          ? {
              intention: {
                type: 'string',
                minLength: 1,
                maxLength: RESIDENT_PUBLIC_ACTION_COMMITMENT_MAX_CHARS,
                pattern: '^[^\\r\\n]+$',
                description:
                  'One short public statement of what this action is for; never private reasoning.',
              },
              expectedObservableConsequence: {
                type: 'string',
                minLength: 1,
                maxLength: RESIDENT_PUBLIC_ACTION_COMMITMENT_MAX_CHARS,
                pattern: '^[^\\r\\n]+$',
                description:
                  'One short public description of what the resident expects to observe if the action succeeds; never a claim that it already happened.',
              },
            }
          : {}),
        action: { const: action.name },
        arguments: cloneJson(action.inputSchema),
      },
      required:
        version === 2
          ? ['intention', 'expectedObservableConsequence', 'action', 'arguments']
          : ['action', 'arguments'],
      additionalProperties: false,
    })),
  });
}

function requestIdentity(
  policy: OllamaLocalPolicy,
  contractJson: string,
  format: unknown,
  messages: readonly unknown[],
): OllamaLocalJsonActionRequestIdentity {
  const residentSession = usesOllamaResidentSessionTransport(policy);
  return deepFreeze({
    protocol:
      policy.transport.protocol === OLLAMA_LOCAL_RESIDENT_SESSION_TRANSPORT_PROTOCOL
        ? OLLAMA_LOCAL_RESIDENT_SESSION_REQUEST_IDENTITY_PROTOCOL
        : policy.transport.protocol === OLLAMA_LOCAL_JSON_ACTION_TRANSPORT_V2_PROTOCOL
          ? OLLAMA_LOCAL_JSON_ACTION_REQUEST_IDENTITY_V2_PROTOCOL
          : OLLAMA_LOCAL_JSON_ACTION_REQUEST_IDENTITY_PROTOCOL,
    transportProtocol: policy.transport.protocol,
    schemaProtocol: policy.transport.schemaProtocol,
    schemaSha256: policy.transport.schemaSha256,
    modelTag: policy.modelTag,
    modelDigest: policy.modelDigest,
    templateSha256: policy.transport.templateSha256,
    actionContractSha256: sha256(contractJson),
    responseFormatSha256: sha256(stableJson(format)),
    ...(residentSession
      ? {
          messageLayoutProtocol: OLLAMA_LOCAL_RESIDENT_SESSION_MESSAGE_LAYOUT_PROTOCOL,
          workingContinuityProtocol: RESIDENT_WORKING_CONTINUITY_PROTOCOL,
          stablePrefixSha256: sha256(stableJson(messages.slice(0, 2))),
        }
      : {}),
  });
}

function transportVersion(policy: OllamaLocalPolicy): 1 | 2 {
  return policy.transport.protocol === OLLAMA_LOCAL_JSON_ACTION_TRANSPORT_PROTOCOL ? 1 : 2;
}

function contractMarkers(version: 1 | 2) {
  return version === 2
    ? {
        instruction: V2_CONTRACT_INSTRUCTION,
        begin: V2_CONTRACT_BEGIN,
        end: V2_CONTRACT_END,
      }
    : {
        instruction: V1_CONTRACT_INSTRUCTION,
        begin: V1_CONTRACT_BEGIN,
        end: V1_CONTRACT_END,
      };
}

export function assertOllamaLocalJsonActionTreatment(
  request: Pick<ResidentMindRequest, 'policyProfile'>,
  policy: OllamaLocalPolicy,
) {
  assertTransportTreatment(request, policy);
}

function assertTransportTreatment(
  request: Pick<ResidentMindRequest, 'policyProfile'>,
  policy: OllamaLocalPolicy,
) {
  const version = transportVersion(policy);
  if (version === 2 && request.policyProfile !== 'legible-resident-v1') {
    throw new Error('Ollama local JSON action v2 requires policyProfile legible-resident-v1');
  }
  if (version === 1 && request.policyProfile === 'legible-resident-v1') {
    throw new Error('policyProfile legible-resident-v1 requires Ollama local JSON action v2');
  }
}

export function usesOllamaResidentSessionTransport(policy: Pick<OllamaLocalPolicy, 'transport'>) {
  return policy.transport.protocol === OLLAMA_LOCAL_RESIDENT_SESSION_TRANSPORT_PROTOCOL;
}

function residentSessionMessages(
  conversationValue: ResidentMindRequest['conversation'],
  contractContent: string,
) {
  const conversation = cloneJson(conversationValue);
  if (!Array.isArray(conversation) || conversation.length < 2) {
    throw new Error('Ollama resident session requires a charter and current lived observation');
  }
  const charter = exactRecord(conversation[0], ['role', 'content'], 'Resident session charter');
  const current = exactRecord(
    conversation.at(-1),
    ['role', 'content'],
    'Resident session current observation',
  );
  if (charter.role !== 'system' || typeof charter.content !== 'string' || !charter.content) {
    throw new Error('Ollama resident session charter must be a nonempty system message');
  }
  if (current.role !== 'user' || typeof current.content !== 'string' || !current.content) {
    throw new Error('Ollama resident session current observation must be a nonempty user message');
  }
  if (
    conversation.slice(1, -1).some((message: any) => {
      const content = String(message?.content || '');
      return (
        content.startsWith('Recent lived action continuity from your own entity loom') ||
        (content.includes('continuity') && content.includes('behold.recent-action-continuity.v1'))
      );
    })
  ) {
    throw new Error(
      `Ollama resident session requires ${RESIDENT_WORKING_CONTINUITY_PROTOCOL}, not repeated full-camera continuity`,
    );
  }
  const dynamic = conversation.slice(1, -1);
  return deepFreeze([
    charter,
    { role: 'system' as const, content: contractContent },
    ...dynamic,
    {
      role: 'user' as const,
      content: `${current.content}\n\n${RESIDENT_SESSION_RESPONSE_REMINDER}`,
    },
  ]);
}

function assertResidentSessionMessageLayout(value: unknown[]) {
  if (value.length < 3) throw new Error('Ollama resident session message layout is incomplete');
  const charter = exactRecord(value[0], ['role', 'content'], 'Resident session charter');
  const current = exactRecord(
    value.at(-1),
    ['role', 'content'],
    'Resident session current observation',
  );
  if (charter.role !== 'system' || typeof charter.content !== 'string' || !charter.content) {
    throw new Error('Ollama resident session charter must be a nonempty system message');
  }
  if (
    current.role !== 'user' ||
    typeof current.content !== 'string' ||
    !current.content.endsWith(`\n\n${RESIDENT_SESSION_RESPONSE_REMINDER}`)
  ) {
    throw new Error('Ollama resident session response reminder is missing or drifted');
  }
  const dynamicMessages = value
    .slice(2, -1)
    .map((message, index) =>
      exactRecord(message, ['role', 'content'], `Resident session dynamic message ${index}`),
    );
  for (const message of dynamicMessages) {
    if (message.role !== 'system' || typeof message.content !== 'string') {
      throw new Error('Ollama resident session dynamic context must use bounded system messages');
    }
    if (
      message.content.startsWith('Recent lived action continuity from your own entity loom') ||
      message.content.includes('behold.recent-action-continuity.v1')
    ) {
      throw new Error('Ollama resident session contains the superseded full-camera continuity');
    }
    if (
      message.content.includes('Resident working continuity from your own entity loom') &&
      !message.content.includes(`"protocol":"${RESIDENT_WORKING_CONTINUITY_PROTOCOL}"`)
    ) {
      throw new Error('Ollama resident session working continuity protocol drifted');
    }
  }
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
