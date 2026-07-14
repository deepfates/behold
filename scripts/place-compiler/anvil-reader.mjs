import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import nbt from 'prismarine-nbt';

export class AnvilWorldReader {
  constructor(worldRoot) {
    this.worldRoot = path.resolve(worldRoot);
    this.regionCache = new Map();
    this.chunkCache = new Map();
  }

  readRegion(rx, rz) {
    const key = `${rx},${rz}`;
    if (this.regionCache.has(key)) return this.regionCache.get(key);
    const file = path.join(this.worldRoot, 'region', `r.${rx}.${rz}.mca`);
    const buffer = existsSync(file) ? readFileSync(file) : null;
    this.regionCache.set(key, buffer);
    return buffer;
  }

  async readChunk(cx, cz) {
    const key = `${cx},${cz}`;
    if (this.chunkCache.has(key)) return this.chunkCache.get(key);
    const region = this.readRegion(Math.floor(cx / 32), Math.floor(cz / 32));
    if (!region) return null;
    const index = (cx & 31) + (cz & 31) * 32;
    const offset = region.readUIntBE(index * 4, 3) * 4096;
    if (!offset) return null;
    const length = region.readUInt32BE(offset);
    const compression = region[offset + 4];
    const payload = region.subarray(offset + 5, offset + 4 + length);
    const raw =
      compression === 2
        ? zlib.inflateSync(payload)
        : compression === 1
          ? zlib.gunzipSync(payload)
          : payload;
    const simplified = nbt.simplify((await nbt.parse(raw)).parsed);
    const sections = simplified.sections ?? simplified.Sections ?? [];
    const chunk = {
      ...simplified,
      sectionsByY: new Map(sections.map((section) => [section.Y, section])),
    };
    this.chunkCache.set(key, chunk);
    return chunk;
  }

  paletteIndex(section, x, y, z) {
    const states = section?.block_states;
    if (!states?.palette?.length || states.palette.length === 1 || !states.data) return 0;
    const bits = Math.max(4, Math.ceil(Math.log2(states.palette.length)));
    const entriesPerLong = Math.floor(64 / bits);
    const blockIndex = ((y & 15) << 8) | ((z & 15) << 4) | (x & 15);
    const longIndex = Math.floor(blockIndex / entriesPerLong);
    const shift = BigInt((blockIndex % entriesPerLong) * bits);
    const mask = (1n << BigInt(bits)) - 1n;
    return Number((BigInt.asUintN(64, states.data[longIndex]) >> shift) & mask);
  }

  async blockAt(x, y, z) {
    const chunk = await this.readChunk(Math.floor(x / 16), Math.floor(z / 16));
    if (!chunk) return null;
    const section = chunk.sectionsByY.get(Math.floor(y / 16));
    if (!section?.block_states?.palette) return null;
    return section.block_states.palette[this.paletteIndex(section, x, y, z)]?.Name ?? null;
  }

  async scanColumn(x, z, { minimumY = -64, maximumY = 511, accept = () => false } = {}) {
    let top = null;
    let accepted = null;
    for (let y = maximumY; y >= minimumY; y -= 1) {
      const name = await this.blockAt(x, y, z);
      if (!name || /^(?:minecraft:)?(?:air|cave_air|void_air|water|lava)$/.test(name)) continue;
      top ??= { y, name };
      if (!accepted && accept(name)) accepted = { y, name };
      if (top && accepted && y < accepted.y - 3) break;
    }
    return { top, accepted };
  }
}
