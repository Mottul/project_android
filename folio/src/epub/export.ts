/**
 * Writing an EPUB back out.
 *
 * The archive is rebuilt rather than patched: highlights are woven into the
 * chapters they belong to, a notes chapter is appended and registered in the
 * package document and the table of contents, and — because "make this smaller"
 * is a real need for illustrated books, whose size is almost entirely images —
 * the pictures can be re-encoded on the way through.
 *
 * Everything else is copied byte for byte. A book that is not annotated and not
 * recompressed comes out identical to the one that went in.
 */

import { strToU8, zipSync } from 'fflate'

import type { Mark } from '@/store/marks'
import { MARK_LABEL } from '@/store/marks'
import { findQuote, rangeFromOffsets, textOf as textOfNode } from './anchor'
import { mimeOf } from './render'
import { dirName, resolvePath, textOf, type EpubBook } from './parse'

export interface EpubExportOptions {
  book: EpubBook
  marks: readonly Mark[]
  includeMarks: boolean
  /** Append a chapter listing every note and highlight. */
  includeNotesChapter: boolean
  /** Re-encode images. `1` leaves them untouched. */
  imageQuality: number
  /** Longest edge in pixels; images below it are left alone. */
  maxImageEdge: number
  onProgress?: (fraction: number, label: string) => void
}

export interface EpubExportResult {
  blob: Blob
  /** Bytes saved by re-encoding images. */
  imageSavings: number
  /** Marks whose text could not be found again in the chapter. */
  unanchored: number
}

const NOTES_PATH_NAME = 'folio-notizen.xhtml'

export async function exportEpub(options: EpubExportOptions): Promise<EpubExportResult> {
  const { book } = options
  const files = new Map(book.files)
  let unanchored = 0

  if (options.includeMarks) {
    options.onProgress?.(0.1, 'Markierungen werden eingesetzt')
    const byChapter = groupByChapter(options.marks)

    for (const [path, marks] of byChapter) {
      const html = textOf(files, path)
      if (!html) {
        unanchored += marks.length
        continue
      }
      const result = injectMarks(html, marks)
      files.set(path, strToU8(result.html))
      unanchored += result.unanchored
    }
  }

  let imageSavings = 0
  if (options.imageQuality < 1 || options.maxImageEdge > 0) {
    options.onProgress?.(0.4, 'Bilder werden verkleinert')
    imageSavings = await recompressImages(files, options)
  }

  if (options.includeNotesChapter && options.marks.length) {
    options.onProgress?.(0.8, 'Notizen werden angehängt')
    addNotesChapter(files, book, options.marks)
  }

  options.onProgress?.(0.92, 'Archiv wird gepackt')
  return { blob: packEpub(files), imageSavings, unanchored }
}

/* ===========================================================================
   Highlights in the markup
   ======================================================================== */

function groupByChapter(marks: readonly Mark[]): Map<string, Mark[]> {
  const byChapter = new Map<string, Mark[]>()
  for (const mark of marks) {
    if (!mark.href || !mark.quote) continue
    const list = byChapter.get(mark.href)
    if (list) list.push(mark)
    else byChapter.set(mark.href, [mark])
  }
  return byChapter
}

export interface InjectionResult {
  html: string
  unanchored: number
}

/**
 * Wraps every mark's text in a `<mark>` element.
 *
 * Marks are applied from the end of the chapter backwards. Wrapping a range
 * changes the text nodes around it, and every offset after the change would
 * otherwise need recomputing; going backwards means the offsets still standing
 * are all before the edit and stay valid.
 */
