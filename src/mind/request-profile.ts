import { createHash } from 'node:crypto';
import type { ResidentMindRequest } from './interface';
import { directOpenRouterRequestBody, directOpenRouterTools } from './direct-wire';
import { attributeProviderRequestBody } from './request-attribution';

export const RESIDENT_REQUEST_PROFILE_PROTOCOL = 'behold.resident-request-profile.v1' as const;

export function profileDirectResidentRequest(
  request: ResidentMindRequest,
  source: Record<string, unknown> = {},
) {
  const body = directOpenRouterRequestBody(request) as Record<string, unknown>;
  const tools = directOpenRouterTools(request.actions);
  const bodyJson = JSON.stringify(body);
  const attribution = attributeProviderRequestBody(body);
  const { bodyBytes, components } = attribution;
  return {
    protocol: RESIDENT_REQUEST_PROFILE_PROTOCOL,
    generatedAt: new Date().toISOString(),
    source,
    request: {
      model: request.model,
      profiles: {
        policy: request.policyProfile ?? 'legacy-unspecified',
        actions: request.actionProfile ?? 'legacy-unspecified',
        safety: request.safetyProfile ?? 'legacy-unspecified',
      },
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
      messageEntries: attribution.messageEntries.map((entry, index) => ({
        ...entry,
        sha256: sha256(JSON.stringify(request.conversation[index])),
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
      profilesBytes: jsonBytes({
        policy: request.policyProfile ?? null,
        actions: request.actionProfile ?? null,
        safety: request.safetyProfile ?? null,
      }),
    },
    safety: {
      providerCalled: false,
      worldMutationEnabled: false,
      executableFunctionsExposed: false,
    },
  };
}

function jsonBytes(value: unknown) {
  const serialized = JSON.stringify(value);
  if (serialized == null) throw new Error('request value is not JSON-serializable');
  return bytes(serialized);
}

function bytes(value: string) {
  return Buffer.byteLength(value, 'utf8');
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
