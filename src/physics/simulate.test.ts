import { describe, expect, it } from 'vitest'
import {
  defaultAdjustments,
  getLauncherModel,
  LAUNCHER_MODELS,
  type LauncherModel,
} from '../models'
import { evaluatePractice } from './practice'
import { positionAt } from './replay'
import { createNominalEnv, simulateShot } from './simulate'
import { measure } from './telemetry'

describe('simulate — Full Shot Pipeline', () => {
  it('simulates all 9 registered launcher models seamlessly through telemetry, practice, and replay', () => {
    const env = createNominalEnv()
    for (const model of LAUNCHER_MODELS) {
      const res = simulateShot(
        model,
        defaultAdjustments(model),
        env,
        { x: 4.0, y: 0 },
        101
      )
      expect(res.release.leftCradle, model.id).toBe(true)
      expect(res.trace.length).toBeGreaterThanOrEqual(2)
      expect(res.trace.length).toBeLessThan(10_000)
      expect(res.trace[res.trace.length - 1].event).toBe('rest')
      expect(res.bouncePoints.length).toBeGreaterThanOrEqual(1)
      expect(res.carryDistanceM).toBeGreaterThan(0.5)
      expect(res.totalDistanceM).toBeGreaterThanOrEqual(res.carryDistanceM)
      expect(res.energyEfficiencyPct).toBeGreaterThan(0)
      expect(res.energyEfficiencyPct).toBeLessThan(100)
      expect(res.armFrames.length).toBeGreaterThan(10)
      expect(res.cycleTimeS).toBeGreaterThan(0)

      const m = measure(res.trace, { x: 4.0, y: 0 })
      expect(m.carry).toBeCloseTo(res.carryDistanceM, 6)
      expect(m.rollout).toBeCloseTo(res.rollDistanceM, 6)
      expect(m.total).toBeCloseTo(res.totalDistanceM, 6)

      const firstContact = res.trace.find((s) => s.event === 'contact')!
      const pos = positionAt(res.trace, firstContact.t - res.trace[0].t)
      expect(pos.x).toBeCloseTo(firstContact.x, 5)

      const rest = res.trace[res.trace.length - 1]
      const prac = evaluatePractice(
        res.trace,
        {
          x: rest.x - res.trace[0].x,
          y: rest.y - res.trace[0].y,
          shape: 'circle',
          radius: 0.05,
        },
        'rest'
      )
      expect(prac.hit).toBe(true)
    }
  })

  it('is bit-identical for identical seeds and strictly positive on extreme humanSigmaS jitter', () => {
    const v51 = getLauncherModel('v51_cord_horn')
    const adj = defaultAdjustments(v51)
    const env = createNominalEnv({ energyVarianceJ: 0.1 })

    const a = simulateShot(v51, adj, env, { x: 4.5, y: 0 }, 4242)
    const b = simulateShot(v51, adj, env, { x: 4.5, y: 0 }, 4242)
    expect(a.totalDistanceM).toBe(b.totalDistanceM)
    expect(a.trace).toEqual(b.trace)

    const wildTiming: LauncherModel = {
      ...v51,
      cycleTiming: { cockPerTrapS: 1, loadS: 1, aimAdjustS: 1, humanSigmaS: 100 },
    }
    for (let seed = 1; seed <= 20; seed++) {
      const r = simulateShot(wildTiming, adj, env, { x: 4.0, y: 0 }, seed)
      expect(r.cycleTimeS).toBeGreaterThan(0)
    }
  })

  it('handles non-ejection / unreachable configs gracefully and validates env upfront', () => {
    const direct = getLauncherModel('direct_arm_rail')
    const res = simulateShot(
      direct,
      { peg: 10, flip: 1, rolling: 1, yawDeg: 0 },
      createNominalEnv({ nominalEnergyJ: 0.1 }),
      { x: 2.0, y: 0 },
      7
    )
    expect(res.release.leftCradle).toBe(false)
    expect(res.carryDistanceM).toBe(0)
    expect(res.rollDistanceM).toBe(0)
    expect(res.totalDistanceM).toBe(0)
    expect(res.energyEfficiencyPct).toBe(0)
    expect(res.trace.length).toBeGreaterThanOrEqual(2)
    const m = measure(res.trace, { x: 2.0, y: 0 })
    expect(m.total).toBe(0)

    const v51 = getLauncherModel('v51_cord_horn')
    expect(() =>
      simulateShot(
        v51,
        defaultAdjustments(v51),
        createNominalEnv({ turfMuR: 0 }),
        { x: 4.0, y: 0 },
        1
      )
    ).toThrow(RangeError)
    expect(() =>
      simulateShot(
        v51,
        defaultAdjustments(v51),
        createNominalEnv({ turfEn: 1.5 }),
        { x: 4.0, y: 0 },
        1
      )
    ).toThrow(RangeError)
  })

  it('contains zero DOM globals, node:* imports, or external physics engine dependencies across all M3 modules', () => {
    const sources = import.meta.glob<string>('./*.ts', {
      query: '?raw',
      import: 'default',
      eager: true,
    })
    const m3Files = [
      'aero.ts',
      'turf.ts',
      'simulate.ts',
      'autosight.ts',
      'sequence.ts',
    ]
    const forbidden = [
      /\bwindow\b/,
      /\bdocument\b/,
      /\bHTMLElement\b/,
      /\bnode:/,
      /cannon-es/,
      /rapier/i,
      /ammo\.js/i,
      /matter-js/i,
    ]
    for (const name of m3Files) {
      const key = `./${name}`
      expect(sources[key], `Missing ${key}`).toBeDefined()
      for (const pat of forbidden) {
        expect(sources[key], `${key} matched ${pat}`).not.toMatch(pat)
      }
    }
  })
})
