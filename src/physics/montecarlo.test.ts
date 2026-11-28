import { describe, expect, it } from 'vitest'
import {
  defaultAdjustments,
  getLauncherModel,
  LAUNCHER_MODELS,
  type LauncherModel,
} from '../models'
import workerSource from '../workers/montecarlo.worker.ts?raw'
import {
  deriveTrialSeed,
  runMonteCarlo,
  type MonteCarloRequest,
} from './montecarlo'
import montecarloSource from './montecarlo.ts?raw'
import { createNominalEnv, simulateShot } from './simulate'

describe('montecarlo — Pure Monte Carlo Engine', () => {
  it('matches simulateShot bit-for-bit at dtS = 0.0005 across all 7 topologies', () => {
    const topologies = new Map<string, LauncherModel>()
    for (const m of LAUNCHER_MODELS) {
      if (!topologies.has(m.topology)) topologies.set(m.topology, m)
    }
    expect(topologies.size).toBe(7)

    const env = createNominalEnv({
      energyVarianceJ: 0.08,
      turfScatterSigmaRad: 0.015,
      dtS: 0.0005,
    })
    const baseSeed = 4242
    const target = { x: 4.5, y: 0 }

    for (const model of topologies.values()) {
      const adj = defaultAdjustments(model)
      const trialSeed = deriveTrialSeed(baseSeed, 0, 0)
      const directShot = simulateShot(model, adj, env, target, trialSeed)
      const [summary] = runMonteCarlo({
        jobId: `equiv-${model.id}`,
        models: [model],
        adjustmentsByModel: { [model.id]: adj },
        env,
        rubricConfig: { task: 'day1_distance', target, fieldHalfWidthM: 3.0 },
        trialsPerModel: 1,
        baseSeed,
      })
      const l = summary.landings[0]
      const rest = directShot.trace[directShot.trace.length - 1]
      expect(l.restX).toBeCloseTo(rest.x, 12)
      expect(l.restY).toBeCloseTo(rest.y, 12)
      expect(l.carryM).toBeCloseTo(directShot.carryDistanceM, 12)
      expect(l.totalM).toBeCloseTo(directShot.totalDistanceM, 12)
    }
  })

  it('produces identical results for identical baseSeed and distinct results for different baseSeeds', () => {
    const v51 = getLauncherModel('v51_cord_horn')
    const adj = defaultAdjustments(v51)
    const env = createNominalEnv({ energyVarianceJ: 0.1 })

    const req: MonteCarloRequest = {
      jobId: 'det-check',
      models: [v51],
      adjustmentsByModel: { [v51.id]: adj },
      env,
      rubricConfig: { task: 'day1_distance', timeWindowS: 210 },
      trialsPerModel: 25,
      baseSeed: 777,
    }

    const a = runMonteCarlo(req)
    const b = runMonteCarlo({ ...req, jobId: 'det-check-2' })
    const c = runMonteCarlo({ ...req, jobId: 'det-check-3', baseSeed: 778 })

    expect(a).toEqual(b)
    expect(a[0].landings).not.toEqual(c[0].landings)
  })

  it('computes exact linear-interpolation quantiles and handles N=1 cleanly', () => {
    const v51 = getLauncherModel('v51_cord_horn')
    const [single] = runMonteCarlo({
      jobId: 'n1',
      models: [v51],
      adjustmentsByModel: { [v51.id]: defaultAdjustments(v51) },
      env: createNominalEnv({ energyVarianceJ: 0.05 }),
      rubricConfig: { task: 'day1_distance', timeWindowS: 210 },
      trialsPerModel: 1,
      baseSeed: 123,
    })
    expect(single.landings).toHaveLength(1)
    expect(single.p10Score).toBe(single.meanScore)
    expect(single.medianScore).toBe(single.meanScore)
    expect(single.p90Score).toBe(single.meanScore)
    expect(single.cep95Ellipse.semiMajorM).toBe(0)
    expect(single.cep95Ellipse.semiMinorM).toBe(0)
    expect(single.cep95Ellipse.angleRad).toBe(0)
    expect(Number.isFinite(single.shotsInWindow)).toBe(true)
  })

  it('handles 0-hit, OOB, non-ejection, zero-roll, and zero-time-window boundaries cleanly', () => {
    const direct = getLauncherModel('direct_arm_rail')
    const [nonEject] = runMonteCarlo({
      jobId: 'non-eject',
      models: [direct],
      adjustmentsByModel: { [direct.id]: { ...defaultAdjustments(direct), peg: 10, flip: 1 } },
      env: createNominalEnv({ nominalEnergyJ: 0.2, energyVarianceJ: 0 }),
      rubricConfig: { task: 'day2_accuracy', target: { x: 25, y: 0 }, timeWindowS: 0 },
      trialsPerModel: 10,
      baseSeed: 55,
    })
    expect(nonEject.missRate).toBe(1)
    expect(nonEject.meanScore).toBe(0)
    expect(nonEject.carryToRollRatio).toBe(0)
    expect(nonEject.shotsInWindow).toBe(0)
    expect(Number.isFinite(nonEject.cep95Ellipse.semiMajorM)).toBe(true)

    const v51 = getLauncherModel('v51_cord_horn')
    const yawed: LauncherModel = {
      ...v51,
      tolerances: { ...v51.tolerances, yawSigmaDeg: 5 },
    }
    const [oob] = runMonteCarlo({
      jobId: 'oob-check',
      models: [yawed],
      adjustmentsByModel: { [yawed.id]: defaultAdjustments(yawed) },
      env: createNominalEnv({ energyVarianceJ: 0.05 }),
      rubricConfig: { task: 'day1_distance', fieldHalfWidthM: 0.05 },
      trialsPerModel: 40,
      baseSeed: 88,
    })
    expect(oob.oobRate).toBeGreaterThan(0)
    expect(oob.missRate).toBe(oob.oobRate)
  })

  it('computes rotated 95% CEP ellipse enclosing ~95% of bivariate spread and zero-area on zero variance', () => {
    const v51 = getLauncherModel('v51_cord_horn')
    const [spread] = runMonteCarlo({
      jobId: 'cep-spread',
      models: [v51],
      adjustmentsByModel: { [v51.id]: { notch: 6, launchDeg: 42, yawDeg: 5 } },
      env: createNominalEnv({ energyVarianceJ: 0.1, energyDistribution: 'gaussian' }),
      rubricConfig: { task: 'day1_distance' },
      trialsPerModel: 300,
      baseSeed: 999,
    })
    const { centerX, centerY, semiMajorM, semiMinorM, angleRad } = spread.cep95Ellipse
    expect(semiMajorM).toBeGreaterThan(semiMinorM)
    expect(semiMinorM).toBeGreaterThan(0)
    const cosA = Math.cos(angleRad)
    const sinA = Math.sin(angleRad)
    let inside = 0
    for (const l of spread.landings) {
      const dx = l.restX - centerX
      const dy = l.restY - centerY
      const u = dx * cosA + dy * sinA
      const v = -dx * sinA + dy * cosA
      if ((u / semiMajorM) ** 2 + (v / semiMinorM) ** 2 <= 1.0001) inside++
    }
    const frac = inside / spread.landings.length
    expect(frac).toBeGreaterThanOrEqual(0.88)
    expect(frac).toBeLessThanOrEqual(0.995)

    const clean: LauncherModel = {
      ...v51,
      cycleTiming: { ...v51.cycleTiming, humanSigmaS: 0 },
      tolerances: { cockAngleSigmaDeg: 0, seatingOffsetSigmaM: 0, yawSigmaDeg: 0, stopAngleSigmaDeg: 0 },
    }
    const [zeroVar] = runMonteCarlo({
      jobId: 'zero-var',
      models: [clean],
      adjustmentsByModel: { [clean.id]: defaultAdjustments(clean) },
      env: createNominalEnv({ energyVarianceJ: 0, turfScatterSigmaRad: 0 }),
      rubricConfig: { task: 'day1_distance' },
      trialsPerModel: 25,
      baseSeed: 1,
    })
    expect(zeroVar.cep95Ellipse.semiMajorM).toBeLessThan(1e-4)
    expect(zeroVar.cep95Ellipse.semiMinorM).toBeLessThan(1e-4)
    expect(zeroVar.cep95Ellipse.angleRad).toBe(0)
  })

  it('throttles onProgress monotonically and always finishes at completed === total', () => {
    const v51 = getLauncherModel('v51_cord_horn')
    const direct = getLauncherModel('direct_arm_rail')
    const events: Array<[number, number]> = []
    runMonteCarlo(
      {
        jobId: 'progress-test',
        models: [v51, direct],
        adjustmentsByModel: {
          [v51.id]: defaultAdjustments(v51),
          [direct.id]: defaultAdjustments(direct),
        },
        env: createNominalEnv({ energyVarianceJ: 0.05 }),
        rubricConfig: { task: 'day1_distance' },
        trialsPerModel: 20,
        baseSeed: 101,
      },
      (completed, total) => events.push([completed, total])
    )
    expect(events.length).toBeGreaterThan(0)
    expect(events.length).toBeLessThanOrEqual(21)
    let prev = 0
    for (const [c, t] of events) {
      expect(t).toBe(40)
      expect(c).toBeGreaterThanOrEqual(prev)
      expect(c).toBeLessThanOrEqual(t)
      prev = c
    }
    expect(events[events.length - 1]).toEqual([40, 40])
  })

  it('validates invalid requests upfront', () => {
    const v51 = getLauncherModel('v51_cord_horn')
    const validBase: MonteCarloRequest = {
      jobId: 'valid',
      models: [v51],
      adjustmentsByModel: { [v51.id]: defaultAdjustments(v51) },
      env: createNominalEnv(),
      rubricConfig: { task: 'day1_distance' },
      trialsPerModel: 5,
      baseSeed: 1,
    }
    expect(() => runMonteCarlo({ ...validBase, jobId: '' })).toThrow()
    expect(() => runMonteCarlo({ ...validBase, models: [] })).toThrow()
    expect(() => runMonteCarlo({ ...validBase, trialsPerModel: 0 })).toThrow()
    expect(() => runMonteCarlo({ ...validBase, baseSeed: Number.NaN })).toThrow()
    expect(() =>
      runMonteCarlo({ ...validBase, rubricConfig: { task: 'day1_distance', fieldHalfWidthM: 0 } })
    ).toThrow()
  })

  it('contains zero DOM globals and zero node:* imports in montecarlo.ts and montecarlo.worker.ts', () => {
    for (const src of [montecarloSource, workerSource]) {
      expect(src).not.toMatch(/['"]node:/)
      expect(src).not.toMatch(/\b(window|document|HTMLElement)\b/)
    }
  })
})
