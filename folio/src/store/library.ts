/**
 * The library: what Folio knows about the documents it has been shown.
 *
 * Two object stores carry it. `sources` remembers where documents came from —
 * a folder handle, a one-off import — so a folder can be re-scanned later.
 * `docs` holds one entry per document: enough metadata to search, sort and
 * display it without ever touching the file, plus whatever is needed to open
 * the file again (a handle, or a key into the `blobs` store).
 *
 * Contents are only copied into IndexedDB when there is no other way back to
 * the file. A picked folder stays on disk.
 */

import {
  STORE,
  idbDelete,
  idbDeleteMany,
  idbGet,
  idbGetAll,
  idbPut,
  idbPutMany,
} from '@/lib/idb'
import { fingerprint, uid } from '@/lib/id'
import { baseName, type DocKind } from '@/lib/kinds'
import { folderOf, hasPermission, readHandle, type ScannedFile } from '@/lib/files'

export interface LibrarySource {
  id: string
  /** `folder` keeps a re-openable handle; `import` copied its files. */
  kind: 'folder' | 'import'
  name: string
  handle?: FileSystemDirectoryHandle
  addedAt: number
  scannedAt: number
  docCount: number
}

export interface DocEntry {
  id: string
  sourceId: string
  /** File name including extension. */
  name: string
  /** Path relative to the source root, including the name. */
  path: string
  folder: string
  kind: DocKind
  size: number
  modifiedAt: number
  addedAt: number
  /** 0 until the document has been opened once. */
  openedAt: number

  /** From the document's own metadata, when it has any. */
  title?: string
  author?: string
  pages?: number

  /** How far through the document the reader got, 0..1. */
  progress?: number
  /** Where exactly: a page number for PDFs, a spine href for EPUB. */
  location?: string
  /** Kept in sync by the annotation store so the library can show a badge. */
  markCount?: number

  /** Present when the file can be re-read — and possibly overwritten — in place. */
  handle?: FileSystemFileHandle
  /** True when the contents live in the `blobs` store instead. */
  copied?: boolean
  /** Set when a re-scan could not find the file any more. */
  missing?: boolean
}

/* ===========================================================================
   Reading
   ======================================================================== */

export function listDocs(): Promise<DocEntry[]> {
  return idbGetAll<DocEntry>(STORE.docs)
}

export function listSources(): Promise<LibrarySource[]> {
  return idbGetAll<LibrarySource>(STORE.sources)
}

export function getDoc(id: string): Promise<DocEntry | undefined> {
  return idbGet<DocEntry>(STORE.docs, id)
}

export function putDoc(entry: DocEntry): Promise<void> {
  return idbPut(STORE.docs, entry)
}

export async function updateDoc(id: string, patch: Partial<DocEntry>): Promise<DocEntry | null> {
  const entry = await getDoc(id)
  if (!entry) return null
  const updated = { ...entry, ...patch }
  await putDoc(updated)
  return updated
}

/* ===========================================================================
   Opening
   ======================================================================== */

export class MissingFileError extends Error {
  constructor(public readonly entry: DocEntry) {
    super(`„${entry.name}“ ist nicht mehr erreichbar.`)
    this.name = 'MissingFileError'
  }
}

export class PermissionError extends Error {
  constructor(public readonly entry: DocEntry) {
    super(`Der Zugriff auf „${entry.name}“ wurde nicht erlaubt.`)
    this.name = 'PermissionError'
  }
}

/**
 * Hands back the file behind a library entry.
 *
 * The handle path can fail in two ways that are worth telling apart: the file
 * is gone (the entry is marked and stays in the library, greyed out), or the
 * permission has lapsed and has to be re-granted by a click.
 */
export async function loadDocFile(entry: DocEntry): Promise<File> {
  if (entry.handle) {
    if (!(await hasPermission(entry.handle, 'read'))) throw new PermissionError(entry)
    try {
      return await readHandle(entry.handle)
    } catch {
      await updateDoc(entry.id, { missing: true })
      throw new MissingFileError(entry)
    }
  }

  const blob = await idbGet<Blob>(STORE.blobs, entry.id)
  if (!blob) {
    await updateDoc(entry.id, { missing: true })
    throw new MissingFileError(entry)
  }
  return new File([blob], entry.name, { type: blob.type, lastModified: entry.modifiedAt })
}

/** True when saving can overwrite the original instead of exporting a copy. */
export async function canWriteInPlace(entry: DocEntry): Promise<boolean> {
  if (!entry.handle) return false
  return hasPermission(entry.handle, 'readwrite')
}

/* ===========================================================================
   Adding
   ======================================================================== */

/**
 * The id of a document. Derived from where the file is rather than from a
 * random value, so that re-scanning a folder updates entries instead of
 * duplicating them — and so annotations stay attached to the right file.
 */
export function docId(sourceId: string, path: string): string {
  return `doc_${fingerprint(sourceId, path)}`
}

