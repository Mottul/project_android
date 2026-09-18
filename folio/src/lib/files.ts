/**
 * Getting files into Folio.
 *
 * There are three ways in, and which of them exist depends entirely on the
 * browser:
 *
 * 1. **A folder, re-openable.** `showDirectoryPicker()` hands back a handle
 *    that can be stored in IndexedDB and used again weeks later. That is the
 *    good case: the library keeps working after a restart, files are read in
 *    place, and edits can be written back over the original. Chromium on the
 *    desktop only.
 * 2. **A folder, once.** `<input type="file" webkitdirectory>` reports the
 *    whole subtree but only as `File` objects, which die with the page. Folio
 *    copies what it finds into IndexedDB so the library survives anyway —
 *    writing back is then impossible and export takes over.
 * 3. **Single files**, through `showOpenFilePicker()` (re-openable) or a plain
 *    `<input type="file">` (copied, like case 2).
 *
 * "Den gesamten Speicher durchsuchen" is case 1 or 2 pointed at the root of a
 * volume. No browser grants access to storage that the user did not hand over
 * explicitly, so a folder picker is as close as a web app gets — and it is the
 * whole reason the scan is recursive.
 */

import { isDocument, kindOf, type DocKind } from './kinds'

/** Directory names that never contain documents worth indexing. */
const SKIP_DIRECTORIES = new Set([
  'node_modules', '.git', '.svn', '.hg', '.cache', '.trash', '.thumbnails',
  '$recycle.bin', 'system volume information', '.gradle', '.idea', 'venv',
  '__pycache__', 'proc', 'sys', 'dev',
])

/** Guards against pathological trees; documents are never nested this deep. */
const MAX_DEPTH = 12

export interface ScannedFile {
  /** Path relative to the picked folder, including the file name. */
  path: string
  name: string
  kind: DocKind
  size: number
  modifiedAt: number
  /** Present in case 1 — lets Folio re-read and overwrite the original. */
  handle?: FileSystemFileHandle
  /** Present in cases 2 and 3 — the contents have to be copied. */
  file?: File
}

export interface ScanProgress {
  /** Files matching a document type so far. */
  found: number
  /** Directory currently being walked, for the progress line. */
  where: string
}

export function supportsDirectoryHandles(): boolean {
  return typeof window.showDirectoryPicker === 'function'
}

export function supportsFileHandles(): boolean {
  return typeof window.showOpenFilePicker === 'function'
}

/** Folder input is the fallback path and exists nearly everywhere except iOS. */
export function supportsFolderInput(): boolean {
  const input = document.createElement('input')
  return 'webkitdirectory' in input
}

/* ===========================================================================
   Picking
   ======================================================================== */

/** Opens the folder picker. Returns null when the user cancelled. */
export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!window.showDirectoryPicker) return null
  try {
    return await window.showDirectoryPicker({ mode: 'readwrite', id: 'folio-library' })
  } catch (error) {
    if (isAbort(error)) return null
    // Asking for readwrite can be refused outright on some platforms; read-only
    // still gives a usable library, just without writing back.
    try {
      return await window.showDirectoryPicker({ mode: 'read', id: 'folio-library' })
    } catch (retryError) {
      if (isAbort(retryError)) return null
      throw retryError
    }
  }
}

export async function pickFiles(accept: string): Promise<ScannedFile[]> {
  if (window.showOpenFilePicker) {
    try {
      const handles = await window.showOpenFilePicker({
        multiple: true,
        types: [
          {
            description: 'Dokumente',
            accept: {
              'application/pdf': ['.pdf'],
              'application/epub+zip': ['.epub'],
              'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif'],
              'text/*': ['.txt', '.md', '.markdown', '.csv', '.json', '.log'],
            },
          },
        ],
      })
      const scanned: ScannedFile[] = []
      for (const handle of handles) {
        const file = await handle.getFile()
        scanned.push(describe(file.name, file, handle))
      }
      return scanned
    } catch (error) {
      if (isAbort(error)) return []
      // Fall through to the input element — some embedded webviews expose the
      // picker but reject every call.
    }
  }

  const files = await promptForFiles({ accept })
  return files.map((file) => describe(file.name, file))
}

/** The fallback folder scan: one picker, the whole subtree, no handles. */
export async function pickFolderContents(): Promise<ScannedFile[]> {
  const files = await promptForFiles({ directory: true })
  return files
    .filter((file) => isDocument(file.name, file.type))
    .map((file) => describe(file.webkitRelativePath || file.name, file))
}

