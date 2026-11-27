import { describe, expect, it } from 'vitest'
import { positionAt } from './replay'
import type { Sample } from './telemetry'

const samples: Sample[] = [
  { t: 100, x: 1, y: 2, z: 3 },
  { t: 100.25, x: 2, y: 3, z: 4 },
  { t: 101.25, x: 6, y: -1, z: 0, event: 'contact' },
  { t: 103.25, x: 8, y: -2, z: 0, event: 'rest' },
]

describe('positionAt', () => {
  it('interpolates between irregularly spaced samples relative to release time', () => {
    expect(positionAt(samples, 0.125)).toEqual({ x: 1.5, y: 2.5, z: 3.5 })
    expect(positionAt(samples, 0.5)).toEqual({ x: 3, y: 2, z: 3 })
    expect(positionAt(samples, 2.25)).toEqual({ x: 7, y: -1.5, z: 0 })
  })

  it('reproduces a recorded contact at its exact timestamp', () => {
    expect(positionAt(samples, 1.25)).toEqual({ x: 6, y: -1, z: 0 })
  })

  it('clamps to the first and last recorded positions', () => {
    for (const t of [-10, 0])
      expect(positionAt(samples, t)).toEqual({ x: 1, y: 2, z: 3 })
    for (const t of [3.25, 100])
      expect(positionAt(samples, t)).toEqual({ x: 8, y: -2, z: 0 })
  })

  it('preserves sub-tick elapsed time at large clock origins', () => {
    const first = { t: 1e16, x: 0, y: 0, z: 1 }
    const second = { t: 1e16 + 2, x: 2, y: 0, z: 3 }
    expect(positionAt([first, second], 0.5)).toEqual({ x: 0.5, y: 0, z: 1.5 })
  })

  it('interpolates across finite times and altitudes whose difference overflows', () => {
    const first = { t: -1e308, x: 0, y: 0, z: -1e308 }
    const second = { t: 1e308, x: 0, y: 0, z: 1e308 }
    expect(positionAt([first, second], 1e308)).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('rejects missing observations or nonfinite elapsed time', () => {
    expect(() => positionAt([], 0)).toThrow(/sample/)
    expect(() => positionAt(samples, NaN)).toThrow(/finite/)
  })
})
