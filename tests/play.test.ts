import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolvePlayEndpoint } from '../scripts/play';

test('play joins the selected managed world endpoint', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-play-endpoint-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = path.join(root, 'worlds.json');
  fs.writeFileSync(
    config,
    JSON.stringify({
      schemaVersion: 2,
      worlds: {
        home: {
          source: {
            path: path.join(root, 'source'),
            digestProfile: 'behold-tree-v2',
            expectedDigest: '1'.repeat(64),
          },
          preparedBaseline: null,
          runtime: {
            worldPath: path.join(root, 'server', 'world'),
            archiveRoot: path.join(root, 'archive'),
          },
          server: { host: '127.0.0.1', port: 25587 },
        },
      },
    }),
  );

  assert.deepEqual(resolvePlayEndpoint(config, 'home', {}), {
    host: '127.0.0.1',
    port: 25587,
    server: '127.0.0.1:25587',
  });
});

test('explicit native endpoint overrides the world configuration consistently', () => {
  assert.deepEqual(
    resolvePlayEndpoint('/missing.json', 'missing', { NATIVE_MC_SERVER: 'localhost:25591' }),
    {
      host: 'localhost',
      port: 25591,
      server: 'localhost:25591',
    },
  );
  assert.throws(
    () => resolvePlayEndpoint('/missing.json', 'missing', { NATIVE_MC_PORT: '70000' }),
    /Invalid native Minecraft port/,
  );
});
