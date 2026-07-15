import assert from 'node:assert/strict';
import test from 'node:test';
import { parseManagedResidentArgs } from '../scripts/managed-resident-cli';

test('managed proof residents accept the complete launcher process contract', () => {
  const parsed = parseManagedResidentArgs([
    'Resident',
    '--server',
    '127.0.0.1',
    '--port',
    '25565',
    '--world',
    'world:epoch',
    '--body',
    'ResidentBody',
    '--model',
    'provider/model',
    '--urgentModel',
    'provider/urgent',
    '--policyProfile',
    'resident-v1',
    '--actionProfile',
    'minecraft-player-v1',
    '--safetyProfile',
    'vanilla-player-v1',
    '--tickMs',
    '1000',
    '--task',
    'observe',
    '--target',
    'Alex',
    '--allowTools',
    'look,wait',
    '--paused',
  ]);

  assert.deepEqual(parsed.positionals, ['Resident']);
  assert.deepEqual(
    { ...parsed.values },
    {
      server: '127.0.0.1',
      port: '25565',
      world: 'world:epoch',
      body: 'ResidentBody',
      model: 'provider/model',
      urgentModel: 'provider/urgent',
      policyProfile: 'resident-v1',
      actionProfile: 'minecraft-player-v1',
      safetyProfile: 'vanilla-player-v1',
      tickMs: '1000',
      task: 'observe',
      target: 'Alex',
      allowTools: 'look,wait',
      paused: true,
    },
  );
});
