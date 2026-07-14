export const DEFAULT_RESIDENT_MODEL = 'openai/gpt-5.6-luna';

export const RESIDENT_MODEL_SELECTION = Object.freeze({
  protocol: 'behold.population-model-selection.v1',
  selected: DEFAULT_RESIDENT_MODEL,
  selectedAt: '2026-07-13T19:00:00-07:00',
  catalog: 'https://openrouter.ai/api/v1/models',
  workload: 'exact CarrotResident restart request from failed population proof v2',
  trialsPerCandidate: 2,
  criteria: ['correct admitted tool', 'latency', 'provider-reported cost'],
  evidence: 'docs/RESIDENT_MODEL_SELECTION.md',
});

export function residentModelSelection(model: string) {
  return model === DEFAULT_RESIDENT_MODEL
    ? RESIDENT_MODEL_SELECTION
    : {
        protocol: 'behold.population-model-selection.v1',
        selected: model,
        selectedAt: new Date().toISOString(),
        mode: 'explicit_operator_override',
      };
}
