import type { ResidentMindRequest } from './interface';
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
