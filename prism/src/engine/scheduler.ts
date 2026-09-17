import { FORMATS } from '@/lib/formats'
import { baseNameOf } from '@/lib/formats'
import { sanitizeFilename } from '@/lib/format-utils'
import type { Capabilities } from '@/lib/capabilities'
import ImageWorker from './workers/image.worker?worker'
import { buildPlan } from './ffmpeg-args'
import { FFmpegCancelled, FFmpegRunner, ffmpegRunner } from './ffmpeg-runner'
import type { Job, JobResult, OutputSettings, WorkerRequest, WorkerResponse } from './types'

/**
 * Job scheduler and engine router.
 *
 * Two lanes, because the two engines have opposite characteristics:
 *
 *   - Image jobs run on a pool of OffscreenCanvas workers. They are short,
 *     independent and parallelise cleanly across cores.
 *   - Video and audio jobs run strictly one at a time. There is a single
 *     ffmpeg.wasm instance holding one wasm heap; running two would double
 *     peak memory for no throughput gain, since the core already uses every
 *     thread it was given.
 */

export interface SchedulerDeps {
  getSettings(job: Job): OutputSettings
  getCapabilities(): Capabilities | null
  onUpdate(id: string, patch: Partial<Job>): void
  onLog?(line: string): void
}

/** Formats the canvas pipeline can write without ffmpeg. */
const CANVAS_FORMATS = new Set(['png', 'jpeg', 'webp', 'avif', 'bmp', 'tiff', 'ico'])

class ImageWorkerPool {
  private idle: Worker[] = []
  private busy = new Set<Worker>()
  private pending: Array<(worker: Worker) => void> = []

  constructor(private readonly size: number) {}

  private spawn(): Worker {
    return new ImageWorker()
  }

  async acquire(): Promise<Worker> {
    const free = this.idle.pop()
    if (free) {
      this.busy.add(free)
      return free
    }
    if (this.busy.size < this.size) {
      const worker = this.spawn()
      this.busy.add(worker)
      return worker
    }
    return new Promise<Worker>((resolve) => this.pending.push(resolve))
  }

  release(worker: Worker) {
    this.busy.delete(worker)
    const next = this.pending.shift()
    if (next) {
      this.busy.add(worker)
      next(worker)
    } else {
      this.idle.push(worker)
    }
  }

  /** Terminate a worker that is in an unknown state and replace its slot. */
  discard(worker: Worker) {
    this.busy.delete(worker)
    worker.terminate()
    const next = this.pending.shift()
    if (next) {
      const replacement = this.spawn()
      this.busy.add(replacement)
      next(replacement)
    }
  }

  destroy() {
    for (const w of [...this.idle, ...this.busy]) w.terminate()
    this.idle = []
    this.busy.clear()
    this.pending = []
  }
}

export class Scheduler {
  private imagePool: ImageWorkerPool | null = null
  private mediaQueue: Job[] = []
  private imageQueue: Job[] = []
  private mediaRunning = false
  private imageRunning = 0
  private cancelled = new Set<string>()
  /** Worker currently handling each in-flight image job, for cancellation. */
  private activeImageWorkers = new Map<string, Worker>()
  private activeMediaJobId: string | null = null

  constructor(private readonly deps: SchedulerDeps) {}

  private get concurrency(): number {
    return this.deps.getCapabilities()?.limits.concurrency ?? 2
  }

  private pool(): ImageWorkerPool {
    if (!this.imagePool) this.imagePool = new ImageWorkerPool(this.concurrency)
    return this.imagePool
  }

  /** Decide which engine owns a job, given its source and target format. */
  private routeOf(job: Job, settings: OutputSettings): 'canvas' | 'ffmpeg' {
    if (job.family !== 'image') return 'ffmpeg'
    return CANVAS_FORMATS.has(settings.image.format) ? 'canvas' : 'ffmpeg'
  }

  enqueue(jobs: Job[]) {
    for (const job of jobs) {
      this.cancelled.delete(job.id)
      const settings = this.deps.getSettings(job)
      if (this.routeOf(job, settings) === 'canvas') this.imageQueue.push(job)
      else this.mediaQueue.push(job)
      this.deps.onUpdate(job.id, { status: 'queued', progress: null, error: undefined })
    }
    this.pumpImages()
    void this.pumpMedia()
  }

  cancel(id: string) {
    this.cancelled.add(id)
    this.imageQueue = this.imageQueue.filter((j) => j.id !== id)
    this.mediaQueue = this.mediaQueue.filter((j) => j.id !== id)

    const worker = this.activeImageWorkers.get(id)
    if (worker) {
      this.pool().discard(worker)
      this.activeImageWorkers.delete(id)
      this.imageRunning = Math.max(0, this.imageRunning - 1)
      this.pumpImages()
    }
    if (this.activeMediaJobId === id) {
      void ffmpegRunner.cancel()
    }
    this.deps.onUpdate(id, { status: 'cancelled', progress: null })
  }

  cancelAll() {
    const ids = [...this.imageQueue, ...this.mediaQueue].map((j) => j.id)
    for (const id of ids) this.cancel(id)
    if (this.activeMediaJobId) this.cancel(this.activeMediaJobId)
    for (const id of [...this.activeImageWorkers.keys()]) this.cancel(id)
  }

  destroy() {
    this.cancelAll()
    this.imagePool?.destroy()
    this.imagePool = null
  }

  /* ---------------------------------------------------------------- image */

  private pumpImages() {
    while (this.imageRunning < this.concurrency && this.imageQueue.length > 0) {
      const job = this.imageQueue.shift()!
      if (this.cancelled.has(job.id)) continue
      this.imageRunning += 1
      void this.runImageJob(job).finally(() => {
        this.imageRunning -= 1
        this.pumpImages()
      })
    }
  }

