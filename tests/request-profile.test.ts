import test from 'node:test';
import assert from 'node:assert/strict';
import {
  profileDirectResidentRequest,
  RESIDENT_REQUEST_PROFILE_PROTOCOL,
} from '../src/mind/request-profile';
import type { ResidentMindRequest } from '../src/mind/interface';

test('resident request profile is an exact UTF-8 byte partition with no execution authority', () => {
  const request: ResidentMindRequest = {
    protocol: 'behold.mind-request.v1',
    entityId: 'IrisLife',
    model: 'fixture/model',
    observation: { sequence: 7, scene: { focus: 'café' } },
    conversation: [
      { role: 'system', content: 'Live here.' },
      { role: 'user', content: 'Earlier world experience: café' },
      { role: 'assistant', content: null, tool_calls: [] },
      { role: 'tool', content: '{"ok":true}' },
      { role: 'user', content: 'Current world experience: 🌲' },
    ],
    actions: [
      {
        name: 'look_direction',
        description: 'Turn your body.',
        inputSchema: {
          type: 'object',
          properties: { direction: { type: 'string', enum: ['left', 'right'] } },
          required: ['direction'],
        },
      },
    ],
    requiredAction: null,
    attention: { mode: 'deliberative', context: 'bounded_loom', triggers: [] },
  };

  const profile = profileDirectResidentRequest(request, { journal: '/fixture/run.jsonl' });
  assert.equal(profile.protocol, RESIDENT_REQUEST_PROFILE_PROTOCOL);
  assert.equal(
    Object.values(profile.request.components).reduce((total, value) => total + value, 0),
    profile.request.bodyBytes,
  );
  assert.equal(profile.request.messageCount, 5);
  assert.equal(profile.request.actionCount, 1);
  assert.deepEqual(profile.request.actionNames, ['look_direction']);
  assert.equal(profile.request.actionEntries[0].name, 'look_direction');
  assert.ok(profile.request.actionEntries[0].definitionBytes > 0);
  assert.deepEqual(
    profile.request.messageEntries.map((entry) => entry.role),
    ['system', 'user', 'assistant', 'tool', 'user'],
  );
  assert.ok(profile.request.components.latestUserMessage > '🌲'.length);
  assert.deepEqual(profile.safety, {
    providerCalled: false,
    worldMutationEnabled: false,
    executableFunctionsExposed: false,
  });
});
