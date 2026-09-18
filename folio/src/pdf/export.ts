/**
 * Writing a document back out.
 *
 * Two routes, because they answer two different questions.
 *
 * **Original** keeps the PDF as it is and draws the marks into it. Text stays
 * text, it stays searchable and selectable, vector graphics stay sharp at any
 * zoom, and the file is roughly the size it was. This is what "save" means.
 *
 * **Komprimiert** throws the page away and re-renders it as a JPEG at a chosen
 * resolution and quality. Everything becomes a picture — no more selecting, no
 * more searching — and in exchange the size becomes something that can actually
 * be aimed at. A 40 MB scan turns into 2 MB that still reads perfectly well on
 * screen. This is what "small enough to send" means, and it is the only honest
 * way a browser can offer a size slider: the alternative, re-compressing the
 * images inside the PDF in place, would need to decode and rebuild every image
 * XObject, and would silently do nothing at all to a document whose size comes
 * from embedded fonts or vector art.
 *
 * Marks are drawn identically in both cases, through one transformation matrix
 * per page (see placement.ts), so a rotated page and a cropped page need no
 * special handling anywhere below.
 */

import {
  BlendMode,
  LineCapStyle,
  PDFDocument,
  PDFHexString,
  PDFName,
  StandardFonts,
  concatTransformationMatrix,
  degrees,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib'
import type { PDFDocumentProxy } from 'pdfjs-dist'

import type { Mark } from '@/store/marks'
import { MARK_LABEL, compareMarks } from '@/store/marks'
import { hexToUnit } from './sample'
import {
  lengthX,
  lengthY,
  placePage,
  rectToDisplay,
  toDisplay,
  type Placement,
} from './placement'
import { toWinAnsi, wrapText } from './text-encoding'
import {
  compressionLadder,
  estimateTotalBytes,
  findStep,
  samplePages,
  type CompressionStep,
} from './compress'

export type PdfExportMode = 'original' | 'komprimiert'

export interface PdfExportOptions {
  /** The untouched bytes of the document. */
  source: ArrayBuffer
  /** The same document, already parsed — used to re-render pages. */
  doc: PDFDocumentProxy
  marks: readonly Mark[]
  includeMarks: boolean
  /** Zero-based page indices in output order. Undefined means the whole document. */
  pages?: number[]
  mode: PdfExportMode
  dpi: number
  quality: number
  grayscale?: boolean
  /** When set, the resolution and quality are searched for rather than used. */
  targetBytes?: number
  onProgress?: (fraction: number, label: string) => void
  signal?: AbortSignal
}

export interface PdfExportResult {
  blob: Blob
  pageCount: number
  /** Which setting the compressed export ended up using. */
  step?: CompressionStep
  /** True when even the lowest setting stayed above the requested target. */
  missedTarget?: boolean
  /** Characters that no standard font could represent, for a warning. */
  droppedCharacters: string[]
}

class Cancelled extends Error {
  constructor() {
    super('Export abgebrochen.')
    this.name = 'Cancelled'
  }
}

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Cancelled()
}

export function isCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === 'Cancelled'
}

/* ===========================================================================
   Entry point
   ======================================================================== */

export async function exportPdf(options: PdfExportOptions): Promise<PdfExportResult> {
  const pages = options.pages ?? range(options.doc.numPages)
  if (!pages.length) throw new Error('Es wurde keine Seite zum Exportieren ausgewählt.')

  return options.mode === 'komprimiert'
    ? exportCompressed(options, pages)
    : exportOriginal(options, pages)
}

/* ===========================================================================
   Original structure
   ======================================================================== */

async function exportOriginal(
  options: PdfExportOptions,
  pages: number[],
): Promise<PdfExportResult> {
  options.onProgress?.(0.05, 'Dokument wird gelesen')

  const source = await PDFDocument.load(options.source, {
    ignoreEncryption: true,
    updateMetadata: false,
  })

  const wholeDocument = pages.length === source.getPageCount() && pages.every((p, i) => p === i)

  // Copying pages loses the outline and any form fields, so it only happens
  // when the export really is a subset.
  let out = source
  if (!wholeDocument) {
    out = await PDFDocument.create()
    const copied = await out.copyPages(source, pages)
    for (const page of copied) out.addPage(page)
  }

  const fonts = await embedFonts(out)
  const dropped = new Set<string>()

  if (options.includeMarks) {
    const byPage = groupMarks(options.marks)
    for (let index = 0; index < pages.length; index += 1) {
      checkCancelled(options.signal)
      const marks = byPage.get(pages[index])
      if (!marks?.length) continue

      drawMarks(out, out.getPage(index), marks, fonts, dropped)
      options.onProgress?.(0.1 + (0.8 * (index + 1)) / pages.length, 'Markierungen werden gesetzt')
    }
  }

  options.onProgress?.(0.95, 'Datei wird geschrieben')
  const bytes = await out.save({ useObjectStreams: true })

  return {
    blob: new Blob([bytes as BufferSource], { type: 'application/pdf' }),
    pageCount: pages.length,
    droppedCharacters: [...dropped],
  }
}

