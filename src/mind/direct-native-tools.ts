import { createHash } from 'node:crypto';
import type { ModelCallEvidence } from './evidence';
import type { ResidentMindDecision, ResidentMindRequest } from './interface';
import {
  createStrictLocalResidentSessionEnvelope,
  RESIDENT_SESSION_RESPONSE_REMINDER,
} from './ollama-json-action';
import { RESIDENT_WORKING_CONTINUITY_PROTOCOL } from './observation-context';
import {
  RESIDENT_PUBLIC_ACTION_COMMITMENT_MAX_CHARS,
  RESIDENT_PUBLIC_ACTION_COMMITMENT_PROTOCOL,
  renderResidentPublicActionCommitment,
  residentPublicActionCommitment,
} from './public-commitment';
import { validateResidentActionInput } from './schema';

export const OPENROUTER_NATIVE_TOOL_RESIDENT_SESSION_PROTOCOL =
  'behold.openrouter-native-tool-resident-session.v2' as const;
export const OPENROUTER_NATIVE_TOOL_MESSAGE_LAYOUT_PROTOCOL =
  'behold.openrouter-native-tool-message-layout.v1' as const;

const NATIVE_ACTION_CONTRACT_PROTOCOL = 'behold.native-tool-action-contract.v1' as const;
const NATIVE_ACTION_METADATA_PROTOCOL = 'behold.native-tool-action-metadata.v1' as const;
const NATIVE_ACTION_RESPONSE_PROTOCOL = 'behold.native-tool-call.v1' as const;
const NATIVE_ACTION_METADATA_BEGIN = 'BEHOLD_NATIVE_TOOL_ACTION_METADATA_V1_BEGIN\n';
const NATIVE_ACTION_METADATA_END = '\nBEHOLD_NATIVE_TOOL_ACTION_METADATA_V1_END';

const NATIVE_TOOL_INSTRUCTION =
  'Choose exactly one supplied bodily control by calling exactly one supplied function. Its presence authorizes an attempt but does not promise that world preconditions hold or that it will succeed. Put the two short public commitments and the unchanged action arguments inside that call. Do not add prose, corrections, or multiple candidates.\n';
const NATIVE_TOOL_RESPONSE_REMINDER =
  "Respond now with exactly one supplied function call. Publish a short intention and expected observable consequence inside it, then supply that action's arguments. Do not repeat the contract or add prose.";

export function createNativeToolResidentSessionEnvelope(request: ResidentMindRequest) {
  const strict = createStrictLocalResidentSessionEnvelope(request);
  const tools = nativeToolsFromActions(request.actions);
  const toolsSha256 = sha256(stableJson(tools));
  const contract = nativeActionContract({
    policyProfile: request.policyProfile,
    bodyProfile: request.bodyProfile,
    actionProfile: request.actionProfile,
    safetyProfile: request.safetyProfile,
    actions: request.actions,
    requiredAction: request.requiredAction,
  });
  const actionContractSha256 = sha256(stableJson(contract));
  const metadata = nativeActionMetadata({
    ...contract,
    actionContractSha256,
    toolsSha256,
  });
  const messages = nativeMessagesFromStrict(strict.messages, metadata);
  return deepFreeze({
    protocol: OPENROUTER_NATIVE_TOOL_RESIDENT_SESSION_PROTOCOL,
    messages,
    tools,
    messageLayoutProtocol: OPENROUTER_NATIVE_TOOL_MESSAGE_LAYOUT_PROTOCOL,
    workingContinuityProtocol: strict.workingContinuityProtocol,
    actionContractSha256,
    toolsSha256,
    requestPrefixSha256: sha256(stableJson(messages.slice(0, 2))),
  });
}

export function assertNativeToolResidentSessionEnvelope(
  messagesValue: unknown,
  toolsValue: unknown,
  toolChoiceValue: unknown,
) {
  if (!Array.isArray(messagesValue) || messagesValue.length < 3) {
    throw new Error('native-tool resident session messages are incomplete');
  }
  if (!Array.isArray(toolsValue) || toolsValue.length < 1) {
    throw new Error('native-tool resident session tools are missing');
  }
  const metadata = nativeMetadataFromMessages(messagesValue);
  const actions = actionsFromNativeTools(toolsValue);
  const selectedNames = actions.map((action) => action.name);
  const toolsSha256 = sha256(stableJson(toolsValue));
  if (metadata.toolsSha256 !== toolsSha256) {
    throw new Error('native tool metadata differs from the supplied tools');
  }
  const contract = nativeActionContract({ ...metadata, actions });
  const actionContractSha256 = sha256(stableJson(contract));
  if (metadata.actionContractSha256 !== actionContractSha256) {
    throw new Error('native tool action contract differs from its metadata');
  }
  if (metadata.requiredAction === null) {
    if (toolChoiceValue !== 'required') {
      throw new Error('native tool choice must require one supplied control');
    }
  } else {
    const choice = exactRecord(toolChoiceValue, ['type', 'function'], 'native tool choice');
    const fn = exactRecord(choice.function, ['name'], 'native tool choice function');
    if (
      choice.type !== 'function' ||
      fn.name !== metadata.requiredAction ||
      !selectedNames.includes(metadata.requiredAction)
    ) {
      throw new Error('native tool choice does not select the required control');
    }
  }
  return deepFreeze({
    protocol: OPENROUTER_NATIVE_TOOL_RESIDENT_SESSION_PROTOCOL,
    messageLayoutProtocol: OPENROUTER_NATIVE_TOOL_MESSAGE_LAYOUT_PROTOCOL,
    workingContinuityProtocol: RESIDENT_WORKING_CONTINUITY_PROTOCOL,
    actionContractSha256,
    toolsSha256,
    requestPrefixSha256: sha256(stableJson(messagesValue.slice(0, 2))),
  });
}

