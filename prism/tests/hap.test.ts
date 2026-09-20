import { describe, expect, it } from 'vitest'

import { compressDXT1, compressDXT5, rgbaToYCoCg, ycocgToRgba } from '../src/engine/hap/dxt'
import {
  encodeHapFrame,
  sectionHeaderSize,
  splitIntoChunks,
  writeSectionHeader,
} from '../src/engine/hap/hap-frame'
import { findDecoderSpecificInfo, flacHeaderFrom, opusHeadFrom } from '../src/engine/hap/audio'
import { snappyCompress } from '../src/engine/hap/snappy'
import { buildFtyp, buildMdatHeader, buildMoov } from '../src/engine/hap/mov'
import {
  HAP_VARIANTS,
  hapVariantFor,
  layoutMovie,
  OutputGrid,
  targetSize,
  textureByteLength,
  timebaseFor,
} from '../src/engine/hap/encode'
import { DEFAULT_SETTINGS } from '../src/engine/types'
import type { VideoSettings } from '../src/engine/types'

/* ===========================================================================
   Reference decoders

   The encoder is only correct if something else can read it back, so the tests
   decode with an independent implementation written straight from the format
   descriptions rather than reusing the encoder's own tables.
   ======================================================================== */

function expand565(c: number) {
  const r5 = (c >> 11) & 31
  const g6 = (c >> 5) & 63
  const b5 = c & 31
  return [(r5 << 3) | (r5 >> 2), (g6 << 2) | (g6 >> 4), (b5 << 3) | (b5 >> 2)]
}

function decodeDXT1(data: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4)
  const bw = Math.ceil(width / 4)
  const bh = Math.ceil(height / 4)
  let at = 0
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const c0 = data[at] | (data[at + 1] << 8)
      const c1 = data[at + 2] | (data[at + 3] << 8)
      const a = expand565(c0)
      const b = expand565(c1)
      const palette =
        c0 > c1
          ? [
              a,
              b,
              [0, 1, 2].map((i) => Math.floor((2 * a[i] + b[i] + 1) / 3)),
              [0, 1, 2].map((i) => Math.floor((a[i] + 2 * b[i] + 1) / 3)),
            ]
          : [a, b, [0, 1, 2].map((i) => Math.floor((a[i] + b[i]) / 2)), [0, 0, 0]]

      for (let y = 0; y < 4; y++) {
        const bits = data[at + 4 + y]
        for (let x = 0; x < 4; x++) {
          const px = bx * 4 + x
          const py = by * 4 + y
          if (px >= width || py >= height) continue
          const colour = palette[(bits >> (x * 2)) & 3]
          const dst = (py * width + px) * 4
          out[dst] = colour[0]
          out[dst + 1] = colour[1]
          out[dst + 2] = colour[2]
          out[dst + 3] = 255
        }
      }
      at += 8
    }
  }
  return out
}

function decodeDXT5(data: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4)
  const bw = Math.ceil(width / 4)
  const bh = Math.ceil(height / 4)
  let at = 0
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const a0 = data[at]
      const a1 = data[at + 1]
      const alpha: number[] = [a0, a1]
      if (a0 > a1) {
        for (let i = 1; i <= 6; i++) alpha.push(Math.round(((7 - i) * a0 + i * a1) / 7))
      } else {
        for (let i = 1; i <= 4; i++) alpha.push(Math.round(((5 - i) * a0 + i * a1) / 5))
        alpha.push(0, 255)
      }

      // 48 bits of 3-bit indices, least significant first.
      let lo = 0
      for (let i = 0; i < 6; i++) lo += data[at + 2 + i] * 2 ** (8 * i)

      const colourAt = at + 8
      const c0 = data[colourAt] | (data[colourAt + 1] << 8)
      const c1 = data[colourAt + 2] | (data[colourAt + 3] << 8)
      const ca = expand565(c0)
      const cb = expand565(c1)
      const palette = [
        ca,
        cb,
        [0, 1, 2].map((i) => Math.floor((2 * ca[i] + cb[i] + 1) / 3)),
        [0, 1, 2].map((i) => Math.floor((ca[i] + 2 * cb[i] + 1) / 3)),
      ]

      for (let y = 0; y < 4; y++) {
        const bits = data[colourAt + 4 + y]
        for (let x = 0; x < 4; x++) {
          const px = bx * 4 + x
          const py = by * 4 + y
          if (px >= width || py >= height) continue
          const i = y * 4 + x
          const colour = palette[(bits >> (x * 2)) & 3]
          const dst = (py * width + px) * 4
          out[dst] = colour[0]
          out[dst + 1] = colour[1]
          out[dst + 2] = colour[2]
          out[dst + 3] = alpha[Math.floor(lo / 2 ** (3 * i)) % 8]
        }
      }
      at += 16
    }
  }
  return out
}

