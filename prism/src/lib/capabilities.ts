/**
 * Runtime capability probe.
 *
 * Prism deliberately does not assume a baseline. Every platform gets the best
 * pipeline it can actually run, and the UI is told what was lost so the user
 * sees a limit instead of a crash. The two facts that drive almost every
 * downstream decision are:
 *
 *   - `webcodecs`      -> hardware encode/decode is available (10-30x faster)
 *   - `streamingWrite` -> output can go straight to disk, so file size is
 *                         bounded by the drive rather than by RAM
 */

export type EnginePath = 'webcodecs' | 'ffmpeg-mt' | 'ffmpeg-st' | 'canvas'

export interface StorageInfo {
  /** Bytes the origin may persist, as reported by the browser. */
  quota: number
  usage: number
  /** True once the user (or a heuristic) granted persistent storage. */
  persisted: boolean
}

export interface Capabilities {
  /** SharedArrayBuffer is usable -> multi-threaded ffmpeg core. */
  crossOriginIsolated: boolean
  sharedArrayBuffer: boolean
  /** VideoEncoder/VideoDecoder present -> hardware-accelerated path. */
  webcodecs: boolean
  /** ImageDecoder present -> decode HEIC/AVIF without a WASM decoder. */
  imageDecoder: boolean
  /** navigator.gpu -> GPU scaling, colour conversion, later DXT for HAP. */
  webgpu: boolean
  /** showOpenFilePicker/showSaveFilePicker -> read and write real files. */
  fileSystemAccess: boolean
  /** A writable stream to disk, i.e. output is not capped by memory. */
  streamingWrite: boolean
  /** Origin Private File System -> scratch space for intermediate data. */
  opfs: boolean
  /** Logical cores; caps how many jobs run at once. */
  cores: number
  /** GiB of RAM, quantised by the browser. Undefined on Safari/Firefox. */
  deviceMemory: number | undefined
  offscreenCanvas: boolean

  isIOS: boolean
  isSafari: boolean
  isFirefox: boolean
  isMobile: boolean
  isInstalled: boolean

  storage: StorageInfo | null

  /** Encoders confirmed by VideoEncoder.isConfigSupported(). */
  hardwareCodecs: string[]
  /** Image mime types the canvas can actually encode to. */
  imageEncoders: string[]

  limits: {
    /** Above this, warn but allow. */
    softMaxBytes: number
    /** Above this, refuse and explain why. */
    hardMaxBytes: number
    /** Threads handed to the ffmpeg core. */
    threads: number
    /** Jobs that may run concurrently. */
    concurrency: number
  }

  /** Ordered best-first; the router walks this list. */
  paths: EnginePath[]
}

const GiB = 1024 ** 3

function detectPlatform() {
  const ua = navigator.userAgent
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports as a Mac; touch points give it away.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua)
  const isFirefox = /firefox|fxios/i.test(ua)
  const isMobile = isIOS || /Android|Mobile/i.test(ua)
  const isInstalled =
    matchMedia('(display-mode: standalone)').matches ||
    matchMedia('(display-mode: window-controls-overlay)').matches ||
    // iOS Safari uses a non-standard flag.
    (navigator as unknown as { standalone?: boolean }).standalone === true

  return { isIOS, isSafari, isFirefox, isMobile, isInstalled }
}

/**
 * Codecs worth probing. These are the ones a hardware encoder realistically
 * exposes; anything else falls through to ffmpeg.wasm.
 */
const CODEC_PROBES: Array<{ id: string; config: VideoEncoderConfig }> = [
  {
    id: 'h264',
    config: { codec: 'avc1.640028', width: 1920, height: 1080, bitrate: 8e6, framerate: 30 },
  },
  {
    id: 'hevc',
    config: { codec: 'hvc1.1.6.L93.B0', width: 1920, height: 1080, bitrate: 8e6, framerate: 30 },
  },
  {
    id: 'vp9',
    config: { codec: 'vp09.00.10.08', width: 1920, height: 1080, bitrate: 6e6, framerate: 30 },
  },
  {
    id: 'av1',
    config: { codec: 'av01.0.08M.08', width: 1920, height: 1080, bitrate: 5e6, framerate: 30 },
  },
  {
    id: 'vp8',
    config: { codec: 'vp8', width: 1920, height: 1080, bitrate: 6e6, framerate: 30 },
  },
]

async function probeHardwareCodecs(): Promise<string[]> {
  if (typeof VideoEncoder === 'undefined') return []
  const results = await Promise.all(
    CODEC_PROBES.map(async ({ id, config }) => {
      try {
        const support = await VideoEncoder.isConfigSupported({
          ...config,
          hardwareAcceleration: 'prefer-hardware',
        })
        return support.supported ? id : null
      } catch {
        return null
      }
    }),
  )
  return results.filter((v): v is string => v !== null)
}

/**
 * Canvas encoders vary a lot: AVIF is Chrome-only, WebP is everywhere except
 * old Safari. Probing beats a browser-sniffing table that rots.
 */
