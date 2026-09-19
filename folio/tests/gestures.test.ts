import { describe, expect, it } from 'vitest'
import {
  DOUBLE_TAP_MS,
  DOUBLE_TAP_SLOP,
  centreOf,
  clamp,
  distanceBetween,
  isDoubleTap,
  pinchScale,
} from '@/ui/gestures'

describe('pinchScale', () => {
  it('scales in proportion to how far the fingers moved apart', () => {
    expect(pinchScale(1, 100, 200, 0.25, 6)).toBe(2)
    expect(pinchScale(1, 200, 100, 0.25, 6)).toBe(0.5)
    expect(pinchScale(2, 100, 150, 0.25, 6)).toBe(3)
  })

  it('stays inside the zoom bounds', () => {
    expect(pinchScale(1, 10, 10_000, 0.25, 6)).toBe(6)
    expect(pinchScale(1, 10_000, 10, 0.25, 6)).toBe(0.25)
  })

  it('does nothing when the fingers started on top of each other', () => {
    // Two pointers reported at the same coordinate would otherwise divide by
    // something close to zero and throw the page to the maximum zoom.
    expect(pinchScale(1.5, 0, 300, 0.25, 6)).toBe(1.5)
  })
})

describe('isDoubleTap', () => {
  const point = { x: 100, y: 200 }

  it('needs a previous tap', () => {
    expect(isDoubleTap(null, 1000, point)).toBe(false)
  })

  it('accepts a second tap that is soon enough and close enough', () => {
    expect(isDoubleTap({ at: 900, point }, 900 + DOUBLE_TAP_MS - 20, { x: 108, y: 206 })).toBe(true)
  })

  it('rejects a tap that came too late', () => {
    expect(isDoubleTap({ at: 900, point }, 900 + DOUBLE_TAP_MS + 1, point)).toBe(false)
  })

  it('rejects a tap somewhere else on the page', () => {
    const far = { x: point.x + DOUBLE_TAP_SLOP + 1, y: point.y }
    expect(isDoubleTap({ at: 900, point }, 1000, far)).toBe(false)
  })
})

describe('geometry', () => {
  it('measures distance and midpoint of two fingers', () => {
    expect(distanceBetween({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
    expect(centreOf({ x: 0, y: 10 }, { x: 20, y: 30 })).toEqual({ x: 10, y: 20 })
  })

  it('clamps', () => {
    expect(clamp(5, 0, 1)).toBe(1)
    expect(clamp(-5, 0, 1)).toBe(0)
    expect(clamp(0.5, 0, 1)).toBe(0.5)
  })
})
