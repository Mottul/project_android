/**
 * Reading colours back out of a rendered page.
 *
 * Replacing a line of text means painting over the original and drawing new
 * text in its place. Both need colours that the PDF itself does not hand over
 * conveniently: the page background at that spot (white is a bad guess on a
 * scan, a coloured box or a letterhead) and the colour the text was set in.
 *
 * Both are read off the canvas pdf.js already rendered. It is an approximation,
 * but it is the same approximation the reader sees, which is the one that
 * matters.
 */

import type { Rect } from '@/lib/geometry'

export interface SampledColors {
  /** Most common colour in the area — the background to paint over it with. */
  background: string
  /** Darkest colour with enough contrast to the background — the ink. */
  text: string
  /** False when the area is too varied to be covered convincingly. */
  uniform: boolean
}

/**
 * Samples the colours of a normalised rectangle on a rendered page canvas.
 *
 * Colours are bucketed to 4 bits per channel before counting. Anti-aliased text
 * produces hundreds of near-identical shades; without bucketing the "most
 * common colour" is whichever shade of near-white happened to win by one pixel.
 */
export function sampleColors(
  canvas: HTMLCanvasElement,
  box: Rect,
  fallbackBackground = '#ffffff',
): SampledColors {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return { background: fallbackBackground, text: '#000000', uniform: false }

  const x = Math.max(0, Math.floor(box.x * canvas.width))
  const y = Math.max(0, Math.floor(box.y * canvas.height))
  const w = Math.min(canvas.width - x, Math.ceil(box.w * canvas.width))
  const h = Math.min(canvas.height - y, Math.ceil(box.h * canvas.height))
  if (w < 1 || h < 1) return { background: fallbackBackground, text: '#000000', uniform: false }

  let data: Uint8ClampedArray
  try {
    data = context.getImageData(x, y, w, h).data
  } catch {
    // A canvas tainted by a cross-origin image cannot be read back.
    return { background: fallbackBackground, text: '#000000', uniform: false }
  }

  const buckets = new Map<number, number>()
  let darkest = 0xffffff
  let darkestLuma = 255

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    if (data[i + 3] < 8) continue

    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    buckets.set(key, (buckets.get(key) ?? 0) + 1)

    const luma = 0.299 * r + 0.587 * g + 0.114 * b
    if (luma < darkestLuma) {
      darkestLuma = luma
      darkest = (r << 16) | (g << 8) | b
    }
  }

  let bestKey = -1
  let bestCount = 0
  let total = 0
  for (const [key, count] of buckets) {
    total += count
    if (count > bestCount) {
      bestCount = count
      bestKey = key
    }
  }

  if (bestKey < 0 || total === 0) {
    return { background: fallbackBackground, text: '#000000', uniform: false }
  }

  // Bucket centres rather than lower bounds: closer to the real colour by half
  // a bucket on average, which is visible where a fill meets untouched page.
  const background = rgbToHex(
    (((bestKey >> 8) & 0xf) << 4) | 0x8,
    (((bestKey >> 4) & 0xf) << 4) | 0x8,
    ((bestKey & 0xf) << 4) | 0x8,
  )

  return {
    background,
    text: rgbToHex((darkest >> 16) & 0xff, (darkest >> 8) & 0xff, darkest & 0xff),
    // Below two thirds the area is a picture, a gradient or a table rule, and
    // painting it over with one colour would be obvious.
    uniform: bestCount / total > 0.66,
  }
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = hex.replace('#', '')
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value.padEnd(6, '0').slice(0, 6)
  const number = Number.parseInt(full, 16)
  return { r: (number >> 16) & 0xff, g: (number >> 8) & 0xff, b: number & 0xff }
}

/** 0..1 components, which is what pdf-lib's `rgb()` expects. */
export function hexToUnit(hex: string): { r: number; g: number; b: number } {
  const { r, g, b } = hexToRgb(hex)
  return { r: r / 255, g: g / 255, b: b / 255 }
}

/** Relative luminance, used to decide whether a colour needs light or dark text. */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex)
  const channel = (value: number) => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

export function readableTextColor(background: string): string {
  return luminance(background) > 0.45 ? '#111827' : '#ffffff'
}
