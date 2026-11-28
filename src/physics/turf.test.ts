import { describe, expect, it } from 'vitest'
import { createNominalEnv, createSeededRng } from './simulate'
import { simulateTurf, validateTurfParams } from './turf'

describe('turf — Grassy Field Impact, Bounce & Rollout', () => {
  it('Test 4 (Turf Termination): reaches exact rest v=0 in finite time across soft, firm, short, long, wet, dry presets and landing angles', () => {
    const turfPresets = [
      { name: 'soft', turfEn: 0.25, turfMuR: 0.16 },
      { name: 'firm', turfEn: 0.4, turfMuR: 0.08 },
      { name: 'short_grass', turfEn: 0.35, turfMuR: 0.08 },
      { name: 'long_grass', turfEn: 0.25, turfMuR: 0.2 },
      { name: 'wet', turfEn: 0.25, turfMuR: 0.2 },
      { name: 'dry', turfEn: 0.35, turfMuR: 0.08 },
    ] as const

    const landingVelocities: Array<[number, number, number]> = [
      [8.0, 0, -1.0], // shallow high-speed skid
      [5.5, 0, -4.5], // mid trajectory
      [1.0, 0, -8.0], // steep high-loft drop
      [0.02, 0, -0.05], // micro capture
    ]

    for (const preset of turfPresets) {
      for (const velMps of landingVelocities) {
        const env = createNominalEnv({
          turfEn: preset.turfEn,
          turfMuR: preset.turfMuR,
          turfScatterSigmaRad: 0.015,
        })
        const res = simulateTurf(
          {
            posM: [3, 0, 0],
            velMps,
            omegaBallRadps: [0, 0, 0],
            tStartS: 0.5,
          },
          env,
          createSeededRng(42)
        )

        const last = res.samples[res.samples.length - 1]
        expect(last.event, `${preset.name}`).toBe('rest')
        expect(last.z).toBe(0)
        expect(res.tRestS).toBeLessThan(30)
        expect(res.samples.length).toBeLessThan(10_000)
        expect(res.restPosM[0]).toBeGreaterThanOrEqual(3 - 1e-6)
        expect(Number.isFinite(res.rollDistanceM)).toBe(true)

        for (let i = 1; i < res.samples.length; i++) {
          expect(res.samples[i].t).toBeGreaterThan(res.samples[i - 1].t)
        }
      }
    }
  })

  it('differentiates shallow skid vs steep drop with Coulomb topspin bite and angle-dependent tangential loss', () => {
    const env = createNominalEnv({
      turfEn: 0.32,
      turfMuR: 0.14,
      turfScatterSigmaRad: 0,
    })

    const shallow = simulateTurf(
      { posM: [3, 0, 0], velMps: [8.0, 0, -1.0], omegaBallRadps: [0, 0, 0], tStartS: 0.5 },
      env
    )
    const steep = simulateTurf(
      { posM: [3, 0, 0], velMps: [1.0, 0, -8.0], omegaBallRadps: [0, 0, 0], tStartS: 0.5 },
      env
    )

    expect(shallow.tangentialSpeedLossRatio).toBeGreaterThan(0)
    expect(shallow.tangentialSpeedLossRatio).toBeLessThan(1)
    expect(steep.tangentialSpeedLossRatio).toBeGreaterThan(0)
    expect(steep.tangentialSpeedLossRatio).toBeLessThan(1)
    expect(
      Math.abs(shallow.tangentialSpeedLossRatio - steep.tangentialSpeedLossRatio)
    ).toBeGreaterThan(0.03)
    expect(shallow.postBounceOmegaRadps[1]).toBeGreaterThan(1)
    expect(shallow.postBounceVelMps[2]).toBeGreaterThan(0)
    expect(shallow.postBounceVelMps[2]).toBeLessThanOrEqual(env.turfEn * 1.0 + 1e-6)
    expect(steep.postBounceVelMps[2]).toBeLessThanOrEqual(env.turfEn * 8.0 + 1e-6)
    expect(shallow.rollDistanceM).toBeGreaterThan(0.5)
    expect(shallow.rollDistanceM).toBeGreaterThan(steep.rollDistanceM * 2)
  })

  it('scales rollout monotonically with turfEn, turfMuR, and stochastic scatter', () => {
    const input = {
      posM: [3, 0, 0] as [number, number, number],
      velMps: [5.5, 0, -4.0] as [number, number, number],
      omegaBallRadps: [0, 0, 0] as [number, number, number],
      tStartS: 0.7,
    }
    const firm = simulateTurf(
      input,
      createNominalEnv({ turfEn: 0.4, turfMuR: 0.12, turfScatterSigmaRad: 0 })
    )
    const soft = simulateTurf(
      input,
      createNominalEnv({ turfEn: 0.25, turfMuR: 0.12, turfScatterSigmaRad: 0 })
    )
    expect(firm.postBounceVelMps[2]).toBeGreaterThan(soft.postBounceVelMps[2])
    expect(firm.rollDistanceM).toBeGreaterThan(soft.rollDistanceM)

    const dry = simulateTurf(
      input,
      createNominalEnv({ turfEn: 0.3, turfMuR: 0.08, turfScatterSigmaRad: 0 })
    )
    const wet = simulateTurf(
      input,
      createNominalEnv({ turfEn: 0.3, turfMuR: 0.2, turfScatterSigmaRad: 0 })
    )
    expect(wet.rollDistanceM).toBeLessThan(dry.rollDistanceM)

    const zeroEn = simulateTurf(
      input,
      createNominalEnv({ turfEn: 0, turfMuR: 0.15, turfScatterSigmaRad: 0 })
    )
    expect(zeroEn.bouncePoints).toHaveLength(1)
    expect(zeroEn.postBounceVelMps[2]).toBe(0)

    const ys = [1, 2, 3, 4, 5].map((seed) => {
      const r = simulateTurf(
        input,
        createNominalEnv({ turfScatterSigmaRad: 0.03 }),
        createSeededRng(seed)
      )
      return r.restPosM[1]
    })
    expect(new Set(ys.map((y) => y.toFixed(6))).size).toBeGreaterThan(1)
  })

  it('validateTurfParams rejects out-of-range parameters cleanly', () => {
    expect(() => validateTurfParams({ en: -0.01, muR: 0.1 })).toThrow(RangeError)
    expect(() => validateTurfParams({ en: 1.01, muR: 0.1 })).toThrow(RangeError)
    expect(() => validateTurfParams({ en: Number.NaN, muR: 0.1 })).toThrow(RangeError)
    expect(() => validateTurfParams({ en: 0.3, muR: 0 })).toThrow(RangeError)
    expect(() => validateTurfParams({ en: 0.3, muR: -0.05 })).toThrow(RangeError)
    expect(() =>
      validateTurfParams({ en: 0.3, muR: 0.1, scatterSigmaRad: -0.01 })
    ).toThrow(RangeError)
  })

  it('handles ultra-low muR=0.001 timeout cap, en=1.0 multi-bounce loop cap, and airborne z>0, vz>0 drop cleanly', () => {
    const lowMu = simulateTurf(
      { posM: [0, 0, 0], velMps: [25, 0, -0.5], omegaBallRadps: [0, 0, 0], tStartS: 0.2 },
      createNominalEnv({ turfEn: 0, turfMuR: 0.001, turfScatterSigmaRad: 0, dtS: 0.0005 })
    )
    expect(lowMu.samples.at(-1)?.event).toBe('rest')
    expect(Number.isFinite(lowMu.rollDistanceM)).toBe(true)
    expect(lowMu.tRestS).toBeLessThanOrEqual(65)

    const elasticBounce = simulateTurf(
      { posM: [0, 0, 0], velMps: [4, 0, -5], omegaBallRadps: [0, 0, 0], tStartS: 0.2 },
      createNominalEnv({ turfEn: 1.0, turfMuR: 0.15, turfScatterSigmaRad: 0, dtS: 0.0005 })
    )
    expect(elasticBounce.samples.at(-1)?.event).toBe('rest')
    expect(elasticBounce.bouncePoints.length).toBeGreaterThan(5)
    expect(elasticBounce.bouncePoints.length).toBeLessThanOrEqual(32)

    const airborne = simulateTurf(
      { posM: [1, 0, 0.5], velMps: [3, 0, 2.5], omegaBallRadps: [0, 0, 0], tStartS: 0.1 },
      createNominalEnv({ turfEn: 0.3, turfMuR: 0.15, turfScatterSigmaRad: 0 })
    )
    expect(airborne.samples[0].z).toBeGreaterThan(0)
    expect(airborne.samples.some((s) => s.event === 'contact')).toBe(true)
    expect(airborne.samples.at(-1)?.event).toBe('rest')
    expect(airborne.restPosM[0]).toBeGreaterThan(1)
  })
})