function promptForFiles(options: { accept?: string; directory?: boolean }): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    if (options.accept) input.accept = options.accept
    if (options.directory) input.webkitdirectory = true
    input.style.position = 'fixed'
    input.style.left = '-9999px'

    // `change` never fires when the dialog is dismissed. `cancel` covers modern
    // browsers; the focus fallback covers the rest, so the caller is never left
    // waiting on a promise that will not settle.
    let settled = false
    const finish = (files: File[]) => {
      if (settled) return
      settled = true
      input.remove()
      resolve(files)
    }

    input.addEventListener('change', () => finish(Array.from(input.files ?? [])))
    input.addEventListener('cancel', () => finish([]))
    window.addEventListener(
      'focus',
      () => setTimeout(() => finish(Array.from(input.files ?? [])), 700),
      { once: true },
    )

    document.body.appendChild(input)
    input.click()
  })
}

function describe(path: string, file: File, handle?: FileSystemFileHandle): ScannedFile {
  const name = path.split('/').pop() || path
  return {
    path,
    name,
    kind: kindOf(name, file.type),
    size: file.size,
    modifiedAt: file.lastModified,
    handle,
    file,
  }
}

/* ===========================================================================
   Scanning a directory handle
   ======================================================================== */

/**
 * Walks a directory handle depth first and reports every document it finds.
 *
 * Deliberately does not read file contents — only `getFile()` for the metadata,
 * which is cheap. A folder with ten thousand files would otherwise pull
 * gigabytes through memory before the library shows a single entry.
 */
export async function scanDirectory(
  root: FileSystemDirectoryHandle,
  onProgress?: (progress: ScanProgress) => void,
  signal?: AbortSignal,
): Promise<ScannedFile[]> {
  const found: ScannedFile[] = []

  async function walk(directory: FileSystemDirectoryHandle, prefix: string, depth: number) {
    if (signal?.aborted || depth > MAX_DEPTH) return
    onProgress?.({ found: found.length, where: prefix || directory.name })

    for await (const entry of directory.values()) {
      if (signal?.aborted) return

      if (entry.kind === 'directory') {
        const lower = entry.name.toLowerCase()
        if (lower.startsWith('.') || SKIP_DIRECTORIES.has(lower)) continue
        try {
          await walk(entry as FileSystemDirectoryHandle, `${prefix}${entry.name}/`, depth + 1)
        } catch {
          // A single unreadable subdirectory must not end the whole scan.
        }
        continue
      }

      if (!isDocument(entry.name)) continue
      try {
        const handle = entry as FileSystemFileHandle
        const file = await handle.getFile()
        found.push({
          path: `${prefix}${entry.name}`,
          name: entry.name,
          kind: kindOf(entry.name, file.type),
          size: file.size,
          modifiedAt: file.lastModified,
          handle,
        })
      } catch {
        // Locked or vanished between listing and reading — skip it.
      }
    }
  }

  await walk(root, '', 0)
  onProgress?.({ found: found.length, where: '' })
  return found
}

/* ===========================================================================
   Permissions, reading, writing
   ======================================================================== */

/**
 * Handles restored from IndexedDB start out without permission; the browser
 * grants it back only after a user gesture. Callers must therefore run this
 * from inside a click handler, never from page load.
 */
export async function ensurePermission(
  handle: FileSystemHandle,
  mode: 'read' | 'readwrite' = 'read',
): Promise<boolean> {
  if (!handle.queryPermission) return true // Not a real handle — nothing to grant.
  try {
    if ((await handle.queryPermission({ mode })) === 'granted') return true
    return (await handle.requestPermission?.({ mode })) === 'granted'
  } catch {
    return false
  }
}

export async function hasPermission(
  handle: FileSystemHandle,
  mode: 'read' | 'readwrite' = 'read',
): Promise<boolean> {
  if (!handle.queryPermission) return true
  try {
    return (await handle.queryPermission({ mode })) === 'granted'
  } catch {
    return false
  }
}

export async function readHandle(handle: FileSystemFileHandle): Promise<File> {
  return handle.getFile()
}

/** Overwrites the original file. Only possible for case 1 handles. */
export async function writeHandle(handle: FileSystemFileHandle, data: Blob): Promise<void> {
  const writable = await handle.createWritable()
  try {
    await writable.write(data)
  } finally {
    await writable.close()
  }
}

/**
 * "Speichern unter" through the save picker where it exists. Returns the handle
 * so the caller can keep saving to it, or null when the browser has no picker
 * (the caller then falls back to a download).
 */
export async function saveAs(
  data: Blob,
  suggestedName: string,
  mimeType: string,
  extension: string,
): Promise<FileSystemFileHandle | null> {
  if (!window.showSaveFilePicker) return null
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName,
      types: [{ description: suggestedName, accept: { [mimeType]: [extension] } }],
    })
    await writeHandle(handle, data)
    return handle
  } catch (error) {
    if (isAbort(error)) return null
    throw error
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** Everything above the file name, used to group the library by folder. */
export function folderOf(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut === -1 ? '' : path.slice(0, cut)
}
