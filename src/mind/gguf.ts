import fs from 'node:fs';

const GGUF_MAGIC = Buffer.from('GGUF');
const MAX_METADATA_ENTRIES = 1_000_000;
const MAX_METADATA_KEY_BYTES = 16 * 1024;
const MAX_METADATA_VALUE_BYTES = 64 * 1024 * 1024;
const MAX_METADATA_SCAN_BYTES = 512 * 1024 * 1024;
const READ_BUFFER_BYTES = 1024 * 1024;

const enum GgufValueType {
  Uint8 = 0,
  Int8 = 1,
  Uint16 = 2,
  Int16 = 3,
  Uint32 = 4,
  Int32 = 5,
  Float32 = 6,
  Bool = 7,
  String = 8,
  Array = 9,
  Uint64 = 10,
  Int64 = 11,
  Float64 = 12,
}

/**
 * Reads one exact UTF-8 string value from a GGUF metadata header without
 * interpreting tensors or loading the model file into memory.
 */
export async function readGgufStringMetadataBytes(file: string, wantedKey: string) {
  const handle = await fs.promises.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('GGUF artifact must be a regular file');
    const reader = new BufferedFileReader(handle, stat.size);
    if (!(await reader.bytes(4)).equals(GGUF_MAGIC)) throw new Error('GGUF magic is invalid');
    const version = await reader.uint32();
    if (version !== 2 && version !== 3) throw new Error(`GGUF version ${version} is unsupported`);
    await reader.uint64('GGUF tensor count');
    const metadataCount = await reader.uint64('GGUF metadata count');
    if (metadataCount > MAX_METADATA_ENTRIES) throw new Error('GGUF metadata count is excessive');
    for (let index = 0; index < metadataCount; index += 1) {
      const keyBytes = await reader.stringBytes(MAX_METADATA_KEY_BYTES, 'GGUF metadata key');
      const key = strictUtf8(keyBytes, 'GGUF metadata key');
      const type = await reader.uint32();
      if (key === wantedKey) {
        if (type !== GgufValueType.String) {
          throw new Error(`GGUF ${wantedKey} metadata is not one exact string`);
        }
        const value = await reader.stringBytes(MAX_METADATA_VALUE_BYTES, `GGUF ${wantedKey}`);
        strictUtf8(value, `GGUF ${wantedKey}`);
        return value;
      }
      await skipValue(reader, type);
      if (reader.position > MAX_METADATA_SCAN_BYTES) {
        throw new Error('GGUF metadata scan exceeded its byte boundary');
      }
    }
    throw new Error(`GGUF metadata does not contain ${wantedKey}`);
  } finally {
    await handle.close();
  }
}

async function skipValue(reader: BufferedFileReader, type: number): Promise<void> {
  const fixed = fixedWidth(type);
  if (fixed != null) {
    await reader.skip(fixed);
    return;
  }
  if (type === GgufValueType.String) {
    const length = await reader.uint64('GGUF string length');
    await reader.skip(length);
    return;
  }
  if (type === GgufValueType.Array) {
    const elementType = await reader.uint32();
    if (elementType === GgufValueType.Array) throw new Error('nested GGUF arrays are unsupported');
    const count = await reader.uint64('GGUF array length');
    const elementWidth = fixedWidth(elementType);
    if (elementWidth != null) {
      const bytes = count * elementWidth;
      if (!Number.isSafeInteger(bytes)) throw new Error('GGUF array byte length is unsafe');
      await reader.skip(bytes);
      return;
    }
    if (elementType !== GgufValueType.String) {
      throw new Error(`GGUF array element type ${elementType} is unsupported`);
    }
    for (let index = 0; index < count; index += 1) {
      const length = await reader.uint64('GGUF array string length');
      await reader.skip(length);
    }
    return;
  }
  throw new Error(`GGUF metadata value type ${type} is unsupported`);
}

function fixedWidth(type: number) {
  switch (type) {
    case GgufValueType.Uint8:
    case GgufValueType.Int8:
    case GgufValueType.Bool:
      return 1;
    case GgufValueType.Uint16:
    case GgufValueType.Int16:
      return 2;
    case GgufValueType.Uint32:
    case GgufValueType.Int32:
    case GgufValueType.Float32:
      return 4;
    case GgufValueType.Uint64:
    case GgufValueType.Int64:
    case GgufValueType.Float64:
      return 8;
    default:
      return null;
  }
}

class BufferedFileReader {
  position = 0;
  private buffer = Buffer.alloc(0);
  private bufferOffset = 0;

  constructor(
    private readonly handle: fs.promises.FileHandle,
    private readonly fileBytes: number,
  ) {}

  async bytes(length: number) {
    safeLength(length, 'GGUF read length');
    if (this.position + length > this.fileBytes) throw new Error('GGUF metadata is truncated');
    const output = Buffer.allocUnsafe(length);
    let written = 0;
    while (written < length) {
      await this.ensureBuffered();
      const available = this.buffer.length - this.bufferOffset;
      const take = Math.min(available, length - written);
      this.buffer.copy(output, written, this.bufferOffset, this.bufferOffset + take);
      this.bufferOffset += take;
      this.position += take;
      written += take;
    }
    return output;
  }

  async skip(length: number) {
    safeLength(length, 'GGUF skip length');
    if (this.position + length > this.fileBytes) throw new Error('GGUF metadata is truncated');
    let remaining = length;
    const buffered = this.buffer.length - this.bufferOffset;
    const consume = Math.min(buffered, remaining);
    this.bufferOffset += consume;
    this.position += consume;
    remaining -= consume;
    if (remaining > 0) {
      this.position += remaining;
      this.buffer = Buffer.alloc(0);
      this.bufferOffset = 0;
    }
  }

  async uint32() {
    return (await this.bytes(4)).readUInt32LE(0);
  }

  async uint64(label: string) {
    const value = (await this.bytes(8)).readBigUInt64LE(0);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label} is unsafe`);
    return Number(value);
  }

  async stringBytes(maxBytes: number, label: string) {
    const length = await this.uint64(`${label} length`);
    if (length > maxBytes) throw new Error(`${label} exceeds its byte boundary`);
    return this.bytes(length);
  }

  private async ensureBuffered() {
    if (this.bufferOffset < this.buffer.length) return;
    const remaining = this.fileBytes - this.position;
    if (remaining <= 0) throw new Error('GGUF metadata is truncated');
    const next = Buffer.allocUnsafe(Math.min(READ_BUFFER_BYTES, remaining));
    const { bytesRead } = await this.handle.read(next, 0, next.length, this.position);
    if (bytesRead <= 0) throw new Error('GGUF metadata is truncated');
    this.buffer = bytesRead === next.length ? next : next.subarray(0, bytesRead);
    this.bufferOffset = 0;
  }
}

function strictUtf8(value: Buffer, label: string) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(value);
  } catch {
    throw new Error(`${label} is not valid UTF-8`);
  }
}

function safeLength(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is unsafe`);
}
