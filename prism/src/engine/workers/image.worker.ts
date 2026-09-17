/// <reference lib="webworker" />

import { FORMATS } from '@/lib/formats'
import { evenUp, withExtension } from '@/lib/format-utils'
import { encodeBMP, encodeICO, encodeTIFF } from '../raster-encoders'
import type { ImageSettings, WorkerRequest, WorkerResponse } from '../types'

/**
 * Image pipeline.
 *
 * Runs entirely on OffscreenCanvas in a worker so a 60 MP panorama never blocks
 * the UI thread. Formats the canvas cannot encode are handed to the hand-written
 * encoders in raster-encoders.ts.
 */

declare const self: DedicatedWorkerGlobalScope

const post = (msg: WorkerResponse, transfer?: Transferable[]) =>
  transfer ? self.postMessage(msg, transfer) : self.postMessage(msg)

/** Formats OffscreenCanvas.convertToBlob() can produce directly. */
const NATIVE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif'])

interface TargetSize {
  width: number
  height: number
  /** Source rectangle, for the crop that 'fill' performs. */
  sx: number
  sy: number
  sw: number
  sh: number
}

function computeTarget(srcW: number, srcH: number, s: ImageSettings): TargetSize {
  const full = { sx: 0, sy: 0, sw: srcW, sh: srcH }

  switch (s.resizeMode) {
    case 'percent': {
      const f = Math.max(1, s.percent) / 100
      return { ...full, width: Math.max(1, Math.round(srcW * f)), height: Math.max(1, Math.round(srcH * f)) }
    }

    case 'fit': {
      // Largest size that fits inside the box, aspect ratio preserved.
      const scale = Math.min(s.width / srcW, s.height / srcH)
      const f = s.noUpscale ? Math.min(scale, 1) : scale
      return { ...full, width: Math.max(1, Math.round(srcW * f)), height: Math.max(1, Math.round(srcH * f)) }
    }

    case 'exact':
      return { ...full, width: Math.max(1, s.width), height: Math.max(1, s.height) }

    case 'fill': {
      // Cover the box, then centre-crop the overflow off the source.
      const targetRatio = s.width / s.height
      const srcRatio = srcW / srcH
      let sw = srcW
      let sh = srcH
      if (srcRatio > targetRatio) {
        sw = Math.round(srcH * targetRatio)
      } else {
        sh = Math.round(srcW / targetRatio)
      }
      return {
        width: Math.max(1, s.width),
        height: Math.max(1, s.height),
        sx: Math.round((srcW - sw) / 2),
        sy: Math.round((srcH - sh) / 2),
        sw,
        sh,
      }
    }

    default:
      return { ...full, width: srcW, height: srcH }
  }
}

/**
 * Draw with progressive halving.
 *
 * A single drawImage from 6000 px down to 400 px aliases badly even with
 * imageSmoothingQuality 'high', because the browser samples a small kernel.
 * Halving repeatedly keeps every source pixel contributing.
 */
function drawScaled(
  source: ImageBitmap,
  target: TargetSize,
  background: string,
): OffscreenCanvas {
  let currentW = target.sw
  let currentH = target.sh
  let current: ImageBitmap | OffscreenCanvas = source
  let sx = target.sx
  let sy = target.sy

  while (currentW > target.width * 2 && currentH > target.height * 2) {
    const nextW = Math.max(target.width, Math.floor(currentW / 2))
    const nextH = Math.max(target.height, Math.floor(currentH / 2))
    const step = new OffscreenCanvas(nextW, nextH)
    const stepCtx = step.getContext('2d')!
    stepCtx.imageSmoothingEnabled = true
    stepCtx.imageSmoothingQuality = 'high'
    stepCtx.drawImage(current, sx, sy, currentW, currentH, 0, 0, nextW, nextH)
    current = step
    currentW = nextW
    currentH = nextH
    // After the first pass the crop has already been applied.
    sx = 0
    sy = 0
  }

  const canvas = new OffscreenCanvas(target.width, target.height)
  const ctx = canvas.getContext('2d')!
  if (background) {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, target.width, target.height)
  }
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(current, sx, sy, currentW, currentH, 0, 0, target.width, target.height)
  return canvas
}

async function encodeCanvas(
  canvas: OffscreenCanvas,
  mime: string,
  quality: number,
): Promise<Blob> {
  // PNG ignores quality; passing it anyway is harmless but noisy.
  const options: ImageEncodeOptions =
    mime === 'image/png' ? { type: mime } : { type: mime, quality: quality / 100 }
  return canvas.convertToBlob(options)
}

