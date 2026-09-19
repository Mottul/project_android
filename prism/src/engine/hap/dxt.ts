/**
 * DXT / BC block compression.
 *
 * HAP does not store a video bitstream. It stores the exact GPU texture blocks
 * the graphics card wants, which is why playback costs almost no CPU — and why
 * encoding means running a texture compressor over every frame:
 *
 *   HAP        RGB  -> BC1 / DXT1        8 bytes per 4x4 block
 *   HAP Alpha  RGBA -> BC3 / DXT5       16 bytes per 4x4 block
 *   HAP Q      RGB  -> YCoCg + BC3      16 bytes per 4x4 block
 *
 * The fit is bounding-box endpoints followed by least-squares refinement. That
 * is a deliberate middle: a plain bounding box is visibly blocky on gradients,
 * a full principal-axis search costs roughly twice the time for a fraction of a
 * dB. Refinement is where the quality actually comes from.
 *
 * Everything here is written for the inner loop: no allocation per block, no
 * closures, scratch buffers hoisted to module scope.
 */

/** Interpolation weight of endpoint b for each of the four palette indices. */
const INDEX_WEIGHT = [0, 1, 1 / 3, 2 / 3]

/** How many least-squares passes refine the endpoints. Two is the knee. */
const REFINE_PASSES = 2

/* Scratch for one 4x4 block: 16 pixels, four channels. */
const blockR = new Int32Array(16)
const blockG = new Int32Array(16)
const blockB = new Int32Array(16)
const blockA = new Int32Array(16)
const blockIndex = new Uint8Array(16)

export function dxt1BlockBytes(width: number, height: number): number {
  return blocksWide(width) * blocksHigh(height) * 8
}

export function dxt5BlockBytes(width: number, height: number): number {
  return blocksWide(width) * blocksHigh(height) * 16
}

export function blocksWide(width: number): number {
  return Math.max(1, (width + 3) >> 2)
}

export function blocksHigh(height: number): number {
  return Math.max(1, (height + 3) >> 2)
}

/**
 * Read one 4x4 block out of an RGBA image into the scratch arrays.
 *
 * Blocks past the right or bottom edge repeat the last real pixel rather than
 * reading black: a black pad bleeds into the border blocks of the decoded
 * texture, and every HAP frame is a full texture whether the image fills it or
 * not.
 */
function gatherBlock(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  bx: number,
  by: number,
) {
  for (let y = 0; y < 4; y++) {
    const sy = Math.min(by * 4 + y, height - 1)
    const row = sy * width
    for (let x = 0; x < 4; x++) {
      const sx = Math.min(bx * 4 + x, width - 1)
      const src = (row + sx) * 4
      const i = y * 4 + x
      blockR[i] = rgba[src]
      blockG[i] = rgba[src + 1]
      blockB[i] = rgba[src + 2]
      blockA[i] = rgba[src + 3]
    }
  }
}

function quantize565(r: number, g: number, b: number): number {
  const qr = Math.round((clamp255(r) * 31) / 255)
  const qg = Math.round((clamp255(g) * 63) / 255)
  const qb = Math.round((clamp255(b) * 31) / 255)
  return (qr << 11) | (qg << 5) | qb
}