export function injectMarks(html: string, marks: readonly Mark[]): InjectionResult {
  const doc = new DOMParser().parseFromString(html, 'application/xhtml+xml')
  const root = doc.querySelector('parsererror') ? null : doc.body ?? doc.documentElement
  if (!root) return { html, unanchored: marks.length }

  const text = textOfNode(root)
  const located = marks
    .map((mark) => ({ mark, range: findQuote(text, { quote: mark.quote ?? '', prefix: mark.prefix, suffix: mark.suffix }) }))
    .filter((entry) => entry.range !== null)
    .sort((a, b) => (b.range?.start ?? 0) - (a.range?.start ?? 0))

  for (const { mark, range } of located) {
    if (!range) continue
    const domRange = rangeFromOffsets(root, range.start, range.end)
    if (!domRange) continue
    wrapRange(doc, domRange, mark)
  }

  return {
    html: new XMLSerializer().serializeToString(doc),
    unanchored: marks.length - located.length,
  }
}

/**
 * Wraps a range that may span several elements.
 *
 * `Range.surroundContents` would be one line, but it throws whenever the range
 * crosses an element boundary — a highlight running over an italic word, which
 * is the normal case in a book. So each text node the range touches is wrapped
 * individually.
 */
function wrapRange(doc: Document, range: Range, mark: Mark): void {
  const nodes: Text[] = []
  const walker = doc.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT)

  let node = walker.nextNode() as Text | null
  while (node) {
    if (range.intersectsNode(node)) nodes.push(node)
    node = walker.nextNode() as Text | null
  }
  if (!nodes.length && range.startContainer.nodeType === Node.TEXT_NODE) {
    nodes.push(range.startContainer as Text)
  }

  for (const target of nodes) {
    const from = target === range.startContainer ? range.startOffset : 0
    const to = target === range.endContainer ? range.endOffset : target.data.length
    if (to <= from) continue

    // Tail first, then head: splitting the head would shift the tail offset.
    if (to < target.data.length) target.splitText(to)
    const piece = from > 0 ? target.splitText(from) : target

    const wrapper = doc.createElementNS('http://www.w3.org/1999/xhtml', 'mark')
    wrapper.setAttribute('class', 'folio-mark')
    wrapper.setAttribute('style', styleFor(mark))
    if (mark.comment) wrapper.setAttribute('title', mark.comment)

    piece.parentNode?.insertBefore(wrapper, piece)
    wrapper.appendChild(piece)
  }
}

function styleFor(mark: Mark): string {
  switch (mark.type) {
    case 'underline':
      return `background:transparent;text-decoration:underline;text-decoration-color:${mark.color};text-decoration-thickness:2px`
    case 'strike':
      return `background:transparent;text-decoration:line-through;text-decoration-color:${mark.color}`
    default:
      return `background:${mark.color};color:inherit`
  }
}

/* ===========================================================================
   Notes chapter
   ======================================================================== */

function addNotesChapter(
  files: Map<string, Uint8Array>,
  book: EpubBook,
  marks: readonly Mark[],
): void {
  const base = dirName(book.packagePath)
  const path = resolvePath(base, NOTES_PATH_NAME)
  files.set(path, strToU8(notesChapterXhtml(book.title, marks)))

  const packageXml = textOf(files, book.packagePath)
  if (!packageXml) return

  const doc = new DOMParser().parseFromString(packageXml, 'application/xhtml+xml')
  const manifest = doc.querySelector('manifest')
  const spine = doc.querySelector('spine')
  if (!manifest || !spine) return

  const item = doc.createElementNS(manifest.namespaceURI, 'item')
  item.setAttribute('id', 'folio-notizen')
  item.setAttribute('href', NOTES_PATH_NAME)
  item.setAttribute('media-type', 'application/xhtml+xml')
  manifest.appendChild(item)

  const itemref = doc.createElementNS(spine.namespaceURI, 'itemref')
  itemref.setAttribute('idref', 'folio-notizen')
  spine.appendChild(itemref)

  files.set(book.packagePath, strToU8(new XMLSerializer().serializeToString(doc)))
}

/**
 * The appended chapter, built as a string rather than through the DOM: it is a
 * fixed document with no structure worth constructing node by node.
 */
