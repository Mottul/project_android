/**
 * The text layer: selection, and the raw material for editing text.
 *
 * pdf.js draws the page into a canvas as an image. The words in that image are
 * not text as far as the browser is concerned, so pdf.js additionally places a
 * transparent `<span>` over every text run, positioned and scaled to match. All
 * text interaction — selecting, searching, highlighting, editing — happens
 * against those spans.
 *
 * Rather than recompute where each run sits from the PDF transform matrices,
 * Folio measures the spans pdf.js has already positioned. It is exact by
 * construction, it follows zoom and rotation for free, and it means one
 * implementation of "where is this text" instead of two that can disagree.
 */

import { TextLayer } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFPageProxy, PageViewport } from 'pdfjs-dist'
import { mergeLineRects, type Rect } from '@/lib/geometry'

export interface RenderedTextLayer {
  container: HTMLElement
  cancel(): void
}

/** Renders the transparent text runs of a page into `container`. */
export async function renderTextLayer(
  page: PDFPageProxy,
  viewport: PageViewport,
  container: HTMLElement,
): Promise<RenderedTextLayer> {
  container.replaceChildren()
  // The name matters: pdf.js reads `--total-scale-factor` and the stylesheet in
  // styles/app.css builds every run's font size from it.
  container.style.setProperty('--total-scale-factor', String(viewport.scale))

  const layer = new TextLayer({
    textContentSource: page.streamTextContent({ includeMarkedContent: false }),
    container,
    viewport,
  })

  await layer.render()
  return { container, cancel: () => layer.cancel() }
}

/* ===========================================================================
   Coordinates
   ======================================================================== */

/**
 * Converts a rectangle in viewport pixels into page-normalised coordinates.
 * `pageBox` is the on-screen rectangle of the page itself.
 */
export function toPageRect(client: DOMRect, pageBox: DOMRect): Rect {
  return {
    x: (client.left - pageBox.left) / pageBox.width,
    y: (client.top - pageBox.top) / pageBox.height,
    w: client.width / pageBox.width,
    h: client.height / pageBox.height,
  }
}

export interface MarkedText {
  page: number
  rects: Rect[]
  text: string
}

/**
 * The rectangles covered by the current text selection, per page.
 *
 * A selection can run across several pages in continuous mode, so the result is
 * grouped by page element.
 */
export function rectsFromSelection(
  selection: Selection,
  pageFor: (node: Node) => { index: number; element: HTMLElement } | null,
): MarkedText[] {
  const ranges: Range[] = []
  for (let i = 0; i < selection.rangeCount; i += 1) {
    const range = selection.getRangeAt(i)
    if (!range.collapsed) ranges.push(range)
  }
  return rectsFromRanges(ranges, pageFor)
}

/**
 * The same, for a range Folio built itself.
 *
 * On touch devices the marker tools do not go through the browser's selection
 * at all — see ui/text-drag.ts — so the range arrives directly.
 */
export function rectsFromRange(
  range: Range,
  pageFor: (node: Node) => { index: number; element: HTMLElement } | null,
): MarkedText[] {
  return range.collapsed ? [] : rectsFromRanges([range], pageFor)
}

function rectsFromRanges(
  ranges: readonly Range[],
  pageFor: (node: Node) => { index: number; element: HTMLElement } | null,
): MarkedText[] {
  const byPage = new Map<number, { element: HTMLElement; rects: Rect[]; text: string }>()

  for (const range of ranges) {
    // Walk the runs the range touches so each rectangle can be attributed to
    // the page it belongs to; `range.getClientRects()` alone loses that.
    for (const { node, subRange } of runsInRange(range)) {
      const page = pageFor(node)
      if (!page) continue

      const box = page.element.getBoundingClientRect()
      const entry = byPage.get(page.index) ?? { element: page.element, rects: [], text: '' }
      for (const client of Array.from(subRange.getClientRects())) {
        if (client.width < 0.5 || client.height < 0.5) continue
        entry.rects.push(toPageRect(client, box))
      }
      entry.text += subRange.toString()
      byPage.set(page.index, entry)
    }
  }

  return [...byPage.entries()]
    .map(([page, entry]) => ({
      page,
      rects: mergeLineRects(entry.rects),
      text: entry.text.replace(/\s+/g, ' ').trim(),
    }))
    .filter((entry) => entry.rects.length > 0)
    .sort((a, b) => a.page - b.page)
}

