import { describe, expect, it } from 'vitest'
import { formatBytes, formatWhen, safeFileName, suffixFileName } from '@/lib/format'

describe('formatBytes', () => {
  it('uses binary steps and a German decimal comma', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(999)).toBe('999 B')
    expect(formatBytes(1024)).toBe('1,00 KB')
    expect(formatBytes(1024 * 1024 * 3.5)).toBe('3,50 MB')
  })

  it('drops decimals once they stop meaning anything', () => {
    expect(formatBytes(1024 * 1024 * 512)).toBe('512 MB')
  })

  it('survives nonsense', () => {
    expect(formatBytes(Number.NaN)).toBe('—')
    expect(formatBytes(-5)).toBe('—')
  })
})

describe('formatWhen', () => {
  const now = Date.parse('2026-09-18T12:00:00Z')

  it('describes recent moments in words', () => {
    expect(formatWhen(now - 20_000, now)).toBe('gerade eben')
    expect(formatWhen(now - 60_000, now)).toBe('vor 1 Minute')
    expect(formatWhen(now - 7_200_000, now)).toBe('vor 2 Stunden')
    expect(formatWhen(now - 90_000_000, now)).toBe('gestern')
  })

  it('falls back to a date once "vor n Tagen" stops helping', () => {
    expect(formatWhen(now - 40 * 86_400_000, now)).toMatch(/^\d{2}\.\d{2}\.\d{4}$/)
  })
})

describe('file names', () => {
  it('removes characters no file system accepts', () => {
    expect(safeFileName('Quartal 1/2: "Bericht"')).toBe('Quartal 1-2- -Bericht-')
  })

  it('inserts a suffix before the extension', () => {
    expect(suffixFileName('bericht.pdf', '-kommentiert')).toBe('bericht-kommentiert.pdf')
    expect(suffixFileName('buch.epub', '-notizen', 'md')).toBe('buch-notizen.md')
  })
})
