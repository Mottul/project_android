/**
 * pdf.js, set up once.
 *
 * Three things need wiring before a document can be opened: the worker (the
 * parser runs off the main thread, otherwise scrolling a 300-page file stutters
 * badly), the data files copied into `public/pdfjs/` by `npm run assets`, and
 * a couple of options that decide how forgiving the parser is.
 *
 * The **legacy** build is used rather than the modern one. pdf.js 6 targets
 * only the newest browser releases and calls things like
 * `Map.prototype.getOrInsertComputed`, which a Chrome that is a few months old
 * does not have — and on Android, a Chrome that is a few months old is normal.
 * The legacy bundle is the same library with those edges transpiled away; it
 * costs a little size and buys the app back several years of devices.
 */

import {
  GlobalWorkerOptions,
  PixelsPerInch,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist/legacy/build/pdf.mjs'
import PdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs?worker'

/**
 * Vite bundles the worker and hands back a constructor. Using `workerPort`
 * rather than `workerSrc` means the worker is a module worker built by the same
 * pipeline as the app — no second copy of pdf.js, no path that breaks when the
 * app moves to a different folder.
 */
GlobalWorkerOptions.workerPort = new PdfWorker()

/** Resolved against the document so it keeps working from any subfolder. */
const assetUrl = (folder: string) => new URL(`./pdfjs/${folder}/`, document.baseURI).href

export const PDF_POINTS_PER_INCH = PixelsPerInch.PDF

export interface PdfMeta {
  title?: string
  author?: string
  subject?: string
  keywords?: string
  creator?: string
  createdAt?: number
  pages: number
  /** The document refuses to be modified without a password. */
  encrypted: boolean
}

export class PasswordRequired extends Error {
  constructor() {
    super('Dieses PDF ist passwortgeschützt.')
    this.name = 'PasswordRequired'
  }
}

/**
 * Opens a PDF.
 *
 * The buffer is transferred to the worker, which means the caller's copy is
 * detached afterwards — anything that needs the original bytes later (export,
 * saving back) has to keep its own copy. `openPdf` therefore takes a slice.
 */
export async function openPdf(data: ArrayBuffer, password?: string): Promise<PDFDocumentProxy> {
  const task = getDocument({
    data: data.slice(0),
    cMapUrl: assetUrl('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: assetUrl('standard_fonts'),
    wasmUrl: assetUrl('wasm'),
    iccUrl: assetUrl('iccs'),
    password,
    // Documents in the wild are frequently a little broken; recovering from
    // that is much better than refusing to show anything.
    stopAtErrors: false,
    // Fonts are installed into the page so the text layer can match them. Off
    // would mean selections that do not line up with what is drawn.
    disableFontFace: false,
  })

  try {
    return await task.promise
  } catch (error) {
    if ((error as { name?: string }).name === 'PasswordException') throw new PasswordRequired()
    throw error
  }
}

/**
 * Closes a document and releases the worker task behind it.
 *
 * `cleanup()` alone only drops cached page data; the parsing task keeps the
 * whole file in the worker until its loading task is destroyed, which matters
 * when the library enriches a folder of hundreds of documents in a row.
 */
export async function closePdf(doc: PDFDocumentProxy): Promise<void> {
  try {
    await doc.cleanup()
  } catch {
    /* already gone */
  }
  try {
    await doc.loadingTask.destroy()
  } catch {
    /* already gone */
  }
}

export async function readMeta(doc: PDFDocumentProxy): Promise<PdfMeta> {
  const meta: PdfMeta = { pages: doc.numPages, encrypted: false }

  try {
    const { info } = (await doc.getMetadata()) as unknown as {
      info: Record<string, unknown>
    }
    const text = (key: string) => {
      const value = info[key]
      return typeof value === 'string' && value.trim() ? value.trim() : undefined
    }
    meta.title = text('Title')
    meta.author = text('Author')
    meta.subject = text('Subject')
    meta.keywords = text('Keywords')
    meta.creator = text('Creator') ?? text('Producer')
    meta.encrypted = info.IsEncrypted === true

    const created = text('CreationDate')
    if (created) meta.createdAt = parsePdfDate(created)
  } catch {
    // Metadata is a nicety; a document without any still opens.
  }

  return meta
}

/** `D:20240115120000+01'00'` — the PDF date format, which is almost ISO. */
export function parsePdfDate(value: string): number | undefined {
  const match = /^D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(value)
  if (!match) return undefined
  const [, year, month = '01', day = '01', hour = '00', minute = '00', second = '00'] = match
  const time = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second)
  return Number.isNaN(time) ? undefined : time
}

export interface OutlineEntry {
  title: string
  /** Resolved page index, zero based. Undefined when the target is external. */
  page?: number
  url?: string
  children: OutlineEntry[]
}

/**
 * Reads the document outline and resolves every destination to a page index.
 *
 * pdf.js hands back destinations as opaque names or arrays of references;
 * resolving them here means the sidebar deals with numbers only.
 */
export async function readOutline(doc: PDFDocumentProxy): Promise<OutlineEntry[]> {
  let raw: Awaited<ReturnType<PDFDocumentProxy['getOutline']>>
  try {
    raw = await doc.getOutline()
  } catch {
    return []
  }
  if (!raw?.length) return []

  const convert = async (items: typeof raw): Promise<OutlineEntry[]> => {
    const result: OutlineEntry[] = []
    for (const item of items ?? []) {
      const entry: OutlineEntry = {
        title: (item.title || '').trim() || '(ohne Titel)',
        children: [],
      }

      if (item.url) {
        entry.url = item.url
      } else if (item.dest) {
        entry.page = await resolveDestination(doc, item.dest)
      }

      if (item.items?.length) entry.children = await convert(item.items as typeof raw)
      result.push(entry)
    }
    return result
  }

  return convert(raw)
}

export async function resolveDestination(
  doc: PDFDocumentProxy,
  dest: string | unknown[],
): Promise<number | undefined> {
  try {
    const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest
    if (!Array.isArray(explicit) || !explicit.length) return undefined
    const index = await doc.getPageIndex(explicit[0] as never)
    return index
  } catch {
    return undefined
  }
}

/** Page size in CSS pixels at 100 % zoom, before device pixel ratio. */
export function pageSize(page: PDFPageProxy, scale = 1): { width: number; height: number } {
  const viewport = page.getViewport({ scale })
  return { width: viewport.width, height: viewport.height }
}

/**
 * Renders a page into a canvas.
 *
 * Returns the render task so the caller can cancel it: scrolling fast through a
 * long document queues renders faster than they complete, and an uncancelled
 * queue is the difference between a smooth reader and a frozen one.
 */
export function renderPage(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  cssWidth: number,
  pixelRatio = window.devicePixelRatio || 1,
) {
  const unscaled = page.getViewport({ scale: 1 })
  const scale = cssWidth / unscaled.width
  const viewport = page.getViewport({ scale: scale * pixelRatio })

  canvas.width = Math.max(1, Math.round(viewport.width))
  canvas.height = Math.max(1, Math.round(viewport.height))
  canvas.style.width = `${Math.round(cssWidth)}px`
  canvas.style.height = `${Math.round(unscaled.height * scale)}px`

  return {
    task: page.render({ canvas, viewport }),
    scale,
    cssHeight: unscaled.height * scale,
  }
}

/** A cover image for the library, as a JPEG blob. */
export async function renderThumbnail(page: PDFPageProxy, maxWidth = 360): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  const { task } = renderPage(page, canvas, maxWidth, 1)
  await task.promise
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.72))
}
