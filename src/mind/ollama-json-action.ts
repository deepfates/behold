import { createHash } from 'node:crypto';
import type { ModelCallEvidence } from './evidence';
import type { ResidentMindDecision, ResidentMindRequest } from './interface';
import { MAX_RESIDENT_CAMERA_FRAME_BYTES } from '../perception/resident-camera-frame';
import type { OllamaLocalPolicy } from './ollama-local';
import {
  RESIDENT_FACTUAL_CONTINUITY_PROTOCOL,
  RESIDENT_WORKING_CONTINUITY_PROTOCOL,
} from './observation-context';
import {
  RESIDENT_PUBLIC_ACTION_COMMITMENT_MAX_CHARS,
  RESIDENT_PUBLIC_ACTION_COMMITMENT_PROTOCOL,
  renderResidentPublicActionCommitment,
  residentPublicActionCommitment,
} from './public-commitment';
import { parseResidentMindRequest } from './request-artifact';
import {
  RESIDENT_CONTEXT_EPOCH_PROTOCOL,
  RESIDENT_CONTINUOUS_TRANSCRIPT_PROTOCOL,
} from './resident-transcript';

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
export const OLLAMA_LOCAL_CONTINUOUS_RESIDENT_SESSION_MESSAGE_LAYOUT_PROTOCOL =
  'behold.ollama-local-resident-session-message-layout.v2' as const;
export const OLLAMA_LOCAL_EPOCH_RESIDENT_SESSION_MESSAGE_LAYOUT_PROTOCOL =
  'behold.ollama-local-resident-session-message-layout.v3' as const;

const V1_CONTRACT_BEGIN = 'BEHOLD_LOCAL_JSON_ACTION_CONTRACT_V1_BEGIN\n';
const V1_CONTRACT_END = '\nBEHOLD_LOCAL_JSON_ACTION_CONTRACT_V1_END';
const V1_CONTRACT_INSTRUCTION =
  'Choose zero or one admitted bodily action. Return only one JSON object with exactly the fields "action" and "arguments". Use {"action":null,"arguments":{}} when you form no bodily intention. Do not use tool calls, Markdown, prose, corrections, or multiple candidates.\n';
const V2_CONTRACT_BEGIN = 'BEHOLD_LOCAL_JSON_ACTION_CONTRACT_V2_BEGIN\n';
const V2_CONTRACT_END = '\nBEHOLD_LOCAL_JSON_ACTION_CONTRACT_V2_END';
export const V2_CONTRACT_INSTRUCTION =
  'Choose exactly one supplied bodily control. Its presence authorizes an attempt but does not promise that world preconditions hold or that it will succeed. Return only one JSON object with exactly the fields "intention", "expectedObservableConsequence", "action", and "arguments". The first two fields are short public commitments, not private reasoning or claims of success. Do not use tool calls, Markdown, prose, corrections, or multiple candidates.\n';
const V3_CONTRACT_BEGIN = 'BEHOLD_CONTINUOUS_JSON_ACTION_CONTRACT_V1_BEGIN\n';
const V3_CONTRACT_END = '\nBEHOLD_CONTINUOUS_JSON_ACTION_CONTRACT_V1_END';
const V3_CONTRACT_INSTRUCTION =
  'Continue your private lived conversation. Choose zero or one admitted bodily action. Return only one JSON object with exactly the fields "action" and "arguments". Use {"action":null,"arguments":{}} when you form no bodily intention. A bodily action and Minecraft\'s actual outcome will remain in your chronological life. Do not use tool calls, Markdown, prose, corrections, or multiple candidates.\n';
const V4_CONTRACT_BEGIN = 'BEHOLD_CONTEXT_EPOCH_JSON_ACTION_CONTRACT_V1_BEGIN\n';
const V4_CONTRACT_END = '\nBEHOLD_CONTEXT_EPOCH_JSON_ACTION_CONTRACT_V1_END';
const V4_CONTRACT_INSTRUCTION =
  'Continue your private lived conversation in the active explicit context epoch. Choose zero or one admitted bodily action, or an exact private-life read. Return only one JSON object with exactly the fields "action" and "arguments". Use {"action":null,"arguments":{}} when you form no bodily intention. A bodily action or private-life read and its actual result will remain in your chronological life. Do not use tool calls, Markdown, prose, corrections, or multiple candidates.\n';
