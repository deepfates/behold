import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const {
  CAPTURE_AWARE_RENDER_LOOP,
  CONTINUOUS_RENDER_LOOP,
  installCaptureDemandRendering,
} = require(path.resolve('scripts/prismarine-viewer-capture-demand.js'));

test('capture-only viewer renders on demand while the public viewer keeps presenting', () => {
  const patched = installCaptureDemandRendering(`before${CONTINUOUS_RENDER_LOOP}after`);
  assert.equal(patched, `before${CAPTURE_AWARE_RENDER_LOOP}after`);

  assert.deepEqual(runLoop(patched.slice('before'.length, -'after'.length), false), {
    animationFrames: 1,
    controlUpdates: 1,
    worldUpdates: 1,
    renders: 1,
  });
  assert.deepEqual(runLoop(patched.slice('before'.length, -'after'.length), true), {
    animationFrames: 0,
    controlUpdates: 0,
    worldUpdates: 0,
    renders: 0,
  });
});

test('capture-demand viewer patch is idempotent and rejects a missing pinned seam', () => {
  const once = installCaptureDemandRendering(CONTINUOUS_RENDER_LOOP);
  assert.equal(installCaptureDemandRendering(once), once);
  assert.throws(
    () => installCaptureDemandRendering('a different viewer bundle'),
    /continuous render loop seam not found/,
  );
});

function runLoop(source: string, captureOnly: boolean) {
  const counts = {
    animationFrames: 0,
    controlUpdates: 0,
    worldUpdates: 0,
    renders: 0,
  };
  const expression = source.endsWith(',') ? source.slice(0, -1) : source;
  vm.runInNewContext(expression, {
    window: {
      __BEHOLD_CAPTURE_TOKEN: captureOnly ? 'private-token' : undefined,
      requestAnimationFrame: () => counts.animationFrames++,
    },
    h: { update: () => counts.controlUpdates++ },
    u: { update: () => counts.worldUpdates++, scene: {}, camera: {} },
    l: { render: () => counts.renders++ },
  });
  return counts;
}
