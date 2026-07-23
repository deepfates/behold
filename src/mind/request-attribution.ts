export const REQUEST_BYTE_ATTRIBUTION_PROTOCOL = 'behold.request-byte-attribution.v1' as const;

export type RequestComponentBytes = {
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

export type RequestByteAttribution = {
  protocol: typeof REQUEST_BYTE_ATTRIBUTION_PROTOCOL;
  exactBytePartition: true;
  bodyBytes: number;
  components: RequestComponentBytes;
  messageEntries: Array<{ index: number; role: string; bytes: number }>;
  toolDefinitionEntries: Array<{ index: number; name: string; bytes: number }>;
};

/** Exact, content-free UTF-8 attribution for an OpenAI-compatible request body. */
export function attributeProviderRequestBody(
  body: Record<string, unknown>,
): RequestByteAttribution {
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
  if (sum(Object.values(components)) !== bodyBytes) {
    throw new Error('request byte attribution does not exactly partition the provider body');
  }
  const tools = Array.isArray(body.tools) ? body.tools : [];
  return {
    protocol: REQUEST_BYTE_ATTRIBUTION_PROTOCOL,
    exactBytePartition: true,
    bodyBytes,
    components,
    messageEntries: messages.map((message, index) => ({
      index,
      role: String(message?.role || 'unknown'),
      bytes: messageBytes[index],
    })),
    toolDefinitionEntries: tools
      .map((tool: any, index) => ({
        index,
        name: String(tool?.function?.name || 'unknown'),
        bytes: jsonBytes(tool),
      }))
      .sort((left, right) => right.bytes - left.bytes),
  };
}

function jsonBytes(value: unknown) {
  const serialized = JSON.stringify(value);
  if (serialized == null) throw new Error('request value is not JSON-serializable');
  return Buffer.byteLength(serialized, 'utf8');
}

function sum(values: readonly number[]) {
  return values.reduce((total, value) => total + value, 0);
}
