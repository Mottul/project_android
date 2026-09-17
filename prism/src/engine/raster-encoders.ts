/**
 * Encoders for the formats a canvas cannot produce.
 *
 * `canvas.convertToBlob()` covers PNG, JPEG, WebP and (in Chromium) AVIF. BMP,
 * TIFF and ICO it does not. Rather than drop those from the registry or pull in
 * a megabyte of WASM, they are written here directly — all three are simple,
 * well-documented container formats.
 */

/* ===========================================================================
   BMP - Windows Bitmap, BITMAPINFOHEADER, 24 or 32 bit, uncompressed
   ======================================================================== */

export function encodeBMP(image: ImageData, withAlpha = false): Blob {
  const { width, height, data } = image
  const bpp = withAlpha ? 4 : 3
  // Each pixel row is padded to a 4-byte boundary.
  const rowSize = Math.ceil((width * bpp) / 4) * 4
  const pixelBytes = rowSize * height
  const headerSize = 14 + 40
  const buffer = new ArrayBuffer(headerSize + pixelBytes)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)

  // BITMAPFILEHEADER
  bytes[0] = 0x42 // 'B'
  bytes[1] = 0x4d // 'M'
  view.setUint32(2, headerSize + pixelBytes, true)
  view.setUint32(10, headerSize, true)

  // BITMAPINFOHEADER
  view.setUint32(14, 40, true)
  view.setInt32(18, width, true)
  // A positive height means the rows are stored bottom-up, which is the
  // conventional (and most widely readable) BMP layout.
  view.setInt32(22, height, true)
  view.setUint16(26, 1, true) // planes
  view.setUint16(28, bpp * 8, true)
  view.setUint32(30, 0, true) // BI_RGB, no compression
  view.setUint32(34, pixelBytes, true)
  view.setInt32(38, 2835, true) // 72 DPI in pixels per metre
  view.setInt32(42, 2835, true)

  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * width * 4
    let dst = headerSize + y * rowSize
    for (let x = 0; x < width; x++) {
      const s = srcRow + x * 4
      // BMP stores BGR(A), not RGB(A).
      bytes[dst++] = data[s + 2]
      bytes[dst++] = data[s + 1]
      bytes[dst++] = data[s]
      if (withAlpha) bytes[dst++] = data[s + 3]
    }
  }

  return new Blob([buffer], { type: 'image/bmp' })
}

/* ===========================================================================
   TIFF - baseline, little-endian, single uncompressed strip
   ======================================================================== */

interface TiffTag {
  tag: number
  type: number // 3 = SHORT, 4 = LONG
  count: number
  values: number[]
}

const TIFF_SHORT = 3
const TIFF_LONG = 4

