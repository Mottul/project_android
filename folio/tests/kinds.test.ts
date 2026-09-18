import { describe, expect, it } from 'vitest'
import { FILE_ACCEPT, baseName, extensionOf, isDocument, kindOf } from '@/lib/kinds'

describe('kindOf', () => {
  it('recognises the formats Folio can open', () => {
    expect(kindOf('bericht.pdf')).toBe('pdf')
    expect(kindOf('Roman.EPUB')).toBe('epub')
    expect(kindOf('scan.JPG')).toBe('image')
    expect(kindOf('notizen.md')).toBe('text')
  })

  it('falls back to the MIME type when the name has no extension', () => {
    // Android document providers frequently hand over a name without one.
    expect(kindOf('document', 'application/pdf')).toBe('pdf')
    expect(kindOf('scan-0001', 'image/heic')).toBe('image')
    expect(kindOf('irgendwas')).toBe('other')
  })

  it('prefers the extension over a wrong MIME type', () => {
    expect(kindOf('bericht.pdf', 'application/octet-stream')).toBe('pdf')
  })
})

describe('isDocument', () => {
  it('accepts foreign document formats so they are at least listed', () => {
    expect(isDocument('vertrag.docx')).toBe(true)
    expect(isDocument('comic.cbz')).toBe(true)
  })

  it('rejects everything that is not a document', () => {
    expect(isDocument('film.mp4')).toBe(false)
    expect(isDocument('bibliothek.dll')).toBe(false)
    expect(isDocument('.DS_Store')).toBe(false)
  })
})

describe('names', () => {
  it('splits extensions', () => {
    expect(extensionOf('a.tar.gz')).toBe('gz')
    expect(extensionOf('ohne-endung')).toBe('')
    expect(extensionOf('.versteckt')).toBe('')
    expect(baseName('bericht.2024.pdf')).toBe('bericht.2024')
  })

  it('offers every openable extension in the file picker', () => {
    for (const extension of ['.pdf', '.epub', '.md', '.png']) {
      expect(FILE_ACCEPT).toContain(extension)
    }
  })
})
