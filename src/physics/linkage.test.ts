import { describe, expect, it } from 'vitest'
import {
  DIRECT_ARM_RAIL,
  DIRECT_CUP_2TRAP,
  FLOOR_FLUSH_INCLINED_RAMP,
  GRAVITY_SLING_TREBUCHET,
  V41_TILTED_CRADLE,
  V50_CIRCULAR_CAM,
  V51_CORD_HORN,
  defaultAdjustments,
} from '../models'
import {
  bailSide,
  buildCordLinkageTable,
  camSide,
  computeDirectCupConfig,
  computeDirectRailConfig,
  computeHornLeverArmMm,
  computeInclinedRampConfig,
  computeTiltedCradleConfig,
  computeTrebuchetConfig,
  cordLen,
  hornSide,
} from './linkage'

describe('linkage kinematics across all 7 topologies', () => {
  it('supports 1-arg hornSide(psiDeg) and computeHornLeverArmMm with dead-center near 53 deg', () => {
    const h0 = hornSide(0)
    expect(h0.leverArmMm).toBeGreaterThan(0)
    expect(h0[2]).toBe(h0.leverArmMm)
    expect(computeHornLeverArmMm(0)).toBeCloseTo(h0.leverArmMm, 12)

    const hDead = hornSide(53.0)
    expect(Number.isFinite(hDead.leverArmMm)).toBe(true)
    expect(Math.abs(hDead.leverArmMm)).toBeLessThan(1.0)
  })

  it('matches Python cam_launch_sim.py cord_len and bail_side on v5.1 and v5.0', () => {
    const b171 = bailSide(171.0)
    expect(b171.leverArmMm).toBeCloseTo(10.4701, 3)
    expect(bailSide(90.0).leverArmMm).toBeCloseTo(43.6432, 3)
    const refCordV51 = cordLen(171.0, -8.2, V51_CORD_HORN)
    expect(refCordV51).toBeCloseTo(162.0828, 2)

    const tableV51 = buildCordLinkageTable(V51_CORD_HORN, -8.2, 48.0)
    expect(tableV51.reachable).toBe(true)
    expect(tableV51.thCockDeg).toBeCloseTo(171.0, 1)
    expect(tableV51.psiDeadDeg).toBeCloseTo(53.0, 0)
    const ev = tableV51.evalAtPsi(20)
    expect(ev.inRange).toBe(true)
    expect(ev.h1).toBeLessThan(0)

    const shortNotch6 = buildCordLinkageTable(V51_CORD_HORN, -8.2, 48.0, -25)
    expect(shortNotch6.reachable).toBe(false)

    const cam = camSide(0)
    expect(cam.leverArmMm).toBe(96.5)
    const tableV50 = buildCordLinkageTable(V50_CIRCULAR_CAM, -6.74, 48.0)
    expect(tableV50.reachable).toBe(true)
    expect(tableV50.thCockDeg).toBeCloseTo(156.0, 1)
  })

  it('computes direct_rail, direct_cup, tilted_cradle, inclined_ramp, and gravity_trebuchet kinematics', () => {
    const rail1A = computeDirectRailConfig(DIRECT_ARM_RAIL, { peg: 1, flip: 0, rolling: 1 })
    const rail10B = computeDirectRailConfig(DIRECT_ARM_RAIL, { peg: 10, flip: 1, rolling: 1 })
    expect(rail1A.x0M).toBeCloseTo(0.08027, 4)
    expect(rail10B.x0M).toBeGreaterThan(rail1A.x0M)
    expect(rail1A.cockedBallBottomHeightM).toBeLessThan(0.0762)

    const cup = computeDirectCupConfig(DIRECT_CUP_2TRAP, defaultAdjustments(DIRECT_CUP_2TRAP))
    expect(cup.thCockDeg).toBe(173)
    expect(cup.thStopDeg).toBe(132)
    expect(cup.cockedBallBottomHeightM).toBeLessThan(0.0762)

    const v41 = computeTiltedCradleConfig(V41_TILTED_CRADLE, defaultAdjustments(V41_TILTED_CRADLE))
    expect(v41.thStopDeg).toBeCloseTo(8.4 - 3.37, 6)

    const ramp = computeInclinedRampConfig(
      FLOOR_FLUSH_INCLINED_RAMP,
      defaultAdjustments(FLOOR_FLUSH_INCLINED_RAMP)
    )
    expect(ramp.rampAngleDeg).toBe(40)
    expect(ramp.cockedBallBottomHeightM).toBeCloseTo(0.024, 6)

    const treb = computeTrebuchetConfig(
      GRAVITY_SLING_TREBUCHET,
      defaultAdjustments(GRAVITY_SLING_TREBUCHET)
    )
    expect(treb.cockedBallBottomHeightM).toBeCloseTo(0.022, 6)
    expect(treb.beta0Rad).toBeGreaterThan(Math.PI / 2)
  })
})
