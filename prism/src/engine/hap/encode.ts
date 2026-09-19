import { RESOLUTION_HEIGHT } from '../ffmpeg-args'
import type { VideoSettings } from '../types'
import { blocksHigh, blocksWide, compressDXT1, compressDXT5, rgbaToYCoCg } from './dxt'
import { encodeHapFrame, type HapTextureFormat } from './hap-frame'
import { buildFtyp, buildMdatHeader, buildMoov, type HapVariant, type MovTrackInfo } from './mov'
import { snappyCompress } from './snappy'

/**
 * The HAP pipeline, minus the parts that need a live decoder.
 *
 * Everything here is a pure function over pixels and numbers so the format
 * work can be tested without WebCodecs, an OffscreenCanvas or a real video.
 */

export interface HapVariantSpec {
  /** The four-character code that tells a player which variant this is. */
  fourcc: HapVariant
  texture: HapTextureFormat
  blockBytes: 8 | 16
  /** Bit depth written into the sample description. */
  depth: 24 | 32
  alpha: boolean
  /** Name shown by QuickTime and friends in a track inspector. */
  compressorName: string
  label: string
}

/**
 * The three variants Prism encodes itself.
 *
 * HAP Q Alpha is deliberately absent: it packs two textures per frame behind a
 * multi-image section, and shipping a half-understood layout would produce
 * files that crash a media server mid-show rather than fail here. It stays on
 * the ffmpeg path.
 */
export const HAP_VARIANTS: Record<string, HapVariantSpec> = {
  hap: {
    fourcc: 'Hap1',
    texture: 'RGB_DXT1',
    blockBytes: 8,
    depth: 24,
    alpha: false,
    compressorName: 'Hap',
    label: 'HAP',
  },
  hap_alpha: {
    fourcc: 'Hap5',
    texture: 'RGBA_DXT5',
    blockBytes: 16,
    depth: 32,
    alpha: true,
    compressorName: 'Hap Alpha',
    label: 'HAP Alpha',
  },
  hap_q: {
    fourcc: 'HapY',
    texture: 'YCoCg_DXT5',
    blockBytes: 16,
    depth: 24,
    alpha: false,
    compressorName: 'Hap Q',
    label: 'HAP Q',
  },
}

export function hapVariantFor(codec: string): HapVariantSpec | null {
  return HAP_VARIANTS[codec] ?? null
}

export interface TargetSize {
  width: number
  height: number
}

/**
 * Round to whole texture blocks.
 *
 * A HAP frame is always a full 4x4-block texture. Declaring odd dimensions
 * leaves every decoder to guess how the partial blocks at the edge are meant to
 * be cropped, and they do not all guess the same way.
 */
function snapToBlock(value: number): number {
  return Math.max(4, Math.round(value / 4) * 4)
}

/** Output dimensions for a frame, honouring the resolution settings. */
export function targetSize(v: VideoSettings, sourceW: number, sourceH: number): TargetSize {
  if (sourceW <= 0 || sourceH <= 0) return { width: 4, height: 4 }

  if (v.resolution === 'custom') {
    return { width: snapToBlock(v.customWidth), height: snapToBlock(v.customHeight) }
  }

  const target = RESOLUTION_HEIGHT[v.resolution]
  if (!target) return { width: snapToBlock(sourceW), height: snapToBlock(sourceH) }

  // Never upscale: a 720p source asked for 1080p stays 720p, same as the
  // ffmpeg path's min(ih, target).
  const scale = Math.min(1, target / sourceH)
  return { width: snapToBlock(sourceW * scale), height: snapToBlock(sourceH * scale) }
}

export interface TextureOptions {
  variant: HapVariantSpec
  chunks: number
  /** Second-stage Snappy compression. Off trades ~10% size for speed. */
  compress: boolean
}

export function textureByteLength(variant: HapVariantSpec, width: number, height: number): number {
  return blocksWide(width) * blocksHigh(height) * variant.blockBytes
}

/**
 * Compress one frame of RGBA pixels into the bytes of a HAP sample.
 *
 * `rgba` is modified in place for HAP Q — the colour transform has no reason to
 * allocate a second full-resolution buffer per frame.
 */
