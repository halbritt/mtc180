import { describe, expect, it } from 'vitest'
import { REGULATION_GOLF_BALL } from '../models'
import { MAX_FLIGHT_TIME_S, simulateFlight } from './aero'
import { createNominalEnv } from './simulate'
import { simulateTurf } from './turf'

describe('aero — 3D Flight Aerodynamics (RK4)', () => {
  it('matches analytical vacuum parabola closely when airDensityKgM3=0 and cdOverride=0', () => {
    const env = createNominalEnv({
      airDensityKgM3: 0,
      cdOverride: 0,
      windVecMps: [0, 0, 0],
    })
    const v0x = 5.0
    const v0z = 4.0
    const z0 = 0.25
    const g = env.gravityMps2
    const tExact = (v0z + Math.sqrt(v0z * v0z + 2 * g * z0)) / g
    const carryExact = v0x * tExact
    const apexExact = z0 + (v0z * v0z) / (2 * g)

    const res = simulateFlight(
      { posM: [0, 0, z0], velMps: [v0x, 0, v0z], omegaBallRadps: [0, 0, 0] },
      env
    )

    expect(res.tImpactS).toBeCloseTo(tExact, 5)
    expect(res.carryDistanceM).toBeCloseTo(carryExact, 5)
    expect(res.apexM).toBeCloseTo(apexExact, 5)
    expect(res.impactPosM[2]).toBe(0)
    expect(res.samples[res.samples.length - 1].event).toBe('contact')
  })

  it('quadratic drag reduces carry and apex vs vacuum and dimpled golf ball out-carries smooth sphere', () => {
    const input = {
      posM: [0, 0, 0.2] as [number, number, number],
      velMps: [6.8, 0, 6.2] as [number, number, number],
      omegaBallRadps: [0, 0, 0] as [number, number, number],
    }
    const vac = simulateFlight(
      input,
      createNominalEnv({ airDensityKgM3: 0, cdOverride: 0 })
    )
    const golf = simulateFlight(
      input,
      createNominalEnv({ projectile: 'golf_ball' })
    )
    const smooth = simulateFlight(
      input,
      createNominalEnv({ projectile: 'smooth_ball' })
    )

    expect(golf.carryDistanceM).toBeLessThan(vac.carryDistanceM)
    expect(golf.apexM).toBeLessThan(vac.apexM)
    expect(golf.carryDistanceM).toBeGreaterThan(smooth.carryDistanceM)
    expect(REGULATION_GOLF_BALL.inertiaKgM2).toBeCloseTo(
      0.4 *
        REGULATION_GOLF_BALL.massKg *
        REGULATION_GOLF_BALL.radiusM *
        REGULATION_GOLF_BALL.radiusM,
      12
    )
  })

  it('Magnus force gives backspin (+z lift), topspin (-z drop), sidespin (±y curve), and spin decay', () => {
    const base = {
      posM: [0, 0, 0.25] as [number, number, number],
      velMps: [6.5, 0, 6.5] as [number, number, number],
    }
    const env = createNominalEnv()
    const back = simulateFlight({ ...base, omegaBallRadps: [0, -80, 0] }, env)
    const zero = simulateFlight({ ...base, omegaBallRadps: [0, 0, 0] }, env)
    const top = simulateFlight({ ...base, omegaBallRadps: [0, 80, 0] }, env)
    const sidePos = simulateFlight({ ...base, omegaBallRadps: [0, 0, 80] }, env)
    const sideNeg = simulateFlight({ ...base, omegaBallRadps: [0, 0, -80] }, env)

    expect(back.apexM).toBeGreaterThan(zero.apexM)
    expect(back.carryDistanceM).toBeGreaterThan(zero.carryDistanceM)
    expect(zero.carryDistanceM).toBeGreaterThan(top.carryDistanceM)
    expect(sidePos.impactPosM[1]).toBeGreaterThan(0.01)
    expect(sideNeg.impactPosM[1]).toBeLessThan(-0.01)
    expect(back.omegaAtImpactRadps[1]).toBeGreaterThan(-80)
    expect(back.omegaAtImpactRadps[1]).toBeLessThan(0)
  })

  it('handles wind (head/tail/cross), zero velocity, near-zero spin, updraft safety cap, and invalid inputs', () => {
    const base = {
      posM: [0, 0, 0.25] as [number, number, number],
      velMps: [6.5, 0, 6.5] as [number, number, number],
      omegaBallRadps: [0, 0, 0] as [number, number, number],
    }
    const head = simulateFlight(
      base,
      createNominalEnv({ windVecMps: [-3, 0, 0] })
    )
    const tail = simulateFlight(
      base,
      createNominalEnv({ windVecMps: [3, 0, 0] })
    )
    const crossPos = simulateFlight(
      base,
      createNominalEnv({ windVecMps: [0, 3, 0] })
    )
    const crossNeg = simulateFlight(
      base,
      createNominalEnv({ windVecMps: [0, -3, 0] })
    )
    expect(head.carryDistanceM).toBeLessThan(tail.carryDistanceM)
    expect(crossPos.impactPosM[1]).toBeGreaterThan(0.02)
    expect(crossNeg.impactPosM[1]).toBeLessThan(-0.02)

    const drop = simulateFlight(
      { posM: [0, 0, 0.5], velMps: [0, 0, 0], omegaBallRadps: [0, 0, 0] },
      createNominalEnv()
    )
    expect(Math.abs(drop.impactPosM[0])).toBeLessThan(1e-6)
    expect(Math.abs(drop.impactPosM[1])).toBeLessThan(1e-6)
    expect(drop.impactPosM[2]).toBe(0)

    const tinySpin = simulateFlight(
      { posM: [0, 0, 0.2], velMps: [6, 0, 6], omegaBallRadps: [0, 1e-12, 0] },
      createNominalEnv()
    )
    expect(Number.isFinite(tinySpin.carryDistanceM)).toBe(true)

    const updraft = simulateFlight(
      { posM: [0, 0, 0.5], velMps: [2, 0, 5], omegaBallRadps: [0, 0, 0] },
      createNominalEnv({ windVecMps: [0, 0, 50] })
    )
    expect(updraft.tImpactS).toBeGreaterThan(0)
    expect(updraft.tImpactS).toBeLessThanOrEqual(MAX_FLIGHT_TIME_S)

    expect(() =>
      simulateFlight(base, createNominalEnv({ airDensityKgM3: -0.1 }))
    ).toThrow(RangeError)
    expect(() =>
      simulateFlight(base, createNominalEnv({ cdOverride: -0.2 }))
    ).toThrow(RangeError)
    expect(() =>
      simulateFlight(base, createNominalEnv({ gravityMps2: 0 }))
    ).toThrow(RangeError)
    expect(() =>
      simulateFlight(base, createNominalEnv({ dtS: 0.002 }))
    ).toThrow(RangeError)
  })

  it('handles immediate ground release (z0 <= 0, vz <= 0) and updraft-cap handoff to simulateTurf cleanly', () => {
    const env = createNominalEnv()
    const ground = simulateFlight(
      { posM: [1.5, -0.2, 0], velMps: [4.0, 0, 0], omegaBallRadps: [0, 0, 0], tStartS: 0.25 },
      env
    )
    expect(ground.carryDistanceM).toBe(0)
    expect(ground.impactPosM).toEqual([1.5, -0.2, 0])
    expect(ground.samples.at(-1)?.event).toBe('contact')

    const negGround = simulateFlight(
      { posM: [0, 0, -0.01], velMps: [3.0, 0, -1.0], omegaBallRadps: [0, 0, 0] },
      env
    )
    expect(negGround.carryDistanceM).toBe(0)
    expect(negGround.impactPosM[2]).toBe(0)

    const updraftEnv = createNominalEnv({ windVecMps: [0, 0, 50], dtS: 0.0005 })
    const updraft = simulateFlight(
      { posM: [0, 0, 0.5], velMps: [2, 0, 5], omegaBallRadps: [0, 0, 0] },
      updraftEnv
    )
    expect(updraft.impactPosM[2]).toBeGreaterThan(0)
    const turfDrop = simulateTurf(
      {
        posM: updraft.impactPosM,
        velMps: updraft.impactVelMps,
        omegaBallRadps: updraft.omegaAtImpactRadps,
        tStartS: updraft.tImpactS,
      },
      updraftEnv
    )
    expect(turfDrop.samples.at(-1)?.event).toBe('rest')
    expect(turfDrop.restPosM[2]).toBe(0)
    expect(Number.isFinite(turfDrop.rollDistanceM)).toBe(true)
  })
})
