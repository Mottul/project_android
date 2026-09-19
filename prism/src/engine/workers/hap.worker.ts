/// <reference lib="webworker" />

import { sanitizeFilename } from '@/lib/format-utils'
import { baseNameOf } from '@/lib/formats'
import {
  encodeFrame,
  estimateBytes,
  hapVariantFor,
  layoutMovie,
  OutputGrid,
  targetSize,
  textureByteLength,
  timebaseFor,
} from '../hap/encode'
import { openFrameSource, UnsupportedSource, type FrameSource } from '../hap/frame-source'
import type { WorkerRequest, WorkerResponse } from '../types'

/**
 * The HAP encoder.
 *
 * Decode a frame, scale it, run a texture compressor over it, append the
 * result to a QuickTime file. No ffmpeg involved: the stock ffmpeg.wasm core
 * has no HAP encoder and building one needs libsnappy, Docker and an afternoon
 * — whereas the actual work, DXT block compression, is a few hundred lines and
 * runs anywhere.
 *
 * It lives in a worker because a 1080p frame is roughly 130,000 blocks to fit
 * and that is not something to do on the thread painting the progress bar.
 */

declare const self: DedicatedWorkerGlobalScope

const GiB = 1024 ** 3

/**
 * Ceiling on how often one source frame may fill repeated output slots. A
 * timelapse legitimately holds a frame for seconds; a corrupt timestamp would
 * otherwise ask for millions of copies.
 */
const MAX_REPEATS = 600

const post = (msg: WorkerResponse) => self.postMessage(msg)

/** Set by a cancel message; every loop checks it between frames. */
const aborts = new Map<string, AbortController>()

interface Canvas {
  canvas: OffscreenCanvas
  ctx: OffscreenCanvasRenderingContext2D
}

function makeCanvas(width: number, height: number): Canvas {
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true })
  if (!ctx) throw new Error('Dieser Browser stellt keinen OffscreenCanvas-Kontext bereit.')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  return { canvas, ctx }
}

/**
 * Draw a decoded frame into the output-sized canvas.
 *
 * `cover` crops, `contain` letterboxes, anything else stretches — the same
 * three choices the ffmpeg path offers, so switching codecs does not silently
 * reframe the picture.
 */
function drawFrame(
  { ctx }: Canvas,
  frame: VideoFrame,
  width: number,
  height: number,
  fit: string,
  keepAlpha: boolean,
) {
  const sourceW = frame.displayWidth || frame.codedWidth
  const sourceH = frame.displayHeight || frame.codedHeight

  if (keepAlpha) ctx.clearRect(0, 0, width, height)
  else {
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, width, height)
  }

  if (fit === 'cover') {
    const scale = Math.max(width / sourceW, height / sourceH)
    const cropW = Math.min(sourceW, Math.round(width / scale))
    const cropH = Math.min(sourceH, Math.round(height / scale))
    ctx.drawImage(
      frame,
      Math.round((sourceW - cropW) / 2),
      Math.round((sourceH - cropH) / 2),
      cropW,
      cropH,
      0,
      0,
      width,
      height,
    )
    return
  }

  if (fit === 'contain') {
    const scale = Math.min(width / sourceW, height / sourceH)
    const drawW = Math.round(sourceW * scale)
    const drawH = Math.round(sourceH * scale)
    ctx.drawImage(
      frame,
      Math.round((width - drawW) / 2),
      Math.round((height - drawH) / 2),
      drawW,
      drawH,
    )
    return
  }

  ctx.drawImage(frame, 0, 0, width, height)
}