export function encodeTIFF(image: ImageData, withAlpha = true): Blob {
  const { width, height, data } = image
  const samples = withAlpha ? 4 : 3
  const pixelBytes = width * height * samples

  const tags: TiffTag[] = [
    { tag: 256, type: TIFF_LONG, count: 1, values: [width] }, // ImageWidth
    { tag: 257, type: TIFF_LONG, count: 1, values: [height] }, // ImageLength
    {
      tag: 258, // BitsPerSample
      type: TIFF_SHORT,
      count: samples,
      values: new Array(samples).fill(8),
    },
    { tag: 259, type: TIFF_SHORT, count: 1, values: [1] }, // Compression = none
    { tag: 262, type: TIFF_SHORT, count: 1, values: [2] }, // Photometric = RGB
    { tag: 273, type: TIFF_LONG, count: 1, values: [0] }, // StripOffsets, patched below
    { tag: 277, type: TIFF_SHORT, count: 1, values: [samples] }, // SamplesPerPixel
    { tag: 278, type: TIFF_LONG, count: 1, values: [height] }, // RowsPerStrip
    { tag: 279, type: TIFF_LONG, count: 1, values: [pixelBytes] }, // StripByteCounts
    { tag: 284, type: TIFF_SHORT, count: 1, values: [1] }, // PlanarConfig = chunky
  ]
  if (withAlpha) {
    // ExtraSamples = 2 (unassociated alpha). Without it readers guess, and some
    // guess premultiplied.
    tags.push({ tag: 338, type: TIFF_SHORT, count: 1, values: [2] })
  }
  tags.sort((a, b) => a.tag - b.tag)

  const typeSize = (type: number) => (type === TIFF_SHORT ? 2 : 4)
  // Values longer than four bytes live outside the IFD entry.
  const overflow = tags.filter((t) => typeSize(t.type) * t.count > 4)

  const ifdOffset = 8
  const ifdSize = 2 + tags.length * 12 + 4
  let overflowOffset = ifdOffset + ifdSize
  const overflowPositions = new Map<number, number>()
  for (const t of overflow) {
    overflowPositions.set(t.tag, overflowOffset)
    overflowOffset += typeSize(t.type) * t.count
  }

  const pixelOffset = overflowOffset
  const total = pixelOffset + pixelBytes
  const buffer = new ArrayBuffer(total)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)

  // Header: "II" little-endian, magic 42, offset of the first IFD.
  bytes[0] = 0x49
  bytes[1] = 0x49
  view.setUint16(2, 42, true)
  view.setUint32(4, ifdOffset, true)

  const stripOffsetTag = tags.find((t) => t.tag === 273)
  if (stripOffsetTag) stripOffsetTag.values = [pixelOffset]

  view.setUint16(ifdOffset, tags.length, true)
  tags.forEach((t, i) => {
    const entry = ifdOffset + 2 + i * 12
    view.setUint16(entry, t.tag, true)
    view.setUint16(entry + 2, t.type, true)
    view.setUint32(entry + 4, t.count, true)

    const size = typeSize(t.type) * t.count
    if (size > 4) {
      const at = overflowPositions.get(t.tag)!
      view.setUint32(entry + 8, at, true)
      t.values.forEach((v, j) => {
        if (t.type === TIFF_SHORT) view.setUint16(at + j * 2, v, true)
        else view.setUint32(at + j * 4, v, true)
      })
    } else {
      t.values.forEach((v, j) => {
        if (t.type === TIFF_SHORT) view.setUint16(entry + 8 + j * 2, v, true)
        else view.setUint32(entry + 8 + j * 4, v, true)
      })
    }
  })
  view.setUint32(ifdOffset + 2 + tags.length * 12, 0, true) // no further IFD

  let dst = pixelOffset
  for (let i = 0; i < width * height; i++) {
    const s = i * 4
    bytes[dst++] = data[s]
    bytes[dst++] = data[s + 1]
    bytes[dst++] = data[s + 2]
    if (withAlpha) bytes[dst++] = data[s + 3]
  }

  return new Blob([buffer], { type: 'image/tiff' })
}

/* ===========================================================================
   ICO - PNG-embedded, which every browser since IE11 reads
   ======================================================================== */

export interface IcoEntry {
  size: number
  png: ArrayBuffer
}

export function encodeICO(entries: IcoEntry[]): Blob {
  const count = entries.length
  const headerSize = 6 + count * 16
  let offset = headerSize

  const header = new ArrayBuffer(headerSize)
  const view = new DataView(header)
  view.setUint16(0, 0, true) // reserved
  view.setUint16(2, 1, true) // 1 = icon
  view.setUint16(4, count, true)

  entries.forEach((entry, i) => {
    const at = 6 + i * 16
    // 256 px is encoded as 0 — the field is a single byte.
    const dim = entry.size >= 256 ? 0 : entry.size
    view.setUint8(at, dim)
    view.setUint8(at + 1, dim)
    view.setUint8(at + 2, 0) // palette size
    view.setUint8(at + 3, 0) // reserved
    view.setUint16(at + 4, 1, true) // colour planes
    view.setUint16(at + 6, 32, true) // bits per pixel
    view.setUint32(at + 8, entry.png.byteLength, true)
    view.setUint32(at + 12, offset, true)
    offset += entry.png.byteLength
  })

  return new Blob([header, ...entries.map((e) => e.png)], { type: 'image/x-icon' })
}