export function parseNativeToolResidentDecision(
  data: unknown,
  request: ResidentMindRequest,
  call: ModelCallEvidence,
): ResidentMindDecision {
  const root = plainRecord(data) ? data : null;
  if (!root || !Array.isArray(root.choices) || root.choices.length !== 1) {
    throw new Error('provider native-tool response must contain exactly one choice');
  }
  const choice = plainRecord(root.choices[0]) ? root.choices[0] : null;
  const assistant = choice && plainRecord(choice.message) ? choice.message : null;
  if (!assistant) throw new Error('provider native-tool response contained no assistant message');
  if (assistant.content != null && assistant.content !== '') {
    throw new Error('provider native-tool response contained forbidden assistant prose');
  }
  if (!Array.isArray(assistant.tool_calls) || assistant.tool_calls.length !== 1) {
    throw new Error('provider native-tool response must contain exactly one tool call');
  }
  const tool = exactRecord(
    assistant.tool_calls[0],
    ['id', 'index', 'type', 'function'],
    'provider native tool call',
  );
  const fn = exactRecord(tool.function, ['name', 'arguments'], 'provider native tool function');
  if (
    tool.type !== 'function' ||
    tool.index !== 0 ||
    typeof tool.id !== 'string' ||
    !tool.id ||
    typeof fn.name !== 'string' ||
    !fn.name ||
    typeof fn.arguments !== 'string'
  ) {
    throw new Error('provider native tool call fields are invalid');
  }
  const admitted = request.actions.find((action) => action.name === fn.name);
  if (!admitted) throw new Error(`provider selected unadmitted action ${String(fn.name)}`);
  if (request.requiredAction && request.requiredAction !== fn.name) {
    throw new Error(`provider selected ${fn.name} while ${request.requiredAction} was required`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fn.arguments);
  } catch {
    throw new Error('provider native tool arguments were not valid JSON');
  }
  const envelope = exactRecord(
    parsed,
    ['intention', 'expectedObservableConsequence', 'arguments'],
    'provider native tool arguments',
  );
  if (!plainRecord(envelope.arguments)) {
    throw new Error('provider native action arguments were not an object');
  }
  const validation = validateResidentActionInput(envelope.arguments, admitted.inputSchema);
  if (validation.ok === false) {
    throw new Error(
      `provider native action arguments were invalid: ${validation.errors.join('; ')}`,
    );
  }
  const publicCommitment = residentPublicActionCommitment({
    protocol: RESIDENT_PUBLIC_ACTION_COMMITMENT_PROTOCOL,
    policyProfile: 'legible-resident-v1',
    intention: envelope.intention,
    expectedObservableConsequence: envelope.expectedObservableConsequence,
  });
  return deepFreeze({
    protocol: 'behold.mind-decision.v1' as const,
    disposition: fn.name === 'wait_for_event' ? ('wait' as const) : ('act' as const),
    utterance: renderResidentPublicActionCommitment(publicCommitment),
    publicCommitment,
    action: {
      name: fn.name,
      input: cloneJson(envelope.arguments),
      callId: tool.id,
    },
    adapterRecord: cloneJson(assistant),
    call,
  });
}

function nativeToolsFromActions(actions: ResidentMindRequest['actions']) {
  if (!Array.isArray(actions) || actions.length < 1) {
    throw new Error('native tool resident session requires at least one control');
  }
  return actions.map((action) =>
    deepFreeze({
      type: 'function' as const,
      function: {
        name: action.name,
        ...(action.description == null ? {} : { description: action.description }),
        parameters: {
          type: 'object',
          properties: {
            ...publicCommitmentSchemas(),
            arguments: cloneJson(action.inputSchema),
          },
          required: ['intention', 'expectedObservableConsequence', 'arguments'],
          additionalProperties: false,
        },
      },
    }),
  );
}