export const RESIDENT_SESSION_RESPONSE_REMINDER =
  'Respond now with one JSON object matching the resident action contract above. Publish a short intention and expected observable consequence, then choose exactly one supplied bodily control. Do not repeat the contract or add prose.';
export const ACTION_ONLY_RESIDENT_SESSION_RESPONSE_REMINDER =
  'Respond now with one JSON object matching the resident action contract above. Choose zero or one supplied bodily control; use a null action when you form no bodily intention. Do not repeat the contract or add prose.';

const schemaDescriptor = deepFreeze({
  protocol: OLLAMA_LOCAL_JSON_ACTION_SCHEMA_PROTOCOL,
  output: {
    type: 'object',
    alternatives: 'oneOf',
    discriminator: { field: 'action', value: 'exact admitted action name or null' },
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
  messageLayoutProtocol?:
    | typeof OLLAMA_LOCAL_RESIDENT_SESSION_MESSAGE_LAYOUT_PROTOCOL
    | typeof OLLAMA_LOCAL_CONTINUOUS_RESIDENT_SESSION_MESSAGE_LAYOUT_PROTOCOL
    | typeof OLLAMA_LOCAL_EPOCH_RESIDENT_SESSION_MESSAGE_LAYOUT_PROTOCOL;
  workingContinuityProtocol?:
    | typeof RESIDENT_WORKING_CONTINUITY_PROTOCOL
    | typeof RESIDENT_FACTUAL_CONTINUITY_PROTOCOL
    | typeof RESIDENT_CONTINUOUS_TRANSCRIPT_PROTOCOL
    | typeof RESIDENT_CONTEXT_EPOCH_PROTOCOL;
  stablePrefixSha256?: string;
}>;

/**
 * Runtime-independent strict resident-session material. Ollama and other local
 * engines may wrap these exact messages/schema in their native wire envelope,
 * but must not reinterpret the action contract or response.
 */
export type StrictLocalResidentSessionEnvelope = Readonly<{
  protocol:
    | 'behold.strict-local-resident-session-envelope.v1'
    | 'behold.strict-local-resident-session-envelope.v2'
    | 'behold.strict-local-resident-session-envelope.v3'
    | 'behold.strict-local-resident-session-envelope.v4';
  schemaProtocol:
    | typeof OLLAMA_LOCAL_JSON_ACTION_SCHEMA_PROTOCOL
    | typeof OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_PROTOCOL;
  schemaSha256:
    | typeof OLLAMA_LOCAL_JSON_ACTION_SCHEMA_SHA256
    | typeof OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_SHA256;
  messageLayoutProtocol:
    | typeof OLLAMA_LOCAL_RESIDENT_SESSION_MESSAGE_LAYOUT_PROTOCOL
    | typeof OLLAMA_LOCAL_CONTINUOUS_RESIDENT_SESSION_MESSAGE_LAYOUT_PROTOCOL
    | typeof OLLAMA_LOCAL_EPOCH_RESIDENT_SESSION_MESSAGE_LAYOUT_PROTOCOL;
  workingContinuityProtocol:
    | typeof RESIDENT_WORKING_CONTINUITY_PROTOCOL
    | typeof RESIDENT_FACTUAL_CONTINUITY_PROTOCOL
    | typeof RESIDENT_CONTINUOUS_TRANSCRIPT_PROTOCOL
    | typeof RESIDENT_CONTEXT_EPOCH_PROTOCOL;
  messages: readonly unknown[];
  responseSchema: unknown;
  actionContractSha256: string;
  responseSchemaSha256: string;
  stablePrefixSha256: string;
}>;

export type StrictLocalResidentSessionEnvelopeIdentity = Readonly<
  Omit<StrictLocalResidentSessionEnvelope, 'protocol' | 'messages' | 'responseSchema'>
>;

export type StrictLocalResidentSessionPrefixIdentity = Readonly<{
  actionContractSha256: string;
  stablePrefixSha256: string;
}>;

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
  if (requestValue.perception) {
    throw new Error('Ollama legacy transport does not admit camera perception');
  }
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
  const version = residentSessionSchemaVersion(request.policyProfile);
  const contract = actionContract(request, version);
  const contractJson = stableJson(contract);
  const responseSchema = responseFormat(contract.actions, contract.requiredAction, version);
  const markers = contractMarkers(version);
  const contractContent = `${markers.instruction}${markers.begin}${contractJson}${markers.end}`;
  const messages = residentSessionMessages(
    request.conversation,
    contractContent,
    version,
    request.perception,
  );
  assertResidentSessionMessageLayout(messages as unknown[], version);
  return deepFreeze({
    protocol:
      version === 4
        ? ('behold.strict-local-resident-session-envelope.v4' as const)
        : version === 3
          ? ('behold.strict-local-resident-session-envelope.v3' as const)
          : version === 2
            ? ('behold.strict-local-resident-session-envelope.v1' as const)
            : ('behold.strict-local-resident-session-envelope.v2' as const),
    schemaProtocol:
      version === 2
        ? OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_PROTOCOL
        : OLLAMA_LOCAL_JSON_ACTION_SCHEMA_PROTOCOL,
    schemaSha256:
      version === 2
        ? OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_SHA256
        : OLLAMA_LOCAL_JSON_ACTION_SCHEMA_SHA256,
    messageLayoutProtocol: residentSessionMessageLayoutProtocol(version),
    workingContinuityProtocol: residentSessionContinuityProtocol(version),
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
  const version = residentSessionSchemaVersionFromContractMessage(contractMessage.content);
  const markers = contractMarkers(version);
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
  const contract = parseActionContract(contractValue, version);
  if (contractJson !== stableJson(contract)) {
    throw new Error('Strict local resident action contract is not exact canonical JSON');
  }
  const expectedSchema = responseFormat(contract.actions, contract.requiredAction, version);
  if (stableJson(responseSchemaValue) !== stableJson(expectedSchema)) {
    throw new Error('Strict local resident response schema differs from its action contract');
  }
  assertResidentSessionMessageLayout(messages, version);
  return deepFreeze({
    schemaProtocol:
      version === 2
        ? OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_PROTOCOL
        : OLLAMA_LOCAL_JSON_ACTION_SCHEMA_PROTOCOL,
    schemaSha256:
      version === 2
        ? OLLAMA_LOCAL_JSON_ACTION_SCHEMA_V2_SHA256
        : OLLAMA_LOCAL_JSON_ACTION_SCHEMA_SHA256,
    messageLayoutProtocol: residentSessionMessageLayoutProtocol(version),
    workingContinuityProtocol: residentSessionContinuityProtocol(version),
    actionContractSha256: sha256(contractJson),
    responseSchemaSha256: sha256(stableJson(expectedSchema)),
    stablePrefixSha256: sha256(stableJson(messages.slice(0, 2))),
  });
}

/**
 * Verify only the stable charter/action-contract prefix used by a resident
 * session. This is deliberately narrower than an action request: setup code
 * may prefill these exact tokens without supplying an observation or granting
 * action authority.
 */
export function assertStrictLocalResidentSessionPrefix(
  messagesValue: unknown,
): StrictLocalResidentSessionPrefixIdentity {
  if (!Array.isArray(messagesValue) || messagesValue.length !== 2) {
    throw new Error('Strict local resident session prefix requires exactly two messages');
  }
  const charter = exactRecord(messagesValue[0], ['role', 'content'], 'Resident session charter');
  if (charter.role !== 'system' || typeof charter.content !== 'string' || !charter.content) {
    throw new Error('Strict local resident session charter must be a nonempty system message');
  }
  const contractMessage = exactRecord(
    messagesValue[1],
    ['role', 'content'],
    'Strict local resident action contract message',
  );
  const version = residentSessionSchemaVersionFromContractMessage(contractMessage.content);
  const markers = contractMarkers(version);
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
  const contract = parseActionContract(contractValue, version);
  if (contractJson !== stableJson(contract)) {
    throw new Error('Strict local resident action contract is not exact canonical JSON');
  }
  return deepFreeze({
    actionContractSha256: sha256(contractJson),
    stablePrefixSha256: sha256(stableJson(messagesValue)),
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
  version: 1 | 2 | 3 | 4 = 2,
): ResidentMindDecision {
  const request = parseResidentMindRequest(requestValue);
  assertHumanSemanticProfiles(request);
  if (version === 2 && request.policyProfile !== 'legible-resident-v1') {
    throw new Error('Strict local JSON action v2 requires policyProfile legible-resident-v1');
  }
  if (version === 3 && request.policyProfile !== 'resident-v3') {
    throw new Error('Strict local JSON action v3 requires policyProfile resident-v3');
  }
  if (version === 4 && request.policyProfile !== 'resident-v4') {
    throw new Error('Strict local JSON action v4 requires policyProfile resident-v4');
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
  if (!plainRecord(decision.arguments)) {
    throw new Error('Strict local JSON action output arguments were not an object');
  }
  if (decision.action === null) {
    if (version === 2) {
      throw new Error('Strict local JSON action v2 requires a bodily action');
    }
    if (request.requiredAction) {
      throw new Error(
        `Strict local JSON action output selected no action while ${request.requiredAction} was required`,
      );
    }
    if (Object.keys(decision.arguments).length > 0) {
      throw new Error('Strict local JSON no-action output arguments were not empty');
    }
    return deepFreeze({
      protocol: 'behold.mind-decision.v1',
      disposition: 'no_action',
      utterance: null,
      action: null,
      adapterRecord: cloneJson(adapterRecord),
      call,
    });
  }
  if (typeof decision.action !== 'string' || !decision.action) {
    throw new Error('Strict local JSON action output action was not nonempty text or null');
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

function actionContract(request: Readonly<ResidentMindRequest>, version: 1 | 2 | 3 | 4) {
  if (version === 2 && request.actions.length < 1) {
    throw new Error('Ollama local action contract is empty');
  }
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

function parseActionContract(
  value: unknown,
  version: 1 | 2 | 3 | 4,
): ReturnType<typeof actionContract> {
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
  if (!Array.isArray(record.actions) || (version === 2 && record.actions.length < 1)) {
    throw new Error(
      version === 2
        ? 'Ollama local action contract actions must be a nonempty array'
        : 'Ollama local action contract actions must be an array',
    );
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
  version: 1 | 2 | 3 | 4,
) {
  const selected = requiredAction
    ? actions.filter((action) => action.name === requiredAction)
    : actions;
  if (selected.length < 1 && (version === 2 || requiredAction)) {
    throw new Error('Ollama local response format has no action variant');
  }
  const noIntention =
    version === 2 || requiredAction
      ? []
      : [
          {
            description: 'No bodily intention is formed for this cognitive opportunity.',
            type: 'object',
            properties: {
              action: { const: null },
              arguments: { type: 'object', properties: {}, additionalProperties: false },
            },
            required: ['action', 'arguments'],
            additionalProperties: false,
          },
        ];
  return deepFreeze({
    oneOf: [
      ...selected.map((action) => ({
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
      ...noIntention,
    ],
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

function contractMarkers(version: 1 | 2 | 3 | 4) {
  return version === 4
    ? {
        instruction: V4_CONTRACT_INSTRUCTION,
        begin: V4_CONTRACT_BEGIN,
        end: V4_CONTRACT_END,
      }
    : version === 3
      ? {
          instruction: V3_CONTRACT_INSTRUCTION,
          begin: V3_CONTRACT_BEGIN,
          end: V3_CONTRACT_END,
        }
      : version === 2
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

function residentSessionSchemaVersion(policyProfile: unknown): 1 | 2 | 3 | 4 {
  if (policyProfile === 'resident-v4') return 4;
  if (policyProfile === 'resident-v3') return 3;
  if (policyProfile === 'resident-v2') return 1;
  if (policyProfile === 'legible-resident-v1') return 2;
  throw new Error(
    'Strict local resident session requires policyProfile resident-v4, resident-v3, resident-v2, or legible-resident-v1',
  );
}

function residentSessionSchemaVersionFromContractMessage(value: unknown): 1 | 2 | 3 | 4 {
  if (typeof value !== 'string') {
    throw new Error('Strict local resident action contract content is not text');
  }
  if (value.startsWith(`${V4_CONTRACT_INSTRUCTION}${V4_CONTRACT_BEGIN}`)) return 4;
  if (value.startsWith(`${V3_CONTRACT_INSTRUCTION}${V3_CONTRACT_BEGIN}`)) return 3;
  if (value.startsWith(`${V1_CONTRACT_INSTRUCTION}${V1_CONTRACT_BEGIN}`)) return 1;
  if (value.startsWith(`${V2_CONTRACT_INSTRUCTION}${V2_CONTRACT_BEGIN}`)) return 2;
  throw new Error('Strict local resident action contract markers are invalid');
}

function residentSessionMessageLayoutProtocol(version: 1 | 2 | 3 | 4) {
  return version === 4
    ? OLLAMA_LOCAL_EPOCH_RESIDENT_SESSION_MESSAGE_LAYOUT_PROTOCOL
    : version === 3
      ? OLLAMA_LOCAL_CONTINUOUS_RESIDENT_SESSION_MESSAGE_LAYOUT_PROTOCOL
      : OLLAMA_LOCAL_RESIDENT_SESSION_MESSAGE_LAYOUT_PROTOCOL;
}

function residentSessionContinuityProtocol(version: 1 | 2 | 3 | 4) {
  return version === 4
    ? RESIDENT_CONTEXT_EPOCH_PROTOCOL
    : version === 3
      ? RESIDENT_CONTINUOUS_TRANSCRIPT_PROTOCOL
      : version === 1
        ? RESIDENT_FACTUAL_CONTINUITY_PROTOCOL
        : RESIDENT_WORKING_CONTINUITY_PROTOCOL;
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
  if (request.policyProfile === 'resident-v3') {
    throw new Error('resident-v3 is not admitted by the legacy Ollama transport');
  }
  if (request.policyProfile === 'resident-v4') {
    throw new Error('resident-v4 is not admitted by the legacy Ollama transport');
  }
  if (request.policyProfile === 'resident-v2') {
    throw new Error('resident-v2 is not admitted by the legacy Ollama transport');
  }
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
  version: 1 | 2 | 3 | 4 = 2,
  perception?: ResidentMindRequest['perception'],
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
  const reminder =
    version === 2
      ? RESIDENT_SESSION_RESPONSE_REMINDER
      : ACTION_ONLY_RESIDENT_SESSION_RESPONSE_REMINDER;
  const currentText =
    version === 3 || version === 4 ? current.content : `${current.content}\n\n${reminder}`;
  const currentContent = perception
    ? [
        { type: 'text' as const, text: currentText },
        {
          type: 'image_url' as const,
          image_url: {
            url: `data:${perception.camera.content.mediaType};base64,${perception.camera.content.data}`,
          },
        },
      ]
    : currentText;
  return deepFreeze([
    charter,
    { role: 'system' as const, content: contractContent },
    ...dynamic,
    {
      role: 'user' as const,
      content: currentContent,
    },
  ]);
}

function assertResidentSessionMessageLayout(value: unknown[], version: 1 | 2 | 3 | 4 = 2) {
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
  const reminder =
    version === 2
      ? RESIDENT_SESSION_RESPONSE_REMINDER
      : ACTION_ONLY_RESIDENT_SESSION_RESPONSE_REMINDER;
  const currentText = residentSessionCurrentText(current.content);
  if (
    current.role !== 'user' ||
    (version === 3 || version === 4
      ? !currentText.startsWith('What you experience:')
      : !currentText.endsWith(`\n\n${reminder}`))
  ) {
    throw new Error('Ollama resident session response reminder is missing or drifted');
  }
  const dynamicMessages = value
    .slice(2, -1)
    .map((message, index) =>
      exactRecord(message, ['role', 'content'], `Resident session dynamic message ${index}`),
    );
  if (version === 3 || version === 4) {
    for (const [index, message] of dynamicMessages.entries()) {
      if (
        (message.role !== 'user' && message.role !== 'assistant') ||
        typeof message.content !== 'string' ||
        !message.content
      ) {
        throw new Error('Continuous resident transcript requires nonempty user/assistant messages');
      }
      if (message.role === 'assistant') {
        const previous = dynamicMessages[index - 1];
        const next = dynamicMessages[index + 1] ?? current;
        if (
          previous?.role !== 'user' ||
          !String(previous.content).startsWith('What you experience:')
        ) {
          throw new Error(
            'Continuous resident assistant response must follow one exact lived experience',
          );
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(message.content);
        } catch {
          throw new Error('Continuous resident assistant response is not valid JSON');
        }
        const choice = exactRecord(
          parsed,
          ['action', 'arguments'],
          `Continuous resident assistant response ${index}`,
        );
        if (
          !choice.arguments ||
          typeof choice.arguments !== 'object' ||
          Array.isArray(choice.arguments)
        ) {
          throw new Error('Continuous resident assistant response arguments are not an object');
        }
        if (choice.action === null) {
          if (Object.keys(choice.arguments).length !== 0) {
            throw new Error('Continuous resident no-intention response arguments are not empty');
          }
          if (next?.role !== 'user' || !String(next.content).startsWith('What you experience:')) {
            throw new Error(
              'Continuous resident no-intention response must be followed by later lived experience',
            );
          }
        } else if (
          typeof choice.action !== 'string' ||
          !choice.action ||
          next?.role !== 'user' ||
          (!String(next.content).startsWith('What Minecraft returned after your ') &&
            !String(next.content).startsWith('What your private life returned:'))
        ) {
          throw new Error(
            'Continuous resident action response must be followed by its Minecraft or private-life outcome',
          );
        }
      } else if (
        !message.content.startsWith('What you experience:') &&
        !message.content.startsWith('What Minecraft returned after your ') &&
        !message.content.startsWith('What happened through ') &&
        !message.content.startsWith('What your private life returned:') &&
        !(
          version === 4 &&
          message.content.startsWith(
            'Your active inference context has entered a new explicit epoch.',
          )
        )
      ) {
        throw new Error('Continuous resident user message is not a lived experience or outcome');
      }
    }
    return;
  }
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

/** Exact text channel from either the text-only or one-frame OpenAI message layout. */
export function residentSessionCurrentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content) || content.length !== 2) {
    throw new Error('Resident session current observation content is malformed');
  }
  const text = exactRecord(content[0], ['type', 'text'], 'Resident session text part');
  const image = exactRecord(content[1], ['type', 'image_url'], 'Resident session image part');
  const imageUrl = exactRecord(image.image_url, ['url'], 'Resident session image URL');
  if (text.type !== 'text' || typeof text.text !== 'string' || !text.text) {
    throw new Error('Resident session text part is malformed');
  }
  if (
    image.type !== 'image_url' ||
    typeof imageUrl.url !== 'string' ||
    !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(imageUrl.url)
  ) {
    throw new Error('Resident session image part is malformed');
  }
  const [, encoded = ''] = imageUrl.url.split(',', 2);
  const bytes = Buffer.from(encoded, 'base64');
  if (
    bytes.length < 1 ||
    bytes.toString('base64') !== encoded ||
    bytes.length > MAX_RESIDENT_CAMERA_FRAME_BYTES
  ) {
    throw new Error('Resident session image bytes are invalid');
  }
  return text.text;
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