async function buildIco(source: ImageBitmap, sizes: number[]): Promise<Blob> {
  const ordered = [...new Set(sizes)].sort((a, b) => a - b).filter((s) => s > 0 && s <= 256)
  const entries = []
  for (const size of ordered) {
    const canvas = drawScaled(
      source,
      { width: size, height: size, sx: 0, sy: 0, sw: source.width, sh: source.height },
      '',
    )
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    entries.push({ size, png: await blob.arrayBuffer() })
  }
  return encodeICO(entries)
}

async function convert(req: WorkerRequest) {
  const started = performance.now()
  const { id, file, settings } = req
  if (!file || !settings) throw new Error('Auftrag ohne Datei oder Einstellungen')

  const s = settings.image
  const format = FORMATS[s.format]
  if (!format) throw new Error(`Unbekanntes Zielformat: ${s.format}`)

  post({ id, type: 'progress', progress: 0.05, stage: 'Dekodieren' })

  let source: ImageBitmap
  try {
    source = await createImageBitmap(file)
  } catch (err) {
    throw new Error(
      `Dieses Bild kann der Browser nicht dekodieren (${format.label}). ` +
        `Bei HEIC oder RAW ist das erwartbar. (${(err as Error).message})`,
    )
  }

  post({
    id,
    type: 'progress',
    progress: 0.3,
    stage: `Skalieren (${source.width} × ${source.height})`,
  })

  const outputName = withExtension(file.name, format.ext)

  // ICO is multi-resolution and bypasses the single-canvas path entirely.
  if (format.id === 'ico') {
    const blob = await buildIco(source, s.iconSizes)
    source.close()
    post({
      id,
      type: 'done',
      blob,
      filename: outputName,
      mime: 'image/x-icon',
      engine: 'canvas',
      durationMs: performance.now() - started,
    })
    return
  }

  const target = computeTarget(source.width, source.height, s)
  if (format.family === 'video' || format.id === 'jpeg') {
    // JPEG has no alpha channel, so transparency must be flattened onto
    // something. White is the least surprising default.
    target.width = evenUp(target.width)
    target.height = evenUp(target.height)
  }

  const needsFlatten = !format.alpha || s.background !== ''
  const background = needsFlatten ? s.background || '#ffffff' : ''

  const canvas = drawScaled(source, target, background)
  source.close()

  post({ id, type: 'progress', progress: 0.65, stage: 'Kodieren' })

  let blob: Blob
  if (NATIVE_TYPES.has(format.mime)) {
    blob = await encodeCanvas(canvas, format.mime, s.lossless ? 100 : s.quality)
    if (blob.type !== format.mime) {
      throw new Error(
        `${format.label} kann dieser Browser nicht schreiben. ` +
          `AVIF gelingt nur in Chromium-Browsern.`,
      )
    }
  } else if (format.id === 'bmp' || format.id === 'tiff') {
    const ctx = canvas.getContext('2d')!
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    blob =
      format.id === 'bmp'
        ? encodeBMP(imageData, Boolean(format.alpha) && !needsFlatten)
        : encodeTIFF(imageData, !needsFlatten)
  } else {
    throw new Error(`${format.label} wird von dieser Engine nicht geschrieben.`)
  }

  post({
    id,
    type: 'done',
    blob,
    filename: outputName,
    mime: blob.type || format.mime,
    engine: 'canvas',
    durationMs: performance.now() - started,
  })
}

async function probe(req: WorkerRequest) {
  const { id, file } = req
  if (!file) return
  try {
    const bitmap = await createImageBitmap(file)
    // Sample the alpha channel rather than trusting the extension: plenty of
    // PNGs are fully opaque and can go to JPEG without losing anything.
    let hasAlpha = false
    const probeCanvas = new OffscreenCanvas(Math.min(bitmap.width, 64), Math.min(bitmap.height, 64))
    const ctx = probeCanvas.getContext('2d')
    if (ctx) {
      ctx.drawImage(bitmap, 0, 0, probeCanvas.width, probeCanvas.height)
      const { data } = ctx.getImageData(0, 0, probeCanvas.width, probeCanvas.height)
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] < 255) {
          hasAlpha = true
          break
        }
      }
    }
    post({
      id,
      type: 'probe',
      probe: { width: bitmap.width, height: bitmap.height, hasAlpha },
    })
    bitmap.close()
  } catch {
    post({ id, type: 'probe', probe: {} })
  }
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data
  try {
    if (req.type === 'probe') await probe(req)
    else if (req.type === 'convert') await convert(req)
  } catch (err) {
    post({ id: req.id, type: 'error', message: (err as Error).message })
  }
}

post({ id: 'boot', type: 'ready' })