function actionsFromNativeTools(value: unknown[]) {
  const names = new Set<string>();
  return value.map((item, index) => {
    const tool = nativeTool(item, index);
    const parameters = exactRecord(
      tool.function.parameters,
      ['type', 'properties', 'required', 'additionalProperties'],
      `native tool parameters ${index}`,
    );
    const properties = exactRecord(
      parameters.properties,
      ['intention', 'expectedObservableConsequence', 'arguments'],
      `native tool properties ${index}`,
    );
    if (
      parameters.type !== 'object' ||
      parameters.additionalProperties !== false ||
      stableJson(parameters.required) !==
        stableJson(['intention', 'expectedObservableConsequence', 'arguments'])
    ) {
      throw new Error(`native tool parameters ${index} differ from the resident contract`);
    }
    const expectedCommitments = publicCommitmentSchemas();
    if (
      stableJson(properties.intention) !== stableJson(expectedCommitments.intention) ||
      stableJson(properties.expectedObservableConsequence) !==
        stableJson(expectedCommitments.expectedObservableConsequence)
    ) {
      throw new Error(`native tool public commitment schema ${index} differs`);
    }
    if (!plainRecord(properties.arguments)) {
      throw new Error(`native tool action schema ${index} is invalid`);
    }
    if (names.has(tool.function.name)) {
      throw new Error(`native tool ${index} duplicates a control name`);
    }
    names.add(tool.function.name);
    return deepFreeze({
      name: tool.function.name,
      ...(tool.function.description == null ? {} : { description: tool.function.description }),
      inputSchema: cloneJson(properties.arguments),
    });
  });
}

function nativeTool(value: unknown, index: number) {
  const tool = exactRecord(value, ['type', 'function'], `native tool ${index}`);
  const fn = exactRecord(
    tool.function,
    plainRecord(tool.function) && Object.hasOwn(tool.function, 'description')
      ? ['name', 'description', 'parameters']
      : ['name', 'parameters'],
    `native tool function ${index}`,
  );
  if (tool.type !== 'function' || typeof fn.name !== 'string' || !fn.name) {
    throw new Error(`native tool ${index} is invalid`);
  }
  if (fn.description != null && (typeof fn.description !== 'string' || fn.description.length < 1)) {
    throw new Error(`native tool ${index} description is invalid`);
  }
  return { type: 'function' as const, function: fn };
}

function nativeMessagesFromStrict(value: readonly unknown[], metadata: unknown) {
  const messages = cloneJson(value) as any[];
  const contract = exactRecord(messages[1], ['role', 'content'], 'resident action contract');
  const current = exactRecord(messages.at(-1), ['role', 'content'], 'resident current observation');
  if (
    typeof contract.content !== 'string' ||
    typeof current.content !== 'string' ||
    !current.content.endsWith(RESIDENT_SESSION_RESPONSE_REMINDER)
  ) {
    throw new Error('strict resident session cannot be converted to native tools');
  }
  contract.content = `${NATIVE_TOOL_INSTRUCTION}${NATIVE_ACTION_METADATA_BEGIN}${stableJson(metadata)}${NATIVE_ACTION_METADATA_END}`;
  current.content =
    current.content.slice(0, -RESIDENT_SESSION_RESPONSE_REMINDER.length) +
    NATIVE_TOOL_RESPONSE_REMINDER;
  return deepFreeze(messages);
}

function nativeMetadataFromMessages(value: readonly unknown[]) {
  if (!Array.isArray(value) || value.length < 3) {
    throw new Error('native-tool resident session message layout is incomplete');
  }
  const contract = exactRecord(value[1], ['role', 'content'], 'native resident action metadata');
  const charter = exactRecord(value[0], ['role', 'content'], 'native resident charter');
  const current = exactRecord(value.at(-1), ['role', 'content'], 'native resident observation');
  if (
    charter.role !== 'system' ||
    typeof charter.content !== 'string' ||
    !charter.content ||
    contract.role !== 'system' ||
    typeof contract.content !== 'string' ||
    !contract.content.startsWith(`${NATIVE_TOOL_INSTRUCTION}${NATIVE_ACTION_METADATA_BEGIN}`) ||
    !contract.content.endsWith(NATIVE_ACTION_METADATA_END) ||
    current.role !== 'user' ||
    typeof current.content !== 'string' ||
    !current.content.endsWith(`\n\n${NATIVE_TOOL_RESPONSE_REMINDER}`)
  ) {
    throw new Error('native-tool resident session message layout differs');
  }
  for (const [index, messageValue] of value.slice(2, -1).entries()) {
    const message = exactRecord(
      messageValue,
      ['role', 'content'],
      `native resident dynamic message ${index}`,
    );
    if (message.role !== 'system' || typeof message.content !== 'string') {
      throw new Error('native resident dynamic context must use bounded system messages');
    }
    if (
      message.content.startsWith('Recent lived action continuity from your own entity loom') ||
      message.content.includes('behold.recent-action-continuity.v1')
    ) {
      throw new Error('native resident session contains superseded full-camera continuity');
    }
    if (
      message.content.includes('Resident working continuity from your own entity loom') &&
      !message.content.includes(`"protocol":"${RESIDENT_WORKING_CONTINUITY_PROTOCOL}"`)
    ) {
      throw new Error('native resident working continuity protocol drifted');
    }
  }
  const json = contract.content.slice(
    NATIVE_TOOL_INSTRUCTION.length + NATIVE_ACTION_METADATA_BEGIN.length,
    contract.content.length - NATIVE_ACTION_METADATA_END.length,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('native resident action metadata is not valid JSON');
  }
  const metadata = parseNativeActionMetadata(parsed);
  if (json !== stableJson(metadata)) {
    throw new Error('native resident action metadata is not exact canonical JSON');
  }
  return metadata;
}

