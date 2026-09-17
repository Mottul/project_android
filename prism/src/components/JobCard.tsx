import {
  AlertTriangle,
  ArrowRight,
  Ban,
  Check,
  Download,
  FileAudio,
  FileImage,
  FileQuestion,
  FileVideo,
  Loader2,
  Play,
  RotateCcw,
  X,
} from 'lucide-react'

import { FAMILY_VAR, FORMATS } from '@/lib/formats'
import {
  cx,
  formatBytes,
  formatDimensions,
  formatDuration,
  formatEta,
  formatSizeDelta,
} from '@/lib/format-utils'
import { useAppStore } from '@/store/useAppStore'
import type { Job } from '@/engine/types'
import { IconButton, Pill } from './ui/controls'

const FAMILY_ICON = {
  video: FileVideo,
  image: FileImage,
  audio: FileAudio,
  document: FileQuestion,
  archive: FileQuestion,
} as const

export function JobCard({ job }: { job: Job }) {
  const removeJob = useAppStore((s) => s.removeJob)
  const cancelJob = useAppStore((s) => s.cancelJob)
  const startJob = useAppStore((s) => s.startJob)
  const downloadJob = useAppStore((s) => s.downloadJob)
  const settings = useAppStore((s) => s.settings)

  const Icon = FAMILY_ICON[job.family]
  const hue = FAMILY_VAR[job.family]
  const sourceFormat = job.sourceFormatId ? FORMATS[job.sourceFormatId] : null
  const targetFormat =
    FORMATS[
      job.family === 'image'
        ? settings.image.format
        : job.family === 'audio'
          ? settings.audio.format
          : settings.video.format
    ]

  const running = job.status === 'running' || job.status === 'probing'
  const delta = job.result ? formatSizeDelta(job.file.size, job.result.bytes) : null

  return (
    <article
      className={cx(
        'animate-rise group relative overflow-hidden rounded-lg border bg-surface',
        'transition-colors duration-200 [transition-timing-function:var(--ease-prism)]',
        job.status === 'error' || job.status === 'blocked'
          ? 'border-danger/35'
          : job.status === 'done'
            ? 'border-ok/30'
            : 'border-line-soft hover:border-line',
      )}
    >
      {/* Family hue as a left edge: identifies the file type without a legend. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: hue, opacity: job.status === 'done' ? 0.9 : 0.55 }}
      />

      <div className="flex items-start gap-3.5 p-3 pl-4">
        <Thumbnail job={job} hue={hue} Icon={Icon} />

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-start gap-2">
            <h3 className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-text" title={job.file.name}>
              {job.file.name}
            </h3>
            <Actions
              job={job}
              onCancel={() => cancelJob(job.id)}
              onStart={() => startJob(job.id)}
              onRemove={() => removeJob(job.id)}
              onDownload={() => void downloadJob(job.id)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-faint">
            <span className="tnum">{formatBytes(job.file.size)}</span>
            {job.probe?.width && (
              <>
                <Dot />
                <span className="tnum">{formatDimensions(job.probe.width, job.probe.height)}</span>
              </>
            )}
            {job.probe?.durationSec !== undefined && (
              <>
                <Dot />
                <span className="tnum">{formatDuration(job.probe.durationSec)}</span>
              </>
            )}
            {job.status === 'probing' && (
              <span className="skeleton h-3 w-24 rounded-full" aria-label="Wird analysiert" />
            )}

            <span className="ml-auto flex items-center gap-1.5">
              <FormatChip label={sourceFormat?.label ?? '?'} muted />
              <ArrowRight size={11} className="text-faint" />
              <FormatChip label={targetFormat?.label ?? '—'} hue={hue} />
            </span>
          </div>

          {running && <ProgressBar job={job} />}

          {job.status === 'done' && job.result && (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px]">
              <Pill tone="ok">
                <Check size={10} strokeWidth={3} />
                Fertig
              </Pill>
              <span className="tnum text-dim">{formatBytes(job.result.bytes)}</span>
              {delta && (
                <span
                  className={cx('tnum font-medium', delta.better ? 'text-ok' : 'text-warn')}
                  title={`Vorher ${formatBytes(job.file.size)}, nachher ${formatBytes(job.result.bytes)}`}
                >
                  {delta.text}
                </span>
              )}
              <Dot />
              <span className="text-faint">
                in {formatDuration(job.result.durationMs / 1000)} · {job.result.engine}
              </span>
            </div>
          )}

          {job.warning && job.status !== 'error' && (
            <p className="mt-0.5 flex items-start gap-1.5 text-[11.5px] leading-snug text-warn">
              <AlertTriangle size={12} className="mt-[1px] shrink-0" strokeWidth={2.4} />
              {job.warning}
            </p>
          )}

          {job.error && (
            <p className="mt-0.5 flex items-start gap-1.5 text-[11.5px] leading-snug text-danger">
              <AlertTriangle size={12} className="mt-[1px] shrink-0" strokeWidth={2.4} />
              {job.error}
            </p>
          )}
        </div>
      </div>
    </article>
  )
}

function Dot() {
  return <span className="text-line-strong">·</span>
}

function FormatChip({ label, hue, muted }: { label: string; hue?: string; muted?: boolean }) {
  return (
    <span
      className={cx(
        'rounded-[5px] px-1.5 py-[1px] text-[10.5px] font-semibold tracking-wide',
        muted ? 'bg-surface-2 text-faint' : 'text-on-accent',
      )}
      style={hue ? { background: hue, color: 'var(--surface-sunk)' } : undefined}
    >
      {label}
    </span>
  )
}

function Thumbnail({
  job,
  hue,
  Icon,
}: {
  job: Job
  hue: string
  Icon: (typeof FAMILY_ICON)[keyof typeof FAMILY_ICON]
}) {
  const poster = job.result?.objectUrl && job.family === 'image' ? job.result.objectUrl : job.probe?.posterUrl

  return (
    <div
      className="relative size-12 shrink-0 overflow-hidden rounded-md bg-surface-sunk"
      style={{ boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${hue} 24%, transparent)` }}
    >
      {poster ? (
        <img
          src={poster}
          alt=""
          className="size-full object-cover"
          // A checkerboard behind transparent images, so alpha is visible.
          style={{
            backgroundImage:
              'repeating-conic-gradient(var(--surface-2) 0% 25%, var(--surface-3) 0% 50%)',
            backgroundSize: '12px 12px',
          }}
        />
      ) : (
        <span className="grid size-full place-items-center" style={{ color: hue }}>
          <Icon size={18} strokeWidth={1.8} />
        </span>
      )}
    </div>
  )
}

function ProgressBar({ job }: { job: Job }) {
  const determinate = job.progress !== null && job.progress > 0
  const pct = Math.round((job.progress ?? 0) * 100)

  return (
    <div className="mt-1 flex flex-col gap-1">
      <div className="relative h-[5px] overflow-hidden rounded-full bg-surface-sunk">
        {determinate ? (
          <div
            className="spectrum h-full rounded-full transition-[width] duration-300 [transition-timing-function:var(--ease-prism)]"
            style={{ width: `${pct}%` }}
          />
        ) : (
          <div className="bar-indeterminate spectrum absolute inset-0 rounded-full opacity-40" />
        )}
      </div>
      <div className="flex items-center gap-2 text-[11px] text-dim">
        <Loader2 size={11} className="animate-spin-slow" />
        <span>{job.stage ?? 'Wird verarbeitet'}</span>
        {determinate && <span className="tnum ml-auto font-medium text-text">{pct} %</span>}
        {job.etaMs !== undefined && (
          <span className="tnum text-faint">{formatEta(job.etaMs)}</span>
        )}
      </div>
    </div>
  )
}

function Actions({
  job,
  onCancel,
  onStart,
  onRemove,
  onDownload,
}: {
  job: Job
  onCancel: () => void
  onStart: () => void
  onRemove: () => void
  onDownload: () => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {job.status === 'done' && (
        <IconButton label="Herunterladen" onClick={onDownload} className="text-accent hover:text-accent">
          <Download size={15} strokeWidth={2.2} />
        </IconButton>
      )}

      {(job.status === 'running' || job.status === 'probing') && (
        <IconButton label="Abbrechen" onClick={onCancel} tone="danger">
          <Ban size={15} strokeWidth={2.2} />
        </IconButton>
      )}

      {(job.status === 'error' || job.status === 'cancelled') && (
        <IconButton label="Erneut versuchen" onClick={onStart}>
          <RotateCcw size={15} strokeWidth={2.2} />
        </IconButton>
      )}

      {job.status === 'queued' && (
        <IconButton label="Diese Datei konvertieren" onClick={onStart}>
          <Play size={15} strokeWidth={2.2} />
        </IconButton>
      )}

      <IconButton
        label="Aus der Liste entfernen"
        onClick={onRemove}
        className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      >
        <X size={15} strokeWidth={2.2} />
      </IconButton>
    </div>
  )
}
