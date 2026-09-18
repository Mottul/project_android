import { describe, expect, it } from 'vitest'
import { EMPTY_FILTER, compareDocs, countByKind, folderTree, matchesSearch, normalise, selectDocs } from '@/store/query'
import type { DocEntry } from '@/store/library'

function doc(patch: Partial<DocEntry>): DocEntry {
  return {
    id: patch.id ?? Math.random().toString(36),
    sourceId: 'src1',
    name: 'datei.pdf',
    path: 'datei.pdf',
    folder: '',
    kind: 'pdf',
    size: 1000,
    modifiedAt: 0,
    addedAt: 0,
    openedAt: 0,
    ...patch,
  }
}

describe('normalise', () => {
  it('folds case, diacritics and the sharp s', () => {
    expect(normalise('Größe')).toBe('grosse')
    expect(normalise('MÜNCHEN')).toBe('munchen')
  })
})

describe('matchesSearch', () => {
  // `folder` is always the leading part of `path`, which is what the search
  // looks at — the fixture mirrors that rather than setting them apart.
  const entry = doc({
    name: 'Lebenslauf 2026.pdf',
    path: 'Bewerbung/Lebenslauf 2026.pdf',
    folder: 'Bewerbung',
    title: 'Lebenslauf',
    author: 'Müller',
  })

  it('matches without the umlaut', () => {
    expect(matchesSearch(entry, 'muller')).toBe(true)
  })

  it('requires every term, in any order', () => {
    expect(matchesSearch(entry, 'lebens 2026')).toBe(true)
    expect(matchesSearch(entry, '2026 lebens')).toBe(true)
    expect(matchesSearch(entry, 'lebens 2025')).toBe(false)
  })

  it('searches the folder as well as the name', () => {
    expect(matchesSearch(entry, 'bewerbung')).toBe(true)
  })

  it('matches everything when nothing was typed', () => {
    expect(matchesSearch(entry, '   ')).toBe(true)
  })
})

describe('selectDocs', () => {
  const docs = [
    doc({ id: 'a', name: 'a.pdf', kind: 'pdf', openedAt: 300, markCount: 2, progress: 0.5 }),
    doc({ id: 'b', name: 'b.epub', kind: 'epub', openedAt: 100 }),
    doc({ id: 'c', name: 'c.pdf', kind: 'pdf', openedAt: 0, progress: 1 }),
  ]

  it('filters by kind', () => {
    const result = selectDocs(docs, { ...EMPTY_FILTER, kinds: ['epub'] }, 'name')
    expect(result.map((entry) => entry.id)).toEqual(['b'])
  })

  it('finds documents that carry notes', () => {
    const result = selectDocs(docs, { ...EMPTY_FILTER, onlyAnnotated: true }, 'name')
    expect(result.map((entry) => entry.id)).toEqual(['a'])
  })

  it('finds documents that were started but not finished', () => {
    const result = selectDocs(docs, { ...EMPTY_FILTER, onlyUnfinished: true }, 'name')
    expect(result.map((entry) => entry.id)).toEqual(['a'])
  })

  it('sorts by the most recently read, unopened last', () => {
    const result = selectDocs(docs, EMPTY_FILTER, 'recent')
    expect(result.map((entry) => entry.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('compareDocs', () => {
  it('sorts names the way a file manager does', () => {
    const a = doc({ name: 'Kapitel 2.pdf' })
    const b = doc({ name: 'Kapitel 10.pdf' })
    expect(compareDocs(a, b, 'name')).toBeLessThan(0)
  })

  it('puts the biggest file first when sorting by size', () => {
    expect(compareDocs(doc({ size: 10 }), doc({ size: 20 }), 'size')).toBeGreaterThan(0)
  })
})

describe('grouping', () => {
  it('counts documents per kind', () => {
    expect(countByKind([doc({ kind: 'pdf' }), doc({ kind: 'pdf' }), doc({ kind: 'epub' })])).toEqual({
      pdf: 2,
      epub: 1,
    })
  })

  it('lists the folders that actually contain something', () => {
    const tree = folderTree([doc({ folder: 'B' }), doc({ folder: 'A' }), doc({ folder: 'A' })])
    expect(tree).toEqual([
      { path: 'A', count: 2 },
      { path: 'B', count: 1 },
    ])
  })
})
