import { describe, expect, it } from 'vitest'
import {
  DIRECT_ARM_1TRAP,
  DIRECT_ARM_2TRAP,
  DIRECT_ARM_RAIL,
  GRAVITY_SLING_TREBUCHET,
  LAUNCHER_MODELS,
  NOMINAL_ENERGY_PER_TRAP_J,
  V41_TILTED_CRADLE,
  V51_CORD_HORN,
} from '../models'
import {
  createTorsionSpringSpec,
  instantaneousSpringTorque,
  integrateSpringWork,
  sampleSpringBankEnergy,
  springPotentialEnergy,
  springTorque,
  springWork,
} from './spring'

function makeRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('spring mechanics (Test 1: Spring Work Integration)', () => {
  it('matches numerical integral within < 0.5% for 2.12 J, 2.0 J, and torqueRatio in {0, 0.5, 1}', () => {
    for (const targetE of [2.12, 2.0]) {
      for (const ratio of [0, 0.5, 1]) {
        const numeric = integrateSpringWork(180, 0, targetE, ratio, 1800)
        const analytic = springWork(180, 0, targetE, ratio)
        expect(Math.abs(numeric - targetE) / targetE).toBeLessThan(0.005)
        expect(Math.abs(analytic - targetE) / targetE).toBeLessThan(1e-12)
      }
    }
  })

  it('satisfies linear torque ratio tau(0) / tau(180) === torqueRatio', () => {
    const t0 = springTorque(0, 2.12, 0.5)
    const t180 = springTorque(180, 2.12, 0.5)
    expect(t0 / t180).toBeCloseTo(0.5, 12)
  })

  it('scales linearly across 1-, 2-, and 3-trap banks', () => {
    const e1 = DIRECT_ARM_1TRAP.trapBank.count * NOMINAL_ENERGY_PER_TRAP_J
    const e2 = DIRECT_ARM_2TRAP.trapBank.count * NOMINAL_ENERGY_PER_TRAP_J
    const e3 = DIRECT_ARM_RAIL.trapBank.count * NOMINAL_ENERGY_PER_TRAP_J
    const w1 = springWork(173, 14, e1, 0.5)
    const w2 = springWork(173, 14, e2, 0.5)
    const w3 = springWork(173, 14, e3, 0.5)
    expect(w2 / w1).toBeCloseTo(2, 10)
    expect(w3 / w1).toBeCloseTo(3, 10)
  })

  it('evaluates V41_TILTED_CRADLE springZeroOffsetDeg = 3.37 linearly without clamping at 180 deg', () => {
    const tb = V41_TILTED_CRADLE.trapBank
    const totalE = tb.count * tb.nominalEnergyPerTrapJ
    const tauAt180 = springTorque(180, totalE, tb.torqueRatio, tb.springZeroOffsetDeg)
    const tauRaw183 = springTorque(183.37, totalE, tb.torqueRatio, 0)
    expect(tauAt180).toBeCloseTo(tauRaw183, 12)
    expect(tauAt180).toBeGreaterThan(springTorque(180, totalE, tb.torqueRatio, 0))

    const numeric = integrateSpringWork(
      tb.thCockMaxDeg,
      tb.thRestDeg,
      totalE,
      tb.torqueRatio,
      1000,
      tb.springZeroOffsetDeg
    )
    const analytic = springWork(
      tb.thCockMaxDeg,
      tb.thRestDeg,
      totalE,
      tb.torqueRatio,
      tb.springZeroOffsetDeg
    )
    expect(Math.abs(numeric - analytic) / analytic).toBeLessThan(0.0005)
  })

  it('integrates all mousetrap models within < 0.5%', () => {
    for (const model of LAUNCHER_MODELS) {
      if (model.trapBank.count === 0) continue
      const tb = model.trapBank
      const totalE = tb.count * tb.nominalEnergyPerTrapJ
      const numeric = integrateSpringWork(
        tb.thCockMaxDeg,
        tb.thRestDeg,
        totalE,
        tb.torqueRatio,
        1000,
        tb.springZeroOffsetDeg
      )
      const analytic = springWork(
        tb.thCockMaxDeg,
        tb.thRestDeg,
        totalE,
        tb.torqueRatio,
        tb.springZeroOffsetDeg
      )
      expect(Math.abs(numeric - analytic) / analytic).toBeLessThan(0.005)
    }
  })

  it('samples uniform and gaussian bank energy and clamps non-negative', () => {
    const rngU = makeRng(101)
    const uniformSamples = Array.from({ length: 200 }, () =>
      sampleSpringBankEnergy(
        V51_CORD_HORN,
        { nominalEnergyJ: 2.0, energyVarianceJ: 0.1, energyDistribution: 'uniform' },
        rngU
      )
    )
    const meanU = uniformSamples.reduce((a, b) => a + b, 0) / uniformSamples.length
    expect(meanU).toBeGreaterThan(1.95)
    expect(meanU).toBeLessThan(2.05)
    expect(Math.min(...uniformSamples)).toBeGreaterThanOrEqual(1.9)
    expect(Math.max(...uniformSamples)).toBeLessThanOrEqual(2.1)

    const rngG = makeRng(202)
    const gaussSamples = Array.from({ length: 100 }, () =>
      sampleSpringBankEnergy(
        V51_CORD_HORN,
        { nominalEnergyJ: 0.2, energyVarianceJ: 1.0, energyDistribution: 'gaussian' },
        rngG
      )
    )
    expect(gaussSamples.every((e) => Number.isFinite(e) && e >= 0)).toBe(true)

    expect(
      sampleSpringBankEnergy(
        GRAVITY_SLING_TREBUCHET,
        { nominalEnergyJ: 2.12, energyVarianceJ: 0.1 },
        makeRng(1)
      )
    ).toBe(0)

    const perTrapUniform = Array.from({ length: 100 }, (_, i) =>
      sampleSpringBankEnergy(
        V51_CORD_HORN,
        { nominalEnergyJ: 2.12, energyVarianceJ: 0.15, energyDistribution: 'uniform' },
        makeRng(500 + i),
        true
      )
    )
    expect(Math.min(...perTrapUniform)).toBeGreaterThanOrEqual(2.12 - 0.15)
    expect(Math.max(...perTrapUniform)).toBeLessThanOrEqual(2.12 + 0.15)
    expect(new Set(perTrapUniform.map((x) => x.toFixed(6))).size).toBeGreaterThan(20)

    const perTrapGauss = Array.from({ length: 100 }, (_, i) =>
      sampleSpringBankEnergy(
        V51_CORD_HORN,
        { nominalEnergyJ: 2.12, energyVarianceJ: 0.15, energyDistribution: 'gaussian' },
        makeRng(900 + i),
        true
      )
    )
    expect(perTrapGauss.every((e) => Number.isFinite(e) && e >= 0)).toBe(true)
    expect(new Set(perTrapGauss.map((x) => x.toFixed(6))).size).toBeGreaterThan(20)

    const oneTrapPerTrap = sampleSpringBankEnergy(
      DIRECT_ARM_1TRAP,
      { nominalEnergyJ: 2.12, energyVarianceJ: 0.1, energyDistribution: 'uniform' },
      makeRng(77),
      true
    )
    expect(oneTrapPerTrap).toBeGreaterThan(0)
  })

  it('validates invalid spring parameters cleanly', () => {
    expect(() => springTorque(90, -1, 0.5)).toThrow(RangeError)
    expect(() => springTorque(90, Number.NaN, 0.5)).toThrow(RangeError)
    expect(() => springTorque(90, 2.0, -0.1)).toThrow(RangeError)
    expect(() => springTorque(90, 2.0, 1.5)).toThrow(RangeError)
    expect(() => integrateSpringWork(180, 0, 2.0, 0.5, 0)).toThrow(RangeError)

    const spec = createTorsionSpringSpec(V51_CORD_HORN, 2.12)
    expect(instantaneousSpringTorque(spec, 7.0)).toBe(0)
    expect(springPotentialEnergy(spec, 7.0)).toBe(0)
    expect(springPotentialEnergy(spec, 171.0)).toBeGreaterThan(1.9)
  })

  it('matches integrateSpringWork when theta + springZeroOffsetDeg < 0 (Fix #6)', () => {
    const analyticNeg = springWork(180, 0, 2.12, 1, -10)
    const numericNeg = integrateSpringWork(180, 0, 2.12, 1, 1000, -10)
    expect(Math.abs(analyticNeg - numericNeg)).toBeLessThan(1e-6)

    const analyticCrossZero = springWork(10, -10, 2.12, 0.5, 0)
    const numericCrossZero = integrateSpringWork(10, -10, 2.12, 0.5, 1000, 0)
    expect(Math.abs(analyticCrossZero - numericCrossZero)).toBeLessThan(1e-6)
  })
})
