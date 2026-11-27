import { describe, expect, it } from 'vitest'
import { measure, type Sample } from './telemetry'

const trace: Sample[] = [
  { t: 0, x: 10, y: -2, z: 1 },
  { t: 0.4, x: 11, y: 0, z: 4 },
  { t: 0.9, x: 13, y: 2, z: 0, event: 'contact' },
  { t: 1.1, x: 13, y: 3, z: 0.2 },
  { t: 1.3, x: 13, y: 4, z: 0, event: 'contact' },
  { t: 2, x: 13, y: 2, z: 0, event: 'rest' },
]

describe('measure', () => {
  it('measures carry and endpoint displacement from release and integrates the horizontal post-contact path', () => {
    const result = measure(trace, { x: 16, y: 6 })
    expect(result).toEqual({
      carry: 5,
      rollout: 4,
      total: 5,
      apex: 4,
      restX: 13,
      restY: 2,
      targetDistance: 10,
      radialError: 5,
      lateralError: -4,
    })
  })

  it('preserves an absent target and a recorded zero carry', () => {
    expect(
      measure([
        { t: 4, x: 2, y: 3, z: 0, event: 'contact' },
        { t: 5, x: 2, y: 3, z: 0, event: 'rest' },
      ])
    ).toEqual({
      carry: 0,
      rollout: 0,
      total: 0,
      apex: 0,
      restX: 2,
      restY: 3,
      targetDistance: null,
      radialError: null,
      lateralError: null,
    })
  })

  it('accepts a target coincident with release', () => {
    expect(measure(trace, { x: 10, y: -2 })).toMatchObject({
      targetDistance: 0,
      lateralError: 4,
      radialError: 5,
    })
  })

  it('uses only explicitly marked ground strikes', () => {
    const unmarked = trace.map(({ t, x, y, z, event }) => ({
      t,
      x,
      y,
      z,
      event: event === 'contact' ? undefined : event,
    }))
    expect(() => measure(unmarked)).toThrow(/contact/)
  })

  it('requires a final rest event and rejects additional samples after rest', () => {
    expect(() => measure([])).toThrow()
    expect(() => measure(trace.slice(0, -1))).toThrow(/rest/)
    expect(() => measure([...trace, { t: 3, x: 13, y: 2, z: 0 }])).toThrow(
      /rest/
    )
  })

  it.each([0, -0.1])('rejects a non-increasing second timestamp of %d', (t) => {
    expect(() =>
      measure(
        trace.map((sample, index) => (index === 1 ? { ...sample, t } : sample))
      )
    ).toThrow(/Time/)
  })

  it('rejects nonfinite observations and target coordinates', () => {
    expect(() => measure([{ t: 0, x: 0, y: 0, z: NaN }, ...trace])).toThrow(
      /finite/
    )
    expect(() => measure(trace, { x: 2, y: Infinity })).toThrow(/finite/)
  })

  it('rejects overflow in derived distances', () => {
    expect(() =>
      measure([
        { t: 0, x: -1e308, y: 0, z: 0, event: 'contact' },
        { t: 1, x: 1e308, y: 0, z: 0, event: 'rest' },
      ])
    ).toThrow(/range/)
  })
})