async function convert(req: WorkerRequest) {
  const started = performance.now()
  const { id, file, settings } = req
  if (!file || !settings) throw new Error('Auftrag ohne Datei oder Einstellungen')

  const v = settings.video
  const variant = hapVariantFor(v.codec)
  if (!variant) throw new Error(`${v.codec} ist keine HAP-Variante, die diese Engine schreibt.`)

  const controller = new AbortController()
  aborts.set(id, controller)

  post({ id, type: 'progress', progress: null, stage: 'Quelle lesen' })

  let source: FrameSource
  try {
    source = await openFrameSource(file)
  } catch (err) {
    if (err instanceof UnsupportedSource) {
      // The scheduler answers this by transcoding to an intermediate the
      // browser can decode and handing the job straight back.
      post({ id, type: 'fallback', reason: err.message })
      return
    }
    throw err
  }

  try {
    const { width, height } = targetSize(v, source.info.width, source.info.height)
    const fps = v.fps > 0 ? v.fps : source.info.fps
    const { timescale, sampleDelta } = timebaseFor(fps)

    const expected = estimateBytes(variant, width, height, source.info.frameCount)
    if (expected > GiB) {
      post({
        id,
        type: 'warning',
        message:
          `${variant.label} bei ${width} × ${height} ergibt rund ` +
          `${(expected / 1024 ** 3).toFixed(1)} GB. HAP komprimiert mit festem Faktor — ` +
          `das ist normal, nicht eine falsche Einstellung.`,
      })
    }

    const canvas = makeCanvas(width, height)
    const scratch = new Uint8Array(textureByteLength(variant, width, height))
    const options = {
      variant,
      chunks: Math.max(1, Math.min(64, Math.round(v.hapChunks))),
      // Snappy on top of DXT wins around a tenth of the size for a small
      // fraction of the time the block fit already costs.
      compress: true,
    }

    /*
     * Finished frames are handed straight to a Blob rather than kept as typed
     * arrays. The browser owns that memory and spills it to disk when it grows;
     * a two-gigabyte HAP Q clip held as JS arrays would simply run the worker
     * out of heap somewhere in the middle.
     */
    const frames: Blob[] = []
    const sizes: number[] = []
    const frameInterval = 1e6 / (fps > 0 ? fps : 30)
    const total = source.info.frameCount || 0

    /*
     * Output is resampled onto a constant grid, which is what a media server
     * wants: a variable frame rate makes a HAP clip drift against the show's
     * timecode. One frame of lookahead is held back, because an output slot
     * belongs to the last frame that started before it — so a slot is only
     * settled once the following frame's timestamp is known.
     */
    const grid = new OutputGrid(frameInterval, MAX_REPEATS)
    let held: Uint8ClampedArray | null = null
    let heldEncoded: Blob | null = null
    let heldSize = 0
    let heldUntil = 0
    let decoded = 0
    let lastPost = 0

    // How long a source frame stays on screen, for frames that do not carry a
    // duration of their own.
    const sourceInterval = 1e6 / (source.info.fps > 0 ? source.info.fps : fps)

    const emit = (slots: number) => {
      if (slots <= 0 || held === null) return
      // The same Blob is referenced again when a slot repeats, so a held frame
      // is compressed once and stored once however long it stays on screen.
      if (heldEncoded === null) {
        const bytes = encodeFrame(held, width, height, options, scratch)
        heldSize = bytes.length
        heldEncoded = new Blob([bytes])
      }
      for (let i = 0; i < slots; i++) {
        frames.push(heldEncoded)
        sizes.push(heldSize)
      }
    }

    for await (const frame of source.frames(controller.signal)) {
      if (controller.signal.aborted) {
        frame.close()
        break
      }
      decoded += 1
      const timestamp = frame.timestamp ?? decoded * frameInterval

      emit(grid.slotsBefore(timestamp))

      drawFrame(canvas, frame, width, height, v.fit, variant.alpha)
      held = canvas.ctx.getImageData(0, 0, width, height).data
      heldEncoded = null
      // `||` rather than `??`: a zero duration is as useless as a missing one.
      heldUntil = timestamp + (frame.duration || sourceInterval)
      frame.close()

      const now = performance.now()
      if (now - lastPost > 120) {
        lastPost = now
        post({
          id,
          type: 'progress',
          progress: total > 0 ? Math.min(0.99, decoded / total) : null,
          stage: `${variant.label} · Bild ${frames.length + 1}`,
        })
      }
    }

    if (controller.signal.aborted) return
    emit(grid.slotsUntil(heldUntil))
    if (frames.length === 0) throw new Error('Aus dieser Datei kam kein einziges Bild an.')

    post({ id, type: 'progress', progress: 0.995, stage: 'Container schreiben' })

    const layout = layoutMovie(frames, sizes, {
      variant: variant.fourcc,
      width,
      height,
      timescale,
      sampleDelta,
      compressorName: variant.compressorName,
      depth: variant.depth,
    })

    const blob = new Blob(layout.parts, { type: 'video/quicktime' })
    const stem = sanitizeFilename(baseNameOf(file.name)) || 'prism_output'

    post({
      id,
      type: 'done',
      blob,
      filename: `${stem}.mov`,
      mime: 'video/quicktime',
      engine: `hap (${variant.label})`,
      durationMs: performance.now() - started,
    })
  } finally {
    source.close()
    aborts.delete(id)
  }
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data
  if (req.type === 'cancel') {
    aborts.get(req.id)?.abort()
    return
  }
  try {
    if (req.type === 'convert') await convert(req)
  } catch (err) {
    aborts.delete(req.id)
    post({ id: req.id, type: 'error', message: (err as Error).message })
  }
}

post({ id: 'boot', type: 'ready' })