function publicCommitmentSchemas() {
  return {
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
  };
}

function nativeActionContract(value: any) {
  if (
    value.policyProfile !== 'legible-resident-v1' ||
    value.bodyProfile !== 'minecraft-human-semantic-v1' ||
    value.actionProfile !== 'minecraft-human-semantic-v1' ||
    value.safetyProfile !== 'vanilla-player-v1'
  ) {
    throw new Error('native tool resident profiles are not human-semantic v1');
  }
  if (!Array.isArray(value.actions) || value.actions.length < 1) {
    throw new Error('native tool action contract is empty');
  }
  const names = value.actions.map((action: any) => String(action.name || ''));
  if (names.some((name: string) => !name) || new Set(names).size !== names.length) {
    throw new Error('native tool action contract names are invalid');
  }
  if (value.requiredAction !== null && !names.includes(value.requiredAction)) {
    throw new Error('native tool required control is invalid');
  }
  return deepFreeze({
    protocol: NATIVE_ACTION_CONTRACT_PROTOCOL,
    policyProfile: value.policyProfile,
    bodyProfile: value.bodyProfile,
    actionProfile: value.actionProfile,
    safetyProfile: value.safetyProfile,
    actions: cloneJson(value.actions),
    requiredAction: value.requiredAction,
    responseProtocol: NATIVE_ACTION_RESPONSE_PROTOCOL,
  });
}

function nativeActionMetadata(value: any) {
  return deepFreeze({
    protocol: NATIVE_ACTION_METADATA_PROTOCOL,
    policyProfile: value.policyProfile,
    bodyProfile: value.bodyProfile,
    actionProfile: value.actionProfile,
    safetyProfile: value.safetyProfile,
    requiredAction: value.requiredAction,
    responseProtocol: NATIVE_ACTION_RESPONSE_PROTOCOL,
    actionContractSha256: digest(value.actionContractSha256, 'native action contract'),
    toolsSha256: digest(value.toolsSha256, 'native tools'),
  });
}

function parseNativeActionMetadata(value: unknown) {
  const record = exactRecord(
    value,
    [
      'protocol',
      'policyProfile',
      'bodyProfile',
      'actionProfile',
      'safetyProfile',
      'requiredAction',
      'responseProtocol',
      'actionContractSha256',
      'toolsSha256',
    ],
    'native resident action metadata',
  );
  if (
    record.protocol !== NATIVE_ACTION_METADATA_PROTOCOL ||
    record.responseProtocol !== NATIVE_ACTION_RESPONSE_PROTOCOL
  ) {
    throw new Error('native resident action metadata protocol is invalid');
  }
  if (
    record.policyProfile !== 'legible-resident-v1' ||
    record.bodyProfile !== 'minecraft-human-semantic-v1' ||
    record.actionProfile !== 'minecraft-human-semantic-v1' ||
    record.safetyProfile !== 'vanilla-player-v1'
  ) {
    throw new Error('native resident action metadata profiles are invalid');
  }
  if (record.requiredAction !== null && typeof record.requiredAction !== 'string') {
    throw new Error('native resident action metadata required control is invalid');
  }
  return nativeActionMetadata(record);
}

function digest(value: unknown, label: string) {
  const text = String(value || '');
  if (!/^[a-f0-9]{64}$/.test(text)) throw new Error(`${label} must be a SHA-256 digest`);
  return text;
}

function exactRecord(value: unknown, fields: readonly string[], label: string) {
  if (
    !plainRecord(value) ||
    stableJson(Object.keys(value).sort()) !== stableJson([...fields].sort())
  ) {
    throw new Error(`${label} fields do not match the versioned contract`);
  }
  return value;
}

function plainRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value: unknown): any {
  return JSON.parse(JSON.stringify(value));
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

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}
