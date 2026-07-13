const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(process.cwd(), 'node_modules', 'prismarine-viewer');

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
  ['chunk && chunk.sections[Math.floor(y / 16)]', 'chunk && chunk.getSection(Math.floor(y / 16))'],
  ['chunk && chunk.sections[Math.floor(y / 16)]', 'chunk && chunk.getSection(Math.floor(y / 16))'],
  [
    'if (chunk && chunk.sections[Math.floor(y / 16)]) {\n      delete dirtySections[key]',
    'if (chunk && chunk.getSection(Math.floor(y / 16))) {\n      delete dirtySections[key]',
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
  ['i&&i.sections[Math.floor(a/16)]', 'i&&i.getSection(Math.floor(a/16))'],
  ['l&&l.sections[Math.floor(n/16)]', 'l&&l.getSection(Math.floor(n/16))'],
]);

console.log('[viewer:patch] World-height rendering and cockpit-friendly entities enabled.');

function patch(file, replacements) {
  let source = fs.readFileSync(file, 'utf8');
  let changed = false;

  for (const [before, after] of replacements) {
    if (source.includes(after)) continue;
    const index = source.indexOf(before);
    if (index === -1) {
      throw new Error(`Unsupported prismarine-viewer layout in ${path.relative(root, file)}`);
    }
    source = source.slice(0, index) + after + source.slice(index + before.length);
    changed = true;
  }

  if (changed) fs.writeFileSync(file, source);
}
