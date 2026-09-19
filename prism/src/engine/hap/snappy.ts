/**
 * Snappy compressor, raw format.
 *
 * HAP's second-stage compressor. Texture blocks are close to random data, so
 * the win is modest — five to fifteen percent on real footage — but the files
 * are gigabytes and every decoder that reads HAP has to support Snappy anyway.
 *
 * Only the compressor is here; Prism never reads HAP back.
 *
 * Format: a varint holding the uncompressed length, then a stream of elements.
 * An element is either a run of literal bytes or a copy from earlier output.
 */

const MAX_HASH_BITS = 14
const MIN_MATCH = 4

/** Worst case for incompressible input: the literal framing overhead. */
export function maxCompressedLength(sourceLength: number): number {
  return 32 + sourceLength + Math.floor(sourceLength / 6)
}

function writeVarint(out: Uint8Array, at: number, value: number): number {
  let v = value
  while (v >= 0x80) {
    out[at++] = (v & 0x7f) | 0x80
    v >>>= 7
  }
  out[at++] = v
  return at
}

function emitLiteral(out: Uint8Array, at: number, src: Uint8Array, from: number, length: number) {
  const n = length - 1
  if (n < 60) {
    out[at++] = (n << 2) | 0
  } else if (n < 0x100) {
    out[at++] = (60 << 2) | 0
    out[at++] = n
  } else if (n < 0x10000) {
    out[at++] = (61 << 2) | 0
    out[at++] = n & 0xff
    out[at++] = (n >>> 8) & 0xff
  } else if (n < 0x1000000) {
    out[at++] = (62 << 2) | 0
    out[at++] = n & 0xff
    out[at++] = (n >>> 8) & 0xff
    out[at++] = (n >>> 16) & 0xff
  } else {
    out[at++] = (63 << 2) | 0
    out[at++] = n & 0xff
    out[at++] = (n >>> 8) & 0xff
    out[at++] = (n >>> 16) & 0xff
    out[at++] = (n >>> 24) & 0xff
  }
  out.set(src.subarray(from, from + length), at)
  return at + length
}

function emitCopy(out: Uint8Array, at: number, offset: number, length: number): number {
  let remaining = length
  // The 2-byte-offset form tops out at 64 bytes per element.
  while (remaining >= 68) {
    out[at++] = (63 << 2) | 2
    out[at++] = offset & 0xff
    out[at++] = (offset >>> 8) & 0xff
    remaining -= 64
  }
  if (remaining > 64) {
    out[at++] = (59 << 2) | 2
    out[at++] = offset & 0xff
    out[at++] = (offset >>> 8) & 0xff
    remaining -= 60
  }
  if (remaining >= 4 && remaining <= 11 && offset < 2048) {
    // 1-byte offset: three bits of length, three high bits of the offset.
    out[at++] = ((remaining - 4) << 2) | 1 | ((offset >>> 8) << 5)
    out[at++] = offset & 0xff
  } else {
    out[at++] = ((remaining - 1) << 2) | 2
    out[at++] = offset & 0xff
    out[at++] = (offset >>> 8) & 0xff
  }
  return at
}

/**
 * Compress with a single-probe hash chain, the same shape as the reference
 * implementation's fast path. Matches are limited to a 64 KiB window so every
 * copy fits the two-byte offset form.
 */
export function snappyCompress(src: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(maxCompressedLength(src.length))
  let at = writeVarint(out, 0, src.length)

  if (src.length === 0) return out.subarray(0, at)

  const tableBits = Math.min(
    MAX_HASH_BITS,
    Math.max(8, 32 - Math.clz32(Math.max(1, src.length - 1))),
  )
  const table = new Int32Array(1 << tableBits).fill(-1)
  const shift = 32 - tableBits
  const limit = src.length - MIN_MATCH

  const hashAt = (i: number) => {
    const word = src[i] | (src[i + 1] << 8) | (src[i + 2] << 16) | (src[i + 3] << 24)
    return (Math.imul(word, 0x1e35a7bd) >>> shift) & ((1 << tableBits) - 1)
  }

  let literalFrom = 0
  let i = 0

  while (i <= limit) {
    const h = hashAt(i)
    const candidate = table[h]
    table[h] = i

    if (
      candidate >= 0 &&
      i - candidate < 65536 &&
      src[candidate] === src[i] &&
      src[candidate + 1] === src[i + 1] &&
      src[candidate + 2] === src[i + 2] &&
      src[candidate + 3] === src[i + 3]
    ) {
      let length = MIN_MATCH
      while (i + length < src.length && src[candidate + length] === src[i + length] && length < 64000) {
        length++
      }

      if (literalFrom < i) {
        at = emitLiteral(out, at, src, literalFrom, i - literalFrom)
      }
      at = emitCopy(out, at, i - candidate, length)

      // Index the interior of the match so the next copy can start from it.
      for (let k = i + 1; k < i + length && k <= limit; k++) table[hashAt(k)] = k
      i += length
      literalFrom = i
    } else {
      i++
    }
  }

  if (literalFrom < src.length) {
    at = emitLiteral(out, at, src, literalFrom, src.length - literalFrom)
  }

  return out.subarray(0, at)
}