/** Reference Snappy decompressor, straight from the format description. */
function snappyDecompress(src: Uint8Array): Uint8Array {
  let at = 0
  let length = 0
  let shift = 0
  for (;;) {
    const byte = src[at++]
    length |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) break
    shift += 7
  }

  const out = new Uint8Array(length)
  let write = 0
  while (at < src.length) {
    const tag = src[at++]
    const kind = tag & 3
    if (kind === 0) {
      let len = tag >> 2
      if (len < 60) {
        len += 1
      } else {
        const extra = len - 59
        let value = 0
        for (let i = 0; i < extra; i++) value |= src[at + i] << (8 * i)
        at += extra
        len = value + 1
      }
      out.set(src.subarray(at, at + len), write)
      at += len
      write += len
      continue
    }

    let len: number
    let offset: number
    if (kind === 1) {
      len = 4 + ((tag >> 2) & 7)
      offset = ((tag >> 5) << 8) | src[at++]
    } else if (kind === 2) {
      len = (tag >> 2) + 1
      offset = src[at] | (src[at + 1] << 8)
      at += 2
    } else {
      len = (tag >> 2) + 1
      offset = src[at] | (src[at + 1] << 8) | (src[at + 2] << 16) | (src[at + 3] << 24)
      at += 4
    }
    for (let i = 0; i < len; i++) {
      out[write] = out[write - offset]
      write += 1
    }
  }

  if (write !== length) throw new Error(`Snappy: ${write} bytes decoded, ${length} declared`)
  return out
}

/** Read a section header the way a HAP decoder would. */
function readSection(data: Uint8Array, at: number) {
  const short = data[at] | (data[at + 1] << 8) | (data[at + 2] << 16)
  const type = data[at + 3]
  if (short !== 0) return { type, size: short, body: at + 4 }
  const size =
    data[at + 4] |
    (data[at + 5] << 8) |
    (data[at + 6] << 16) |
    (data[at + 7] << 24)
  return { type, size, body: at + 8 }
}

/** Walk an MP4/MOV box tree and return the path's byte range. */
function findBox(data: Uint8Array, path: string[], from = 0, to = data.length): [number, number] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let at = from
  while (at + 8 <= to) {
    const size = view.getUint32(at)
    const type = String.fromCharCode(data[at + 4], data[at + 5], data[at + 6], data[at + 7])
    const end = size === 0 ? to : at + size
    if (type === path[0]) {
      if (path.length === 1) return [at, end]
      return findBox(data, path.slice(1), at + 8, end)
    }
    if (size < 8) break
    at = end
  }
  throw new Error(`Box ${path.join('/')} nicht gefunden`)
}

/** Deterministic noise. Random enough that Snappy finds nothing to match. */
function noise(length: number): Uint8Array {
  const out = new Uint8Array(length)
  let x = 0x9e3779b9
  for (let i = 0; i < length; i++) {
    x ^= (x << 13) >>> 0
    x >>>= 0
    x ^= x >>> 17
    x ^= (x << 5) >>> 0
    x >>>= 0
    out[i] = (x >>> 24) & 0xff
  }
  return out
}

function solidImage(width: number, height: number, rgba: number[]): Uint8Array {
  const out = new Uint8Array(width * height * 4)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = rgba[0]
    out[i + 1] = rgba[1]
    out[i + 2] = rgba[2]
    out[i + 3] = rgba[3]
  }
  return out
}

function gradientImage(width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4
      out[at] = Math.round((x / Math.max(1, width - 1)) * 255)
      out[at + 1] = Math.round((y / Math.max(1, height - 1)) * 255)
      out[at + 2] = 128
      out[at + 3] = 255 - Math.round((x / Math.max(1, width - 1)) * 255)
    }
  }
  return out
}

function meanAbsError(a: Uint8Array, b: Uint8Array, channels = [0, 1, 2]): number {
  let sum = 0
  let count = 0
  for (let i = 0; i < a.length; i += 4) {
    for (const c of channels) {
      sum += Math.abs(a[i + c] - b[i + c])
      count += 1
    }
  }
  return sum / count
}

/* ===========================================================================
   Texture compression
   ======================================================================== */