export interface AddResult {
  added: number
  updated: number
  entries: DocEntry[]
}

/**
 * Writes scanned files into the library.
 *
 * `copyContents` decides whether the bytes are stored: true for imports whose
 * `File` objects die with the page, false for folder handles that can be read
 * again at any time.
 */
export async function addScanned(
  source: LibrarySource,
  files: ScannedFile[],
  copyContents: boolean,
): Promise<AddResult> {
  const existing = new Map((await listDocs()).map((doc) => [doc.id, doc]))
  const now = Date.now()

  const entries: DocEntry[] = []
  const blobs: { key: string; blob: Blob }[] = []
  let added = 0
  let updated = 0

  for (const file of files) {
    const id = docId(source.id, file.path)
    const previous = existing.get(id)

    const entry: DocEntry = {
      ...(previous ?? {}),
      id,
      sourceId: source.id,
      name: file.name,
      path: file.path,
      folder: folderOf(file.path),
      kind: file.kind,
      size: file.size,
      modifiedAt: file.modifiedAt,
      addedAt: previous?.addedAt ?? now,
      openedAt: previous?.openedAt ?? 0,
      missing: false,
    }

    if (file.handle) {
      entry.handle = file.handle
      entry.copied = false
    } else if (copyContents && file.file) {
      entry.copied = true
      blobs.push({ key: id, blob: file.file })
    }

    // A file that changed on disk invalidates the cached page count and cover.
    if (previous && previous.modifiedAt !== file.modifiedAt) {
      delete entry.pages
      await idbDelete(STORE.thumbs, id).catch(() => undefined)
    }

    entries.push(entry)
    previous ? (updated += 1) : (added += 1)
  }

  await idbPutMany(STORE.docs, entries)
  for (const { key, blob } of blobs) await idbPut(STORE.blobs, blob, key)

  source.docCount = (await listDocs()).filter((doc) => doc.sourceId === source.id).length
  source.scannedAt = now
  await idbPut(STORE.sources, source)

  return { added, updated, entries }
}

export async function createSource(
  kind: LibrarySource['kind'],
  name: string,
  handle?: FileSystemDirectoryHandle,
): Promise<LibrarySource> {
  const source: LibrarySource = {
    id: uid('src'),
    kind,
    name,
    handle,
    addedAt: Date.now(),
    scannedAt: 0,
    docCount: 0,
  }
  await idbPut(STORE.sources, source)
  return source
}

/**
 * The single source that collects everything imported through a file picker.
 * Keeping them together means one "Importierte Dateien" group in the library
 * instead of a new group per picker use.
 */
export async function importSource(): Promise<LibrarySource> {
  const sources = await listSources()
  const existing = sources.find((source) => source.kind === 'import')
  return existing ?? createSource('import', 'Importierte Dateien')
}

/**
 * Re-scanning replaces a folder's entries with what is on disk now. Documents
 * that disappeared are marked rather than deleted: their annotations are worth
 * more than a tidy list, and a folder can be temporarily unavailable.
 */
export async function markMissing(sourceId: string, seenIds: Set<string>): Promise<number> {
  const docs = await listDocs()
  const gone = docs.filter((doc) => doc.sourceId === sourceId && !seenIds.has(doc.id))
  if (gone.length) {
    await idbPutMany(
      STORE.docs,
      gone.map((doc) => ({ ...doc, missing: true })),
    )
  }
  return gone.length
}

/* ===========================================================================
   Removing
   ======================================================================== */

export async function removeDoc(id: string): Promise<void> {
  await idbDelete(STORE.docs, id)
  await idbDelete(STORE.blobs, id).catch(() => undefined)
  await idbDelete(STORE.thumbs, id).catch(() => undefined)
}

/** Removes a source and everything the library knows about its documents. */
export async function removeSource(sourceId: string): Promise<void> {
  const docs = (await listDocs()).filter((doc) => doc.sourceId === sourceId)
  await idbDeleteMany(STORE.docs, docs.map((doc) => doc.id))
  await idbDeleteMany(STORE.blobs, docs.map((doc) => doc.id)).catch(() => undefined)
  await idbDeleteMany(STORE.thumbs, docs.map((doc) => doc.id)).catch(() => undefined)
  await idbDelete(STORE.sources, sourceId)
}

/* ===========================================================================
   Covers
   ======================================================================== */

export function putThumb(docId: string, blob: Blob): Promise<void> {
  return idbPut(STORE.thumbs, blob, docId)
}

export function getThumb(docId: string): Promise<Blob | undefined> {
  return idbGet<Blob>(STORE.thumbs, docId)
}

/** Title shown in the library: document metadata first, file name second. */
export function displayTitle(entry: DocEntry): string {
  const title = entry.title?.trim()
  if (title && title.length > 1) return title
  return baseName(entry.name)
}
