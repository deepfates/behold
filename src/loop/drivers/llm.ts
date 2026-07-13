import type { Intent } from '../arbiter';

export interface LLMClient {
  complete(input: {
    system: string;
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
    tools: Array<{ name: string; description: string; parameters: any }>;
    maxTokens?: number;
  }): Promise<
    | { type: 'text'; content: string }
    | { type: 'tool_call'; name: string; arguments: any }
    | { type: 'wait' }
  >;
}

export function mapOutputToIntent(out: any): Intent | null {
  if (!out) return null;
  if (out.type === 'wait') return null;
  if (out.type === 'text') {
    return {
      id: `llm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      source: 'llm',
      tool: 'chat',
      input: { text: String(out.content).slice(0, 200) },
    };
  }
  if (out.type === 'tool_call' && typeof out.name === 'string') {
    return {
      id: `llm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      source: 'llm',
      tool: out.name,
      input: out.arguments,
    };
  }
  return null;
}
