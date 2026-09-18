import { describe, expect, it } from 'vitest'
import { formatPageRange, parsePageRange } from '@/export/range'

describe('parsePageRange', () => {
  it('treats an empty field as the whole document', () => {
    const result = parsePageRange('', 5)
    expect(result.pages).toEqual([0, 1, 2, 3, 4])
    expect(result.whole).toBe(true)
  })

  it('reads the notation every print dialog uses', () => {
    expect(parsePageRange('1-3, 5', 10).pages).toEqual([0, 1, 2, 4])
  })

  it('accepts open ranges on either side', () => {
    expect(parsePageRange('-2', 6).pages).toEqual([0, 1])
    expect(parsePageRange('5-', 6).pages).toEqual([4, 5])
  })

  it('sorts and de-duplicates', () => {
    expect(parsePageRange('4, 1, 2-3, 2', 10).pages).toEqual([0, 1, 2, 3])
  })

  it('accepts a reversed range rather than refusing it', () => {
    expect(parsePageRange('5-2', 10).pages).toEqual([1, 2, 3, 4])
  })

  it('tolerates spaces, semicolons and en dashes', () => {
    expect(parsePageRange(' 2 – 3 ; 6 ', 10).pages).toEqual([1, 2, 5])
  })

  it('clips a range that runs past the end', () => {
    expect(parsePageRange('8-99', 10).pages).toEqual([7, 8, 9])
  })

  it('names the part it could not read and keeps the rest', () => {
    const result = parsePageRange('2, xyz', 10)
    expect(result.pages).toEqual([1])
    expect(result.problem).toContain('xyz')
  })

  it('falls back to the whole document when nothing survives', () => {
    const result = parsePageRange('99-120', 10)
    expect(result.pages).toHaveLength(10)
    expect(result.problem).toBeDefined()
  })
})

describe('formatPageRange', () => {
  it('collapses runs back into ranges', () => {
    expect(formatPageRange([0, 1, 2, 4, 6, 7])).toBe('1–3, 5, 7–8')
  })

  it('handles a single page and an empty selection', () => {
    expect(formatPageRange([3])).toBe('4')
    expect(formatPageRange([])).toBe('')
  })
})
