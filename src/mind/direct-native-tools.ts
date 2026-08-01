import { createHash } from 'node:crypto';
import type { ModelCallEvidence } from './evidence';
import type { ResidentMindDecision, ResidentMindRequest } from './interface';
import {
  assertStrictLocalResidentSessionEnvelope,
  createStrictLocalResidentSessionEnvelope,
  RESIDENT_SESSION_RESPONSE_REMINDER,
  V2_CONTRACT_INSTRUCTION,
} from './ollama-json-action';
import {
  RESIDENT_PUBLIC_ACTION_COMMITMENT_MAX_CHARS,
  RESIDENT_PUBLIC_ACTION_COMMITMENT_PROTOCOL,
  renderResidentPublicActionCommitment,
  residentPublicActionCommitment,
} from './public-commitment';
import { validateResidentActionInput } from './schema';

export const OPENROUTER_NATIVE_TOOL_RESIDENT_SESSION_PROTOCOL =
  'behold.openrouter-native-tool-resident-session.v1' as const;

const NATIVE_TOOL_INSTRUCTION =
  'Choose exactly one supplied bodily control by calling exactly one supplied function. Its presence authorizes an attempt but does not promise that world preconditions hold or that it will succeed. Put the two short public commitments and the unchanged action arguments inside that call. Do not add prose, corrections, or multiple candidates.\n';
const NATIVE_TOOL_RESPONSE_REMINDER =
  "Respond now with exactly one supplied function call. Publish a short intention and expected observable consequence inside it, then supply that action's arguments. Do not repeat the contract or add prose.";

export function createNativeToolResidentSessionEnvelope(request: ResidentMindRequest) {
  const strict = createStrictLocalResidentSessionEnvelope(request);
  const tools = toolsFromStrictSchema(strict.responseSchema);
  const messages = nativeMessagesFromStrict(strict.messages);
  return deepFreeze({
    protocol: OPENROUTER_NATIVE_TOOL_RESIDENT_SESSION_PROTOCOL,
    messages,
    tools,
    messageLayoutProtocol: strict.messageLayoutProtocol,
    workingContinuityProtocol: strict.workingContinuityProtocol,
    actionContractSha256: strict.actionContractSha256,
    toolsSha256: sha256(stableJson(tools)),
    stablePrefixSha256: sha256(stableJson(messages.slice(0, 2))),
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
  const strictMessages = strictMessagesFromNative(messagesValue);
  const strictSchema = strictSchemaFromTools(toolsValue);
  const identity = assertStrictLocalResidentSessionEnvelope(strictMessages, strictSchema);
  const selectedNames = toolsValue.map((tool, index) => nativeTool(tool, index).function.name);
  if (toolChoiceValue !== 'required') {
    const choice = exactRecord(toolChoiceValue, ['type', 'function'], 'native tool choice');
    const fn = exactRecord(choice.function, ['name'], 'native tool choice function');
    if (
      choice.type !== 'function' ||
      typeof fn.name !== 'string' ||
      selectedNames.length !== 1 ||
      selectedNames[0] !== fn.name
    ) {
      throw new Error('native tool choice does not select the sole required action');
    }
  }
  return deepFreeze({
    protocol: OPENROUTER_NATIVE_TOOL_RESIDENT_SESSION_PROTOCOL,
    ...identity,
    toolsSha256: sha256(stableJson(toolsValue)),
    stablePrefixSha256: sha256(stableJson(messagesValue.slice(0, 2))),
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

function toolsFromStrictSchema(value: unknown) {
  const schema = exactRecord(value, ['oneOf'], 'strict resident response schema');
  if (!Array.isArray(schema.oneOf) || schema.oneOf.length < 1) {
    throw new Error('strict resident response schema has no action variants');
  }
  return schema.oneOf.map((value: unknown, index: number) => {
    const variant = exactRecord(
      value,
      plainRecord(value) && Object.hasOwn(value, 'description')
        ? ['description', 'type', 'properties', 'required', 'additionalProperties']
        : ['type', 'properties', 'required', 'additionalProperties'],
      `strict resident action variant ${index}`,
    );
    const properties = exactRecord(
      variant.properties,
      ['intention', 'expectedObservableConsequence', 'action', 'arguments'],
      `strict resident action properties ${index}`,
    );
    const action = exactRecord(properties.action, ['const'], `strict resident action ${index}`);
    if (typeof action.const !== 'string' || !action.const) {
      throw new Error(`strict resident action ${index} has no name`);
    }
    return deepFreeze({
      type: 'function' as const,
      function: {
        name: action.const,
        ...(variant.description == null ? {} : { description: variant.description }),
        parameters: {
          type: 'object',
          properties: {
            intention: cloneJson(properties.intention),
            expectedObservableConsequence: cloneJson(properties.expectedObservableConsequence),
            arguments: cloneJson(properties.arguments),
          },
          required: ['intention', 'expectedObservableConsequence', 'arguments'],
          additionalProperties: false,
        },
      },
    });
  });
}

function strictSchemaFromTools(value: unknown[]) {
  return {
    oneOf: value.map((item, index) => {
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
      return {
        ...(tool.function.description == null ? {} : { description: tool.function.description }),
        type: 'object',
        properties: {
          intention: cloneJson(properties.intention),
          expectedObservableConsequence: cloneJson(properties.expectedObservableConsequence),
          action: { const: tool.function.name },
          arguments: cloneJson(properties.arguments),
        },
        required: ['intention', 'expectedObservableConsequence', 'action', 'arguments'],
        additionalProperties: false,
      };
    }),
  };
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
  return { type: 'function' as const, function: fn };
}

function nativeMessagesFromStrict(value: readonly unknown[]) {
  const messages = cloneJson(value) as any[];
  const contract = exactRecord(messages[1], ['role', 'content'], 'resident action contract');
  const current = exactRecord(messages.at(-1), ['role', 'content'], 'resident current observation');
  if (
    typeof contract.content !== 'string' ||
    !contract.content.startsWith(V2_CONTRACT_INSTRUCTION) ||
    typeof current.content !== 'string' ||
    !current.content.endsWith(RESIDENT_SESSION_RESPONSE_REMINDER)
  ) {
    throw new Error('strict resident session cannot be converted to native tools');
  }
  contract.content =
    NATIVE_TOOL_INSTRUCTION + contract.content.slice(V2_CONTRACT_INSTRUCTION.length);
  current.content =
    current.content.slice(0, -RESIDENT_SESSION_RESPONSE_REMINDER.length) +
    NATIVE_TOOL_RESPONSE_REMINDER;
  return deepFreeze(messages);
}

function strictMessagesFromNative(value: readonly unknown[]) {
  const messages = cloneJson(value) as any[];
  const contract = exactRecord(messages[1], ['role', 'content'], 'native resident action contract');
  const current = exactRecord(messages.at(-1), ['role', 'content'], 'native resident observation');
  if (
    typeof contract.content !== 'string' ||
    !contract.content.startsWith(NATIVE_TOOL_INSTRUCTION) ||
    typeof current.content !== 'string' ||
    !current.content.endsWith(NATIVE_TOOL_RESPONSE_REMINDER)
  ) {
    throw new Error('native-tool resident session message layout differs');
  }
  contract.content =
    V2_CONTRACT_INSTRUCTION + contract.content.slice(NATIVE_TOOL_INSTRUCTION.length);
  current.content =
    current.content.slice(0, -NATIVE_TOOL_RESPONSE_REMINDER.length) +
    RESIDENT_SESSION_RESPONSE_REMINDER;
  return messages;
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
