import { FFFSType, FFmpeg } from '@ffmpeg/ffmpeg'
import { toBlobURL } from '@ffmpeg/util'

import type { FFmpegPlan } from './ffmpeg-args'

/**
 * Owns the ffmpeg.wasm instance.
 *
 * @ffmpeg/ffmpeg already spawns its own worker, so this module stays on the
 * main thread: nesting another worker around it buys nothing and breaks on
 * Safari. The UI thread never blocks because all the real work happens inside
 * ffmpeg's worker.
 */

/**
 * Above this, the input is mounted through WORKERFS instead of being copied
 * into the in-memory filesystem. WORKERFS reads lazily via File.slice(), which
 * is the only reason a multi-gigabyte source is possible at all.
 */
const MOUNT_THRESHOLD_BYTES = 192 * 1024 * 1024

const MOUNT_POINT = '/mnt'

/**
 * The cores are served as static assets from public/ffmpeg/ (see
 * scripts/sync-ffmpeg-core.mjs). Same-origin, so COEP/require-corp is happy,
 * and the service worker caches them on first use rather than precaching 30 MB.
 *
 * The two script files are handed to ffmpeg as blob: URLs rather than plain
 * paths. ffmpeg's worker loads them with a dynamic import(), and a dev-server
 * import of anything under /public is refused ("can only be referenced via HTML
 * tags"). Fetching them ourselves and wrapping them in a blob sidesteps the
 * module pipeline entirely and behaves identically in dev and in production.
 *
 * The .wasm stays a plain URL: it is not transformed, and blob-ifying it would
 * hold 31 MB in memory a second time.
 */
/**
 * Absolute URLs, resolved once against the document.
 *
 * They must not stay relative: `wasmURL` is resolved *inside* ffmpeg's own
 * worker, which runs from a blob: URL where a relative path would resolve
 * against the blob and 404. Deriving them from `document.baseURI` keeps the
 * build portable across the repository's relative-path convention — the same
 * output works at /project_android/prism/ and at /prism/.
 */
const asset = (path: string) => new URL(path, document.baseURI).href

const CORE = {
  st: {
    coreURL: asset('ffmpeg/st/ffmpeg-core.js'),
    wasmURL: asset('ffmpeg/st/ffmpeg-core.wasm'),
  },
  mt: {
    coreURL: asset('ffmpeg/mt/ffmpeg-core.js'),
    wasmURL: asset('ffmpeg/mt/ffmpeg-core.wasm'),
    workerURL: asset('ffmpeg/mt/ffmpeg-core.worker.js'),
  },
} as const

export type CoreVariant = 'mt' | 'st'

export interface RunCallbacks {
  onProgress?(progress: number | null, stage: string, speed?: number): void
  onLog?(line: string): void
}

export interface RunResult {
  blob: Blob
  filename: string
  mime: string
  engine: string
  durationMs: number
}

export class FFmpegCancelled extends Error {
  constructor() {
    super('Abgebrochen')
    this.name = 'FFmpegCancelled'
  }
}

export class FFmpegRunner {
  private ffmpeg: FFmpeg | null = null
  private variant: CoreVariant | null = null
  private loading: Promise<CoreVariant> | null = null
  private cancelled = false
  /** Last lines of ffmpeg output; the real error is almost always in here. */
  private logTail: string[] = []

  get loadedVariant(): CoreVariant | null {
    return this.variant
  }

  get isLoaded(): boolean {
    return this.ffmpeg !== null && this.variant !== null
  }

