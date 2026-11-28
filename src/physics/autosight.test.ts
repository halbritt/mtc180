import { describe, expect, it } from 'vitest'
import {
  getLauncherModel,
  LAUNCHER_MODELS,
  validateAndClampAdjustments,
  type LauncherModel,
} from '../models'
import { autoSight } from './autosight'
import { createNominalEnv, simulateShot } from './simulate'

describe('autosight — Nominal Parameter Calibration', () => {
  it('hits target distances on discrete models (v51_cord_horn, direct_arm_rail) and selects peg >= 8 for 0.60 m', () => {
    const env = createNominalEnv({ turfScatterSigmaRad: 0 })

    const v51 = getLauncherModel('v51_cord_horn')
    for (const targetM of [2.2, 3.5, 4.2]) {
      const res = autoSight(v51, env, targetM)
      expect(res.reachable, `v51 ${targetM}m`).toBe(true)
      expect(() => validateAndClampAdjustments(v51, res.adjustments)).not.toThrow()
      const shot = simulateShot(v51, res.adjustments, env, { x: targetM, y: 0 }, 1)
      expect(Math.abs(shot.totalDistanceM - targetM)).toBeLessThan(0.5)
    }

    const direct = getLauncherModel('direct_arm_rail')
    for (const targetM of [0.6, 2.5, 4.1]) {
      const res = autoSight(direct, env, targetM)
      expect(res.reachable, `direct ${targetM}m`).toBe(true)
      expect(() => validateAndClampAdjustments(direct, res.adjustments)).not.toThrow()
      const shot = simulateShot(direct, res.adjustments, env, { x: targetM, y: 0 }, 1)
      expect(Math.abs(shot.totalDistanceM - targetM)).toBeLessThan(0.5)
    }
    const nearMin = autoSight(direct, env, 0.6)
    expect(nearMin.adjustments.peg).toBeGreaterThanOrEqual(8)
  })

  it('optimizes continuous and all registered launcher models within DOF bounds', () => {
    const env = createNominalEnv({ turfScatterSigmaRad: 0 })
    const continuousModels = LAUNCHER_MODELS.filter((m) =>
      m.adjustments.some((a) => a.kind === 'continuous' && a.id !== 'yawDeg')
    )
    expect(continuousModels.length).toBeGreaterThanOrEqual(4)

    for (const model of LAUNCHER_MODELS) {
      const res = autoSight(model, env, 2.5)
      expect(() => validateAndClampAdjustments(model, res.adjustments)).not.toThrow()
      expect(Number.isFinite(res.predictedDistanceM)).toBe(true)
      expect(Number.isFinite(res.errorM)).toBe(true)
      expect(res.message.length).toBeGreaterThan(0)
      expect(res.statusMessage).toBe(res.message)
    }
  })

  it('compensates yawDeg under crosswind and flags unreachable targets cleanly', () => {
    const v51 = getLauncherModel('v51_cord_horn')
    const crossEnv = createNominalEnv({
      windVecMps: [0, 3.5, 0],
      turfScatterSigmaRad: 0,
    })
    const windSight = autoSight(v51, crossEnv, 3.5)
    expect(windSight.reachable).toBe(true)
    expect(windSight.adjustments.yawDeg).toBeLessThan(0)

    const unreachable = autoSight(v51, createNominalEnv(), 20.0)
    expect(unreachable.reachable).toBe(false)
    expect(unreachable.message).toMatch(/unreachable|out of range/i)

    expect(() => autoSight(v51, createNominalEnv(), -1)).toThrow(RangeError)
    expect(() => autoSight(v51, createNominalEnv(), Number.NaN)).toThrow(RangeError)
  })

  it('optimizes both discrete and continuous DOFs off defaults on a hybrid model', () => {
    const base = getLauncherModel('v41_tilted_cradle')
    const hybrid: LauncherModel = {
      ...base,
      id: 'v41_hybrid_test',
      adjustments: base.adjustments.map((def) =>
        def.id === 'launchDeg'
          ? {
              ...def,
              kind: 'discrete' as const,
              options: [20, 42, 65],
              min: 20,
              max: 65,
              defaultValue: 20,
            }
          : def
      ),
    }
    const env = createNominalEnv({ turfScatterSigmaRad: 0 })
    const res = autoSight(hybrid, env, 4.2)
    expect(res.reachable).toBe(true)
    expect(res.adjustments.launchDeg).not.toBe(20)
    expect(res.adjustments.stopDeg).not.toBe(8.4)
    expect(res.errorM).toBeLessThan(0.5)
  })

  it('rejects backward headwind blowback and extreme crosswind off-axis shots via signed/2D error', () => {
    const v51 = getLauncherModel('v51_cord_horn')

    const headRes = autoSight(
      v51,
      createNominalEnv({ windVecMps: [-45, 0, 0], turfScatterSigmaRad: 0 }),
      3.0
    )
    expect(headRes.reachable).toBe(false)
    expect(headRes.predictedDistanceM).toBeLessThan(0)

    const crossRes = autoSight(
      v51,
      createNominalEnv({ windVecMps: [0, -22, 0], turfScatterSigmaRad: 0 }),
      3.0
    )
    expect(crossRes.reachable).toBe(false)
    expect(crossRes.errorM).toBeGreaterThan(1)
  })
})