/* ===========================================================================
   Compressed
   ======================================================================== */

async function exportCompressed(
  options: PdfExportOptions,
  pages: number[],
): Promise<PdfExportResult> {
  let step: CompressionStep = { dpi: options.dpi, quality: options.quality }
  let missedTarget = false

  if (options.targetBytes) {
    options.onProgress?.(0.02, 'Passende Einstellung wird gesucht')
    const search = await searchForTarget(options, pages, options.targetBytes)
    step = search.step
    missedTarget = search.missed
  }

  const out = await PDFDocument.create()
  const fonts = await embedFonts(out)
  const dropped = new Set<string>()
  const byPage = groupMarks(options.marks)

  for (let index = 0; index < pages.length; index += 1) {
    checkCancelled(options.signal)
    const pageIndex = pages[index]

    const rendered = await renderPageToJpeg(options.doc, pageIndex, step, options.grayscale)
    const image = await out.embedJpg(rendered.bytes)

    // The new page keeps the size of the old one in points, so paper size,
    // margins and anything measured off the page survive the rasterisation.
    const page = out.addPage([rendered.widthPt, rendered.heightPt])
    page.drawImage(image, { x: 0, y: 0, width: rendered.widthPt, height: rendered.heightPt })

    const marks = options.includeMarks ? byPage.get(pageIndex) : undefined
    if (marks?.length) drawMarks(out, page, marks, fonts, dropped)

    options.onProgress?.(
      0.1 + (0.85 * (index + 1)) / pages.length,
      `Seite ${index + 1} von ${pages.length}`,
    )
  }

  options.onProgress?.(0.97, 'Datei wird geschrieben')
  const bytes = await out.save({ useObjectStreams: true })

  return {
    blob: new Blob([bytes as BufferSource], { type: 'application/pdf' }),
    pageCount: pages.length,
    step,
    missedTarget,
    droppedCharacters: [...dropped],
  }
}

/**
 * Finds the best setting that fits a target size.
 *
 * Only a sample of pages is encoded per candidate — see compress.ts — and every
 * measurement is cached, because the bisection revisits the same step when it
 * narrows down.
 */
async function searchForTarget(
  options: PdfExportOptions,
  pages: number[],
  targetBytes: number,
): Promise<{ step: CompressionStep; missed: boolean }> {
  const sample = samplePages(pages.length).map((index) => pages[index])
  const ladder = compressionLadder()
  let taken = 0

  const result = await findStep(
    ladder,
    async (step) => {
      checkCancelled(options.signal)
      let total = 0
      for (const pageIndex of sample) {
        const rendered = await renderPageToJpeg(options.doc, pageIndex, step, options.grayscale)
        total += rendered.bytes.byteLength
      }
      taken += 1
      // A bisection over this ladder takes about six measurements; the bar is
      // capped so a document that needs one more does not run past it.
      options.onProgress?.(0.02 + Math.min(0.06, taken * 0.01), 'Größe wird geschätzt')
      return estimateTotalBytes([total / sample.length], pages.length)
    },
    targetBytes,
  )

  return { step: result.step, missed: result.missed }
}

export interface RenderedPage {
  bytes: Uint8Array
  widthPt: number
  heightPt: number
}

