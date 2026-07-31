---
id: beh-jygo
status: closed
deps: []
links: []
created: 2026-07-31T02:09:45Z
type: feature
priority: 0
assignee: deepfates
parent: beh-cqjs
tags: [cognition, provider, behavior]
---

# Admit exact native-tool resident decisions

OpenAI-class provider models that have previously produced physical Minecraft consequences cannot use Behold's current legible resident response_format because its top-level oneOf is rejected. Add the smallest explicit provider-native tool-call transport that preserves the same public commitment and exact admitted action contract. This is a product adapter, not a permissive fallback or evidence framework.

## Acceptance Criteria

A pinned OpenRouter route can request exactly one native tool call from an OpenAI-class resident model; every available tool corresponds to one currently admitted resident action and carries bounded public intention, expected observable consequence, and that action's unchanged validated arguments; multiple calls, prose-only output, undeclared fields, route/model/provider drift, or malformed arguments fail before world intent with no repair or retry. Existing strict response-schema and local paths remain unchanged. Provider-free tests cover exact request/parse/rejection/identity behavior, and one bounded no-world real request passes before an ordinary behold live attempt.

## Notes

**2026-07-31T02:23:12Z**

Implemented explicit OpenRouter route v3 native_tools transport at 15fd329/34547e8/8f0b951. Full check passed before the two runtime compatibility fixes; focused broker/direct suites pass after them. Live endpoint gate on one retained ordinary Minecraft request passed in 1.369s: openai/gpt-5.6-luna via OpenAI chose one valid grounded chat call, no retry/repair, 4,344 tokens, /bin/zsh.00008628. A prior successful raw shape inspection cost /bin/zsh.00009168; the initial 404 was pre-generation. OpenAI indexed tool calls are admitted only at index 0. Native provider strict:true remains deliberately off because current Behold action schemas contain legitimate optional properties that OpenAI strict mode requires to be required/nullable; Behold validates the unchanged exact schemas before decision representation and again before world intent.
