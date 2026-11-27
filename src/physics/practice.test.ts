import { describe, expect, it } from 'vitest'
import { evaluatePractice, type PracticeTarget } from './practice'
import type { Sample } from './telemetry'

const trace: Sample[] = [
  { t: 1, x: 20, y: -10, z: 1 },
  { t: 2, x: 25, y: -8, z: 0, event: 'contact' },
  { t: 3, x: 29, y: -7, z: 0, event: 'contact' },
  { t: 4, x: 32, y: -6, z: 0, event: 'rest' },
]
const circle: PracticeTarget = { shape: 'circle', x: 8, y: 6, radius: 5 }
const rectangle: PracticeTarget = {
  shape: 'rectangle',
  x: 8,
  y: 6,
  length: 8,
  width: 4,
}

describe('evaluatePractice', () => {
  it('measures the offset of the first contact using a release-relative centre', () => {
    expect(evaluatePractice(trace, circle, 'contact')).toEqual({
      dx: -3,
      dy: -4,
      radialError: 5,
      hit: true,
    })
    expect(
      evaluatePractice(trace, { ...circle, radius: 4.99 }, 'contact').hit
    ).toBe(false)
  })

  it('handles rest on the corner of a field-aligned rectangle as a hit', () => {
    const result = evaluatePractice(trace, rectangle, 'rest')
    expect(result).toEqual({
      dx: 4,
      dy: -2,
      radialError: Math.hypot(4, -2),
      hit: true,
    })
    expect(evaluatePractice(trace, rectangle, 'contact').hit).toBe(false)
    expect(
      evaluatePractice(trace, { ...rectangle, length: 7.99 }, 'rest').hit
    ).toBe(false)
    expect(
      evaluatePractice(trace, { ...rectangle, width: 3.99 }, 'rest').hit
    ).toBe(false)
  })

  it('handles both signs of crossrange error', () => {
    expect(
      evaluatePractice(trace, { ...circle, x: 5, y: 1 }, 'contact').dy
    ).toBe(1)
  })

  it.each([
    { ...circle, x: NaN },
    { ...circle, y: Infinity },
    { ...circle, radius: -1 },
    { ...circle, radius: Infinity },
    { ...rectangle, length: 0 },
    { ...rectangle, width: NaN },
  ])('rejects invalid target input %o', (invalid) => {
    expect(() => evaluatePractice(trace, invalid, 'contact')).toThrow()
  })

  it('requires a completed trace', () => {
    expect(() => evaluatePractice(trace.slice(0, -1), circle, 'rest')).toThrow(
      /rest/
    )
    expect(() =>
      evaluatePractice([trace[0], trace[3]], circle, 'contact')
    ).toThrow(/contact/)
  })
})