/** Expand 565 back the way the GPU does, so the fit sees the real palette. */
function expand565(c: number): { r: number; g: number; b: number } {
  const r5 = (c >> 11) & 31
  const g6 = (c >> 5) & 63
  const b5 = c & 31
  return {
    r: (r5 << 3) | (r5 >> 2),
    g: (g6 << 2) | (g6 >> 4),
    b: (b5 << 3) | (b5 >> 2),
  }
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

/* Endpoint state, module scope so the block loop allocates nothing. */
let e0r = 0
let e0g = 0
let e0b = 0
let e1r = 0
let e1g = 0
let e1b = 0

/** Bounding box of the block, inset to blunt single-pixel outliers. */
function boundingBoxEndpoints() {
  let minR = 255
  let minG = 255
  let minB = 255
  let maxR = 0
  let maxG = 0
  let maxB = 0

  for (let i = 0; i < 16; i++) {
    const r = blockR[i]
    const g = blockG[i]
    const b = blockB[i]
    if (r < minR) minR = r
    if (g < minG) minG = g
    if (b < minB) minB = b
    if (r > maxR) maxR = r
    if (g > maxG) maxG = g
    if (b > maxB) maxB = b
  }

  const insetR = (maxR - minR) >> 4
  const insetG = (maxG - minG) >> 4
  const insetB = (maxB - minB) >> 4

  e0r = clamp255(maxR - insetR)
  e0g = clamp255(maxG - insetG)
  e0b = clamp255(maxB - insetB)
  e1r = clamp255(minR + insetR)
  e1g = clamp255(minG + insetG)
  e1b = clamp255(minB + insetB)
}

/* The four palette colours for the current endpoints, as the GPU sees them. */
const palR = new Int32Array(4)
const palG = new Int32Array(4)
const palB = new Int32Array(4)

function buildPalette(c0: number, c1: number) {
  const a = expand565(c0)
  const b = expand565(c1)
  palR[0] = a.r
  palG[0] = a.g
  palB[0] = a.b
  palR[1] = b.r
  palG[1] = b.g
  palB[1] = b.b
  palR[2] = (2 * a.r + b.r + 1) / 3
  palG[2] = (2 * a.g + b.g + 1) / 3
  palB[2] = (2 * a.b + b.b + 1) / 3
  palR[3] = (a.r + 2 * b.r + 1) / 3
  palG[3] = (a.g + 2 * b.g + 1) / 3
  palB[3] = (a.b + 2 * b.b + 1) / 3
}

/**
 * Nearest palette entry per pixel.
 *
 * The channel weights are the usual luma approximation: the eye notices a green
 * error far more than a blue one, and an unweighted distance spends bits where
 * nobody looks.
 */
function assignIndices(): number {
  let error = 0
  for (let i = 0; i < 16; i++) {
    const r = blockR[i]
    const g = blockG[i]
    const b = blockB[i]
    let best = 0
    let bestErr = Infinity
    for (let p = 0; p < 4; p++) {
      const dr = r - palR[p]
      const dg = g - palG[p]
      const db = b - palB[p]
      const err = 3 * dr * dr + 6 * dg * dg + db * db
      if (err < bestErr) {
        bestErr = err
        best = p
      }
    }
    blockIndex[i] = best
    error += bestErr
  }
  return error
}

/**
 * Least-squares endpoints for the indices we already have.
 *
 * Given weights w (how far along the ramp each pixel sits), the endpoints that
 * minimise the squared error fall out of a 2x2 system. This is the step that
 * turns a coarse bounding box into a genuinely good fit.
 */
function refineEndpoints() {
  let ww = 0
  let vv = 0
  let wv = 0
  let ar = 0
  let ag = 0
  let ab = 0
  let br = 0
  let bg = 0
  let bb = 0

  for (let i = 0; i < 16; i++) {
    const w = INDEX_WEIGHT[blockIndex[i]]
    const v = 1 - w
    ww += w * w
    vv += v * v
    wv += w * v
    ar += v * blockR[i]
    ag += v * blockG[i]
    ab += v * blockB[i]
    br += w * blockR[i]
    bg += w * blockG[i]
    bb += w * blockB[i]
  }

  const det = vv * ww - wv * wv
  // Every pixel landed on the same ramp position; the system is degenerate and
  // the current endpoints are as good as anything.
  if (Math.abs(det) < 1e-6) return

  const inv = 1 / det
  e0r = clamp255(Math.round((ar * ww - br * wv) * inv))
  e0g = clamp255(Math.round((ag * ww - bg * wv) * inv))
  e0b = clamp255(Math.round((ab * ww - bb * wv) * inv))
  e1r = clamp255(Math.round((br * vv - ar * wv) * inv))
  e1g = clamp255(Math.round((bg * vv - ag * wv) * inv))
  e1b = clamp255(Math.round((bb * vv - ab * wv) * inv))
}

/**
 * Fit the colour half of a block and write its 8 bytes.
 *
 * DXT1 reserves the c0 <= c1 ordering for the three-colour-plus-punchthrough
 * mode. HAP textures are opaque, so the four-colour mode is always what we
 * want and the endpoints are swapped when quantisation inverts them.
 */
function writeColorBlock(out: Uint8Array, at: number) {
  boundingBoxEndpoints()

  let c0 = quantize565(e0r, e0g, e0b)
  let c1 = quantize565(e1r, e1g, e1b)

  if (c0 === c1) {
    // Flat block: one colour, every index 0. No ramp to fit.
    out[at] = c0 & 0xff
    out[at + 1] = (c0 >> 8) & 0xff
    out[at + 2] = c1 & 0xff
    out[at + 3] = (c1 >> 8) & 0xff
    out[at + 4] = 0
    out[at + 5] = 0
    out[at + 6] = 0
    out[at + 7] = 0
    return
  }

  buildPalette(c0, c1)
  assignIndices()

  for (let pass = 0; pass < REFINE_PASSES; pass++) {
    refineEndpoints()
    const r0 = quantize565(e0r, e0g, e0b)
    const r1 = quantize565(e1r, e1g, e1b)
    if (r0 === r1) break
    c0 = r0
    c1 = r1
    buildPalette(c0, c1)
    assignIndices()
  }

  if (c0 < c1) {
    const t = c0
    c0 = c1
    c1 = t
    // Swapping the endpoints swaps 0 with 1 and 2 with 3 — one xor covers both.
    for (let i = 0; i < 16; i++) blockIndex[i] ^= 1
  }

  out[at] = c0 & 0xff
  out[at + 1] = (c0 >> 8) & 0xff
  out[at + 2] = c1 & 0xff
  out[at + 3] = (c1 >> 8) & 0xff

  for (let row = 0; row < 4; row++) {
    out[at + 4 + row] =
      blockIndex[row * 4] |
      (blockIndex[row * 4 + 1] << 2) |
      (blockIndex[row * 4 + 2] << 4) |
      (blockIndex[row * 4 + 3] << 6)
  }
}

/**
 * Fit the alpha half of a DXT5 block and write its 8 bytes.
 *
 * Eight interpolated levels along min..max. For HAP Q this channel carries
 * luma, which is why HAP Q looks so much better than plain HAP at the same
 * block size: the eye's most sensitive channel gets the most precise ramp.
 */
function writeAlphaBlock(out: Uint8Array, at: number) {
  let min = 255
  let max = 0
  for (let i = 0; i < 16; i++) {
    const a = blockA[i]
    if (a < min) min = a
    if (a > max) max = a
  }

  out[at] = max
  out[at + 1] = min

  if (max === min) {
    out[at + 2] = 0
    out[at + 3] = 0
    out[at + 4] = 0
    out[at + 5] = 0
    out[at + 6] = 0
    out[at + 7] = 0
    return
  }

  // Palette order for the a0 > a1 mode: endpoints first, then six steps.
  const span = max - min
  let bits = 0
  let bitCount = 0
  let byteAt = at + 2

  for (let i = 0; i < 16; i++) {
    const a = blockA[i]
    // Position on the 7-step ramp from max down to min.
    const t = Math.round(((max - a) * 7) / span)
    const index = t === 0 ? 0 : t === 7 ? 1 : t + 1
    bits |= index << bitCount
    bitCount += 3
    while (bitCount >= 8) {
      out[byteAt++] = bits & 0xff
      bits >>>= 8
      bitCount -= 8
    }
  }
  if (bitCount > 0) out[byteAt] = bits & 0xff
}

/** Compress an RGBA image to DXT1, ignoring alpha. 8 bytes per block. */
export function compressDXT1(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  out: Uint8Array,
): Uint8Array {
  const bw = blocksWide(width)
  const bh = blocksHigh(height)
  let at = 0
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      gatherBlock(rgba, width, height, bx, by)
      writeColorBlock(out, at)
      at += 8
    }
  }
  return out
}

