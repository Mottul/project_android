/**
 * Getting documents into the library, and filling in what is known about them.
 *
 * Two phases, deliberately separate. Adding is fast: name, size, date, path —
 * everything a listing needs, straight from the directory walk. Enriching is
 * slow: it opens each document to read its title and draw a cover, which for a
 * folder of five hundred PDFs is minutes of work.
 *
 * Doing them together would mean staring at a spinner before seeing anything.
 * Doing them separately means the library appears immediately and fills in.
 */

import {
  addScanned,
  createSource,
  getThumb,
  importSource,
  listDocs,
  loadDocFile,
  markMissing,
  putThumb,
  updateDoc,
  type AddResult,
  type DocEntry,
  type LibrarySource,
} from '@/store/library'
import {
  ensurePermission,
  pickDirectory,
  pickFiles,
  pickFolderContents,
  scanDirectory,
  supportsDirectoryHandles,
  type ScannedFile,
} from '@/lib/files'
import { FILE_ACCEPT } from '@/lib/kinds'
import { listSources } from '@/store/library'
import { hasPermission } from '@/lib/files'
import { closePdf, openPdf, readMeta, renderThumbnail } from '@/pdf/loader'
import { readEpub } from '@/epub/parse'
import { mimeOf } from '@/epub/render'
import { progressToast, toast } from './feedback'

/* ===========================================================================
   Adding
   ======================================================================== */

/** Files chosen through a picker, or handed over by the operating system. */
export async function importFiles(files: ScannedFile[]): Promise<AddResult> {
  if (!files.length) return { added: 0, updated: 0, entries: [] }
  const source = await importSource()
  // Contents are copied for anything without a handle: the `File` objects a
  // plain input produces do not survive a reload.
  return addScanned(source, files, true)
}

export async function pickAndImportFiles(): Promise<AddResult> {
  const files = await pickFiles(FILE_ACCEPT)
  return importFiles(files)
}

export interface FolderResult {
  source: LibrarySource | null
  added: number
  updated: number
  entries: DocEntry[]
  /** True when the browser could only offer the one-off variant. */
  copied: boolean
}

/**
 * Adds a folder.
 *
 * The good path uses a directory handle, which can be stored and re-opened;
 * that is what makes "Ordner erneut durchsuchen" and writing back to the
 * original file possible. Where the browser has no such picker, the folder
 * input is used instead and the files are copied into Folio — the library still
 * works, it just cannot follow changes on disk.
 */
export async function addFolder(): Promise<FolderResult> {
  if (supportsDirectoryHandles()) {
    const handle = await pickDirectory()
    if (!handle) return { source: null, added: 0, updated: 0, entries: [], copied: false }

    const progress = progressToast(`„${handle.name}“ wird durchsucht`)
    try {
      const source = await createSource('folder', handle.name, handle)
      const files = await scanDirectory(handle, ({ found, where }) => {
        progress.update(0.5, `${found} Dokumente — ${where || handle.name}`)
      })

      const result = await addScanned(source, files, false)
      progress.done()
      return { source, ...result, copied: false }
    } catch (error) {
      progress.done()
      throw error
    }
  }

  const files = await pickFolderContents()
  if (!files.length) return { source: null, added: 0, updated: 0, entries: [], copied: true }

  // The picked folder's name is the first segment of every reported path.
  const name = files[0].path.split('/')[0] || 'Ordner'
  const source = await createSource('import', name)
  const result = await addScanned(source, files, true)
  return { source, ...result, copied: true }
}

/** Walks a stored folder handle again and updates what changed on disk. */
export async function rescanFolder(source: LibrarySource): Promise<AddResult & { gone: number }> {
  if (!source.handle) throw new Error('Diese Quelle lässt sich nicht erneut durchsuchen.')
  if (!(await ensurePermission(source.handle, 'read'))) {
    throw new Error('Der Zugriff auf den Ordner wurde nicht erlaubt.')
  }

  const progress = progressToast(`„${source.name}“ wird durchsucht`)
  try {
    const files = await scanDirectory(source.handle, ({ found, where }) => {
      progress.update(0.5, `${found} Dokumente — ${where || source.name}`)
    })
    const result = await addScanned(source, files, false)
    const gone = await markMissing(source.id, new Set(result.entries.map((entry) => entry.id)))
    progress.done()
    return { ...result, gone }
  } catch (error) {
    progress.done()
    throw error
  }
}

/* ===========================================================================
   Enrichment
   ======================================================================== */