  private async runImageJob(job: Job) {
    const worker = await this.pool().acquire()
    this.activeImageWorkers.set(job.id, worker)
    const settings = this.deps.getSettings(job)

    this.deps.onUpdate(job.id, {
      status: 'running',
      progress: 0,
      startedAt: Date.now(),
      stage: 'Start',
    })

    try {
      const result = await this.talkToWorker(worker, job, settings)
      this.finish(job, result)
    } catch (err) {
      if (this.cancelled.has(job.id)) {
        this.deps.onUpdate(job.id, { status: 'cancelled', progress: null })
      } else {
        this.deps.onUpdate(job.id, {
          status: 'error',
          progress: null,
          error: (err as Error).message,
          finishedAt: Date.now(),
        })
      }
    } finally {
      if (this.activeImageWorkers.get(job.id) === worker) {
        this.activeImageWorkers.delete(job.id)
        this.pool().release(worker)
      }
    }
  }

  private talkToWorker(worker: Worker, job: Job, settings: OutputSettings): Promise<JobResult> {
    return new Promise<JobResult>((resolve, reject) => {
      const onMessage = (event: MessageEvent<WorkerResponse>) => {
        const msg = event.data
        if (msg.id !== job.id) return

        switch (msg.type) {
          case 'progress':
            this.deps.onUpdate(job.id, { progress: msg.progress, stage: msg.stage })
            break
          case 'warning':
            this.deps.onUpdate(job.id, { warning: msg.message })
            break
          case 'done':
            cleanup()
            resolve({
              blob: msg.blob,
              filename: msg.filename,
              bytes: msg.blob.size,
              mime: msg.mime,
              durationMs: msg.durationMs,
              engine: msg.engine,
            })
            break
          case 'error':
            cleanup()
            reject(new Error(msg.message))
            break
        }
      }

      const onError = (event: ErrorEvent) => {
        cleanup()
        reject(new Error(event.message || 'Der Bild-Worker ist abgestürzt.'))
      }

      const cleanup = () => {
        worker.removeEventListener('message', onMessage)
        worker.removeEventListener('error', onError)
      }

      worker.addEventListener('message', onMessage)
      worker.addEventListener('error', onError)

      const request: WorkerRequest = {
        id: job.id,
        type: 'convert',
        file: job.file,
        settings,
        family: job.family,
      }
      worker.postMessage(request)
    })
  }

  /* ---------------------------------------------------------------- media */

  private async pumpMedia() {
    if (this.mediaRunning) return
    this.mediaRunning = true
    try {
      while (this.mediaQueue.length > 0) {
        const job = this.mediaQueue.shift()!
        if (this.cancelled.has(job.id)) continue
        await this.runMediaJob(job)
      }
    } finally {
      this.mediaRunning = false
      this.activeMediaJobId = null
    }
  }

  private async runMediaJob(job: Job) {
    const caps = this.deps.getCapabilities()
    const settings = this.deps.getSettings(job)
    this.activeMediaJobId = job.id

    this.deps.onUpdate(job.id, {
      status: 'running',
      progress: null,
      startedAt: Date.now(),
      stage: 'Engine laden',
    })

    try {
      await ffmpegRunner.load(Boolean(caps?.sharedArrayBuffer), this.deps.onLog)
      if (this.cancelled.has(job.id)) throw new FFmpegCancelled()

      const targetFormat = FORMATS[settings.video.format]
      const audioOnly = job.family === 'audio' || targetFormat?.family === 'audio'

      const plan = buildPlan({
        inputName: FFmpegRunner.inputPathFor(job.file),
        outputStem: sanitizeFilename(baseNameOf(job.file.name)) || 'prism_output',
        family: job.family,
        settings,
        probe: job.probe,
        threads: caps?.limits.threads ?? 1,
        audioOnly,
      })

      if (plan.warnings.length > 0) {
        this.deps.onUpdate(job.id, { warning: plan.warnings.join(' ') })
      }

      // The exact invocation, so a surprising result can be reproduced or
      // pasted into a native ffmpeg to compare.
      for (const line of plan.commandLine.split('\n')) {
        this.deps.onLog?.(`$ ${line}`)
      }

      const result = await ffmpegRunner.run(job.file, plan, {
        onProgress: (progress, stage) => {
          if (this.cancelled.has(job.id)) return
          const eta = estimateEta(progress, job.startedAt)
          this.deps.onUpdate(job.id, { progress, stage, etaMs: eta })
        },
        onLog: this.deps.onLog,
      })

      this.finish(job, {
        blob: result.blob,
        filename: result.filename,
        bytes: result.blob.size,
        mime: result.mime,
        durationMs: result.durationMs,
        engine: result.engine,
      })
    } catch (err) {
      if (err instanceof FFmpegCancelled || this.cancelled.has(job.id)) {
        this.deps.onUpdate(job.id, { status: 'cancelled', progress: null })
      } else {
        this.deps.onUpdate(job.id, {
          status: 'error',
          progress: null,
          error: (err as Error).message,
          finishedAt: Date.now(),
        })
      }
    }
  }

  private finish(job: Job, result: JobResult) {
    this.deps.onUpdate(job.id, {
      status: 'done',
      progress: 1,
      stage: undefined,
      etaMs: undefined,
      finishedAt: Date.now(),
      result: { ...result, objectUrl: URL.createObjectURL(result.blob!) },
    })
  }
}

/** Linear extrapolation from elapsed time. Good enough, honest enough. */
function estimateEta(progress: number | null, startedAt?: number): number | undefined {
  if (progress === null || progress <= 0.02 || !startedAt) return undefined
  const elapsed = Date.now() - startedAt
  return Math.max(0, (elapsed / progress) * (1 - progress))
}
