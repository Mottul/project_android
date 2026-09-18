/**
 * Deciding how hard to compress.
 *
 * Folio's compressed export re-renders every page as a JPEG at a chosen
 * resolution and quality. Two knobs, and the relationship between them and the
 * resulting file size depends entirely on the document — a scanned invoice and
 * a photo book behave nothing alike. Guessing from the page count is hopeless.
 *
 * So the size is measured instead of predicted: a handful of representative
 * pages are encoded at a candidate setting, the result is extrapolated to the
 * whole document, and a bisection over the ladder of settings finds the best
 * one that fits. Six or seven measurements on three pages, rather than a full
 * export per attempt.
 *
 * Everything here is pure: the measuring function is injected, which is also
 * what makes it testable.
 */

export interface CompressionStep {
  /** Render resolution in dots per inch. 72 is "PDF points", i.e. no upscaling. */
  dpi: number
  /** JPEG quality, 0..1. */
  quality: number
}

export const DPI_CHOICES = [72, 96, 120, 150, 200, 240, 300] as const
export const QUALITY_CHOICES = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9] as const

/**
 * The ladder the search walks, ordered from largest to smallest expected file.
 *
 * Resolution is reduced before quality: JPEG artefacts on text are far uglier
 * than the same text rendered slightly softer, so the ladder keeps quality high
 * while there is still resolution to give up, and only then starts trading
 * quality away.
 */
export function compressionLadder(): CompressionStep[] {
  const steps: CompressionStep[] = []
  for (const dpi of [...DPI_CHOICES].reverse()) {
    for (const quality of [0.9, 0.8, 0.7]) steps.push({ dpi, quality })
  }
  // Last resort, once the resolution ladder is exhausted.
  for (const quality of [0.6, 0.5, 0.4, 0.3]) steps.push({ dpi: 72, quality })

  // Sorted by the rough size proxy dpi² × quality, so the search can assume the
  // ladder is monotone even though it was built from two nested loops.
  return steps.sort((a, b) => b.dpi * b.dpi * b.quality - a.dpi * a.dpi * a.quality)
}

/**
 * Which pages to measure.
 *
 * Evenly spaced rather than the first n: the first pages of a document are
 * frequently a title page and a table of contents, which compress far better
 * than the body and would make every estimate optimistic.
 */
export function samplePages(pageCount: number, sampleSize = 3): number[] {
  if (pageCount <= sampleSize) return Array.from({ length: pageCount }, (_, i) => i)

  const pages: number[] = []
  for (let i = 0; i < sampleSize; i += 1) {
    pages.push(Math.min(pageCount - 1, Math.round(((i + 0.5) * pageCount) / sampleSize)))
  }
  return [...new Set(pages)]
}

/** Bytes of PDF structure around the images: roughly a kilobyte per page. */
export const PDF_OVERHEAD_PER_PAGE = 1024

export function estimateTotalBytes(
  sampleBytes: readonly number[],
  pageCount: number,
): number {
  if (!sampleBytes.length) return 0
  const average = sampleBytes.reduce((sum, value) => sum + value, 0) / sampleBytes.length
  return Math.round(average * pageCount + PDF_OVERHEAD_PER_PAGE * pageCount)
}

export interface SearchResult {
  step: CompressionStep
  /** Estimated size of the whole document at that step. */
  estimate: number
  /** True when even the smallest step stays above the target. */
  missed: boolean
  /** How many times the measuring function was called. */
  measurements: number
}

/**
 * Finds the highest-quality step whose estimate fits into `targetBytes`.
 *
 * A bisection over an array that is assumed to be monotone. It is not perfectly
 * monotone in reality — a page can encode marginally larger at a lower quality
 * — but the deviations are far below the granularity anyone cares about, and
 * the result is checked against the real file afterwards anyway.
 *
 * `measure` may return a promise, because measuring means rendering pages. The
 * search itself stays free of anything else: no canvas, no document, nothing to
 * mock in a test.
 */
export async function findStep(
  ladder: readonly CompressionStep[],
  measure: (step: CompressionStep) => number | Promise<number>,
  targetBytes: number,
): Promise<SearchResult> {
  let measurements = 0
  const cache = new Map<number, number>()

  const sizeAt = async (index: number): Promise<number> => {
    const cached = cache.get(index)
    if (cached !== undefined) return cached
    measurements += 1
    const size = await measure(ladder[index])
    cache.set(index, size)
    return size
  }

  if (!ladder.length) {
    return { step: { dpi: 150, quality: 0.8 }, estimate: 0, missed: true, measurements }
  }

  // The best setting already fits — no reason to give anything up.
  const best = await sizeAt(0)
  if (best <= targetBytes) {
    return { step: ladder[0], estimate: best, missed: false, measurements }
  }

  const last = ladder.length - 1
  const worst = await sizeAt(last)
  if (worst > targetBytes) {
    return { step: ladder[last], estimate: worst, missed: true, measurements }
  }

  let low = 0
  let high = last
  while (high - low > 1) {
    const middle = (low + high) >> 1
    if ((await sizeAt(middle)) <= targetBytes) high = middle
    else low = middle
  }

  return { step: ladder[high], estimate: await sizeAt(high), missed: false, measurements }
}

/** Target sizes offered in the export dialog. */
export const TARGET_PRESETS = [
  { label: '1 MB', bytes: 1024 * 1024 },
  { label: '2 MB', bytes: 2 * 1024 * 1024 },
  { label: '5 MB', bytes: 5 * 1024 * 1024 },
  { label: '10 MB', bytes: 10 * 1024 * 1024 },
  { label: '20 MB', bytes: 20 * 1024 * 1024 },
]

/** Plain-language description of what a step will do to the document. */
export function describeStep(step: CompressionStep): string {
  const sharpness =
    step.dpi >= 240 ? 'druckfein' : step.dpi >= 150 ? 'scharf' : step.dpi >= 96 ? 'lesbar' : 'grob'
  const fidelity =
    step.quality >= 0.85 ? 'sehr gut' : step.quality >= 0.7 ? 'gut' : step.quality >= 0.5 ? 'sichtbar verlustbehaftet' : 'stark verlustbehaftet'
  return `${step.dpi} dpi (${sharpness}), Qualität ${Math.round(step.quality * 100)} % (${fidelity})`
}