async function probeImageEncoders(): Promise<string[]> {
  const candidates = ['image/png', 'image/jpeg', 'image/webp', 'image/avif']
  if (typeof OffscreenCanvas === 'undefined') {
    // Fall back to the synchronous data-URL sniff.
    const c = document.createElement('canvas')
    c.width = c.height = 1
    return candidates.filter((type) => c.toDataURL(type).startsWith(`data:${type}`))
  }
  const canvas = new OffscreenCanvas(1, 1)
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, 1, 1)
  }
  const supported: string[] = []
  for (const type of candidates) {
    try {
      const blob = await canvas.convertToBlob({ type })
      if (blob.type === type) supported.push(type)
    } catch {
      /* unsupported */
    }
  }
  return supported
}

async function probeStorage(): Promise<StorageInfo | null> {
  if (!navigator.storage?.estimate) return null
  try {
    const { quota = 0, usage = 0 } = await navigator.storage.estimate()
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false
    return { quota, usage, persisted }
  } catch {
    return null
  }
}

/**
 * Size limits are the honest part of the app. They come from three hard walls:
 *
 *   1. wasm32 caps a linear memory at 4 GiB; ffmpeg.wasm in practice dies
 *      somewhere past ~2 GiB of working set.
 *   2. Safari terminates a tab that grows past roughly 1-1.5 GiB.
 *   3. Without a writable file stream the finished file has to exist as one
 *      Blob in memory before it can be handed to the user.
 *
 * With streaming write plus WebCodecs none of those bind, because neither the
 * input nor the output is ever fully resident.
 */
function computeLimits(c: Omit<Capabilities, 'limits' | 'paths'>) {
  const cores = c.cores
  const threads = c.sharedArrayBuffer ? Math.min(Math.max(cores - 1, 1), 8) : 1

  // Image jobs are cheap and parallelise well; video jobs are not.
  const concurrency = c.isMobile ? 1 : Math.min(Math.max(Math.floor(cores / 2), 1), 4)

  if (c.streamingWrite && c.webcodecs) {
    // Bounded by the drive, not by us. Cap at the storage quota when known.
    const quota = c.storage?.quota ?? 0
    return {
      softMaxBytes: 16 * GiB,
      hardMaxBytes: quota > 0 ? Math.max(quota, 64 * GiB) : Number.POSITIVE_INFINITY,
      threads,
      concurrency,
    }
  }

  if (c.isIOS) {
    return { softMaxBytes: 0.5 * GiB, hardMaxBytes: 1.2 * GiB, threads: 1, concurrency: 1 }
  }

  if (c.isSafari) {
    return { softMaxBytes: 0.75 * GiB, hardMaxBytes: 1.5 * GiB, threads, concurrency: 1 }
  }

  // Desktop without streaming write: input can still be read lazily, so the
  // ceiling is really about the produced file.
  return {
    softMaxBytes: 1.5 * GiB,
    hardMaxBytes: 2 * GiB,
    threads,
    concurrency,
  }
}

function computePaths(c: Omit<Capabilities, 'paths' | 'limits'>): EnginePath[] {
  const paths: EnginePath[] = []
  if (c.webcodecs) paths.push('webcodecs')
  if (c.sharedArrayBuffer && c.crossOriginIsolated) paths.push('ffmpeg-mt')
  paths.push('ffmpeg-st')
  paths.push('canvas')
  return paths
}

let cached: Capabilities | null = null

export async function detectCapabilities(force = false): Promise<Capabilities> {
  if (cached && !force) return cached

  const platform = detectPlatform()

  const sharedArrayBuffer =
    typeof SharedArrayBuffer !== 'undefined' && globalThis.crossOriginIsolated === true

  const fileSystemAccess =
    typeof (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker === 'function'

  const streamingWrite =
    typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker ===
      'function' && typeof FileSystemWritableFileStream !== 'undefined'

  const [hardwareCodecs, imageEncoders, storage] = await Promise.all([
    probeHardwareCodecs(),
    probeImageEncoders(),
    probeStorage(),
  ])

  const base = {
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    sharedArrayBuffer,
    webcodecs: typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined',
    imageDecoder: typeof (globalThis as { ImageDecoder?: unknown }).ImageDecoder !== 'undefined',
    webgpu: typeof (navigator as { gpu?: unknown }).gpu !== 'undefined',
    fileSystemAccess,
    streamingWrite,
    opfs: typeof navigator.storage?.getDirectory === 'function',
    cores: navigator.hardwareConcurrency || 4,
    deviceMemory: (navigator as { deviceMemory?: number }).deviceMemory,
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    ...platform,
    storage,
    hardwareCodecs,
    imageEncoders,
  }

  cached = { ...base, limits: computeLimits(base), paths: computePaths(base) }
  return cached
}

/** Ask for persistent storage so a long job is not evicted mid-run. */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  try {
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

/** Short human-readable reason a file is refused, or null when it is fine. */
export function checkFileSize(bytes: number, caps: Capabilities): string | null {
  if (bytes > caps.limits.hardMaxBytes) {
    if (caps.isIOS) {
      return 'Auf iOS begrenzt Safari den Arbeitsspeicher pro Tab. Diese Datei ist zu groß — bitte am Desktop konvertieren.'
    }
    return 'Datei überschreitet das Speicherlimit dieses Browsers. Chrome oder Edge erlauben deutlich größere Dateien.'
  }
  if (bytes > caps.limits.softMaxBytes) {
    return 'Große Datei — die Konvertierung kann lange dauern und viel Speicher belegen.'
  }
  return null
}