/** Renders one page into a JPEG at the requested resolution. */
export async function renderPageToJpeg(
  doc: PDFDocumentProxy,
  pageIndex: number,
  step: CompressionStep,
  grayscale = false,
): Promise<RenderedPage> {
  const page = await doc.getPage(pageIndex + 1)
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: step.dpi / 72 })

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(viewport.width))
  canvas.height = Math.max(1, Math.round(viewport.height))

  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('Die Seite konnte nicht gerendert werden.')

  // JPEG has no transparency; without a white ground, pages with a transparent
  // background come out black.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)

  await page.render({ canvas, viewport }).promise

  if (grayscale) toGrayscale(context, canvas.width, canvas.height)

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', step.quality),
  )
  if (!blob) throw new Error('Die Seite konnte nicht komprimiert werden.')

  // Frees the backing store immediately rather than at the next collection;
  // a 300 dpi A4 page is 35 megabytes of canvas.
  canvas.width = 0
  canvas.height = 0
  page.cleanup()

  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    widthPt: base.width,
    heightPt: base.height,
  }
}

function toGrayscale(context: CanvasRenderingContext2D, width: number, height: number): void {
  const image = context.getImageData(0, 0, width, height)
  const { data } = image
  for (let i = 0; i < data.length; i += 4) {
    const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    data[i] = luma
    data[i + 1] = luma
    data[i + 2] = luma
  }
  context.putImageData(image, 0, 0)
}

/* ===========================================================================
   Drawing marks
   ======================================================================== */

interface Fonts {
  sans: PDFFont
  sansBold: PDFFont
  serif: PDFFont
  serifBold: PDFFont
  mono: PDFFont
}

async function embedFonts(doc: PDFDocument): Promise<Fonts> {
  return {
    sans: await doc.embedFont(StandardFonts.Helvetica),
    sansBold: await doc.embedFont(StandardFonts.HelveticaBold),
    serif: await doc.embedFont(StandardFonts.TimesRoman),
    serifBold: await doc.embedFont(StandardFonts.TimesRomanBold),
    mono: await doc.embedFont(StandardFonts.Courier),
  }
}

function groupMarks(marks: readonly Mark[]): Map<number, Mark[]> {
  const byPage = new Map<number, Mark[]>()
  for (const mark of marks) {
    if (mark.page === undefined) continue
    const list = byPage.get(mark.page)
    if (list) list.push(mark)
    else byPage.set(mark.page, [mark])
  }
  for (const list of byPage.values()) list.sort(compareMarks)
  return byPage
}

/**
 * Draws every mark of one page.
 *
 * Order matters and is not the order the marks were made in: fills that cover
 * original content go down first, then the translucent bands, then ink and
 * text on top. A highlight drawn under a redaction would be invisible; a
 * redaction drawn over a replacement would hide the new text.
 */
function drawMarks(
  doc: PDFDocument,
  page: PDFPage,
  marks: readonly Mark[],
  fonts: Fonts,
  dropped: Set<string>,
): void {
  const crop = page.getCropBox()
  const placement = placePage(crop, page.getRotation().angle)

  const layers: Mark['type'][][] = [
    ['redact', 'replace'],
    ['highlight'],
    ['underline', 'strike'],
    ['ink'],
    ['text'],
    ['note'],
  ]

  // One graphics state around everything: the marks must not inherit whatever
  // the page's own content stream left behind, and must not leak into it either.
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(...placement.matrix),
  )

  for (const types of layers) {
    for (const mark of marks) {
      if (!types.includes(mark.type)) continue
      drawMark(page, placement, mark, fonts, dropped)
    }
  }

  page.pushOperators(popGraphicsState())

  // Comments become real PDF annotations, outside the content stream, so every
  // reader shows them in its own comment list. They are placed afterwards
  // because annotation rectangles live in page space, not in display space.
  for (const mark of marks) {
    if (!mark.comment?.trim()) continue
    addCommentAnnotation(doc, page, placement, mark)
  }
}

