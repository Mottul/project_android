import { describe, expect, it } from 'vitest'
import {
  PDF_OVERHEAD_PER_PAGE,
  compressionLadder,
  describeStep,
  estimateTotalBytes,
  findStep,
  samplePages,
  type CompressionStep,
} from '@/pdf/compress'

describe('compressionLadder', () => {
  it('runs from the largest expected file to the smallest', () => {
    const ladder = compressionLadder()
    expect(ladder.length).toBeGreaterThan(8)

    const proxy = ladder.map((step) => step.dpi * step.dpi * step.quality)
    for (let i = 1; i < proxy.length; i += 1) {
      expect(proxy[i]).toBeLessThanOrEqual(proxy[i - 1])
    }
  })

  it('starts at the best setting it offers', () => {
    const [first] = compressionLadder()
    expect(first.dpi).toBe(300)
    expect(first.quality).toBeCloseTo(0.9)
  })
})

describe('samplePages', () => {
  it('takes every page of a short document', () => {
    expect(samplePages(2)).toEqual([0, 1])
  })

  it('spreads the sample rather than taking the first pages', () => {
    const pages = samplePages(120)
    expect(pages).toHaveLength(3)
    // Nothing from the title pages, nothing past the end.
    expect(pages[0]).toBeGreaterThan(5)
    expect(pages[pages.length - 1]).toBeLessThan(120)
  })
})

describe('estimateTotalBytes', () => {
  it('extrapolates from the sample and adds the structure', () => {
    expect(estimateTotalBytes([1000], 10)).toBe(10_000 + PDF_OVERHEAD_PER_PAGE * 10)
  })

  it('returns nothing when nothing was measured', () => {
    expect(estimateTotalBytes([], 10)).toBe(0)
  })
})

describe('findStep', () => {
  /** A stand-in document whose size follows the usual dpi²×quality shape. */
  const sizeOf = (step: CompressionStep, factor = 1) =>
    Math.round(step.dpi * step.dpi * step.quality * factor)

  it('keeps the best setting when it already fits', async () => {
    const ladder = compressionLadder()
    const result = await findStep(ladder, (step) => sizeOf(step), Number.MAX_SAFE_INTEGER)

    expect(result.step).toEqual(ladder[0])
    expect(result.missed).toBe(false)
    // One measurement: the first candidate answered the question.
    expect(result.measurements).toBe(1)
  })

  it('finds the largest setting that fits under the target', async () => {
    const ladder = compressionLadder()
    const target = 2_000_000

    const result = await findStep(ladder, (step) => sizeOf(step, 60), target)
    expect(result.estimate).toBeLessThanOrEqual(target)
    expect(result.missed).toBe(false)

    // And it really is the best one: the step above it is over the target.
    const index = ladder.findIndex(
      (step) => step.dpi === result.step.dpi && step.quality === result.step.quality,
    )
    expect(sizeOf(ladder[index - 1], 60)).toBeGreaterThan(target)
  })

  it('bisects instead of walking the whole ladder', async () => {
    const ladder = compressionLadder()
    const result = await findStep(ladder, (step) => sizeOf(step, 60), 2_000_000)
    expect(result.measurements).toBeLessThan(Math.log2(ladder.length) + 4)
  })

  it('reports a target that cannot be reached and uses the smallest step', async () => {
    const ladder = compressionLadder()
    const result = await findStep(ladder, (step) => sizeOf(step, 10_000), 1000)

    expect(result.missed).toBe(true)
    expect(result.step).toEqual(ladder[ladder.length - 1])
  })

  it('accepts an asynchronous measurement', async () => {
    const ladder = compressionLadder()
    const result = await findStep(
      ladder,
      async (step) => Promise.resolve(sizeOf(step, 60)),
      2_000_000,
    )
    expect(result.estimate).toBeLessThanOrEqual(2_000_000)
  })

  it('survives an empty ladder', async () => {
    const result = await findStep([], () => 0, 1000)
    expect(result.missed).toBe(true)
  })
})

describe('describeStep', () => {
  it('says what a setting means in words', () => {
    expect(describeStep({ dpi: 300, quality: 0.9 })).toContain('druckfein')
    expect(describeStep({ dpi: 72, quality: 0.4 })).toContain('grob')
  })
})
