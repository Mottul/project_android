import { describe, expect, it } from 'vitest'
import { isWinAnsi, toWinAnsi, wrapText } from '@/pdf/text-encoding'

describe('toWinAnsi', () => {
  it('leaves German text completely alone', () => {
    const input = 'Größe: 12 µm — „Prüfbericht“, Ausgabe 3/2026 · 50 % · 20 €'
    const { text, dropped } = toWinAnsi(input)
    expect(text).toBe(input)
    expect(dropped).toEqual([])
  })

  it('folds ligatures back into letters', () => {
    // PDF text extraction produces these constantly.
    expect(toWinAnsi('ﬁnden ﬂieÃen'.replace('Ã', 'ß')).text).toBe('finden fließen')
  })

  it('replaces invisible spacing characters with something printable', () => {
    // Written as code points: these are indistinguishable from a normal space,
    // or from nothing at all, in a source file.
    const nbsp = String.fromCharCode(0x00a0)
    const softHyphen = String.fromCharCode(0x00ad)

    expect(toWinAnsi(`12${nbsp}345`).text).toBe('12 345')
    expect(toWinAnsi(`Soft${softHyphen}hyphen`).text).toBe('Softhyphen')
  })

  it('keeps the base letter of an unsupported accented character', () => {
    // Latin Extended-A: not in WinAnsi, but the word is still readable.
    expect(toWinAnsi('Gdańsk').text).toBe('Gdansk')
  })

  it('reports what it could not represent', () => {
    const { text, dropped } = toWinAnsi('Preis 100 元 ✓')
    expect(text).toBe('Preis 100 ? ?')
    expect(dropped).toEqual(['元', '✓'])
  })

  it('expands tabs and keeps line breaks', () => {
    expect(toWinAnsi('a\tb\nc').text).toBe('a    b\nc')
  })

  it('recognises text that needs no folding at all', () => {
    expect(isWinAnsi('Übergrößen')).toBe(true)
    expect(isWinAnsi('日本語')).toBe(false)
  })
})

describe('wrapText', () => {
  /** A stand-in for a font metric: every character is one unit wide. */
  const width = (line: string) => line.length

  it('breaks a line at the last word that fits', () => {
    expect(wrapText('eins zwei drei vier', 10, width)).toEqual(['eins zwei', 'drei vier'])
  })

  it('keeps explicit line breaks', () => {
    expect(wrapText('eins\nzwei', 40, width)).toEqual(['eins', 'zwei'])
  })

  it('breaks a word that is longer than the whole box', () => {
    const lines = wrapText('Donaudampfschifffahrt', 8, width)
    expect(lines.length).toBeGreaterThan(2)
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(8)
  })

  it('returns one line when everything fits', () => {
    expect(wrapText('kurz', 40, width)).toEqual(['kurz'])
  })
})