  /**
   * Load a core. The multi-threaded build needs SharedArrayBuffer, which needs
   * cross-origin isolation; without it we fall back rather than fail.
   */
  async load(preferMultiThread: boolean, onLog?: (line: string) => void): Promise<CoreVariant> {
    if (this.variant) return this.variant
    if (this.loading) return this.loading

    this.loading = (async () => {
      const useMt =
        preferMultiThread &&
        typeof SharedArrayBuffer !== 'undefined' &&
        globalThis.crossOriginIsolated === true

      const ffmpeg = new FFmpeg()

      ffmpeg.on('log', ({ message }) => {
        this.logTail.push(message)
        if (this.logTail.length > 120) this.logTail.shift()
        onLog?.(message)
      })

      try {
        await ffmpeg.load(await resolveCore(useMt ? 'mt' : 'st'))
      } catch (err) {
        if (useMt) {
          // A failed MT load is usually a missing COEP header. Retry single
          // threaded so the app still works, just slower.
          await ffmpeg.load(await resolveCore('st'))
          this.ffmpeg = ffmpeg
          this.variant = 'st'
          return 'st' as CoreVariant
        }
        throw err
      }

      this.ffmpeg = ffmpeg
      this.variant = useMt ? 'mt' : 'st'
      return this.variant
    })()

    try {
      return await this.loading
    } finally {
      this.loading = null
    }
  }

  /**
   * Execute a plan. Multi-pass plans report a single continuous 0..1 progress,
   * weighted by each pass's share of the work.
   */
  async run(file: File, plan: FFmpegPlan, callbacks: RunCallbacks = {}): Promise<RunResult> {
    const ffmpeg = this.ffmpeg
    if (!ffmpeg) throw new Error('ffmpeg wurde nicht geladen')

    this.cancelled = false
    this.logTail = []
    const started = performance.now()

    const useMount = file.size >= MOUNT_THRESHOLD_BYTES
    let mounted = false

    try {
      if (useMount) {
        await ffmpeg.createDir(MOUNT_POINT).catch(() => undefined)
        await ffmpeg.mount(FFFSType.WORKERFS, { files: [file] }, MOUNT_POINT)
        mounted = true
      } else {
        const buffer = new Uint8Array(await file.arrayBuffer())
        await ffmpeg.writeFile(plan.passes[0].args[indexOfInput(plan)], buffer)
      }

      let completedWeight = 0
      const totalWeight = plan.passes.reduce((sum, p) => sum + p.weight, 0) || 1

      for (const pass of plan.passes) {
        if (this.cancelled) throw new FFmpegCancelled()

        const share = pass.weight / totalWeight
        const base = completedWeight

        const onProgress = ({ progress }: { progress: number; time: number }) => {
          // ffmpeg occasionally reports > 1 near the end; clamping keeps the
          // bar from jumping backwards when the next pass starts at 0.
          const local = Math.min(Math.max(progress, 0), 1)
          callbacks.onProgress?.(base + local * share, pass.label)
        }

        ffmpeg.on('progress', onProgress)
        callbacks.onProgress?.(base, pass.label)

        try {
          const code = await ffmpeg.exec(pass.args)
          if (code !== 0) {
            throw new Error(this.explainFailure(code))
          }
        } finally {
          ffmpeg.off('progress', onProgress)
        }

        completedWeight += share
      }

      if (this.cancelled) throw new FFmpegCancelled()

      const data = await ffmpeg.readFile(plan.outputName)
      const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data))
      if (bytes.byteLength === 0) {
        throw new Error('ffmpeg hat eine leere Datei erzeugt. Details stehen im Protokoll.')
      }

      // Copy out of the wasm heap before the buffer can be reused.
      const blob = new Blob([bytes.slice()], { type: plan.mime })

