import type { MediaFamily } from '@/lib/formats'

/* ===========================================================================
   Output settings
   ======================================================================== */

export type QualityMode =
  /** Constant quality (CRF). The right default: bitrate adapts to content. */
  | 'quality'
  /** Fixed average bitrate. */
  | 'bitrate'
  /** Hit a file size; bitrate is derived from duration. */
  | 'size'
  /** Mathematically identical output. */
  | 'lossless'

export type ResolutionPreset =
  | 'source'
  | '4320p'
  | '2160p'
  | '1440p'
  | '1080p'
  | '720p'
  | '480p'
  | '360p'
  | 'custom'

export type FitMode = 'contain' | 'cover' | 'stretch'

export type SpeedPreset = 'ultrafast' | 'veryfast' | 'fast' | 'medium' | 'slow' | 'veryslow'

export interface VideoSettings {
  /** Format id from the registry, e.g. 'mp4'. */
  format: string
  codec: string
  /**
   * How the sound is written, or 'none' for a silent file.
   *
   * Deliberately the only place that decides: a separate "strip audio" flag
   * alongside it meant two sources of the same truth, and a preset could set
   * one without the other — leaving the inspector showing a codec while the
   * output came out silent.
   */
  audioCodec: string

  mode: QualityMode
  /** CRF-style quality; meaning depends on the codec's own range. */
  quality: number
  bitrateKbps: number
  targetSizeMB: number
  audioBitrateKbps: number

  resolution: ResolutionPreset
  customWidth: number
  customHeight: number
  fit: FitMode
  /** Keep dimensions divisible by 2, which most encoders require. */
  evenDimensions: boolean

  /** 0 means "keep source". */
  fps: number
  speed: SpeedPreset
  twoPass: boolean

  /** Seconds. end = 0 means "to the end". */
  trimStart: number
  trimEnd: number

  stripMetadata: boolean
  /** MP4 only: move the moov atom to the front for instant web playback. */
  faststart: boolean

  /** HAP only: more chunks means more decoder threads on playback. */
  hapChunks: number
}

export interface ImageSettings {
  format: string
  /** 1-100. Ignored when lossless. */
  quality: number
  lossless: boolean

  resizeMode: 'none' | 'fit' | 'fill' | 'exact' | 'percent'
  width: number
  height: number
  percent: number
  /** Never scale a small image up to the target box. */
  noUpscale: boolean

  /** Flatten transparency onto this colour; empty keeps alpha. */
  background: string
  stripMetadata: boolean
  /** Multi-resolution output, used by ICO and icon sets. */
  iconSizes: number[]
}

export interface AudioSettings {
  format: string
  codec: string
  mode: QualityMode
  quality: number
  bitrateKbps: number
  sampleRate: number
  channels: 0 | 1 | 2
  normalize: boolean
  trimStart: number
  trimEnd: number
}

export interface OutputSettings {
  video: VideoSettings
  image: ImageSettings
  audio: AudioSettings
}

export const DEFAULT_SETTINGS: OutputSettings = {
  video: {
    format: 'mp4',
    codec: 'h264',
    audioCodec: 'aac',
    mode: 'quality',
    quality: 23,
    bitrateKbps: 8000,
    targetSizeMB: 25,
    audioBitrateKbps: 192,
    resolution: 'source',
    customWidth: 1920,
    customHeight: 1080,
    fit: 'contain',
    evenDimensions: true,
    fps: 0,
    speed: 'medium',
    twoPass: false,
    trimStart: 0,
    trimEnd: 0,
    stripMetadata: false,
    faststart: true,
    hapChunks: 4,
  },
  image: {
    format: 'webp',
    quality: 82,
    lossless: false,
    resizeMode: 'none',
    width: 1920,
    height: 1080,
    percent: 100,
    noUpscale: true,
    background: '',
    stripMetadata: true,
    iconSizes: [16, 32, 48, 64, 128, 256],
  },
  audio: {
    format: 'mp3',
    codec: 'mp3',
    mode: 'bitrate',
    quality: 4,
    bitrateKbps: 192,
    sampleRate: 0,
    channels: 0,
    normalize: false,
    trimStart: 0,
    trimEnd: 0,
  },
}

/* ===========================================================================
   Jobs
   ======================================================================== */

export type JobStatus =
  | 'queued'
  | 'probing'
  | 'running'
  | 'done'
  | 'error'
  | 'cancelled'
  | 'blocked'

export interface MediaProbe {
  durationSec?: number
  width?: number
  height?: number
  fps?: number
  videoCodec?: string
  audioCodec?: string
  audioChannels?: number
  sampleRate?: number
  bitrateKbps?: number
  hasAlpha?: boolean
  /** Frame or still used for the queue thumbnail. */
  posterUrl?: string
}

export interface JobResult {
  blob?: Blob
  /** Set instead of `blob` when the output was streamed straight to disk. */
  fileHandle?: FileSystemFileHandle
  filename: string
  bytes: number
  mime: string
  durationMs: number
  /** Which engine actually ran, for the status line and for bug reports. */
  engine: string
  objectUrl?: string
}

export interface Job {
  id: string
  file: File
  /** Set when the file came from a directory or save-picker handle. */
  handle?: FileSystemFileHandle
  family: MediaFamily
  sourceFormatId: string | null

  status: JobStatus
  /** 0..1, or null while indeterminate. */
  progress: number | null
  /** Encoding speed relative to realtime, e.g. 4.2 means 4.2x. */
  speed?: number
  etaMs?: number
  stage?: string

  probe?: MediaProbe
  result?: JobResult
  error?: string
  /** Non-fatal note, e.g. a size warning or a codec fallback. */
  warning?: string

  /** Per-job override; falls back to the global settings when absent. */
  settingsOverride?: Partial<OutputSettings>

  addedAt: number
  startedAt?: number
  finishedAt?: number
}

/* ===========================================================================
   Worker protocol
   ======================================================================== */

export interface WorkerRequest {
  id: string
  type: 'probe' | 'convert' | 'cancel' | 'init'
  file?: File
  settings?: OutputSettings
  family?: MediaFamily
  options?: Record<string, unknown>
}

export type WorkerResponse =
  | { id: string; type: 'ready' }
  | { id: string; type: 'probe'; probe: MediaProbe }
  | {
      id: string
      type: 'progress'
      progress: number | null
      stage?: string
      speed?: number
      etaMs?: number
    }
  | { id: string; type: 'log'; line: string }
  | { id: string; type: 'warning'; message: string }
  | {
      id: string
      type: 'done'
      blob: Blob
      filename: string
      mime: string
      engine: string
      durationMs: number
    }
  | { id: string; type: 'error'; message: string; fatal?: boolean }
  /**
   * The HAP engine can read the settings but not this particular source — an
   * unsupported container or a codec WebCodecs will not decode. The scheduler
   * answers it by transcoding to an intermediate and asking again.
   */
  | { id: string; type: 'fallback'; reason: string }
