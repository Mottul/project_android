import { describe, expect, it } from 'vitest'
import { compareMarks, invertStep, markSummary, newMark, type Mark } from '@/store/marks'

function mark(patch: Partial<Mark>): Mark {
  return { ...newMark('doc1', 'highlight'), ...patch }
}

describe('newMark', () => {
  it('gives highlights a highlighter colour and everything else an ink colour', () => {
    expect(newMark('d', 'highlight').color).toBe('#ffd60a')
    expect(newMark('d', 'ink').color).toBe('#e11d48')
  })

  it('creates distinct ids', () => {
    expect(newMark('d', 'note').id).not.toBe(newMark('d', 'note').id)
  })
})

describe('compareMarks', () => {
  it('orders by page first', () => {
    expect(compareMarks(mark({ page: 1 }), mark({ page: 4 }))).toBeLessThan(0)
  })

  it('then from the top of the page downwards', () => {
    const top = mark({ page: 2, rects: [{ x: 0, y: 0.1, w: 1, h: 0.02 }] })
    const bottom = mark({ page: 2, rects: [{ x: 0, y: 0.8, w: 1, h: 0.02 }] })
    expect(compareMarks(top, bottom)).toBeLessThan(0)
  })

  it('falls back to age for two marks on the same line', () => {
    const first = mark({ page: 1, createdAt: 100, rects: [{ x: 0, y: 0.5, w: 1, h: 0.02 }] })
    const second = mark({ page: 1, createdAt: 200, rects: [{ x: 0.5, y: 0.5, w: 1, h: 0.02 }] })
    expect(compareMarks(first, second)).toBeLessThan(0)
  })
})

describe('markSummary', () => {
  it('prefers the quoted text', () => {
    expect(markSummary(mark({ quote: 'ein Satz', comment: 'ein Kommentar' }))).toBe('ein Satz')
  })

  it('describes a stroke count for ink', () => {
    const single = mark({ type: 'ink', paths: [{ points: [0, 0, 1, 1], width: 0.003 }] })
    expect(markSummary(single)).toBe('1 Strich')
  })

  it('says a replacement was a deletion when nothing was put in its place', () => {
    expect(markSummary(mark({ type: 'replace', text: '' }))).toBe('(gelöscht)')
  })
})

describe('invertStep', () => {
  const created = mark({ id: 'm1' })

  it('undoes a creation by deleting, and redoes it by writing it back', () => {
    expect(invertStep({ kind: 'create', mark: created }, 'undo')).toEqual({
      action: 'delete',
      id: 'm1',
    })
    expect(invertStep({ kind: 'create', mark: created }, 'redo')).toEqual({
      action: 'put',
      mark: created,
    })
  })

  it('undoes a deletion by restoring it', () => {
    expect(invertStep({ kind: 'delete', mark: created }, 'undo')).toEqual({
      action: 'put',
      mark: created,
    })
  })

  it('swaps the two versions of an edit', () => {
    const before = mark({ id: 'm2', comment: 'alt' })
    const after = mark({ id: 'm2', comment: 'neu' })

    expect(invertStep({ kind: 'update', before, after }, 'undo')).toEqual({
      action: 'put',
      mark: before,
    })
    expect(invertStep({ kind: 'update', before, after }, 'redo')).toEqual({
      action: 'put',
      mark: after,
    })
  })
})
