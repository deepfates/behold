import { DEFAULT_LLM_MODEL } from '../src/config';

export const DEFAULT_RESIDENT_MODEL = DEFAULT_LLM_MODEL;

export const RESIDENT_MODEL_SELECTION = Object.freeze({
  protocol: 'behold.population-model-selection.v1',
  selected: DEFAULT_RESIDENT_MODEL,
  selectedAt: '2026-07-14T03:30:00-07:00',
  catalog: 'https://openrouter.ai/api/v1/models',
  workload: 'exact initial ground-search request from failed two-axis population proof v7',
  trialsPerCandidate: 3,
  criteria: [
    'uses the orthogonal orientation affordance',
    'full embodied proof behavior',
    'latency',
    'provider-reported cost',
  ],
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
