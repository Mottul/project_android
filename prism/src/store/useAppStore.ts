import { create } from 'zustand'
import { zip } from 'fflate'

import { detectCapabilities, checkFileSize, type Capabilities } from '@/lib/capabilities'
import { FORMATS, familyOf, identifyFormat, type MediaFamily } from '@/lib/formats'
import { uid, withExtension } from '@/lib/format-utils'
import { applyPreset, presetById, presetMatches, PRESETS } from '@/lib/presets'
import { DEFAULT_SETTINGS, type Job, type OutputSettings } from '@/engine/types'
import { probeFile } from '@/engine/probe'
import { Scheduler } from '@/engine/scheduler'

export type Theme = 'light' | 'dark'

interface AppState {
  jobs: Job[]
  settings: OutputSettings
  activePresetId: string | null
  caps: Capabilities | null
  theme: Theme
  /** Family whose controls the inspector is showing. */
  focusFamily: MediaFamily
  log: string[]
  showLog: boolean

  init(): Promise<void>
  addFiles(files: File[]): void
  removeJob(id: string): void
  clearCompleted(): void
  clearAll(): void

  setSettings(patch: Partial<OutputSettings>): void
  patchVideo(patch: Partial<OutputSettings['video']>): void
  patchImage(patch: Partial<OutputSettings['image']>): void
  patchAudio(patch: Partial<OutputSettings['audio']>): void
  setTargetFormat(formatId: string): void
  usePreset(id: string): void
  setFocusFamily(family: MediaFamily): void

  startAll(): void
  startJob(id: string): void
  cancelJob(id: string): void
  cancelAll(): void

  downloadJob(id: string): Promise<void>
  downloadAll(): Promise<void>

  toggleTheme(): void
  setShowLog(open: boolean): void
}

/** Created once; the store only ever talks to this instance. */
let scheduler: Scheduler | null = null