function drawMark(
  page: PDFPage,
  placement: Placement,
  mark: Mark,
  fonts: Fonts,
  dropped: Set<string>,
): void {
  const color = hexToUnit(mark.color)

  switch (mark.type) {
    case 'highlight': {
      for (const r of mark.rects ?? []) {
        const box = rectToDisplay(placement, r)
        page.drawRectangle({
          ...box,
          color: rgb(color.r, color.g, color.b),
          opacity: mark.opacity ?? 0.35,
          // Multiply keeps the text underneath readable instead of veiling it.
          blendMode: BlendMode.Multiply,
        })
      }
      return
    }

    case 'underline':
    case 'strike': {
      for (const r of mark.rects ?? []) {
        const box = rectToDisplay(placement, r)
        const thickness = Math.max(0.6, box.height * 0.06)
        const y = mark.type === 'underline' ? box.y + thickness : box.y + box.height * 0.45
        page.drawLine({
          start: { x: box.x, y },
          end: { x: box.x + box.width, y },
          thickness,
          color: rgb(color.r, color.g, color.b),
          opacity: mark.opacity ?? 1,
          lineCap: LineCapStyle.Round,
        })
      }
      return
    }

    case 'ink': {
      for (const path of mark.paths ?? []) {
        const d = svgPathOf(path.points, placement)
        if (!d) continue
        page.drawSvgPath(d, {
          // drawSvgPath works in SVG conventions — y downwards from the anchor —
          // so anchoring at the top edge makes the stored coordinates line up.
          x: 0,
          y: placement.displayHeight,
          scale: 1,
          borderColor: rgb(color.r, color.g, color.b),
          borderWidth: Math.max(0.4, lengthX(placement, path.width)),
          borderLineCap: LineCapStyle.Round,
          borderOpacity: mark.opacity ?? 1,
        })
      }
      return
    }

    case 'redact': {
      if (!mark.box) return
      const box = rectToDisplay(placement, mark.box)
      const fill = hexToUnit(mark.fill ?? mark.color)
      page.drawRectangle({ ...box, color: rgb(fill.r, fill.g, fill.b) })
      return
    }

    case 'replace': {
      if (!mark.box) return
      const box = rectToDisplay(placement, mark.box)
      const fill = hexToUnit(mark.fill ?? '#ffffff')
      page.drawRectangle({ ...box, color: rgb(fill.r, fill.g, fill.b) })
      if (mark.text?.trim()) drawTextBlock(page, placement, mark, fonts, dropped, box)
      return
    }

    case 'text': {
      if (!mark.box || !mark.text?.trim()) return
      const box = rectToDisplay(placement, mark.box)
      drawTextBlock(page, placement, mark, fonts, dropped, box)
      return
    }

    case 'note': {
      // The pin. The comment itself rides along as an annotation.
      if (!mark.box) return
      const anchor = toDisplay(placement, mark.box.x, mark.box.y)
      const size = Math.max(8, lengthX(placement, 0.018))
      page.drawRectangle({
        x: anchor.x,
        y: anchor.y - size,
        width: size,
        height: size,
        color: rgb(color.r, color.g, color.b),
        opacity: 0.9,
        borderColor: rgb(1, 1, 1),
        borderWidth: Math.max(0.5, size * 0.08),
      })
      return
    }

    default:
      return
  }
}

function drawTextBlock(
  page: PDFPage,
  placement: Placement,
  mark: Mark,
  fonts: Fonts,
  dropped: Set<string>,
  box: { x: number; y: number; width: number; height: number },
): void {
  const encoded = toWinAnsi(mark.text ?? '')
  for (const char of encoded.dropped) dropped.add(char)

  const font = pickFont(fonts, mark)
  const size = Math.max(4, lengthY(placement, mark.fontSize ?? 0.014))
  const lineHeight = size * 1.2

  const lines = wrapText(encoded.text, box.width, (line) => font.widthOfTextAtSize(line, size))
  const color = hexToUnit(mark.color)

  // Text sits on the first baseline inside the box and runs downwards, the same
  // way it does in the editor, so what was typed is what comes out.
  let y = box.y + box.height - size * 0.88

  for (const line of lines) {
    const width = font.widthOfTextAtSize(line, size)
    const x =
      mark.align === 'center'
        ? box.x + (box.width - width) / 2
        : mark.align === 'right'
          ? box.x + box.width - width
          : box.x

    page.drawText(line, {
      x,
      y,
      size,
      font,
      color: rgb(color.r, color.g, color.b),
      opacity: mark.opacity ?? 1,
    })
    y -= lineHeight
  }
}

/**
 * The closest standard font to the one the line was originally set in.
 *
 * A replacement carries the family the text editor read off the page, so a
 * corrected line in a serif document stays serif. Only the family and the
 * weight survive — the actual typeface is whatever the document embedded, and
 * re-embedding a subset of it for one edited line is a different project.
 */
function pickFont(fonts: Fonts, mark: Mark): PDFFont {
  if (mark.family === 'mono') return fonts.mono
  if (mark.family === 'serif') return mark.bold ? fonts.serifBold : fonts.serif
  return mark.bold ? fonts.sansBold : fonts.sans
}

