const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(process.cwd(), 'node_modules', 'prismarine-viewer');
const viewerVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
if (viewerVersion !== '1.33.0') {
  throw new Error(`Unsupported prismarine-viewer version: ${viewerVersion}`);
}

patch(path.join(root, 'viewer/lib/worldrenderer.js'), [
  [
    '    this.loadedChunks[`${x},${z}`] = true\n',
    '    const bounds = { minY: chunk.minY ?? 0, worldHeight: chunk.worldHeight ?? 256 }\n    this.loadedChunks[`${x},${z}`] = bounds\n',
  ],
  [
    '    for (let y = 0; y < 256; y += 16) {\n',
    '    for (let y = bounds.minY; y < bounds.minY + bounds.worldHeight; y += 16) {\n',
  ],
  [
    '  removeColumn (x, z) {\n    delete this.loadedChunks[`${x},${z}`]\n',
    '  removeColumn (x, z) {\n    const bounds = this.loadedChunks[`${x},${z}`] ?? { minY: 0, worldHeight: 256 }\n    delete this.loadedChunks[`${x},${z}`]\n',
  ],
  [
    '    for (let y = 0; y < 256; y += 16) {\n',
    '    for (let y = bounds.minY; y < bounds.minY + bounds.worldHeight; y += 16) {\n',
  ],
  [
    '    for (let y = 0; y < 256; y += 16) {\n      this.setSectionDirty(new Vec3(x, y, z), false)',
    '    for (let y = bounds.minY; y < bounds.minY + bounds.worldHeight; y += 16) {\n      this.setSectionDirty(new Vec3(x, y, z), false)',
  ],
  [
    '    const bounds = { minY: chunk.minY ?? 0, worldHeight: chunk.worldHeight ?? 256 }\n    this.loadedChunks[`${x},${z}`] = bounds',
    "    const chunkData = typeof chunk === 'string' ? JSON.parse(chunk) : chunk\n    const bounds = { minY: chunkData.minY ?? 0, worldHeight: chunkData.worldHeight ?? 256, sectionYs: [] }\n    bounds.sectionYs = (chunkData.sections ?? []).flatMap((section, index) => {\n      if (!section) return []\n      try {\n        return JSON.parse(section).solidBlockCount > 0 ? [bounds.minY + index * 16] : []\n      } catch {\n        return [bounds.minY + index * 16]\n      }\n    })\n    this.loadedChunks[`${x},${z}`] = bounds",
  ],
  [
    '    for (let y = bounds.minY; y < bounds.minY + bounds.worldHeight; y += 16) {\n      const loc = new Vec3(x, y, z)',
    '    for (const y of bounds.sectionYs) {\n      const loc = new Vec3(x, y, z)',
  ],
  [
    '    for (let y = bounds.minY; y < bounds.minY + bounds.worldHeight; y += 16) {\n      this.setSectionDirty(new Vec3(x, y, z), false)',
    '    for (const y of bounds.sectionYs ?? Array.from({ length: bounds.worldHeight / 16 }, (_, index) => bounds.minY + index * 16)) {\n      this.setSectionDirty(new Vec3(x, y, z), false)',
  ],
]);

patch(path.join(root, 'viewer/lib/worker.js'), [
  [
    'chunk && chunk.sections[Math.floor(y / 16)]',
    'chunk && chunk.getSectionAtIndex(Math.floor(y / 16))',
  ],
  [
    'chunk && chunk.sections[Math.floor(y / 16)]',
    'chunk && chunk.getSectionAtIndex(Math.floor(y / 16))',
  ],
  [
    'if (chunk && chunk.sections[Math.floor(y / 16)]) {\n      delete dirtySections[key]',
    'if (chunk && chunk.getSectionAtIndex(Math.floor(y / 16))) {\n      delete dirtySections[key]',
  ],
]);

// Modern Java worlds extend below Y=0. Prismarine Viewer's renderer otherwise
// suppresses every culled face there, producing zero-vertex terrain meshes.
patch(path.join(root, 'viewer/lib/models.js'), [
  [
    '    if (neighbor.position.y < 0) continue\n',
    '    // Negative Y is ordinary visible terrain in modern world-height chunks.\n',
  ],
  [
    '      if (neighbor.position.y < 0) continue\n',
    '      // Negative Y is ordinary visible terrain in modern world-height chunks.\n',
  ],
]);

// Player-name sprites inherit the entity model's internal scale and become
// enormous billboards in first-person view. The cockpit already renders nearby
// players as useful, clickable HUD chips, so suppress the broken duplicate.
patch(path.join(root, 'viewer/lib/entities.js'), [
  [
    '      if (entity.username !== undefined) {',
    '      if (false && entity.username !== undefined) {',
  ],
]);

// Prismarine Viewer otherwise reveals its square chunk boundary as a bright
// void. Match the server's eight-chunk radius with a Minecraft-style horizon.
patch(path.join(root, 'viewer/lib/viewer.js'), [
  [
    "    this.scene.background = new THREE.Color('lightblue')\n",
    "    this.scene.background = new THREE.Color('lightblue')\n    this.scene.fog = new THREE.Fog(new THREE.Color('lightblue'), 96, 128)\n",
  ],
]);

