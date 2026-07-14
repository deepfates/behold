import type { ResidentMindRequest } from './interface';

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

export function directOpenRouterRequestBody(request: ResidentMindRequest) {
  return {
    model: request.model,
    messages: request.conversation,
    tools: directOpenRouterTools(request.actions),
    tool_choice: request.requiredAction
      ? { type: 'function', function: { name: request.requiredAction } }
      : 'required',
    parallel_tool_calls: false,
    ...(request.model.includes('gpt-5') ? {} : { temperature: 0.2 }),
  };
}
