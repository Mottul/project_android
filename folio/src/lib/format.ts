/** Small formatting helpers shared by the library and the export dialog. */

/**
 * Human readable file size. Binary steps (the unit every file manager shows),
 * German decimal comma, and no decimals once the number is large enough that
 * they stop meaning anything.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${Math.round(bytes)} B`

  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }

  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(digits).replace('.', ',')} ${units[unit]}`
}

/** "vor 3 Minuten", "gestern", "14.02.2026" — whichever is most useful. */
export function formatWhen(timestamp: number, now = Date.now()): string {
  if (!timestamp) return '—'
  const seconds = Math.round((now - timestamp) / 1000)

  if (seconds < 60) return 'gerade eben'
  if (seconds < 3600) {
    const minutes = Math.round(seconds / 60)
    return `vor ${minutes} ${minutes === 1 ? 'Minute' : 'Minuten'}`
  }
  if (seconds < 86_400) {
    const hours = Math.round(seconds / 3600)
    return `vor ${hours} ${hours === 1 ? 'Stunde' : 'Stunden'}`
  }
  if (seconds < 172_800) return 'gestern'
  if (seconds < 604_800) return `vor ${Math.round(seconds / 86_400)} Tagen`

  return new Date(timestamp).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)} %`
}

/** Makes a file name safe for a download without mangling it beyond recognition. */
export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim() || 'dokument'
}

/** `bericht.pdf` + `-kommentiert` → `bericht-kommentiert.pdf` */
export function suffixFileName(name: string, suffix: string, extension?: string): string {
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = extension ?? (dot > 0 ? name.slice(dot + 1) : 'pdf')
  return safeFileName(`${stem}${suffix}.${ext}`)
}