/** Every text node a range touches, each with the part of the range inside it. */
function runsInRange(range: Range): { node: Text; subRange: Range }[] {
  const root = range.commonAncestorContainer
  const walker = document.createTreeWalker(
    root.nodeType === Node.TEXT_NODE ? (root.parentNode as Node) : root,
    NodeFilter.SHOW_TEXT,
  )
  const runs: { node: Text; subRange: Range }[] = []

  let node = walker.nextNode() as Text | null
  while (node) {
    if (range.intersectsNode(node)) {
      const subRange = document.createRange()
      subRange.selectNodeContents(node)

      if (node === range.startContainer) subRange.setStart(node, range.startOffset)
      if (node === range.endContainer) subRange.setEnd(node, range.endOffset)

      if (!subRange.collapsed) runs.push({ node, subRange })
    }
    node = walker.nextNode() as Text | null
  }

  return runs
}

/* ===========================================================================
   Editable lines
   ======================================================================== */

export interface TextLine {
  /** Index within the page, in reading order. */
  index: number
  text: string
  /** Normalised box around the whole line. */
  box: Rect
  /** Font size as a fraction of page height. */
  fontSize: number
  family: 'serif' | 'sans' | 'mono'
  bold: boolean
  italic: boolean
  /** The spans this line was built from, for highlighting it while editing. */
  spans: HTMLElement[]
}

/**
 * Groups the text runs of a page into lines.
 *
 * Editing works on lines, not on runs: a run boundary is an artefact of how the
 * PDF was written (a change of font, a kerning pair, a colour switch) and never
 * something a reader thinks of as a unit. Lines are what people edit.
 */
export function collectLines(container: HTMLElement, pageBox: DOMRect): TextLine[] {
  const spans = Array.from(container.querySelectorAll<HTMLElement>('span')).filter(
    (span) => span.textContent && span.textContent.trim().length > 0,
  )

  type Row = { rect: DOMRect; spans: HTMLElement[] }
  const rows: Row[] = []

  for (const span of spans) {
    const rect = span.getBoundingClientRect()
    if (rect.width < 0.5 || rect.height < 0.5) continue

    // Same line when the vertical centres are within half a line height and the
    // run starts near where the previous one ended.
    const row = rows.find((candidate) => {
      const a = candidate.rect
      const overlap =
        Math.min(a.bottom, rect.bottom) - Math.max(a.top, rect.top) >
        Math.min(a.height, rect.height) * 0.5
      return overlap && rect.left >= a.left - rect.height * 0.5
    })

    if (row) {
      row.spans.push(span)
      row.rect = mergeDomRect(row.rect, rect)
    } else {
      rows.push({ rect, spans: [span] })
    }
  }

  rows.sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)

  return rows.map((row, index) => {
    row.spans.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
    const style = getComputedStyle(row.spans[0])
    const family = classifyFamily(style.fontFamily)

    return {
      index,
      text: row.spans.map((span) => span.textContent ?? '').join(''),
      box: toPageRect(row.rect, pageBox),
      fontSize: row.rect.height / pageBox.height,
      family,
      bold: Number.parseInt(style.fontWeight, 10) >= 600 || style.fontWeight === 'bold',
      italic: style.fontStyle === 'italic' || style.fontStyle === 'oblique',
      spans: row.spans,
    }
  })
}

function mergeDomRect(a: DOMRect, b: DOMRect): DOMRect {
  const left = Math.min(a.left, b.left)
  const top = Math.min(a.top, b.top)
  return new DOMRect(left, top, Math.max(a.right, b.right) - left, Math.max(a.bottom, b.bottom) - top)
}

/**
 * pdf.js names the font it installed for a run, falling back to a generic
 * family. Only the family matters here: the export can embed one of the three
 * standard font families, and picking the closest keeps a replaced line from
 * looking pasted in.
 */
export function classifyFamily(fontFamily: string): 'serif' | 'sans' | 'mono' {
  const name = fontFamily.toLowerCase()
  if (/mono|courier|consol|menlo|typewriter/.test(name)) return 'mono'
  if (/sans|arial|helvetica|verdana|tahoma|segoe|roboto|calibri/.test(name)) return 'sans'
  if (/serif|times|georgia|garamond|book|minion|cambria/.test(name)) return 'serif'
  // pdf.js falls back to sans-serif for fonts it cannot classify.
  return 'sans'
}

/** Extracts the plain text of a page, used for search and for note export. */
export async function pageText(page: PDFPageProxy): Promise<string> {
  const content = await page.getTextContent()
  let text = ''
  for (const item of content.items) {
    if ('str' in item) {
      text += item.str
      if (item.hasEOL) text += '\n'
    }
  }
  return text
}
