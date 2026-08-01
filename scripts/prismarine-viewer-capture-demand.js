const CONTINUOUS_RENDER_LOOP =
  '!function t(){window.requestAnimationFrame(t),h&&h.update(),u.update(),l.render(u.scene,u.camera)}(),';
const CAPTURE_AWARE_RENDER_LOOP =
  'window.__BEHOLD_CAPTURE_TOKEN||function t(){window.requestAnimationFrame(t),h&&h.update(),u.update(),l.render(u.scene,u.camera)}(),';

function installCaptureDemandRendering(source) {
  if (source.includes(CAPTURE_AWARE_RENDER_LOOP)) return source;
  if (!source.includes(CONTINUOUS_RENDER_LOOP)) {
    throw new Error('Prismarine Viewer continuous render loop seam not found');
  }
  return source.replace(CONTINUOUS_RENDER_LOOP, CAPTURE_AWARE_RENDER_LOOP);
}

module.exports = {
  CAPTURE_AWARE_RENDER_LOOP,
  CONTINUOUS_RENDER_LOOP,
  installCaptureDemandRendering,
};