describe('DXT1', () => {
  it('reproduces a flat colour exactly within 5:6:5 quantisation', () => {
    const image = solidImage(8, 8, [255, 128, 0, 255])
    const out = new Uint8Array((8 / 4) * (8 / 4) * 8)
    compressDXT1(image, 8, 8, out)
    const back = decodeDXT1(out, 8, 8)

    // 8-bit 128 has no exact 6-bit representation; one step is the floor.
    expect(meanAbsError(image, back)).toBeLessThan(3)
  })

  it('always writes the four-colour mode', () => {
    const out = new Uint8Array(8)
    compressDXT1(gradientImage(4, 4), 4, 4, out)
    const c0 = out[0] | (out[1] << 8)
    const c1 = out[2] | (out[3] << 8)
    expect(c0).toBeGreaterThanOrEqual(c1)
  })

  it('keeps a gradient close to the original', () => {
    const image = gradientImage(64, 64)
    const out = new Uint8Array(16 * 16 * 8)
    compressDXT1(image, 64, 64, out)
    expect(meanAbsError(image, decodeDXT1(out, 64, 64))).toBeLessThan(6)
  })

  it('pads a block-misaligned image by repeating the edge', () => {
    const out = new Uint8Array(2 * 2 * 8)
    // 5x5 needs 2x2 blocks; the encoder must not read past the image.
    expect(() => compressDXT1(gradientImage(5, 5), 5, 5, out)).not.toThrow()
    expect(out.some((b) => b !== 0)).toBe(true)
  })
})

describe('DXT5', () => {
  it('carries the alpha channel', () => {
    const image = gradientImage(16, 16)
    const out = new Uint8Array(4 * 4 * 16)
    compressDXT5(image, 16, 16, out)
    expect(meanAbsError(image, decodeDXT5(out, 16, 16), [3])).toBeLessThan(4)
  })

  it('reproduces a constant alpha exactly', () => {
    const image = solidImage(8, 8, [10, 20, 30, 200])
    const out = new Uint8Array(2 * 2 * 16)
    compressDXT5(image, 8, 8, out)
    const back = decodeDXT5(out, 8, 8)
    for (let i = 3; i < back.length; i += 4) expect(back[i]).toBe(200)
  })
})

describe('YCoCg', () => {
  it('round-trips through the colour transform', () => {
    const image = gradientImage(32, 32)
    const transformed = image.slice()
    rgbaToYCoCg(transformed)
    ycocgToRgba(transformed)
    expect(meanAbsError(image, transformed)).toBeLessThan(2)
  })

  it('parks the scale byte at zero, which the HAP shader reads as unscaled', () => {
    const transformed = gradientImage(8, 8)
    rgbaToYCoCg(transformed)
    for (let i = 2; i < transformed.length; i += 4) expect(transformed[i]).toBe(0)
  })

  it('beats plain DXT1 on a gradient, which is the whole point of HAP Q', () => {
    const image = gradientImage(64, 64)

    const dxt1 = new Uint8Array(16 * 16 * 8)
    compressDXT1(image, 64, 64, dxt1)
    const plainError = meanAbsError(image, decodeDXT1(dxt1, 64, 64))

    const ycocg = image.slice()
    rgbaToYCoCg(ycocg)
    const dxt5 = new Uint8Array(16 * 16 * 16)
    compressDXT5(ycocg, 64, 64, dxt5)
    const decoded = decodeDXT5(dxt5, 64, 64)
    ycocgToRgba(decoded)
    const qError = meanAbsError(image, decoded)

    expect(qError).toBeLessThan(plainError)
  })
})

/* ===========================================================================
   Snappy
   ======================================================================== */

describe('snappy', () => {
  it('round-trips repetitive data and actually shrinks it', () => {
    const src = new Uint8Array(4096)
    for (let i = 0; i < src.length; i++) src[i] = i % 17
    const packed = snappyCompress(src)
    expect(packed.length).toBeLessThan(src.length / 2)
    expect(Array.from(snappyDecompress(packed))).toEqual(Array.from(src))
  })

  it('round-trips incompressible data', () => {
    const src = noise(3000)
    expect(snappyCompress(src).length).toBeGreaterThan(src.length)
    expect(Array.from(snappyDecompress(snappyCompress(src)))).toEqual(Array.from(src))
  })

  it('round-trips a long run, which spans several copy elements', () => {
    const src = new Uint8Array(70_000).fill(7)
    expect(Array.from(snappyDecompress(snappyCompress(src)))).toEqual(Array.from(src))
  })

  it('handles the empty and single-byte cases', () => {
    expect(snappyDecompress(snappyCompress(new Uint8Array(0))).length).toBe(0)
    expect(Array.from(snappyDecompress(snappyCompress(new Uint8Array([42]))))).toEqual([42])
  })

  it('round-trips real texture data', () => {
    const image = gradientImage(128, 128)
    const texture = new Uint8Array(32 * 32 * 16)
    compressDXT5(image, 128, 128, texture)
    expect(Array.from(snappyDecompress(snappyCompress(texture)))).toEqual(Array.from(texture))
  })
})

/* ===========================================================================
   Frame sections
   ======================================================================== */