export function notesChapterXhtml(bookTitle: string, marks: readonly Mark[]): string {
  const items = marks
    .map((mark) => {
      const quote = mark.quote?.trim()
      const comment = mark.comment?.trim()
      return [
        '<li>',
        `<p class="folio-kind">${escapeXml(MARK_LABEL[mark.type])}</p>`,
        quote ? `<blockquote>${escapeXml(quote)}</blockquote>` : '',
        comment ? `<p>${escapeXml(comment)}</p>` : '',
        '</li>',
      ].join('')
    })
    .join('\n')

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<!DOCTYPE html>',
    '<html xmlns="http://www.w3.org/1999/xhtml" lang="de">',
    '<head><meta charset="utf-8"/><title>Notizen</title></head>',
    '<body>',
    `<h1>Notizen zu ${escapeXml(bookTitle)}</h1>`,
    `<ol>${items}</ol>`,
    '</body>',
    '</html>',
  ].join('\n')
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/* ===========================================================================
   Images
   ======================================================================== */

/** Below this an image is not worth the re-encode. */
const MIN_IMAGE_BYTES = 48 * 1024

async function recompressImages(
  files: Map<string, Uint8Array>,
  options: EpubExportOptions,
): Promise<number> {
  const images = [...files.keys()].filter((path) => {
    const type = mimeOf(path)
    // SVG is text and vector — re-encoding it as a bitmap would be a downgrade.
    return type.startsWith('image/') && type !== 'image/svg+xml'
  })

  let saved = 0
  let done = 0

  for (const path of images) {
    const original = files.get(path)
    if (!original || original.byteLength < MIN_IMAGE_BYTES) continue

    try {
      const replacement = await recompress(original, mimeOf(path), options)
      if (replacement && replacement.byteLength < original.byteLength) {
        saved += original.byteLength - replacement.byteLength
        files.set(path, replacement)
      }
    } catch {
      // A picture that will not decode stays as it is.
    }

    done += 1
    options.onProgress?.(0.4 + (0.35 * done) / Math.max(1, images.length), 'Bilder werden verkleinert')
  }

  return saved
}

/**
 * Re-encodes one image.
 *
 * JPEGs are re-encoded as JPEG, PNGs stay PNG. Turning a PNG into a JPEG would
 * usually save more, but it would also have to rewrite the file name and the
 * manifest entry, and it would silently destroy any transparency — for a cover
 * with a cut-out that is a worse outcome than a larger file.
 */
async function recompress(
  data: Uint8Array,
  mimeType: string,
  options: EpubExportOptions,
): Promise<Uint8Array | null> {
  const blob = new Blob([data as BlobPart], { type: mimeType })
  const bitmap = await createImageBitmap(blob)

  const longest = Math.max(bitmap.width, bitmap.height)
  const limit = options.maxImageEdge > 0 ? options.maxImageEdge : longest
  const scale = Math.min(1, limit / longest)

  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d', { alpha: mimeType !== 'image/jpeg' })
  if (!context) {
    bitmap.close()
    return null
  }
  if (mimeType === 'image/jpeg') {
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
  }
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const target = mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png'
  const encoded = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, target, options.imageQuality),
  )
  canvas.width = 0
  canvas.height = 0
  if (!encoded) return null

  return new Uint8Array(await encoded.arrayBuffer())
}

/* ===========================================================================
   Packing
   ======================================================================== */

/**
 * Builds the archive.
 *
 * `mimetype` has to come first and has to be stored uncompressed — that is what
 * lets a reader identify an EPUB from its first bytes, and a book that gets it
 * wrong is rejected by strict readers even though every other byte is fine.
 */
export function packEpub(files: Map<string, Uint8Array>): Blob {
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {}

  entries.mimetype = [strToU8('application/epub+zip'), { level: 0 }]
  for (const [path, data] of files) {
    if (path === 'mimetype') continue
    entries[path] = [data, { level: 6 }]
  }

  const zipped = zipSync(entries)
  return new Blob([zipped as BlobPart], { type: 'application/epub+zip' })
}