      return {
        blob,
        filename: plan.outputName,
        mime: plan.mime,
        engine: `ffmpeg.wasm (${this.variant})`,
        durationMs: performance.now() - started,
      }
    } finally {
      await this.cleanup(plan, mounted)
    }
  }

  private async cleanup(plan: FFmpegPlan, mounted: boolean) {
    const ffmpeg = this.ffmpeg
    if (!ffmpeg) return
    for (const name of [plan.outputName, ...plan.scratch]) {
      await ffmpeg.deleteFile(name).catch(() => undefined)
    }
    if (mounted) await ffmpeg.unmount(MOUNT_POINT).catch(() => undefined)
  }

  /** Turn an exit code plus the log tail into something a human can act on. */
  private explainFailure(code: number): string {
    const tail = this.logTail.join('\n')

    if (/Unknown encoder|Unrecognized option|Encoder .* not found/i.test(tail)) {
      const match = tail.match(/Unknown encoder '([^']+)'/)
      const name = match?.[1]
      // HAP, HAP Alpha and HAP Q never reach ffmpeg — Prism writes those
      // itself. Getting here means HAP Q Alpha, the one variant that still
      // needs the extended core.
      return name === 'hap'
        ? 'HAP Q Alpha braucht den erweiterten ffmpeg-Core (siehe docs/hap.md). HAP, HAP Alpha und HAP Q schreibt Prism dagegen selbst — eine davon funktioniert hier sofort.'
        : `Dieser ffmpeg-Core kennt den gewählten Encoder${name ? ` "${name}"` : ''} nicht.`
    }
    if (/Invalid data found when processing input/i.test(tail)) {
      return 'Die Eingabedatei konnte nicht gelesen werden — möglicherweise beschädigt oder ein nicht unterstützter Codec.'
    }
    if (/Out of memory|memory access out of bounds|Aborted/i.test(tail)) {
      return 'Der Arbeitsspeicher hat nicht gereicht. Eine kleinere Auflösung oder ein Zuschnitt hilft meist.'
    }
    if (/height not divisible by 2|width not divisible by 2/i.test(tail)) {
      return 'Die Zielauflösung muss in beiden Achsen gerade sein — das betroffene Format verlangt das.'
    }

    const lastRealLine = [...this.logTail].reverse().find((l) => l.trim().length > 0)
    return `ffmpeg ist mit Code ${code} fehlgeschlagen.${lastRealLine ? ` ${lastRealLine}` : ''}`
  }

  getLog(): string[] {
    return [...this.logTail]
  }

  /**
   * Hard stop. ffmpeg.wasm cannot interrupt a running exec cooperatively, so
   * the whole instance is torn down and the next job reloads it.
   */
  async cancel(): Promise<void> {
    this.cancelled = true
    const ffmpeg = this.ffmpeg
    this.ffmpeg = null
    this.variant = null
    try {
      ffmpeg?.terminate()
    } catch {
      /* already gone */
    }
  }

  /** Mount path for a file, matching what buildPlan() was given as inputName. */
  static inputPathFor(file: File): string {
    return file.size >= MOUNT_THRESHOLD_BYTES ? `${MOUNT_POINT}/${file.name}` : 'input_source'
  }

  static usesMount(file: File): boolean {
    return file.size >= MOUNT_THRESHOLD_BYTES
  }
}

/**
 * Fetch the core scripts and expose them as blob: URLs, cached per variant so a
 * second job does not re-download 100 KB of glue code.
 */
const blobCache = new Map<CoreVariant, { coreURL: string; wasmURL: string; workerURL?: string }>()

async function resolveCore(variant: CoreVariant) {
  const cached = blobCache.get(variant)
  if (cached) return cached

  const source = CORE[variant]
  const resolved =
    variant === 'mt'
      ? {
          coreURL: await toBlobURL(source.coreURL, 'text/javascript'),
          wasmURL: source.wasmURL,
          workerURL: await toBlobURL(
            (source as typeof CORE.mt).workerURL,
            'text/javascript',
          ),
        }
      : {
          coreURL: await toBlobURL(source.coreURL, 'text/javascript'),
          wasmURL: source.wasmURL,
        }

  blobCache.set(variant, resolved)
  return resolved
}

/** Position of the input filename inside a plan's first pass. */
function indexOfInput(plan: FFmpegPlan): number {
  const args = plan.passes[0].args
  const i = args.indexOf('-i')
  return i === -1 ? 0 : i + 1
}

export const ffmpegRunner = new FFmpegRunner()
