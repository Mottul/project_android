import type { MediaFamily } from '@/lib/formats'
import type { MediaProbe } from './types'

/**
 * Fast metadata read using the browser's own demuxers.
 *
 * Deliberately does not touch ffmpeg: spinning up a 30 MB WASM core just to
 * learn a video's duration would make the queue feel slow for no reason. What
 * this cannot tell us (exact codec strings, per-stream detail) is filled in
 * later by the engine that actually runs the job.
 */

const POSTER_MAX_EDGE = 320
/** Seek a little into the file; frame zero is often black or a slate. */
const POSTER_SEEK_RATIO = 0.12

function withObjectUrl<T>(file: File, fn: (url: string) => Promise<T>): Promise<T> {
  const url = URL.createObjectURL(file)
  return fn(url).finally(() => URL.revokeObjectURL(url))
}

function drawPoster(source: CanvasImageSource, width: number, height: number): string | undefined {
  if (!width || !height) return undefined
  const scale = Math.min(POSTER_MAX_EDGE / width, POSTER_MAX_EDGE / height, 1)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return undefined
  ctx.imageSmoothingQuality = 'high'
  try {
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.72)
  } catch {
    // Tainted canvas or a decoder that refuses to hand over pixels.
    return undefined
  }
}

async function probeVideo(file: File): Promise<MediaProbe> {
  return withObjectUrl(file, (url) => {
    return new Promise<MediaProbe>((resolve) => {
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.muted = true
      video.playsInline = true
      // A cross-origin-free blob URL keeps the canvas untainted.
      video.src = url

      let settled = false
      const finish = (probe: MediaProbe) => {
        if (settled) return
        settled = true
        video.removeAttribute('src')
        video.load()
        resolve(probe)
      }

      // Some containers (notably broken MKV) never fire loadedmetadata.
      const timeout = setTimeout(() => finish({}), 8000)

      video.onloadedmetadata = () => {
        const base: MediaProbe = {
          durationSec: Number.isFinite(video.duration) ? video.duration : undefined,
          width: video.videoWidth || undefined,
          height: video.videoHeight || undefined,
          bitrateKbps:
            Number.isFinite(video.duration) && video.duration > 0
              ? Math.round((file.size * 8) / video.duration / 1000)
              : undefined,
        }

        // Grab a poster frame, but never let it hold up the queue.
        const posterTimeout = setTimeout(() => {
          clearTimeout(timeout)
          finish(base)
        }, 4000)

        video.onseeked = () => {
          clearTimeout(posterTimeout)
          clearTimeout(timeout)
          finish({
            ...base,
            posterUrl: drawPoster(video, video.videoWidth, video.videoHeight),
          })
        }
        video.onerror = () => {
          clearTimeout(posterTimeout)
          clearTimeout(timeout)
          finish(base)
        }

        const target = (base.durationSec ?? 0) * POSTER_SEEK_RATIO
        try {
          video.currentTime = Math.min(Math.max(target, 0.1), (base.durationSec ?? 1) - 0.05)
        } catch {
          clearTimeout(posterTimeout)
          clearTimeout(timeout)
          finish(base)
        }
      }

      video.onerror = () => {
        clearTimeout(timeout)
        finish({})
      }
    })
  })
}

async function probeAudio(file: File): Promise<MediaProbe> {
  return withObjectUrl(file, (url) => {
    return new Promise<MediaProbe>((resolve) => {
      const audio = document.createElement('audio')
      audio.preload = 'metadata'
      audio.src = url
      const timeout = setTimeout(() => resolve({}), 6000)
      audio.onloadedmetadata = () => {
        clearTimeout(timeout)
        const durationSec = Number.isFinite(audio.duration) ? audio.duration : undefined
        resolve({
          durationSec,
          bitrateKbps:
            durationSec && durationSec > 0
              ? Math.round((file.size * 8) / durationSec / 1000)
              : undefined,
        })
      }
      audio.onerror = () => {
        clearTimeout(timeout)
        resolve({})
      }
    })
  })
}

async function probeImage(file: File): Promise<MediaProbe> {
  try {
    const bitmap = await createImageBitmap(file)
    const probe: MediaProbe = {
      width: bitmap.width,
      height: bitmap.height,
      posterUrl: drawPoster(bitmap, bitmap.width, bitmap.height),
      hasAlpha: detectAlpha(bitmap),
    }
    bitmap.close()
    return probe
  } catch {
    // SVG and anything the browser will not decode land here; the <img>
    // fallback handles SVG because it resolves the intrinsic size itself.
    return withObjectUrl(file, (url) => {
      return new Promise<MediaProbe>((resolve) => {
        const img = new Image()
        const timeout = setTimeout(() => resolve({}), 5000)
        img.onload = () => {
          clearTimeout(timeout)
          resolve({
            width: img.naturalWidth || undefined,
            height: img.naturalHeight || undefined,
            posterUrl: drawPoster(img, img.naturalWidth || 300, img.naturalHeight || 300),
            hasAlpha: true,
          })
        }
        img.onerror = () => {
          clearTimeout(timeout)
          resolve({})
        }
        img.src = url
      })
    })
  }
}

/**
 * Sample a downscaled copy for non-opaque pixels. Cheaper and more truthful
 * than trusting the file extension — most PNGs in the wild are fully opaque.
 */
function detectAlpha(bitmap: ImageBitmap): boolean {
  const w = Math.min(bitmap.width, 80)
  const h = Math.min(bitmap.height, 80)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return false
  ctx.drawImage(bitmap, 0, 0, w, h)
  try {
    const { data } = ctx.getImageData(0, 0, w, h)
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) return true
    }
  } catch {
    return false
  }
  return false
}

export async function probeFile(file: File, family: MediaFamily): Promise<MediaProbe> {
  switch (family) {
    case 'video':
      return probeVideo(file)
    case 'audio':
      return probeAudio(file)
    case 'image':
      return probeImage(file)
    default:
      return {}
  }
}
