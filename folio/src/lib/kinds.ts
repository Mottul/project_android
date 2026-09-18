/**
 * What kind of document a file is, decided from its name.
 *
 * Name first, MIME type second: the library is built by walking directories,
 * where `File.type` is often empty (Android's document providers rarely fill it
 * in) and sometimes wrong, while the extension is always there.
 */

export type DocKind = 'pdf' | 'epub' | 'image' | 'text' | 'other'

/** Extensions per kind. `other` is everything that is listed but not opened. */
const EXTENSIONS: Record<Exclude<DocKind, 'other'>, readonly string[]> = {
  pdf: ['pdf'],
  epub: ['epub'],
  image: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'svg'],
  text: ['txt', 'md', 'markdown', 'log', 'csv', 'json', 'rtf'],
}

/**
 * Formats that show up in a documents folder and belong in the library even
 * though Folio cannot render them. They are listed, searchable and can be
 * handed to another app; opening one explains why it stays closed.
 */
const FOREIGN_DOCUMENT_EXTENSIONS = [
  'doc', 'docx', 'odt', 'rtf', 'pages',
  'xls', 'xlsx', 'ods', 'numbers',
  'ppt', 'pptx', 'odp', 'key',
  'mobi', 'azw', 'azw3', 'fb2', 'djvu', 'cbz', 'cbr', 'xps',
]

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return ''
  return name.slice(dot + 1).toLowerCase()
}

/** Strips the extension — used as the fallback title of a document. */
export function baseName(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

export function kindOf(name: string, mime = ''): DocKind {
  const ext = extensionOf(name)

  for (const [kind, list] of Object.entries(EXTENSIONS)) {
    if (list.includes(ext)) return kind as DocKind
  }

  // No usable extension: fall back to the MIME type, if there is one.
  if (mime) {
    if (mime === 'application/pdf') return 'pdf'
    if (mime === 'application/epub+zip') return 'epub'
    if (mime.startsWith('image/')) return 'image'
    if (mime.startsWith('text/')) return 'text'
  }

  return 'other'
}

/** True for files worth putting into the library at all. */
export function isDocument(name: string, mime = ''): boolean {
  const kind = kindOf(name, mime)
  if (kind !== 'other') return true
  return FOREIGN_DOCUMENT_EXTENSIONS.includes(extensionOf(name))
}

/** Can Folio display it? `other` documents are listed but not opened. */
export function isOpenable(kind: DocKind): boolean {
  return kind !== 'other'
}

/** Only PDFs carry annotations that survive an export as real PDF markup. */
export function supportsAnnotations(kind: DocKind): boolean {
  return kind === 'pdf' || kind === 'image'
}

export const KIND_LABEL: Record<DocKind, string> = {
  pdf: 'PDF',
  epub: 'EPUB',
  image: 'Bild',
  text: 'Text',
  other: 'Datei',
}

/** Accept list for the file picker, kept in sync with the kinds above. */
export const FILE_ACCEPT = [
  '.pdf', '.epub',
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif', '.svg',
  '.txt', '.md', '.markdown', '.log', '.csv', '.json', '.rtf',
  ...FOREIGN_DOCUMENT_EXTENSIONS.map((e) => `.${e}`),
].join(',')
