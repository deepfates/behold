import test from 'node:test';
import assert from 'node:assert/strict';
import { incomingChatPolicySignal } from '../src/tui/console';

test('managed resident chat wakes cognition without impersonating a human resume', () => {
  const managedBodies = new Set(['iris', 'moss']);

  assert.equal(incomingChatPolicySignal('Moss', managedBodies), 'wake');
  assert.equal(incomingChatPolicySignal('mOsS', managedBodies), 'wake');
  assert.equal(incomingChatPolicySignal('importdf', managedBodies), 'resume');
});
