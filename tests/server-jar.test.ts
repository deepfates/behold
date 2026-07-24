import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ensureServerJar } from '../scripts/server-jar';

test('server jar setup downloads, verifies, and then reuses the pinned artifact', async (t) => {
  const fixture = makeFixture(t, Buffer.from('pinned server jar'));
  let fetches = 0;
  const fetch = async () => {
    fetches += 1;
    return response(fixture.bytes);
  };

  const installed = await ensureServerJar({ repository: fixture.root, fetch });
  assert.equal(installed.downloaded, true);
  assert.deepEqual(fs.readFileSync(fixture.destination), fixture.bytes);

  const verified = await ensureServerJar({
    repository: fixture.root,
    fetch: async () => assert.fail('a valid local jar must not fetch'),
  });
  assert.equal(verified.downloaded, false);
  assert.equal(fetches, 1);
});

test('server jar setup refuses to replace an existing mismatched file', async (t) => {
  const fixture = makeFixture(t, Buffer.from('pinned server jar'));
  fs.mkdirSync(path.dirname(fixture.destination), { recursive: true });
  fs.writeFileSync(fixture.destination, 'local jar that must survive');

  await assert.rejects(
    ensureServerJar({
      repository: fixture.root,
      fetch: async () => assert.fail('an existing jar must not fetch'),
    }),
    /does not match the tool lock/,
  );
  assert.equal(fs.readFileSync(fixture.destination, 'utf8'), 'local jar that must survive');
});

test('server jar setup leaves no artifact when the download fails verification', async (t) => {
  const fixture = makeFixture(t, Buffer.from('pinned server jar'));

  await assert.rejects(
    ensureServerJar({
      repository: fixture.root,
      fetch: async () => response(Buffer.from('wrong')),
    }),
    /does not match the tool lock/,
  );
  assert.equal(fs.existsSync(fixture.destination), false);
  assert.deepEqual(fs.readdirSync(path.dirname(fixture.destination)), []);
});

test('check-only reports an absent jar without downloading', async (t) => {
  const fixture = makeFixture(t, Buffer.from('pinned server jar'));
  await assert.rejects(
    ensureServerJar({
      repository: fixture.root,
      checkOnly: true,
      fetch: async () => assert.fail('check-only must not fetch'),
    }),
    /is absent/,
  );
});

function makeFixture(t: test.TestContext, bytes: Buffer) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'behold-server-jar-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const relative = '.behold-runtime/server/server.jar';
  const toolLock = {
    tools: {
      minecraftServer: {
        version: 'test',
        downloadUrl: 'https://example.invalid/server.jar',
        path: relative,
        sizeBytes: bytes.length,
        sha1: createHash('sha1').update(bytes).digest('hex'),
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    },
  };
  fs.mkdirSync(path.join(root, 'docs/sf-world'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/sf-world/tool-lock.json'), JSON.stringify(toolLock));
  return { root, bytes, destination: path.join(root, relative) };
}

function response(bytes: Buffer) {
  return {
    ok: true,
    status: 200,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}
