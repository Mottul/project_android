/// <reference types="@webgpu/types" />

import shaderSource from './dxt.wgsl?raw'
import { blocksHigh, blocksWide, compressDXT1, compressDXT5, rgbaToYCoCg } from './dxt'
import type { HapVariantSpec } from './encode'

/**
 * Texture compression on the GPU.
 *
 * Block compression is the job a compute shader was invented for: every 4x4
 * block is independent, and a 1080p frame is 130,000 of them. On the CPU that
 * is the slowest part of a HAP conversion by a wide margin.
 *
 * Pixels reach the shader without the CPU ever seeing them. The frame is drawn
 * into a canvas, copied into a GPU texture, and copied again into a storage
 * buffer — both copies happen on the card. Only the compressed result, a sixth
 * the size, comes back.
 *
 * The one thing that must never happen is a GPU that runs and produces subtly
 * wrong bytes: that is a HAP file which plays as garbage on a media server
 * rather than failing here. So the compressor proves itself against the CPU
 * implementation before it is used, and any disagreement retires it for the
 * session.
 */

export const GPU_MODE = {
  dxt1: 0,
  dxt5: 1,
  ycocg: 2,
} as const

export function gpuModeFor(variant: HapVariantSpec): number {
  switch (variant.texture) {
    case 'RGB_DXT1':
      return GPU_MODE.dxt1
    case 'RGBA_DXT5':
      return GPU_MODE.dxt5
    default:
      return GPU_MODE.ycocg
  }
}

/** `copyTextureToBuffer` wants every row to start on a 256-byte boundary. */
const ROW_ALIGNMENT = 256

function alignedRowBytes(width: number): number {
  return Math.ceil((width * 4) / ROW_ALIGNMENT) * ROW_ALIGNMENT
}

interface Resources {
  width: number
  height: number
  mode: number
  texture: GPUTexture
  pixels: GPUBuffer
  blocks: GPUBuffer
  staging: GPUBuffer
  params: GPUBuffer
  bindGroup: GPUBindGroup
  blockBytes: number
}

export class GpuTextureCompressor {
  private resources: Resources | null = null

  private constructor(
    private readonly device: GPUDevice,
    private readonly pipeline: GPUComputePipeline,
    readonly label: string,
  ) {}

  /**
   * Bring up a device, or return null when there is no usable GPU.
   *
   * Never throws: every caller's answer to a failure here is the same, and it
   * is to carry on with the CPU.
   */
  static async create(): Promise<GpuTextureCompressor | null> {
    const gpu = navigator.gpu
    if (!gpu) return null

    try {
      const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' })
      if (!adapter) return null

      const device = await adapter.requestDevice()
      // A lost device must not take the job down with it; the worker checks
      // `alive` and falls back.
      let lost = false
      void device.lost.then(() => {
        lost = true
      })

      const module = device.createShaderModule({ code: shaderSource, label: 'hap-dxt' })

      // Compilation errors are reported here rather than thrown, so a shader
      // this driver dislikes is found now instead of at the first frame.
      const info = await module.getCompilationInfo?.()
      if (info?.messages.some((m) => m.type === 'error')) return null

      const pipeline = device.createComputePipeline({
        layout: 'auto',
        compute: { module, entryPoint: 'main' },
      })
      if (lost) return null

      const name = adapter.info?.description || adapter.info?.vendor || 'GPU'
      return new GpuTextureCompressor(device, pipeline, name)
    } catch {
      return null
    }
  }