/**
 * Reads titles and draws covers for entries that do not have them yet.
 *
 * Runs one document at a time. Parallelism would help on paper, but each PDF
 * opens a worker task and allocates a page-sized canvas, and a dozen at once on
 * a phone is how a tab gets killed. One at a time, cancellable, is the right
 * shape for something that runs in the background while the library is already
 * usable.
 */
export class Enricher {
  private queue: DocEntry[] = []
  private running = false
  private stopped = false

  constructor(private readonly onUpdated: (entry: DocEntry) => void) {}

  /** Queues everything that is still missing a cover or a page count. */
  async enqueuePending(): Promise<void> {
    const docs = await listDocs()
    const pending: DocEntry[] = []

    // Folders whose permission lapsed over a restart are skipped whole. Asking
    // is a user's decision, not a background task's, and trying anyway would
    // produce one failure per document in the console.
    const readable = new Set<string>()
    for (const source of await listSources()) {
      if (!source.handle || (await hasPermission(source.handle, 'read'))) readable.add(source.id)
    }

    for (const doc of docs) {
      if (doc.missing) continue
      if (!readable.has(doc.sourceId)) continue
      if (doc.kind !== 'pdf' && doc.kind !== 'epub' && doc.kind !== 'image') continue
      if (doc.title && (doc.pages || doc.kind !== 'pdf') && (await getThumb(doc.id))) continue
      pending.push(doc)
    }

    // Most recently added first: those are the ones being looked at right now.
    pending.sort((a, b) => b.addedAt - a.addedAt)
    this.queue = pending
    void this.run()
  }

  stop(): void {
    this.stopped = true
    this.queue = []
  }

  private async run(): Promise<void> {
    if (this.running) return
    this.running = true

    while (this.queue.length && !this.stopped) {
      const entry = this.queue.shift() as DocEntry
      try {
        const updated = await enrich(entry)
        if (updated) this.onUpdated(updated)
      } catch (error) {
        // A document that will not open must not interrupt a background pass —
        // it shows up as a plain card and explains itself when someone opens
        // it. It is still logged: a whole folder that produces no covers is a
        // bug, and silence is the one thing that would hide it.
        console.warn(`[Folio] „${entry.name}“ konnte nicht gelesen werden:`, error)
      }
      // Yields to the event loop so scrolling the library stays smooth.
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    this.running = false
  }
}

async function enrich(entry: DocEntry): Promise<DocEntry | null> {
  const file = await loadDocFile(entry)

  if (entry.kind === 'pdf') return enrichPdf(entry, file)
  if (entry.kind === 'epub') return enrichEpub(entry, file)
  if (entry.kind === 'image') return enrichImage(entry, file)
  return null
}

async function enrichPdf(entry: DocEntry, file: File): Promise<DocEntry | null> {
  const doc = await openPdf(await file.arrayBuffer())
  try {
    const meta = await readMeta(doc)
    const page = await doc.getPage(1)
    const thumb = await renderThumbnail(page)
    if (thumb) await putThumb(entry.id, thumb)
    page.cleanup()

    return updateDoc(entry.id, {
      title: meta.title ?? entry.title,
      author: meta.author,
      pages: meta.pages,
    })
  } finally {
    await closePdf(doc)
  }
}

async function enrichEpub(entry: DocEntry, file: File): Promise<DocEntry | null> {
  const book = await readEpub(await file.arrayBuffer())

  if (book.coverPath) {
    const data = book.files.get(book.coverPath)
    if (data) {
      await putThumb(entry.id, new Blob([data as BlobPart], { type: mimeOf(book.coverPath) }))
    }
  }

  return updateDoc(entry.id, {
    title: book.title,
    author: book.author,
    pages: book.spine.length,
  })
}

async function enrichImage(entry: DocEntry, file: File): Promise<DocEntry | null> {
  // Images are their own cover; only oversized ones are worth scaling down.
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 360 / Math.max(bitmap.width, bitmap.height))

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')
  context?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.75),
  )
  canvas.width = 0
  canvas.height = 0
  if (blob) await putThumb(entry.id, blob)

  return updateDoc(entry.id, { pages: 1 })
}

/** Shared wording for the two failure modes a stored handle has. */
export function explainAccessError(error: unknown): void {
  const name = (error as { name?: string }).name
  if (name === 'PermissionError') {
    toast('Der Zugriff auf die Datei muss erneut erlaubt werden. Ordner in der Bibliothek antippen.', {
      kind: 'warn',
    })
    return
  }
  if (name === 'MissingFileError') {
    toast('Die Datei ist nicht mehr am ursprünglichen Ort.', { kind: 'warn' })
    return
  }
  toast((error as Error).message || 'Die Datei konnte nicht geöffnet werden.', { kind: 'error' })
}
