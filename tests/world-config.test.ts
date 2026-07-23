import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  initializeLocalWorldLabConfig,
  loadWorldLabConfig,
  resolveWorldLabConfigPath,
} from '../scripts/world-lab';

test('world config resolution is explicit, then environment, then ignored local default', () => {
  const cwd = '/workspace/behold';
  assert.equal(
    resolveWorldLabConfigPath({ explicit: 'chosen.json', env: { BEHOLD_WORLD_CONFIG: 'env.json' }, cwd }),
    '/workspace/behold/chosen.json',
  );
  assert.equal(
    resolveWorldLabConfigPath({ env: { BEHOLD_WORLD_CONFIG: 'env.json' }, cwd }),
    '/workspace/behold/env.json',
  );
  assert.equal(resolveWorldLabConfigPath({ env: {}, cwd }), '/workspace/behold/behold-worlds.json');
});

test('world init copies the tracked portable example once and never overwrites local state', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-world-config-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const example = path.join(root, '.behold-worlds.example.json');
  fs.copyFileSync(path.resolve('.behold-worlds.example.json'), example);

  const initialized = initializeLocalWorldLabConfig(root);
  assert.equal(initialized.target, path.join(root, 'behold-worlds.json'));
  assert.doesNotThrow(() => loadWorldLabConfig(initialized.target));
  fs.writeFileSync(initialized.target, 'local-state-must-survive');
  assert.throws(
    () => initializeLocalWorldLabConfig(root),
    (error: any) => error?.code === 'local_config_exists',
  );
  assert.equal(fs.readFileSync(initialized.target, 'utf8'), 'local-state-must-survive');
});
