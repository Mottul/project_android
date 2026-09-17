/** Small formatting helpers shared by the UI. All output is German-locale. */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

export function formatBytes(bytes: number, digits?: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes === 0) return '0 B'
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1)
  const value = bytes / 1024 ** i
  const d = digits ?? (i === 0 ? 0 : value < 100 ? 1 : 0)
  return `${value.toLocaleString('de-DE', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  })} ${UNITS[i]}`
}

export function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '—'
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** Coarse, human ETA. Precision here would be false confidence. */
export function formatEta(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return '—'
  const s = Math.round(ms / 1000)
  if (s < 5) return 'gleich fertig'
  if (s < 60) return `noch ${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `noch ${m} min`
  return `noch ${Math.floor(m / 60)} h ${m % 60} min`
}

export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return ''
  return `${Math.round(value * 100)} %`
}

/** "1920 x 1080" with a real multiplication sign. */
export function formatDimensions(w?: number, h?: number): string {
  if (!w || !h) return '—'
  return `${w} × ${h}`
}

export function formatBitrate(kbps?: number): string {
  if (!kbps || !Number.isFinite(kbps)) return '—'
  return kbps >= 1000
    ? `${(kbps / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} Mbit/s`
    : `${Math.round(kbps)} kbit/s`
}

/** Signed size delta, e.g. "-72 %" or "+14 %". */
export function formatSizeDelta(before: number, after: number): { text: string; better: boolean } {
  if (!before || !after) return { text: '—', better: false }
  const ratio = after / before - 1
  const pct = Math.round(Math.abs(ratio) * 100)
  const sign = ratio < 0 ? '−' : '+'
  return { text: `${sign}${pct} %`, better: ratio < 0 }
}

let counter = 0
export function uid(prefix = 'id'): string {
  counter += 1
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`
}

/** Replace the extension on a filename, keeping any dots inside the stem. */
export function withExtension(filename: string, ext: string): string {
  const dot = filename.lastIndexOf('.')
  const stem = dot <= 0 ? filename : filename.slice(0, dot)
  return `${stem}.${ext}`
}

/**
 * Remove characters that Windows, macOS or Linux reject in a filename.
 * Spaces are legal everywhere and are deliberately preserved.
 */
const ILLEGAL_FILENAME_CHARS = new RegExp('[<>:"/\\\\|?*\\u0000-\\u001F]', 'g')

export function sanitizeFilename(name: string): string {
  return name.replace(ILLEGAL_FILENAME_CHARS, '_').replace(/\.+$/, '').slice(0, 200)
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** Round up to the nearest even number; most encoders reject odd dimensions. */
export function evenUp(value: number): number {
  const rounded = Math.round(value)
  return rounded % 2 === 0 ? rounded : rounded + 1
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