export function encodeFrame(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  options: TextureOptions,
  scratch: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const { variant } = options

  switch (variant.texture) {
    case 'RGB_DXT1':
      compressDXT1(rgba, width, height, scratch)
      break
    case 'RGBA_DXT5':
      compressDXT5(rgba, width, height, scratch)
      break
    case 'YCoCg_DXT5':
      rgbaToYCoCg(rgba)
      compressDXT5(rgba, width, height, scratch)
      break
  }

  return encodeHapFrame(scratch, {
    format: variant.texture,
    chunks: options.chunks,
    blockBytes: variant.blockBytes,
    compress: options.compress,
    compressor: snappyCompress,
  })
}

export interface MovieLayout {
  /** In file order: ftyp, the mdat header, every frame, then moov. */
  parts: BlobPart[]
  totalBytes: number
}

/**
 * Lay out the finished file.
 *
 * `mdat` goes first, so the only thing that has to wait for the last frame is
 * the index — and the index is small. The frames are passed as separate parts
 * and never concatenated: a minute of 1080p HAP Q is around two gigabytes, and
 * no browser hands out that much contiguous memory.
 *
 * `sizes` comes in alongside the parts because a frame that has already been
 * handed to a Blob no longer has a readable length, and moving frames out of
 * the JS heap as they are produced is the whole point.
 */
export function layoutMovie(
  frames: BlobPart[],
  sizes: number[],
  info: Omit<MovTrackInfo, 'sampleSizes'>,
): MovieLayout {
  if (frames.length !== sizes.length) {
    throw new Error('Jedes Sample braucht genau eine Größe.')
  }
  const payload = sizes.reduce((sum, size) => sum + size, 0)

  const ftyp = buildFtyp()
  const mdatHeader = buildMdatHeader(payload)
  const mdatStart = ftyp.length + mdatHeader.length
  const moov = buildMoov({ ...info, sampleSizes: sizes }, mdatStart)

  return {
    parts: [ftyp, mdatHeader, ...frames, moov],
    totalBytes: mdatStart + payload + moov.length,
  }
}

/**
 * Media timescale and per-sample duration for a frame rate.
 *
 * Scaling by 1000 keeps 29.97 and 23.976 exact instead of rounding them into a
 * drift of a frame every few minutes.
 */
export function timebaseFor(fps: number): { timescale: number; sampleDelta: number } {
  const safe = fps > 0 && Number.isFinite(fps) ? fps : 30
  return { timescale: Math.round(safe * 1000), sampleDelta: 1000 }
}

/** Rough output size, for the warning shown before a long run starts. */
export function estimateBytes(
  variant: HapVariantSpec,
  width: number,
  height: number,
  frames: number,
): number {
  return textureByteLength(variant, width, height) * Math.max(0, frames)
}

/**
 * Maps source frame timestamps onto a constant output grid.
 *
 * A media server runs to timecode, so a HAP clip with a variable frame rate
 * drifts against everything else in the show. The grid is what keeps the output
 * honest: a source frame owns every slot that falls while it is on screen —
 * which duplicates it when the output rate is higher and skips it when lower.
 *
 * It is a small state machine rather than a loop over an array because frames
 * arrive one at a time from the decoder, and a slot cannot be settled until the
 * frame after it turns up.
 */
export class OutputGrid {
  private next = 0
  private started = false

  /**
   * Timestamps arrive as whole microseconds while the grid advances by a
   * fraction of one, so an exact comparison has 25 fps land a third of a
   * microsecond early and claim a slot that belongs to the next frame. A
   * microsecond of slack costs nothing and keeps a matching source and output
   * rate mapping one to one.
   */
  private static readonly EPSILON_US = 1

  constructor(
    readonly intervalUs: number,
    private readonly maxRepeats = 600,
  ) {}

  /**
   * How many slots the frame currently held owns, given that the next source
   * frame begins at `timestamp`. Zero for the very first frame, which only sets
   * where the grid starts.
   */
  slotsBefore(timestamp: number): number {
    if (!this.started) {
      this.started = true
      this.next = timestamp
      return 0
    }
    let slots = 0
    const until = timestamp - OutputGrid.EPSILON_US
    while (this.next < until && slots < this.maxRepeats) {
      this.next += this.intervalUs
      slots += 1
    }
    return slots
  }

  /**
   * How many slots the last frame owns. Nothing follows it, so its own duration
   * has to say where it ends — otherwise a one-second clip at six frames per
   * second comes out with seven.
   */
  slotsUntil(endUs: number): number {
    if (!this.started) return 0
    let slots = 0
    const until = endUs - OutputGrid.EPSILON_US
    while (this.next < until && slots < this.maxRepeats) {
      this.next += this.intervalUs
      slots += 1
    }
    return slots
  }
}