export const useAppStore = create<AppState>((set, get) => {
  const updateJob = (id: string, patch: Partial<Job>) => {
    set((state) => ({
      jobs: state.jobs.map((job) => (job.id === id ? { ...job, ...patch } : job)),
    }))
  }

  const ensureScheduler = (): Scheduler => {
    if (!scheduler) {
      scheduler = new Scheduler({
        getSettings: (job) => {
          const { settings } = get()
          const override = job.settingsOverride
          return override
            ? {
                video: { ...settings.video, ...override.video },
                image: { ...settings.image, ...override.image },
                audio: { ...settings.audio, ...override.audio },
              }
            : settings
        },
        getCapabilities: () => get().caps,
        onUpdate: updateJob,
        onLog: (line) =>
          set((state) => ({ log: [...state.log.slice(-400), line] })),
      })
    }
    return scheduler
  }

  return {
    jobs: [],
    settings: DEFAULT_SETTINGS,
    activePresetId: 'web-1080',
    caps: null,
    theme: (document.documentElement.dataset.theme as Theme) ?? 'dark',
    focusFamily: 'video',
    log: [],
    showLog: false,

    async init() {
      const caps = await detectCapabilities()
      set({ caps })
    },

    addFiles(files) {
      const { caps } = get()
      const jobs: Job[] = []

      for (const file of files) {
        const family = familyOf(file)
        if (!family) {
          // Still queue it, but say plainly that we do not know what it is.
          jobs.push({
            id: uid('job'),
            file,
            family: 'document',
            sourceFormatId: null,
            status: 'blocked',
            progress: null,
            error: `Unbekannter Dateityp: ${file.name.split('.').pop() ?? '—'}`,
            addedAt: Date.now(),
          })
          continue
        }

        const sizeIssue = caps ? checkFileSize(file.size, caps) : null
        const blocked = Boolean(
          sizeIssue && caps && file.size > caps.limits.hardMaxBytes,
        )

        jobs.push({
          id: uid('job'),
          file,
          family,
          sourceFormatId: identifyFormat(file)?.id ?? null,
          status: blocked ? 'blocked' : 'queued',
          progress: null,
          warning: blocked ? undefined : (sizeIssue ?? undefined),
          error: blocked ? (sizeIssue ?? undefined) : undefined,
          addedAt: Date.now(),
        })
      }

      if (jobs.length === 0) return

      set((state) => ({ jobs: [...state.jobs, ...jobs] }))

      // Focus the inspector on whatever was just dropped.
      const firstUsable = jobs.find((j) => j.status !== 'blocked')
      if (firstUsable) set({ focusFamily: firstUsable.family })

      // Probe in the background; the queue renders immediately.
      for (const job of jobs) {
        if (job.status === 'blocked') continue
        updateJob(job.id, { status: 'probing' })
        void probeFile(job.file, job.family).then((probe) => {
          updateJob(job.id, { probe, status: 'queued' })
        })
      }
    },

    removeJob(id) {
      const job = get().jobs.find((j) => j.id === id)
      if (job?.result?.objectUrl) URL.revokeObjectURL(job.result.objectUrl)
      if (job?.probe?.posterUrl?.startsWith('blob:')) URL.revokeObjectURL(job.probe.posterUrl)
      scheduler?.cancel(id)
      set((state) => ({ jobs: state.jobs.filter((j) => j.id !== id) }))
    },

    clearCompleted() {
      const { jobs } = get()
      for (const job of jobs) {
        if (job.status === 'done' && job.result?.objectUrl) {
          URL.revokeObjectURL(job.result.objectUrl)
        }
      }
      set({ jobs: jobs.filter((j) => j.status !== 'done') })
    },

    clearAll() {
      scheduler?.cancelAll()
      for (const job of get().jobs) {
        if (job.result?.objectUrl) URL.revokeObjectURL(job.result.objectUrl)
      }
      set({ jobs: [] })
    },

    setSettings(patch) {
      set((state) => {
        const settings = { ...state.settings, ...patch }
        return { settings, activePresetId: matchingPresetId(settings) }
      })
    },

    patchVideo(patch) {
      set((state) => {
        const settings = { ...state.settings, video: { ...state.settings.video, ...patch } }
        return { settings, activePresetId: matchingPresetId(settings) }
      })
    },

    patchImage(patch) {
      set((state) => {
        const settings = { ...state.settings, image: { ...state.settings.image, ...patch } }
        return { settings, activePresetId: matchingPresetId(settings) }
      })
    },

    patchAudio(patch) {
      set((state) => {
        const settings = { ...state.settings, audio: { ...state.settings.audio, ...patch } }
        return { settings, activePresetId: matchingPresetId(settings) }
      })
    },

    /**
     * One entry point for the format picker, because the target format also
     * decides which engine runs: choosing an audio format for a video source
     * means "extract the audio", and the scheduler reads that off video.format.
     */
    setTargetFormat(formatId) {
      const format = FORMATS[formatId]
      if (!format) return

      set((state) => {
        const settings = { ...state.settings }

        if (format.family === 'image') {
          settings.image = { ...settings.image, format: formatId }
          if (state.focusFamily === 'video') {
            settings.video = { ...settings.video, format: formatId }
          }
        } else if (format.family === 'audio') {
          settings.audio = {
            ...settings.audio,
            format: formatId,
            codec: format.defaultCodec ?? settings.audio.codec,
          }
          // Recorded on the video section too, so a video source routes to the
          // audio-only plan.
          settings.video = { ...settings.video, format: formatId }
        } else {
          const codecs = format.codecs ?? []
          const keepCodec = codecs.includes(settings.video.codec)
          settings.video = {
            ...settings.video,
            format: formatId,
            codec: keepCodec ? settings.video.codec : (format.defaultCodec ?? 'h264'),
          }
        }

        return { settings, activePresetId: matchingPresetId(settings) }
      })
    },

    usePreset(id) {
      const preset = presetById(id)
      if (!preset) return
      set((state) => ({
        settings: applyPreset(state.settings, preset),
        activePresetId: id,
        focusFamily: preset.family,
      }))
    },

    setFocusFamily(family) {
      set({ focusFamily: family })
    },

    startAll() {
      const runnable = get().jobs.filter(
        (j) => j.status === 'queued' || j.status === 'error' || j.status === 'cancelled',
      )
      if (runnable.length === 0) return
      ensureScheduler().enqueue(runnable)
    },

    startJob(id) {
      const job = get().jobs.find((j) => j.id === id)
      if (!job || job.status === 'running' || job.status === 'blocked') return
      ensureScheduler().enqueue([job])
    },

    cancelJob(id) {
      scheduler?.cancel(id)
    },

    cancelAll() {
      scheduler?.cancelAll()
    },

    async downloadJob(id) {
      const job = get().jobs.find((j) => j.id === id)
      if (!job?.result?.blob) return
      triggerDownload(job.result.blob, job.result.filename)
    },

    /**
     * Batch download as a ZIP. Stored, not deflated: media is already
     * compressed, so deflate would burn CPU for a fraction of a percent.
     */
    async downloadAll() {
      const done = get().jobs.filter((j) => j.status === 'done' && j.result?.blob)
      if (done.length === 0) return
      if (done.length === 1) {
        triggerDownload(done[0].result!.blob!, done[0].result!.filename)
        return
      }

      const entries: Record<string, [Uint8Array, { level: 0 }]> = {}
      const used = new Set<string>()
      for (const job of done) {
        const result = job.result!
        let name = result.filename
        // Two sources can produce the same output name; keep both.
        let n = 2
        while (used.has(name)) {
          name = withExtension(
            `${result.filename.replace(/\.[^.]+$/, '')} (${n})`,
            result.filename.split('.').pop() ?? 'bin',
          )
          n += 1
        }
        used.add(name)
        entries[name] = [new Uint8Array(await result.blob!.arrayBuffer()), { level: 0 }]
      }

      // fflate always allocates a fresh, non-shared ArrayBuffer, so the cast
      // is sound and avoids copying the whole archive a second time.
      const archive = await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
        zip(entries, { level: 0 }, (err, data) =>
          err ? reject(err) : resolve(data as Uint8Array<ArrayBuffer>),
        )
      })

      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
      triggerDownload(new Blob([archive], { type: 'application/zip' }), `prism-${stamp}.zip`)
    },

    toggleTheme() {
      const next: Theme = get().theme === 'dark' ? 'light' : 'dark'
      document.documentElement.dataset.theme = next
      try {
        localStorage.setItem('prism.theme', next)
      } catch {
        /* private mode */
      }
      set({ theme: next })
    },

    setShowLog(open) {
      set({ showLog: open })
    },
  }
})

/** The preset chip stays lit only while every field it pins still matches. */
function matchingPresetId(settings: OutputSettings): string | null {
  return PRESETS.find((p) => presetMatches(settings, p))?.id ?? null
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/* Derived selectors, kept out of components so they memoise cleanly. */

export const selectStats = (state: AppState) => {
  let done = 0
  let running = 0
  let queued = 0
  let failed = 0
  let bytesIn = 0
  let bytesOut = 0

  for (const job of state.jobs) {
    bytesIn += job.file.size
    if (job.result) bytesOut += job.result.bytes
    switch (job.status) {
      case 'done':
        done += 1
        break
      case 'running':
      case 'probing':
        running += 1
        break
      case 'queued':
        queued += 1
        break
      case 'error':
      case 'blocked':
        failed += 1
        break
    }
  }

  return { done, running, queued, failed, bytesIn, bytesOut, total: state.jobs.length }
}