describe('HAP sections', () => {
  it('uses the long header only past the 24-bit size limit', () => {
    expect(sectionHeaderSize(1000)).toBe(4)
    // Three bytes hold 0xffffff exactly; one more needs the long form.
    expect(sectionHeaderSize(0xffffff)).toBe(4)
    expect(sectionHeaderSize(0x1000000)).toBe(8)

    const short = new Uint8Array(4)
    writeSectionHeader(short, 0, 0xab, 0x010203)
    expect(Array.from(short)).toEqual([0x03, 0x02, 0x01, 0xab])

    const long = new Uint8Array(8)
    writeSectionHeader(long, 0, 0xab, 0x01020304)
    expect(Array.from(long.subarray(0, 4))).toEqual([0, 0, 0, 0xab])
  })

  it('writes a single section for an unchunked frame', () => {
    const texture = new Uint8Array(1024).fill(9)
    const frame = encodeHapFrame(texture, {
      format: 'RGB_DXT1',
      chunks: 1,
      blockBytes: 8,
      compress: false,
      compressor: snappyCompress,
    })

    const section = readSection(frame, 0)
    // 0xA = no second-stage compressor, 0xB = RGB_DXT1.
    expect(section.type).toBe(0xab)
    expect(section.size).toBe(texture.length)
    expect(section.body + section.size).toBe(frame.length)
  })

  it('marks a Snappy-compressed section and decompresses back to the texture', () => {
    const texture = new Uint8Array(4096)
    for (let i = 0; i < texture.length; i++) texture[i] = i % 5
    const frame = encodeHapFrame(texture, {
      format: 'YCoCg_DXT5',
      chunks: 1,
      blockBytes: 16,
      compress: true,
      compressor: snappyCompress,
    })

    const section = readSection(frame, 0)
    expect(section.type).toBe(0xbf)
    const body = frame.subarray(section.body, section.body + section.size)
    expect(Array.from(snappyDecompress(body))).toEqual(Array.from(texture))
  })

  it('falls back to an uncompressed section when Snappy would grow the frame', () => {
    const texture = noise(2048)
    const frame = encodeHapFrame(texture, {
      format: 'RGBA_DXT5',
      chunks: 1,
      blockBytes: 16,
      compress: true,
      compressor: snappyCompress,
    })
    expect(readSection(frame, 0).type).toBe(0xae)
  })

  it('splits chunks on block boundaries and spreads the remainder', () => {
    const texture = new Uint8Array(16 * 10)
    const parts = splitIntoChunks(texture, 4, 16)
    expect(parts.map((p) => p.length)).toEqual([48, 48, 32, 32])
    expect(parts.reduce((sum, p) => sum + p.length, 0)).toBe(texture.length)
  })

  it('never returns more chunks than the texture has blocks', () => {
    expect(splitIntoChunks(new Uint8Array(16 * 2), 8, 16)).toHaveLength(2)
  })

  it('writes a decode-instructions container a player can walk', () => {
    const texture = new Uint8Array(16 * 64)
    for (let i = 0; i < texture.length; i++) texture[i] = i % 11
    const frame = encodeHapFrame(texture, {
      format: 'YCoCg_DXT5',
      chunks: 4,
      blockBytes: 16,
      compress: true,
      compressor: snappyCompress,
    })

    const top = readSection(frame, 0)
    // 0xC = complex/chunked.
    expect(top.type).toBe(0xcf)
    expect(top.body + top.size).toBe(frame.length)

    const instructions = readSection(frame, top.body)
    expect(instructions.type).toBe(0x01)

    const compressors = readSection(frame, instructions.body)
    expect(compressors.type).toBe(0x02)
    expect(compressors.size).toBe(4)

    const sizes = readSection(frame, compressors.body + compressors.size)
    expect(sizes.type).toBe(0x03)
    expect(sizes.size).toBe(16)

    // The chunk data begins right after the instructions container.
    let at = instructions.body + instructions.size
    const rebuilt: number[] = []
    for (let i = 0; i < 4; i++) {
      const base = sizes.body + i * 4
      const size =
        frame[base] | (frame[base + 1] << 8) | (frame[base + 2] << 16) | (frame[base + 3] << 24)
      const chunk = frame.subarray(at, at + size)
      const mode = frame[compressors.body + i]
      rebuilt.push(...(mode === 1 ? snappyDecompress(chunk) : chunk))
      at += size
    }

    expect(at).toBe(frame.length)
    expect(rebuilt).toEqual(Array.from(texture))
  })
})

/* ===========================================================================
   QuickTime container
   ======================================================================== */