  private allocate(width: number, height: number, mode: number, blockBytes: number): Resources {
    const current = this.resources
    if (
      current &&
      current.width === width &&
      current.height === height &&
      current.mode === mode
    ) {
      return current
    }
    this.release()

    const device = this.device
    const rowBytes = alignedRowBytes(width)
    const blockCount = blocksWide(width) * blocksHigh(height)
    const outputBytes = blockCount * blockBytes

    const texture = device.createTexture({
      size: [width, height],
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING,
    })

    const pixels = device.createBuffer({
      size: rowBytes * height,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    const blocks = device.createBuffer({
      size: outputBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    })
    const staging = device.createBuffer({
      size: outputBytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })
    const params = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    device.queue.writeBuffer(
      params,
      0,
      new Uint32Array([
        width,
        height,
        blocksWide(width),
        blocksHigh(height),
        rowBytes / 4,
        mode,
        0,
        0,
      ]),
    )

    const bindGroup = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: pixels } },
        { binding: 1, resource: { buffer: blocks } },
        { binding: 2, resource: { buffer: params } },
      ],
    })

    this.resources = {
      width,
      height,
      mode,
      texture,
      pixels,
      blocks,
      staging,
      params,
      bindGroup,
      blockBytes,
    }
    return this.resources
  }

  /**
   * Compress what is currently drawn on `canvas` into `out`.
   *
   * The canvas goes to the GPU directly; the pixels are never read back into
   * JavaScript, which on a 1080p frame saves eight megabytes of copying per
   * frame on top of the compression itself.
   */
  async compress(
    canvas: OffscreenCanvas,
    width: number,
    height: number,
    mode: number,
    blockBytes: number,
    out: Uint8Array,
  ): Promise<void> {
    const r = this.allocate(width, height, mode, blockBytes)
    const device = this.device
    const rowBytes = alignedRowBytes(width)

    device.queue.copyExternalImageToTexture(
      { source: canvas, flipY: false },
      { texture: r.texture, premultipliedAlpha: false },
      [width, height],
    )

    const encoder = device.createCommandEncoder()
    encoder.copyTextureToBuffer(
      { texture: r.texture },
      { buffer: r.pixels, bytesPerRow: rowBytes, rowsPerImage: height },
      [width, height],
    )

    const pass = encoder.beginComputePass()
    pass.setPipeline(this.pipeline)
    pass.setBindGroup(0, r.bindGroup)
    pass.dispatchWorkgroups(Math.ceil(blocksWide(width) / 8), Math.ceil(blocksHigh(height) / 8))
    pass.end()

    encoder.copyBufferToBuffer(r.blocks, 0, r.staging, 0, out.byteLength)
    device.queue.submit([encoder.finish()])

    await r.staging.mapAsync(GPUMapMode.READ)
    out.set(new Uint8Array(r.staging.getMappedRange(0, out.byteLength)))
    r.staging.unmap()
  }

  private release() {
    const r = this.resources
    if (!r) return
    r.texture.destroy()
    r.pixels.destroy()
    r.blocks.destroy()
    r.staging.destroy()
    r.params.destroy()
    this.resources = null
  }

  destroy() {
    this.release()
    this.device.destroy()
  }
}

/**
 * Prove the GPU agrees with the CPU before trusting it with a conversion.
 *
 * The reference picture carries the three cases that separate a correct block
 * compressor from a plausible one: a flat area where both endpoints collapse
 * onto each other, a hard edge inside a block, and a smooth ramp where the
 * least-squares refinement actually moves. A driver that rounds differently
 * shows up here rather than in someone's rendered show.
 *
 * `tests/dxt-shader.test.ts` checks the same equivalence against a WGSL
 * interpreter on every build; this is the same check against real hardware.
 */
export async function validateCompressor(
  compressor: GpuTextureCompressor,
  makeCanvas: (width: number, height: number) => OffscreenCanvas | null,
): Promise<boolean> {
  const size = 16
  const canvas = makeCanvas(size, size)
  if (!canvas) return false

  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return false

  const reference = referenceImage(size)
  ctx.putImageData(new ImageData(reference, size, size), 0, 0)

  // Read the canvas back rather than trusting the array we just wrote: the 2D
  // context is allowed to round, and the CPU side has to see exactly what the
  // GPU will be handed.
  const drawn = new Uint8ClampedArray(ctx.getImageData(0, 0, size, size).data)

  const blocks = blocksWide(size) * blocksHigh(size)
  for (const [mode, blockBytes] of [
    [GPU_MODE.dxt1, 8],
    [GPU_MODE.dxt5, 16],
    [GPU_MODE.ycocg, 16],
  ] as const) {
    const gpu = new Uint8Array(blocks * blockBytes)
    try {
      await compressor.compress(canvas, size, size, mode, blockBytes, gpu)
    } catch {
      return false
    }

    const expected = new Uint8Array(blocks * blockBytes)
    const source = drawn.slice()
    if (mode === GPU_MODE.dxt1) compressDXT1(source, size, size, expected)
    else {
      if (mode === GPU_MODE.ycocg) rgbaToYCoCg(source)
      compressDXT5(source, size, size, expected)
    }

    for (let i = 0; i < expected.length; i++) {
      if (gpu[i] !== expected[i]) return false
    }
  }

  return true
}

/** Flat, hard-edged and smooth regions, in one 16x16 picture. */
function referenceImage(size: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const at = (y * size + x) * 4
      const half = x < size / 2
      if (y < 4) {
        out[at] = 200
        out[at + 1] = 30
        out[at + 2] = 90
        out[at + 3] = 255
      } else if (y < 8) {
        out[at] = half ? 0 : 255
        out[at + 1] = half ? 255 : 0
        out[at + 2] = half ? 128 : 16
        out[at + 3] = half ? 255 : 0
      } else {
        out[at] = Math.round((x / (size - 1)) * 255)
        out[at + 1] = Math.round((y / (size - 1)) * 255)
        out[at + 2] = (x * 7 + y * 13) % 256
        out[at + 3] = 255 - Math.round((x / (size - 1)) * 255)
      }
    }
  }
  return out
}