/** Turns normalised stroke points into an SVG path in display points. */
export function svgPathOf(points: readonly number[], placement: Placement): string {
  if (points.length < 2) return ''

  const px = (value: number) => (value * placement.displayWidth).toFixed(2)
  const py = (value: number) => (value * placement.displayHeight).toFixed(2)

  let d = `M ${px(points[0])} ${py(points[1])}`
  if (points.length === 2) {
    // A single tap still has to leave a dot; a zero-length line with a round
    // cap does not draw in every renderer, a hairline does.
    d += ` l 0.01 0.01`
    return d
  }
  for (let i = 2; i < points.length; i += 2) {
    d += ` L ${px(points[i])} ${py(points[i + 1])}`
  }
  return d
}

/**
 * A comment as a `/Text` annotation — the sticky note every PDF reader knows.
 *
 * Built by hand because pdf-lib has no high-level API for markup annotations.
 * The dictionary is deliberately minimal: `Contents` is what readers show, `T`
 * is the author line, `C` the colour of the pin, and flag 4 (`Print`) means the
 * note is not silently dropped when the document is printed.
 */
function addCommentAnnotation(
  doc: PDFDocument,
  page: PDFPage,
  placement: Placement,
  mark: Mark,
): void {
  const anchor = mark.box
    ? toDisplay(placement, mark.box.x, mark.box.y)
    : mark.rects?.length
      ? toDisplay(placement, mark.rects[0].x, mark.rects[0].y)
      : toDisplay(placement, 0.02, 0.02)

  // Display space back into page space, which is where annotation rectangles live.
  const [a, b, c, d, e, f] = placement.matrix
  const toPage = (x: number, y: number) => ({ x: a * x + c * y + e, y: b * x + d * y + f })

  const size = 18
  const corner1 = toPage(anchor.x, anchor.y)
  const corner2 = toPage(anchor.x + size, anchor.y - size)
  const color = hexToUnit(mark.color)

  const annotation = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Text',
    Name: 'Comment',
    Rect: [
      Math.min(corner1.x, corner2.x),
      Math.min(corner1.y, corner2.y),
      Math.max(corner1.x, corner2.x),
      Math.max(corner1.y, corner2.y),
    ],
    Contents: PDFHexString.fromText(mark.comment ?? ''),
    T: PDFHexString.fromText(`Folio — ${MARK_LABEL[mark.type]}`),
    Subj: PDFHexString.fromText(mark.quote?.slice(0, 120) ?? MARK_LABEL[mark.type]),
    C: [color.r, color.g, color.b],
    F: 4,
    CA: 1,
    M: PDFHexString.fromText(pdfDate(mark.updatedAt)),
  })

  const reference = doc.context.register(annotation)
  const existing = page.node.Annots()
  if (existing) existing.push(reference)
  else page.node.set(PDFName.of('Annots'), doc.context.obj([reference]))
}

/** `D:20260918143000Z` — the date format PDF readers expect. */
export function pdfDate(timestamp: number): string {
  const iso = new Date(timestamp).toISOString()
  return `D:${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`
}

/* ===========================================================================
   Page images
   ======================================================================== */

/** Exports single pages as images, for slides, mails and chat messages. */
export async function exportPageImage(
  doc: PDFDocumentProxy,
  pageIndex: number,
  options: { dpi: number; quality: number; format: 'image/jpeg' | 'image/png' },
): Promise<Blob> {
  const page = await doc.getPage(pageIndex + 1)
  const viewport = page.getViewport({ scale: options.dpi / 72 })

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(viewport.width))
  canvas.height = Math.max(1, Math.round(viewport.height))

  const context = canvas.getContext('2d', { alpha: options.format === 'image/png' })
  if (!context) throw new Error('Die Seite konnte nicht gerendert werden.')
  if (options.format === 'image/jpeg') {
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
  }

  await page.render({ canvas, viewport }).promise

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, options.format, options.quality),
  )
  canvas.width = 0
  canvas.height = 0
  page.cleanup()

  if (!blob) throw new Error('Das Bild konnte nicht erzeugt werden.')
  return blob
}

/* ===========================================================================
   Helpers
   ======================================================================== */

function range(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index)
}

/** Rotation helper kept next to the others; used by the page tools. */
export function rotatePage(page: PDFPage, byDegrees: number): void {
  page.setRotation(degrees((page.getRotation().angle + byDegrees + 360) % 360))
}
