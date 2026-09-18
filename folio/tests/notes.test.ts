import { describe, expect, it } from 'vitest'
import { notesToJson, notesToMarkdown, parseNotesJson } from '@/export/notes'
import { newMark, type Mark } from '@/store/marks'

const context = { title: 'Jahresbericht', fileName: 'bericht.pdf' }

function mark(patch: Partial<Mark>): Mark {
  return { ...newMark('doc1', 'highlight'), ...patch }
}

describe('notesToMarkdown', () => {
  const marks = [
    mark({ page: 0, quote: 'Der Umsatz stieg um 12 %.', comment: 'Zahl prüfen' }),
    mark({ page: 2, type: 'note', comment: 'Fehlt hier eine Quelle?' }),
    mark({ page: 2, type: 'replace', original: 'Dezember 2024', text: 'Dezember 2025' }),
  ]

  const markdown = notesToMarkdown(marks, context, new Date('2026-09-18T10:00:00Z'))

  it('starts with the document and a count', () => {
    expect(markdown).toContain('# Jahresbericht')
    expect(markdown).toContain('3 Einträge')
    expect(markdown).toContain('bericht.pdf')
  })

  it('groups by page, in reading order', () => {
    expect(markdown.indexOf('## Seite 1')).toBeLessThan(markdown.indexOf('## Seite 3'))
    // One heading per page, not one per mark.
    expect(markdown.match(/## Seite 3/g)).toHaveLength(1)
  })

  it('quotes the marked text and keeps the comment underneath', () => {
    expect(markdown).toContain('> Der Umsatz stieg um 12 %.')
    expect(markdown).toContain('Zahl prüfen')
  })

  it('shows a text change as before and after', () => {
    expect(markdown).toContain('„Dezember 2024“ → „Dezember 2025“')
  })

  it('says so when there is nothing to export', () => {
    expect(notesToMarkdown([], context)).toContain('Keine Notizen')
  })
})

describe('JSON round trip', () => {
  it('reads back what it wrote', () => {
    const original = [mark({ page: 1, quote: 'ein Satz', comment: 'ein Kommentar' })]
    const parsed = parseNotesJson(notesToJson(original, context))

    expect(parsed.title).toBe('Jahresbericht')
    expect(parsed.marks).toHaveLength(1)
    expect(parsed.marks[0].quote).toBe('ein Satz')
  })

  it('leaves the document id out — the marks are re-attached on import', () => {
    const json = JSON.parse(notesToJson([mark({ page: 0 })], context))
    expect(json.marks[0]).not.toHaveProperty('docId')
  })

  it('refuses a file that is not JSON', () => {
    expect(() => parseNotesJson('{kaputt')).toThrow(/JSON/)
  })

  it('refuses a JSON file that is not a Folio export', () => {
    expect(() => parseNotesJson('{"format":"etwas-anderes"}')).toThrow(/Folio-Notizen/)
  })

  it('drops entries that could never be placed in a document', () => {
    const json = JSON.stringify({
      format: 'folio-marks',
      version: 1,
      marks: [
        { id: 'a', type: 'highlight', page: 0 },
        { id: 'b', type: 'highlight' }, // nowhere to put it
        { id: 'c', type: 'kein-typ', page: 1 }, // not a mark Folio knows
        'gar kein Objekt',
      ],
    })
    expect(parseNotesJson(json).marks.map((entry) => entry.id)).toEqual(['a'])
  })

  it('refuses a file whose marks are all unusable', () => {
    const json = JSON.stringify({ format: 'folio-marks', version: 1, marks: [{ id: 'x' }] })
    expect(() => parseNotesJson(json)).toThrow(/lesbaren/)
  })
})
