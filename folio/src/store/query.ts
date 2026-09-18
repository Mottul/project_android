/**
 * Searching and sorting the library.
 *
 * Pure functions over an array of entries — no storage, no DOM. The library
 * view holds every entry in memory anyway (a few hundred bytes each), so
 * filtering locally is both simpler and faster than keeping IndexedDB indexes
 * for every combination the interface offers.
 */

import type { DocKind } from '@/lib/kinds'
import type { DocEntry } from './library'

export type SortKey = 'recent' | 'added' | 'name' | 'size' | 'pages'

export interface LibraryFilter {
  /** Free text over title, author, file name and folder. */
  search: string
  /** Empty means "every kind". */
  kinds: DocKind[]
  sourceId: string | null
  folder: string | null
  onlyAnnotated: boolean
  onlyUnfinished: boolean
}

export const EMPTY_FILTER: LibraryFilter = {
  search: '',
  kinds: [],
  sourceId: null,
  folder: null,
  onlyAnnotated: false,
  onlyUnfinished: false,
}

/**
 * Lower-cases and strips diacritics so that "Lebenslauf" is found by "lebens"
 * and "Größe" by "grosse". The ß needs its own rule — Unicode normalisation
 * leaves it alone.
 */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

/** Every term has to appear somewhere, in any order. */
export function matchesSearch(entry: DocEntry, search: string): boolean {
  const terms = normalise(search).split(/\s+/).filter(Boolean)
  if (!terms.length) return true

  const haystack = normalise(
    [entry.title ?? '', entry.author ?? '', entry.name, entry.path].join(' '),
  )
  return terms.every((term) => haystack.includes(term))
}

export function matchesFilter(entry: DocEntry, filter: LibraryFilter): boolean {
  if (filter.kinds.length && !filter.kinds.includes(entry.kind)) return false
  if (filter.sourceId && entry.sourceId !== filter.sourceId) return false
  if (filter.folder !== null && entry.folder !== filter.folder) return false
  if (filter.onlyAnnotated && !(entry.markCount ?? 0)) return false
  if (filter.onlyUnfinished) {
    const progress = entry.progress ?? 0
    if (progress <= 0 || progress >= 0.98) return false
  }
  return matchesSearch(entry, filter.search)
}

const COLLATOR = new Intl.Collator('de', { numeric: true, sensitivity: 'base' })

export function compareDocs(a: DocEntry, b: DocEntry, key: SortKey): number {
  switch (key) {
    case 'recent': {
      // Never opened sorts after everything that was, most recent first.
      const diff = (b.openedAt || 0) - (a.openedAt || 0)
      return diff !== 0 ? diff : COLLATOR.compare(a.name, b.name)
    }
    case 'added':
      return (b.addedAt || 0) - (a.addedAt || 0)
    case 'size':
      return (b.size || 0) - (a.size || 0)
    case 'pages':
      return (b.pages ?? 0) - (a.pages ?? 0) || COLLATOR.compare(a.name, b.name)
    case 'name':
    default:
      return COLLATOR.compare(a.title || a.name, b.title || b.name)
  }
}

export function selectDocs(
  docs: readonly DocEntry[],
  filter: LibraryFilter,
  sort: SortKey,
): DocEntry[] {
  return docs.filter((doc) => matchesFilter(doc, filter)).sort((a, b) => compareDocs(a, b, sort))
}

/** How many documents there are per kind, for the filter chips. */
export function countByKind(docs: readonly DocEntry[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const doc of docs) counts[doc.kind] = (counts[doc.kind] ?? 0) + 1
  return counts
}

/**
 * Folders that actually contain documents, with their counts, sorted the way a
 * file manager would sort them.
 */
export function folderTree(docs: readonly DocEntry[]): { path: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const doc of docs) counts.set(doc.folder, (counts.get(doc.folder) ?? 0) + 1)
  return [...counts.entries()]
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => COLLATOR.compare(a.path, b.path))
}