/** Compress an RGBA image to DXT5. 16 bytes per block. */
export function compressDXT5(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  out: Uint8Array,
): Uint8Array {
  const bw = blocksWide(width)
  const bh = blocksHigh(height)
  let at = 0
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      gatherBlock(rgba, width, height, bx, by)
      writeAlphaBlock(out, at)
      writeColorBlock(out, at + 8)
      at += 16
    }
  }
  return out
}

/**
 * RGB -> YCoCg, in place, as HAP Q wants it.
 *
 * The channels are rearranged to (Co, Cg, scale, Y) so that a plain DXT5
 * compressor does the right thing: chroma lands in the coarse colour block,
 * luma in the precise alpha ramp. The scale byte stays 0, which the HAP decode
 * shader reads as "chroma is unscaled" — the per-block scaling the format also
 * allows buys very little on real footage and costs a second pass over the
 * block.
 *
 *   Y  =  (R + 2G + B) / 4
 *   Co =  (R - B) / 2      + 128
 *   Cg = (-R + 2G - B) / 4 + 128
 */
export function rgbaToYCoCg(rgba: Uint8Array | Uint8ClampedArray): void {
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i]
    const g = rgba[i + 1]
    const b = rgba[i + 2]
    const y = (r + 2 * g + b + 2) >> 2
    const co = ((r - b + 1) >> 1) + 128
    const cg = ((-r + 2 * g - b + 2) >> 2) + 128
    rgba[i] = co < 0 ? 0 : co > 255 ? 255 : co
    rgba[i + 1] = cg < 0 ? 0 : cg > 255 ? 255 : cg
    rgba[i + 2] = 0
    rgba[i + 3] = y < 0 ? 0 : y > 255 ? 255 : y
  }
}

/** Inverse of `rgbaToYCoCg`, for the round-trip tests. */
export function ycocgToRgba(data: Uint8Array | Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const co = data[i] - 128
    const cg = data[i + 1] - 128
    const y = data[i + 3]
    const r = y + co - cg
    const g = y + cg
    const b = y - co - cg
    data[i] = r < 0 ? 0 : r > 255 ? 255 : r
    data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g
    data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b
    data[i + 3] = 255
  }
}
