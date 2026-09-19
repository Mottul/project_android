/**
 * HAP frame layout.
 *
 * A HAP frame is a tree of sections. Every section has a header carrying its
 * body size and a type byte; the type byte packs two nibbles, the high one
 * naming the second-stage compressor and the low one the texture format:
 *
 *   compressor   0xA none   0xB snappy   0xC complex (chunked)
 *   texture      0xB DXT1   0xE DXT5     0xF YCoCg DXT5
 *
 * A single-section frame is the whole texture, optionally Snappy-compressed. A
 * chunked frame splits the texture into independently compressed pieces and
 * prefixes them with a table describing each one, so the player can hand one
 * chunk to each CPU core. That is the entire reason media servers ask for four
 * chunks: it is a decode-time parallelism hint, not a compression setting.
 */

export type HapTextureFormat = 'RGB_DXT1' | 'RGBA_DXT5' | 'YCoCg_DXT5'

const TEXTURE_NIBBLE: Record<HapTextureFormat, number> = {
  RGB_DXT1: 0xb,
  RGBA_DXT5: 0xe,
  YCoCg_DXT5: 0xf,
}

const COMPRESSOR_NONE = 0xa
const COMPRESSOR_SNAPPY = 0xb
const COMPRESSOR_COMPLEX = 0xc

const SECTION_DECODE_INSTRUCTIONS = 0x01
const SECTION_COMPRESSOR_TABLE = 0x02
const SECTION_SIZE_TABLE = 0x03

/** Per-chunk compressor ids, as written into the compressor table. */
const CHUNK_NONE = 0
const CHUNK_SNAPPY = 1

/**
 * Four-byte headers carry the size in three bytes. Anything that does not fit
 * — an 8K texture, say — switches to the eight-byte form with three zero bytes
 * where the short size would be.
 */
export function sectionHeaderSize(bodySize: number): number {
  return bodySize < 0x1000000 ? 4 : 8
}

export function writeSectionHeader(
  out: Uint8Array,
  at: number,
  type: number,
  bodySize: number,
): number {
  if (bodySize < 0x1000000) {
    out[at] = bodySize & 0xff
    out[at + 1] = (bodySize >>> 8) & 0xff
    out[at + 2] = (bodySize >>> 16) & 0xff
    out[at + 3] = type
    return at + 4
  }
  out[at] = 0
  out[at + 1] = 0
  out[at + 2] = 0
  out[at + 3] = type
  out[at + 4] = bodySize & 0xff
  out[at + 5] = (bodySize >>> 8) & 0xff
  out[at + 6] = (bodySize >>> 16) & 0xff
  out[at + 7] = (bodySize >>> 24) & 0xff
  return at + 8
}

export interface HapChunk {
  data: Uint8Array
  compressor: number
}

/**
 * Split a texture into `count` pieces on block boundaries.
 *
 * A chunk has to end on a whole texture block or the decoder reassembles
 * garbage, so the split is done in blocks and the remainder spread over the
 * leading chunks rather than dumped on the last one.
 */
export function splitIntoChunks(
  texture: Uint8Array,
  count: number,
  blockBytes: number,
): Uint8Array[] {
  const totalBlocks = Math.floor(texture.length / blockBytes)
  const chunks = Math.max(1, Math.min(count, totalBlocks))
  const base = Math.floor(totalBlocks / chunks)
  const extra = totalBlocks % chunks

  const parts: Uint8Array[] = []
  let at = 0
  for (let i = 0; i < chunks; i++) {
    const blocks = base + (i < extra ? 1 : 0)
    at += blocks * blockBytes
    // The last chunk runs to the end, which absorbs a trailing partial block
    // if a caller ever hands us a texture that is not a whole number of them.
    parts.push(texture.subarray(at - blocks * blockBytes, i === chunks - 1 ? texture.length : at))
  }
  return parts
}

export interface FrameOptions {
  format: HapTextureFormat
  /** 1 writes a single section; more writes a chunked frame. */
  chunks: number
  blockBytes: number
  /** Second-stage compression. Off makes encoding noticeably faster. */
  compress: boolean
  compressor: (input: Uint8Array) => Uint8Array
}

/**
 * Compress one chunk, keeping the result only when it actually got smaller.
 * Texture blocks are close to random, so on some frames Snappy loses.
 */
function compressChunk(
  chunk: Uint8Array,
  options: FrameOptions,
): HapChunk {
  if (!options.compress) return { data: chunk, compressor: CHUNK_NONE }
  const packed = options.compressor(chunk)
  return packed.length < chunk.length
    ? { data: packed, compressor: CHUNK_SNAPPY }
    : { data: chunk, compressor: CHUNK_NONE }
}

/** Build the bytes of one HAP frame from an already-compressed texture. */
export function encodeHapFrame(
  texture: Uint8Array,
  options: FrameOptions,
): Uint8Array<ArrayBuffer> {
  const textureNibble = TEXTURE_NIBBLE[options.format]

  if (options.chunks <= 1) {
    const chunk = compressChunk(texture, options)
    const compressor = chunk.compressor === CHUNK_SNAPPY ? COMPRESSOR_SNAPPY : COMPRESSOR_NONE
    const header = sectionHeaderSize(chunk.data.length)
    const out = new Uint8Array(header + chunk.data.length)
    const at = writeSectionHeader(out, 0, (compressor << 4) | textureNibble, chunk.data.length)
    out.set(chunk.data, at)
    return out
  }

  const parts = splitIntoChunks(texture, options.chunks, options.blockBytes)
  const packed = parts.map((part) => compressChunk(part, options))
  const count = packed.length

  const compressorTableBody = count
  const sizeTableBody = count * 4
  const instructionsBody =
    sectionHeaderSize(compressorTableBody) +
    compressorTableBody +
    sectionHeaderSize(sizeTableBody) +
    sizeTableBody

  const payload = packed.reduce((sum, c) => sum + c.data.length, 0)
  const topBody = sectionHeaderSize(instructionsBody) + instructionsBody + payload

  const out = new Uint8Array(sectionHeaderSize(topBody) + topBody)
  let at = writeSectionHeader(out, 0, (COMPRESSOR_COMPLEX << 4) | textureNibble, topBody)
  at = writeSectionHeader(out, at, SECTION_DECODE_INSTRUCTIONS, instructionsBody)

  at = writeSectionHeader(out, at, SECTION_COMPRESSOR_TABLE, compressorTableBody)
  for (const chunk of packed) out[at++] = chunk.compressor

  at = writeSectionHeader(out, at, SECTION_SIZE_TABLE, sizeTableBody)
  for (const chunk of packed) {
    const size = chunk.data.length
    out[at++] = size & 0xff
    out[at++] = (size >>> 8) & 0xff
    out[at++] = (size >>> 16) & 0xff
    out[at++] = (size >>> 24) & 0xff
  }

  for (const chunk of packed) {
    out.set(chunk.data, at)
    at += chunk.data.length
  }

  return out
}