describe('MOV', () => {
  const info = {
    variant: 'HapY' as const,
    width: 1920,
    height: 1080,
    timescale: 30000,
    sampleDelta: 1000,
    compressorName: 'Hap Q',
    depth: 24 as const,
  }

  function assemble(sizes: number[]) {
    const frames = sizes.map((size) => new Uint8Array(size).fill(1))
    const layout = layoutMovie(frames, sizes, info)
    const flat = new Uint8Array(layout.totalBytes)
    let at = 0
    for (const part of layout.parts) {
      flat.set(part as Uint8Array, at)
      at += (part as Uint8Array).length
    }
    return flat
  }

  it('announces itself as QuickTime', () => {
    const ftyp = buildFtyp()
    expect(String.fromCharCode(...ftyp.subarray(4, 8))).toBe('ftyp')
    expect(String.fromCharCode(...ftyp.subarray(8, 12))).toBe('qt  ')
  })

  it('switches mdat to the 64-bit form past 4 GiB', () => {
    expect(buildMdatHeader(1024).length).toBe(8)
    const large = buildMdatHeader(5 * 1024 ** 3)
    expect(large.length).toBe(16)
    expect(new DataView(large.buffer).getUint32(0)).toBe(1)
  })

  it('lays the file out as ftyp, mdat, then the index', () => {
    const file = assemble([100, 120, 90])
    expect(String.fromCharCode(...file.subarray(4, 8))).toBe('ftyp')
    const [mdatStart] = findBox(file, ['mdat'])
    const [moovStart] = findBox(file, ['moov'])
    expect(mdatStart).toBeLessThan(moovStart)
  })

  it('names the codec with the HAP four-character code', () => {
    const file = assemble([64])
    const [start, end] = findBox(file, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsd'])
    const stsd = file.subarray(start, end)
    expect(String.fromCharCode(...stsd.subarray(20, 24))).toBe('HapY')
  })

  it('points every sample offset at its real bytes', () => {
    const sizes = [100, 120, 90]
    const file = assemble(sizes)
    const [mdatStart] = findBox(file, ['mdat'])
    const [stcoStart] = findBox(file, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stco'])
    const view = new DataView(file.buffer)

    const count = view.getUint32(stcoStart + 12)
    expect(count).toBe(sizes.length)

    let expected = mdatStart + 8
    for (let i = 0; i < count; i++) {
      expect(view.getUint32(stcoStart + 16 + i * 4)).toBe(expected)
      expected += sizes[i]
    }
  })

  it('records the sample sizes it was given', () => {
    const sizes = [100, 120, 90]
    const file = assemble(sizes)
    const [stszStart] = findBox(file, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsz'])
    const view = new DataView(file.buffer)
    expect(view.getUint32(stszStart + 12)).toBe(0) // varying sizes
    expect(view.getUint32(stszStart + 16)).toBe(sizes.length)
    for (let i = 0; i < sizes.length; i++) {
      expect(view.getUint32(stszStart + 20 + i * 4)).toBe(sizes[i])
    }
  })

  it('describes a constant frame rate in a single stts run', () => {
    const file = assemble([10, 10, 10, 10])
    const [sttsStart] = findBox(file, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stts'])
    const view = new DataView(file.buffer)
    expect(view.getUint32(sttsStart + 12)).toBe(1)
    expect(view.getUint32(sttsStart + 16)).toBe(4)
    expect(view.getUint32(sttsStart + 20)).toBe(1000)
  })

  it('reports a duration matching the frame count', () => {
    const file = assemble([10, 10, 10])
    const [mvhdStart] = findBox(file, ['moov', 'mvhd'])
    const view = new DataView(file.buffer)
    // 3 frames at 30 fps is 100 ms on the 1000-tick movie timeline.
    expect(view.getUint32(mvhdStart + 12 + 12)).toBe(100)
  })

  it('every box header declares its own length', () => {
    const file = assemble([32, 32])
    const [moovStart, moovEnd] = findBox(file, ['moov'])
    const view = new DataView(file.buffer)
    expect(view.getUint32(moovStart)).toBe(moovEnd - moovStart)
    expect(moovEnd).toBe(file.length)
  })

  it('keeps the frames as separate parts rather than one buffer', () => {
    const frames = [new Uint8Array(8), new Uint8Array(8)]
    const layout = layoutMovie(frames, [8, 8], info)
    // ftyp, mdat header, two frames, moov.
    expect(layout.parts).toHaveLength(5)
    expect(layout.parts[2]).toBe(frames[0])
  })

  it('refuses a sample list and a size list that disagree', () => {
    expect(() => layoutMovie([new Uint8Array(8)], [8, 8], info)).toThrow()
  })
})

/* ===========================================================================
   Settings mapping
   ======================================================================== */

describe('HAP settings', () => {
  const video = (patch: Partial<VideoSettings>): VideoSettings => ({
    ...DEFAULT_SETTINGS.video,
    ...patch,
  })

  it('claims exactly the variants it can write', () => {
    expect(hapVariantFor('hap')?.fourcc).toBe('Hap1')
    expect(hapVariantFor('hap_alpha')?.fourcc).toBe('Hap5')
    expect(hapVariantFor('hap_q')?.fourcc).toBe('HapY')
    // Two textures per frame; still the ffmpeg path.
    expect(hapVariantFor('hap_q_alpha')).toBeNull()
    expect(hapVariantFor('h264')).toBeNull()
  })

  it('sizes a texture from the variant', () => {
    expect(textureByteLength(HAP_VARIANTS.hap, 1920, 1080)).toBe(480 * 270 * 8)
    expect(textureByteLength(HAP_VARIANTS.hap_q, 1920, 1080)).toBe(480 * 270 * 16)
  })

  it('keeps the source size when no resolution is chosen', () => {
    expect(targetSize(video({ resolution: 'source' }), 1920, 1080)).toEqual({
      width: 1920,
      height: 1080,
    })
  })

  it('scales down to a preset but never up', () => {
    expect(targetSize(video({ resolution: '720p' }), 1920, 1080)).toEqual({
      width: 1280,
      height: 720,
    })
    expect(targetSize(video({ resolution: '2160p' }), 1280, 720)).toEqual({
      width: 1280,
      height: 720,
    })
  })

  it('rounds every dimension onto a whole texture block', () => {
    const { width, height } = targetSize(video({ resolution: 'source' }), 1919, 1081)
    expect(width % 4).toBe(0)
    expect(height % 4).toBe(0)

    const custom = targetSize(
      video({ resolution: 'custom', customWidth: 1023, customHeight: 767 }),
      1920,
      1080,
    )
    expect(custom).toEqual({ width: 1024, height: 768 })
  })

  it('never returns a zero-sized frame', () => {
    expect(targetSize(video({ resolution: 'source' }), 0, 0)).toEqual({ width: 4, height: 4 })
    expect(targetSize(video({ resolution: '360p' }), 2, 1)).toEqual({ width: 4, height: 4 })
  })

  it('keeps fractional frame rates exact', () => {
    expect(timebaseFor(30)).toEqual({ timescale: 30000, sampleDelta: 1000 })
    expect(timebaseFor(29.97)).toEqual({ timescale: 29970, sampleDelta: 1000 })
    expect(timebaseFor(23.976)).toEqual({ timescale: 23976, sampleDelta: 1000 })
    expect(timebaseFor(0)).toEqual({ timescale: 30000, sampleDelta: 1000 })
  })
})

/* ===========================================================================
   Frame rate conversion
   ======================================================================== */

describe('OutputGrid', () => {
  /**
   * Drive the grid the way the worker does: one frame at a time, then the tail
   * bounded by the last frame's duration. Returns how many output frames each
   * source frame produced.
   */
  function run(count: number, sourceFps: number, outputFps: number): number[] {
    const grid = new OutputGrid(1e6 / outputFps)
    const step = 1e6 / sourceFps
    const slots: number[] = new Array(count).fill(0)

    let held = -1
    for (let i = 0; i < count; i++) {
      const timestamp = Math.round(i * step)
      const owed = grid.slotsBefore(timestamp)
      if (held >= 0) slots[held] += owed
      held = i
    }
    slots[held] += grid.slotsUntil(Math.round((count - 1) * step) + step)
    return slots
  }

  const total = (slots: number[]) => slots.reduce((sum, n) => sum + n, 0)

  it('passes a matching frame rate through one for one', () => {
    expect(run(12, 12, 12)).toEqual(new Array(12).fill(1))
  })

  it('halves a rate by dropping every other frame', () => {
    const slots = run(12, 12, 6)
    expect(total(slots)).toBe(6)
    expect(slots).toEqual([1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0])
  })

  it('doubles a rate by repeating each frame', () => {
    const slots = run(6, 12, 24)
    expect(total(slots)).toBe(12)
    expect(slots.every((n) => n === 2)).toBe(true)
  })

  it('keeps the duration when the rate is not a whole multiple', () => {
    // A second of 30 fps asked for 25 has to come out as 25 frames.
    expect(total(run(30, 30, 25))).toBe(25)
    expect(total(run(24, 24, 30))).toBe(30)
  })

  it('emits nothing for a source that never produced a frame', () => {
    const grid = new OutputGrid(1000)
    expect(grid.slotsUntil(100_000)).toBe(0)
  })

  it('emits a single frame for a single-frame source', () => {
    expect(run(1, 30, 30)).toEqual([1])
  })

  it('refuses to spin forever on a broken timestamp', () => {
    const grid = new OutputGrid(1000, 10)
    grid.slotsBefore(0)
    expect(grid.slotsBefore(Number.MAX_SAFE_INTEGER)).toBe(10)
  })
})

/* ===========================================================================
   Audio

   The container work is checked here; the decoding itself needs a real
   AudioDecoder and is exercised against a generated Opus clip in the browser.
   ======================================================================== */

describe('audio configuration', () => {
  it('finds the AudioSpecificConfig inside an esds', () => {
    // version/flags, then ES_Descriptor -> DecoderConfig -> DecoderSpecificInfo.
    const esds = new Uint8Array([
      0, 0, 0, 0,
      0x03, 0x19, 0x00, 0x01, 0x00,
      0x04, 0x11, 0x40, 0x15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0x05, 0x02, 0x11, 0x90,
      0x06, 0x01, 0x02,
    ])
    expect(Array.from(findDecoderSpecificInfo(esds) ?? [])).toEqual([0x11, 0x90])
  })

  it('reads a multi-byte descriptor length', () => {
    const body = new Uint8Array(200).fill(0xaa)
    const esds = new Uint8Array([
      0, 0, 0, 0,
      // Lengths here use the four-byte continuation form real muxers emit.
      0x03, 0x80, 0x80, 0x80, 0xff, 0x00, 0x01, 0x00,
      0x04, 0x80, 0x80, 0x80, 0xf0, 0x40, 0x15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0x05, 0x80, 0x80, 0x81, 0x48, ...body,
    ])
    const found = findDecoderSpecificInfo(esds)
    expect(found?.length).toBe(200)
    expect(found?.[0]).toBe(0xaa)
  })

  it('returns null rather than guessing when there is no config', () => {
    expect(findDecoderSpecificInfo(new Uint8Array([0, 0, 0, 0]))).toBeNull()
    expect(findDecoderSpecificInfo(new Uint8Array([0, 0, 0, 0, 0x03, 0x40, 0, 1, 0]))).toBeNull()
  })

  it('rebuilds an OpusHead with the endianness swapped', () => {
    // dOps body: version, channels, preSkip BE, rate BE, gain BE, family.
    const dOps = new Uint8Array([0, 2, 0x01, 0x38, 0x00, 0x00, 0xbb, 0x80, 0x00, 0x00, 0])
    const head = opusHeadFrom(dOps)!
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength)

    expect(String.fromCharCode(...head.subarray(0, 8))).toBe('OpusHead')
    expect(head[8]).toBe(1)
    expect(head[9]).toBe(2)
    expect(view.getUint16(10, true)).toBe(312)
    expect(view.getUint32(12, true)).toBe(48000)
    expect(view.getUint16(16, true)).toBe(0)
    expect(head[18]).toBe(0)
    expect(head.length).toBe(19)
  })

  it('carries the channel mapping table for surround', () => {
    const dOps = new Uint8Array([0, 6, 0x01, 0x38, 0, 0, 0xbb, 0x80, 0, 0, 1, 4, 2, 0, 1, 2, 3, 4, 5])
    const head = opusHeadFrom(dOps)!
    expect(head[18]).toBe(1)
    expect(Array.from(head.subarray(19))).toEqual([4, 2, 0, 1, 2, 3, 4, 5])
  })

  it('refuses a truncated dOps instead of reading past it', () => {
    expect(opusHeadFrom(new Uint8Array([0, 2, 0x01]))).toBeNull()
  })
})

describe('MOV with sound', () => {
  const video = {
    variant: 'Hap1' as const,
    width: 128,
    height: 96,
    timescale: 12000,
    sampleDelta: 1000,
    compressorName: 'Hap',
    depth: 24 as const,
  }

  const audio = {
    info: { sampleRate: 48000, channels: 2, frameCount: 48000, byteLength: 48000 * 4 },
    parts: [new Uint8Array(48000 * 4)],
  }

  function assemble(sizes: number[], withAudio = true) {
    const frames = sizes.map((size) => new Uint8Array(size))
    const layout = layoutMovie(frames, sizes, video, withAudio ? audio : null)
    const flat = new Uint8Array(layout.totalBytes)
    let at = 0
    for (const part of layout.parts) {
      flat.set(part as Uint8Array, at)
      at += (part as Uint8Array).length
    }
    return { flat, layout }
  }

  function findBoxIn(data: Uint8Array, type: string, from: number, to: number) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    let at = from
    while (at + 8 <= to) {
      const size = view.getUint32(at)
      const name = String.fromCharCode(data[at + 4], data[at + 5], data[at + 6], data[at + 7])
      if (name === type) return { start: at, end: at + size, body: at + 8 }
      if (size < 8) break
      at += size
    }
    return null
  }

  function traks(file: Uint8Array) {
    const [moovStart, moovEnd] = findBox(file, ['moov'])
    const view = new DataView(file.buffer)
    const found: Array<{ start: number; end: number; body: number }> = []
    let at = moovStart + 8
    while (at + 8 < moovEnd) {
      const size = view.getUint32(at)
      const name = String.fromCharCode(file[at + 4], file[at + 5], file[at + 6], file[at + 7])
      if (name === 'trak') found.push({ start: at, end: at + size, body: at + 8 })
      if (size < 8) break
      at += size
    }
    return found
  }

  it('writes a second track only when there is audio', () => {
    expect(traks(assemble([64, 64]).flat)).toHaveLength(2)
    expect(traks(assemble([64, 64], false).flat)).toHaveLength(1)
  })

  it('keeps the PCM as its own part, after the last frame', () => {
    const { layout } = assemble([100, 120])
    // ftyp, the mdat header, two frames, the PCM, moov — in that order.
    expect(layout.parts).toHaveLength(6)
    expect(layout.parts[4]).toBe(audio.parts[0])
  })

  it('describes the PCM as 16-bit little-endian stereo', () => {
    const { flat } = assemble([64])
    const sound = traks(flat)[1]
    const [start] = findBox(flat, ['mdia', 'minf', 'stbl', 'stsd'], sound.body, sound.end)
    const entry = findBoxIn(flat, 'sowt', start + 16, sound.end)!
    const view = new DataView(flat.buffer)

    expect(view.getUint16(entry.body + 16)).toBe(2) // channels
    expect(view.getUint16(entry.body + 18)).toBe(16) // bits
    expect(view.getUint32(entry.body + 24) / 65536).toBe(48000)
  })

  it('indexes the PCM as fixed-size samples at one tick each', () => {
    const { flat } = assemble([64])
    const sound = traks(flat)[1]
    const view = new DataView(flat.buffer)

    const [sttsStart] = findBox(flat, ['mdia', 'minf', 'stbl', 'stts'], sound.body, sound.end)
    expect(view.getUint32(sttsStart + 12)).toBe(1) // one run
    expect(view.getUint32(sttsStart + 16)).toBe(48000) // frames
    expect(view.getUint32(sttsStart + 20)).toBe(1) // one tick per frame

    const [stszStart] = findBox(flat, ['mdia', 'minf', 'stbl', 'stsz'], sound.body, sound.end)
    expect(view.getUint32(stszStart + 12)).toBe(4) // stereo, 16 bit
    expect(view.getUint32(stszStart + 16)).toBe(48000)

    const [mdhdStart] = findBox(flat, ['mdia', 'mdhd'], sound.body, sound.end)
    expect(view.getUint32(mdhdStart + 20)).toBe(48000) // timescale is the rate
  })

  it('points the sound chunk at the first PCM byte', () => {
    const sizes = [100, 120]
    const { flat } = assemble(sizes)
    const [mdatStart] = findBox(flat, ['mdat'])
    const sound = traks(flat)[1]
    const view = new DataView(flat.buffer)
    const [stcoStart] = findBox(flat, ['mdia', 'minf', 'stbl', 'stco'], sound.body, sound.end)

    expect(view.getUint32(stcoStart + 12)).toBe(1) // one chunk
    expect(view.getUint32(stcoStart + 16)).toBe(mdatStart + 8 + sizes[0] + sizes[1])
  })

  it('gives the sound track full volume and the video track none', () => {
    const { flat } = assemble([64])
    const [videoTrak, soundTrak] = traks(flat)
    const view = new DataView(flat.buffer)
    const [videoTkhd] = findBox(flat, ['tkhd'], videoTrak.body, videoTrak.end)
    const [soundTkhd] = findBox(flat, ['tkhd'], soundTrak.body, soundTrak.end)

    expect(view.getUint16(videoTkhd + 8 + 36)).toBe(0)
    expect(view.getUint16(soundTkhd + 8 + 36)).toBe(0x0100)
    expect(view.getUint32(videoTkhd + 8 + 12)).toBe(1)
    expect(view.getUint32(soundTkhd + 8 + 12)).toBe(2)
  })

  it('runs the movie as long as its longest track', () => {
    // Two frames at 12 fps is 167 ms of video against a full second of audio.
    const { flat } = assemble([64, 64])
    const [mvhdStart] = findBox(flat, ['moov', 'mvhd'])
    const view = new DataView(flat.buffer)
    expect(view.getUint32(mvhdStart + 8 + 16)).toBe(1000)
    expect(view.getUint32(mvhdStart + 8 + 96)).toBe(3) // next free track id
  })

  it('counts the PCM into mdat and into the total', () => {
    const { flat, layout } = assemble([100])
    const [mdatStart, mdatEnd] = findBox(flat, ['mdat'])
    expect(mdatEnd - mdatStart).toBe(8 + 100 + audio.info.byteLength)
    expect(layout.totalBytes).toBe(flat.length)
  })
})

describe('FLAC configuration', () => {
  it('puts the fLaC magic in front of the metadata blocks', () => {
    // A dfLa box: version and flags, then a last-block STREAMINFO header.
    const dfLa = new Uint8Array([0, 0, 0, 0, 0x80, 0x00, 0x00, 0x22, ...new Array(34).fill(7)])
    const header = flacHeaderFrom(dfLa)!

    expect(String.fromCharCode(...header.subarray(0, 4))).toBe('fLaC')
    expect(Array.from(header.subarray(4, 8))).toEqual([0x80, 0x00, 0x00, 0x22])
    expect(header.length).toBe(4 + dfLa.length - 4)
  })

  it('refuses a dfLa with no blocks in it', () => {
    expect(flacHeaderFrom(new Uint8Array([0, 0, 0, 0]))).toBeNull()
  })
})
