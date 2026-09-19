import { describe, expect, it } from 'vitest'
// The package's "main" is a CommonJS build that its own "type": "module"
// breaks; the ES build beside it is the one that loads.
import { WgslExec, WgslParser } from 'wgsl_reflect/wgsl_reflect.module.js'

import shaderSource from '../src/engine/hap/dxt.wgsl?raw'
import { compressDXT1, compressDXT5, rgbaToYCoCg } from '../src/engine/hap/dxt'
import { GPU_MODE } from '../src/engine/hap/gpu-dxt'

/**
 * The compute shader against the CPU compressor.
 *
 * WebGPU cannot run in this test environment and will not run in most CI, so
 * the shader is executed by a WGSL interpreter instead. That is slower than a
 * graphics card by several orders of magnitude and completely sufficient: what
 * has to be proved is that the two implementations agree, not that either is
 * fast. A block the GPU packs differently is a corrupt HAP file, and this is
 * the only place that can be caught before someone's show.
 *
 * The runtime self-check in `gpu-dxt.ts` guards the same property on real
 * hardware, where drivers get their own opinions about floating point.
 */

const parsed = new WgslParser().parse(shaderSource)

interface Image {
  width: number
  height: number
  rgba: Uint8Array
}

/** Pack RGBA bytes the way `copyTextureToBuffer` hands them over. */
function toPixelBuffer(image: Image, rowStride: number): Uint32Array {
  const out = new Uint32Array(rowStride * image.height)
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const at = (y * image.width + x) * 4
      out[y * rowStride + x] =
        (image.rgba[at] |
          (image.rgba[at + 1] << 8) |
          (image.rgba[at + 2] << 16) |
          (image.rgba[at + 3] << 24)) >>>
        0
    }
  }
  return out
}

function runShader(image: Image, mode: number, rowStride = image.width): Uint8Array {
  const blocksWide = Math.ceil(image.width / 4)
  const blocksHigh = Math.ceil(image.height / 4)
  const wordsPerBlock = mode === GPU_MODE.dxt1 ? 2 : 4
  const out = new Uint32Array(blocksWide * blocksHigh * wordsPerBlock)

  const params = new Uint32Array([
    image.width,
    image.height,
    blocksWide,
    blocksHigh,
    rowStride,
    mode,
    0,
    0,
  ])

  const exec = new WgslExec(parsed)
  exec.dispatchWorkgroups('main', [Math.ceil(blocksWide / 8), Math.ceil(blocksHigh / 8), 1], {
    0: { 0: toPixelBuffer(image, rowStride), 1: out, 2: params },
  })

  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength)
}

function cpuTexture(image: Image, mode: number): Uint8Array {
  const blocks = Math.ceil(image.width / 4) * Math.ceil(image.height / 4)
  if (mode === GPU_MODE.dxt1) {
    const out = new Uint8Array(blocks * 8)
    compressDXT1(image.rgba, image.width, image.height, out)
    return out
  }
  const out = new Uint8Array(blocks * 16)
  const source = image.rgba.slice()
  if (mode === GPU_MODE.ycocg) rgbaToYCoCg(source)
  compressDXT5(source, image.width, image.height, out)
  return out
}

/** A picture with the cases that break a block compressor. */
function testImage(width: number, height: number): Image {
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4
      const half = x < width / 2
      if (y < 4) {
        // Flat colour: the degenerate path where both endpoints collapse.
        rgba[at] = 200
        rgba[at + 1] = 30
        rgba[at + 2] = 90
        rgba[at + 3] = 255
      } else if (y < 8) {
        // Hard edge inside a block.
        rgba[at] = half ? 0 : 255
        rgba[at + 1] = half ? 255 : 0
        rgba[at + 2] = half ? 128 : 16
        rgba[at + 3] = half ? 255 : 0
      } else {
        // Smooth ramp, where the least-squares refinement actually moves.
        rgba[at] = Math.round((x / Math.max(1, width - 1)) * 255)
        rgba[at + 1] = Math.round((y / Math.max(1, height - 1)) * 255)
        rgba[at + 2] = (x * 7 + y * 13) % 256
        rgba[at + 3] = 255 - Math.round((x / Math.max(1, width - 1)) * 255)
      }
    }
  }
  return { width, height, rgba }
}

describe('DXT compute shader', () => {
  const image = testImage(16, 16)

  it('produces the same DXT1 blocks as the CPU compressor', () => {
    expect(Array.from(runShader(image, GPU_MODE.dxt1))).toEqual(
      Array.from(cpuTexture(image, GPU_MODE.dxt1)),
    )
  })

  it('produces the same DXT5 blocks as the CPU compressor', () => {
    expect(Array.from(runShader(image, GPU_MODE.dxt5))).toEqual(
      Array.from(cpuTexture(image, GPU_MODE.dxt5)),
    )
  })

  it('produces the same YCoCg blocks as the CPU compressor', () => {
    expect(Array.from(runShader(image, GPU_MODE.ycocg))).toEqual(
      Array.from(cpuTexture(image, GPU_MODE.ycocg)),
    )
  })

  it('honours the row padding copyTextureToBuffer imposes', () => {
    // 256-byte alignment on a 12-pixel-wide image means 64 u32 per row.
    const narrow = testImage(12, 8)
    expect(Array.from(runShader(narrow, GPU_MODE.dxt1, 64))).toEqual(
      Array.from(cpuTexture(narrow, GPU_MODE.dxt1)),
    )
  })

  it('repeats the edge pixel for a block-misaligned image', () => {
    const odd = testImage(10, 6)
    expect(Array.from(runShader(odd, GPU_MODE.ycocg))).toEqual(
      Array.from(cpuTexture(odd, GPU_MODE.ycocg)),
    )
  })

  it('writes nothing past the last block', () => {
    const blocks = 4 * 4
    const out = new Uint32Array(blocks * 2 + 4).fill(0xdeadbeef)
    const params = new Uint32Array([16, 16, 4, 4, 16, GPU_MODE.dxt1, 0, 0])
    new WgslExec(parsed).dispatchWorkgroups('main', [1, 1, 1], {
      0: { 0: toPixelBuffer(image, 16), 1: out, 2: params },
    })
    expect(Array.from(out.subarray(blocks * 2))).toEqual([
      0xdeadbeef, 0xdeadbeef, 0xdeadbeef, 0xdeadbeef,
    ])
  })
})
