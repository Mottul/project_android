import { describe, expect, it } from 'vitest'
import {
  commonPrefixLength,
  commonSuffixLength,
  findQuote,
  makeSelector,
  normaliseWhitespace,
  normaliseWithMap,
} from '@/epub/anchor'

describe('makeSelector', () => {
  it('keeps context on both sides of the quote', () => {
    const text = 'Der Vertrag beginnt am ersten Januar und endet am Jahresende.'
    const selector = makeSelector(text, 23, 36)

    expect(selector.quote).toBe('ersten Januar')
    expect(selector.prefix?.endsWith('beginnt am ')).toBe(true)
    expect(selector.suffix?.startsWith(' und endet')).toBe(true)
  })
})

describe('findQuote', () => {
  it('finds a unique quote', () => {
    const text = 'Erstens. Zweitens. Drittens.'
    expect(findQuote(text, { quote: 'Zweitens' })).toEqual({ start: 9, end: 17 })
  })

  it('uses the context to pick the right one of several occurrences', () => {
    // The same sentence twice; only the surroundings tell them apart.
    const text = 'Im Norden gilt: kein Zutritt. Im Süden gilt: kein Zutritt.'
    const found = findQuote(text, {
      quote: 'kein Zutritt',
      prefix: 'Im Süden gilt: ',
      suffix: '.',
    })

    expect(found?.start).toBe(45)
    expect(text.slice(found!.start, found!.end)).toBe('kein Zutritt')
  })

  it('still finds text whose spacing changed', () => {
    // Re-flowed markup puts the line break in a different place.
    const text = 'Der  Bericht\n   liegt  vor.'
    const found = findQuote(text, { quote: 'Der Bericht liegt vor.' })

    expect(found).not.toBeNull()
    expect(normaliseWhitespace(text.slice(found!.start, found!.end))).toBe(
      'Der Bericht liegt vor.',
    )
  })

  it('gives up rather than guessing when the text is gone', () => {
    expect(findQuote('Ein anderer Text.', { quote: 'kommt nicht vor' })).toBeNull()
  })

  it('treats an empty quote as unanchorable', () => {
    expect(findQuote('Irgendwas', { quote: '' })).toBeNull()
  })

  it('falls back to the first occurrence when no context was stored', () => {
    const text = 'gleich gleich gleich'
    expect(findQuote(text, { quote: 'gleich' })?.start).toBe(0)
  })
})

describe('normaliseWithMap', () => {
  it('maps every normalised character back to where it came from', () => {
    const { normalised, map } = normaliseWithMap('  a \n b  ')
    expect(normalised).toBe('a b')
    expect(map).toHaveLength(normalised.length)

    // Each mapped offset points at the right character in the original.
    expect('  a \n b  '[map[0]]).toBe('a')
    expect('  a \n b  '[map[2]]).toBe('b')
  })
})

describe('context scoring helpers', () => {
  it('counts agreement from the inside out', () => {
    expect(commonSuffixLength('das Haus', 'ein Haus')).toBe(5)
    expect(commonPrefixLength('Hausdach', 'Haustür')).toBe(4)
    expect(commonPrefixLength('', 'egal')).toBe(0)
  })
})