patch(path.join(root, 'public/index.js'), [
  [
    'o=i(8007)({path:window.location.pathname+"socket.io"});',
    'o=i(8007)({path:window.location.pathname+"socket.io",auth:{beholdCaptureToken:window.__BEHOLD_CAPTURE_TOKEN||null}});',
  ],
  [
    'const u=new r(l);',
    'const u=new r(l);o.on("behold_capture_frame",(async t=>{try{const e=t.camera;u.camera.position.set(e.position.x,e.position.y,e.position.z),u.camera.rotation.set(e.pitch,e.yaw,0,"ZYX"),await u.waitForChunksToRender(),u.update(),l.render(u.scene,u.camera),o.emit("behold_capture_frame_ready",{id:t.id,camera:e,data:l.domElement.toDataURL("image/jpeg",.9)})}catch(e){o.emit("behold_capture_frame_ready",{id:t.id,error:String(e&&e.message||e)})}}));',
  ],
  [
    's=!0,u.listen(o),o.on("position",',
    's=!0,u.listen(o),window.__BEHOLD_CAPTURE_TOKEN&&o.emit("behold_capture_ready"),o.on("position",',
  ],
  [
    'addColumn(t,e,i){this.loadedChunks[`${t},${e}`]=!0;',
    'addColumn(t,e,i){const s=i.minY??0,o=i.worldHeight??256;this.loadedChunks[`${t},${e}`]={minY:s,worldHeight:o};',
  ],
  ['for(let i=0;i<256;i+=16)', 'for(let i=s;i<s+o;i+=16)'],
  [
    'removeColumn(t,e){delete this.loadedChunks[`${t},${e}`];',
    'removeColumn(t,e){const s=this.loadedChunks[`${t},${e}`]||{minY:0,worldHeight:256};delete this.loadedChunks[`${t},${e}`];',
  ],
  ['for(let i=0;i<256;i+=16)', 'for(let i=s.minY;i<s.minY+s.worldHeight;i+=16)'],
  ['if(void 0!==t.username){const e=s(500,100)', 'if(!1&&void 0!==t.username){const e=s(500,100)'],
  [
    'this.scene.background=new n.Color("lightblue"),this.ambientLight=',
    'this.scene.background=new n.Color("lightblue"),this.scene.fog=new n.Fog(new n.Color("lightblue"),96,128),this.ambientLight=',
  ],
  [
    'addColumn(t,e,i){const s=i.minY??0,o=i.worldHeight??256;this.loadedChunks[`${t},${e}`]={minY:s,worldHeight:o};',
    'addColumn(t,e,i){const a="string"==typeof i?JSON.parse(i):i,s=a.minY??0,o=a.worldHeight??256,h=(a.sections||[]).flatMap(((t,e)=>!t||0===JSON.parse(t).solidBlockCount?[]:[s+16*e]));this.loadedChunks[`${t},${e}`]={minY:s,worldHeight:o,sectionYs:h};',
  ],
  ['for(let i=s;i<s+o;i+=16){const n=new r(t,i,e);', 'for(const i of h){const n=new r(t,i,e);'],
  [
    'for(let i=s.minY;i<s.minY+s.worldHeight;i+=16){this.setSectionDirty(new r(t,i,e),!1);',
    'for(const i of s.sectionYs||Array.from({length:s.worldHeight/16},((t,e)=>s.minY+16*e))){this.setSectionDirty(new r(t,i,e),!1);',
  ],
]);

patch(path.join(root, 'public/worker.js'), [
  ['i&&i.sections[Math.floor(a/16)]', 'i&&i.getSectionAtIndex(Math.floor(a/16))'],
  ['l&&l.sections[Math.floor(n/16)]', 'l&&l.getSectionAtIndex(Math.floor(n/16))'],
  ['if(g.position.y<0)continue;', 'if(!1&&g.position.y<0)continue;'],
  ['if(n.position.y<0)continue', 'if(!1&&n.position.y<0)continue'],
]);

assertContains(path.join(root, 'public/index.js'), [
  'beholdCaptureToken',
  'behold_capture_frame',
  'behold_capture_ready',
]);

console.log('[viewer:patch] World-height rendering and cockpit-friendly entities enabled.');

function patch(file, replacements) {
  let source = fs.readFileSync(file, 'utf8');
  let changed = false;

  for (const [before, after] of replacements) {
    if (source.includes(after)) continue;
    const index = source.indexOf(before);
    // A later replacement in the same pinned file can subsume an earlier one;
    // this makes the patch safe to re-run without weakening the version gate.
    if (index === -1) continue;
    source = source.slice(0, index) + after + source.slice(index + before.length);
    changed = true;
  }

  if (changed) fs.writeFileSync(file, source);
}

function assertContains(file, markers) {
  const source = fs.readFileSync(file, 'utf8');
  for (const marker of markers) {
    if (!source.includes(marker)) {
      throw new Error(`Prismarine Viewer patch did not install required marker ${marker}`);
    }
  }
}
