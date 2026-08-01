import type { ResidentMindRequest } from './interface';
import { createNativeToolResidentSessionEnvelope } from './direct-native-tools';
import { createStrictLocalResidentSessionEnvelope } from './ollama-json-action';
import { openRouterWirePolicy, type OpenRouterRoutePolicy } from './openrouter-route';

export function directOpenRouterTools(actions: ResidentMindRequest['actions']) {
  return actions.map((action) => ({
    type: 'function' as const,
    function: {
      name: action.name,
      ...(action.description == null ? {} : { description: action.description }),
      parameters: action.inputSchema,
    },
  }));
}

export function directOpenRouterRequestBody(
  request: ResidentMindRequest,
  routePolicy?: OpenRouterRoutePolicy | null,
) {
  if (request.policyProfile === 'resident-v2' || request.policyProfile === 'legible-resident-v1') {
    if (request.perception) {
      throw new Error('OpenRouter resident routes do not yet admit camera perception');
    }
    if (
      request.policyProfile === 'legible-resident-v1' &&
      routePolicy?.protocol === 'behold.openrouter-route-policy.v3'
    ) {
      const envelope = createNativeToolResidentSessionEnvelope(request);
      return {
        model: request.model,
        messages: envelope.messages,
        tools: envelope.tools,
        tool_choice: request.requiredAction
          ? { type: 'function' as const, function: { name: request.requiredAction } }
          : ('required' as const),
        parallel_tool_calls: false as const,
        reasoning: { effort: routePolicy.reasoningEffort, exclude: true as const },
        ...(request.model.includes('gpt-5') ? {} : { temperature: 0.2 }),
        stream: false as const,
        ...openRouterWirePolicy(routePolicy),
      };
    }
    const envelope = createStrictLocalResidentSessionEnvelope(request);
    return {
      model: request.model,
      messages: envelope.messages,
      response_format: {
        type: 'json_schema' as const,
        json_schema: {
          name:
            request.policyProfile === 'resident-v2'
              ? 'behold_resident_action_v1'
              : 'behold_resident_action_v2',
          strict: true as const,
          schema: envelope.responseSchema,
        },
      },
      reasoning: { effort: 'minimal' as const, exclude: true as const },
      ...(request.model.includes('gpt-5') ? {} : { temperature: 0.2 }),
      stream: false as const,
      ...(routePolicy ? openRouterWirePolicy(routePolicy) : {}),
    };
  }
  return {
    model: request.model,
    messages: request.conversation,
    tools: directOpenRouterTools(request.actions),
    ...(request.requiredAction
      ? { tool_choice: { type: 'function', function: { name: request.requiredAction } } }
      : {}),
    parallel_tool_calls: false,
    ...(request.model.includes('gpt-5') ? {} : { temperature: 0.2 }),
    ...(routePolicy ? openRouterWirePolicy(routePolicy) : {}),
  };
}
