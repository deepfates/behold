import { createHash } from 'node:crypto';
import type { ResidentMindRequest } from './interface';
import { directOpenRouterRequestBody, directOpenRouterTools } from './direct-wire';

export const RESIDENT_REQUEST_PROFILE_PROTOCOL = 'behold.resident-request-profile.v1' as const;

type RequestComponentBytes = {
  systemMessages: number;
  latestUserMessage: number;
  priorUserMessages: number;
  assistantHistory: number;
  toolResultHistory: number;
  otherMessages: number;
  toolDefinitions: number;
  otherRequestValues: number;
  structural: number;
};

export function profileDirectResidentRequest(
  request: ResidentMindRequest,
  source: Record<string, unknown> = {},
) {
  const body = directOpenRouterRequestBody(request) as Record<string, unknown>;
  const tools = directOpenRouterTools(request.actions);
  const bodyJson = JSON.stringify(body);
  const components = requestComponentBytes(body);
  const componentTotal = sum(Object.values(components));
  const bodyBytes = bytes(bodyJson);
  if (componentTotal !== bodyBytes) {
    throw new Error(`request byte attribution mismatch: ${componentTotal} != ${bodyBytes}`);
  }
  return {
    protocol: RESIDENT_REQUEST_PROFILE_PROTOCOL,
    generatedAt: new Date().toISOString(),
    source,
    request: {
      model: request.model,
      bodyBytes,
      bodySha256: sha256(bodyJson),
      messageCount: request.conversation.length,
      actionCount: request.actions.length,
      actionNames: request.actions.map((action) => action.name),
      requiredAction: request.requiredAction,
      attention: request.attention ?? null,
      exactBytePartition: true,
      components,
      fractions: Object.fromEntries(
        Object.entries(components).map(([key, value]) => [
          key,
          bodyBytes === 0 ? 0 : value / bodyBytes,
        ]),
      ),
      messageEntries: request.conversation.map((message: any, index) => ({
        index,
        role: String(message?.role || 'unknown'),
        bytes: jsonBytes(message),
        sha256: sha256(JSON.stringify(message)),
      })),
      actionEntries: request.actions
        .map((action, index) => ({
          name: action.name,
          definitionBytes: jsonBytes(tools[index]),
          descriptionBytes: jsonBytes(action.description ?? null),
          schemaBytes: jsonBytes(action.inputSchema),
        }))
        .sort((left, right) => right.definitionBytes - left.definitionBytes),
    },
    mindContract: {
      observationBytes: jsonBytes(request.observation),
      conversationBytes: jsonBytes(request.conversation),
      admittedActionsBytes: jsonBytes(request.actions),
      requiredActionBytes: jsonBytes(request.requiredAction),
      attentionBytes: jsonBytes(request.attention ?? null),
    },
    safety: {
      providerCalled: false,
      worldMutationEnabled: false,
      executableFunctionsExposed: false,
    },
  };
}

function requestComponentBytes(body: Record<string, unknown>): RequestComponentBytes {
  if (!Array.isArray(body.messages)) throw new Error('request body has no messages array');
  const entries = Object.entries(body);
  const bodyBytes = jsonBytes(body);
  const topLevelValueBytes = sum(entries.map(([, value]) => jsonBytes(value)));
  const topLevelStructuralBytes = bodyBytes - topLevelValueBytes;
  const messages = body.messages as any[];
  const messageBytes = messages.map((message) => jsonBytes(message));
  const messageStructuralBytes = jsonBytes(messages) - sum(messageBytes);
  if (topLevelStructuralBytes < 0 || messageStructuralBytes < 0) {
    throw new Error('request byte attribution underflow');
  }
  let latestUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      latestUserIndex = index;
      break;
    }
  }
  const components: RequestComponentBytes = {
    systemMessages: 0,
    latestUserMessage: 0,
    priorUserMessages: 0,
    assistantHistory: 0,
    toolResultHistory: 0,
    otherMessages: 0,
    toolDefinitions: Object.hasOwn(body, 'tools') ? jsonBytes(body.tools) : 0,
    otherRequestValues: entries
      .filter(([key]) => key !== 'messages' && key !== 'tools')
      .reduce((total, [, value]) => total + jsonBytes(value), 0),
    structural: topLevelStructuralBytes + messageStructuralBytes,
  };
  messages.forEach((message, index) => {
    const value = messageBytes[index];
    if (message?.role === 'system') components.systemMessages += value;
    else if (message?.role === 'user' && index === latestUserIndex) {
      components.latestUserMessage += value;
    } else if (message?.role === 'user') components.priorUserMessages += value;
    else if (message?.role === 'assistant') components.assistantHistory += value;
    else if (message?.role === 'tool') components.toolResultHistory += value;
    else components.otherMessages += value;
  });
  return components;
}

function jsonBytes(value: unknown) {
  const serialized = JSON.stringify(value);
  if (serialized == null) throw new Error('request value is not JSON-serializable');
  return bytes(serialized);
}

function bytes(value: string) {
  return Buffer.byteLength(value, 'utf8');
}

function sum(values: readonly number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
