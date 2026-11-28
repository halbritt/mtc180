import { describe, expect, it } from 'vitest'
import {
  defaultAdjustments,
  getLauncherModel,
  type LauncherModel,
} from '../models'
import { autoSight } from './autosight'
import { simulateSequence } from './sequence'
import { createNominalEnv } from './simulate'

describe('sequence — Timed Multi-Shot Events', () => {
  it('enforces exact window boundaries (0s, short, and exact N * t_cycle vs N * t_cycle - 0.01)', () => {
    const v51 = getLauncherModel('v51_cord_horn')
    const fixed: LauncherModel = {
      ...v51,
      cycleTiming: { cockPerTrapS: 5, loadS: 5, aimAdjustS: 0, humanSigmaS: 0 },
      tolerances: {
        cockAngleSigmaDeg: 0,
        seatingOffsetSigmaM: 0,
        yawSigmaDeg: 0,
        stopAngleSigmaDeg: 0,
      },
    }
    const adj = defaultAdjustments(fixed)
    const env = createNominalEnv()

    const zero = simulateSequence(fixed, adj, env, { windowS: 0, seed: 1 })
    expect(zero.shotsCompleted).toBe(0)
    expect(zero.shotsAttempted).toBe(0)
    expect(zero.totalElapsedS).toBe(0)

    const shortWin = simulateSequence(fixed, adj, env, { windowS: 0.5, seed: 1 })
    expect(shortWin.shotsCompleted).toBe(0)
    expect(shortWin.shotsAttempted).toBe(1)

    // t_cycle = 5 * 3 + 5 = 20 s
    const exact6 = simulateSequence(fixed, adj, env, { windowS: 120, seed: 1 })
    expect(exact6.shotsCompleted).toBe(6)
    expect(exact6.shotsAttempted).toBe(6)
    expect(exact6.totalElapsedS).toBeCloseTo(120, 6)
    expect(exact6.elapsedS).toBe(exact6.totalElapsedS)

    const justUnder = simulateSequence(fixed, adj, env, {
      windowS: 119.99,
      seed: 1,
    })
    expect(justUnder.shotsCompleted).toBe(5)
    expect(justUnder.shotsAttempted).toBe(6)
    expect(justUnder.totalElapsedS).toBeCloseTo(100, 6)
  })

  it('alternates dual targets and scores hits accurately within targetRadiusM', () => {
    const v51 = getLauncherModel('v51_cord_horn')
    const env = createNominalEnv({
      energyVarianceJ: 0.03,
      turfScatterSigmaRad: 0.005,
    })
    const a1 = autoSight(v51, env, 2.2)
    const a2 = autoSight(v51, env, 4.2)

    const seq = simulateSequence(v51, a1.adjustments, env, {
      windowS: 210,
      targets: [
        { x: 2.2, y: 0 },
        { x: 4.2, y: 0 },
      ],
      targetAdjustments: [a1.adjustments, a2.adjustments],
      targetRadiusM: 0.6,
      seed: 123,
    })

    expect(seq.shotsCompleted).toBeGreaterThanOrEqual(4)
    expect(seq.totalElapsedS).toBeLessThanOrEqual(210 + 1e-6)
    expect(seq.target1Hits).toBeGreaterThan(0)
    expect(seq.target2Hits).toBeGreaterThan(0)
    expect(seq.target1Hits + seq.target2Hits).toBeLessThanOrEqual(
      seq.shotsCompleted
    )
  })

  it('rejects negative/non-finite windowS, non-positive targetRadiusM, and non-finite seed', () => {
    const v51 = getLauncherModel('v51_cord_horn')
    const adj = defaultAdjustments(v51)
    const env = createNominalEnv()
    expect(() =>
      simulateSequence(v51, adj, env, { windowS: -1, seed: 1 })
    ).toThrow(RangeError)
    expect(() =>
      simulateSequence(v51, adj, env, { windowS: 100, targetRadiusM: 0, seed: 1 })
    ).toThrow(RangeError)
    expect(() =>
      simulateSequence(v51, adj, env, { windowS: 100, seed: Number.NaN })
    ).toThrow(RangeError)
  })
})
