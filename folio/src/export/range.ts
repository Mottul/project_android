/**
 * Page ranges, as typed into the export dialog.
 *
 * `1-4, 9, 12-` is the notation every print dialog uses, so it is the one Folio
 * accepts. Parsing is forgiving — spaces anywhere, en dashes as well as hyphens,
 * reversed ranges, numbers past the end — because the alternative is an error
 * message for input whose meaning was never in doubt.
 */

export interface PageRange {
  /** Zero-based page indices, in order, without duplicates. */
  pages: number[]
  /** True when the input was empty or covered the whole document. */
  whole: boolean
  /** Set when part of the input could not be read. */
  problem?: string
}

export function parsePageRange(input: string, total: number): PageRange {
  const trimmed = input.trim()
  const all = Array.from({ length: total }, (_, index) => index)
  if (!trimmed) return { pages: all, whole: true }

  const pages = new Set<number>()
  let problem: string | undefined

  for (const rawPart of trimmed.split(/[,;]/)) {
    const part = rawPart.trim().replace(/[‒-―]/g, '-')
    if (!part) continue

    const match = /^(\d*)\s*-\s*(\d*)$/.exec(part)
    if (match) {
      const from = match[1] ? Number.parseInt(match[1], 10) : 1
      const to = match[2] ? Number.parseInt(match[2], 10) : total
      const low = Math.max(1, Math.min(from, to))
      const high = Math.min(total, Math.max(from, to))

      if (high < 1 || low > total) {
        problem ??= `„${part}“ liegt außerhalb des Dokuments.`
        continue
      }
      for (let page = low; page <= high; page += 1) pages.add(page - 1)
      continue
    }

    const single = /^\d+$/.test(part) ? Number.parseInt(part, 10) : NaN
    if (Number.isFinite(single) && single >= 1 && single <= total) {
      pages.add(single - 1)
      continue
    }
    problem ??= `„${part}“ ist keine gültige Seitenangabe.`
  }

  const list = [...pages].sort((a, b) => a - b)
  return {
    pages: list.length ? list : all,
    whole: list.length === 0 || list.length === total,
    problem,
  }
}

/** The inverse, for showing what was understood. */
export function formatPageRange(pages: readonly number[]): string {
  if (!pages.length) return ''

  const parts: string[] = []
  let start = pages[0]
  let previous = pages[0]

  for (let i = 1; i <= pages.length; i += 1) {
    const page = pages[i]
    if (page === previous + 1) {
      previous = page
      continue
    }
    parts.push(start === previous ? `${start + 1}` : `${start + 1}–${previous + 1}`)
    start = page
    previous = page
  }

  return parts.join(', ')
}
