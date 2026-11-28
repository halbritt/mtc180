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
  buildCordLinkageTableInternal,
  camSide,
  clearCordLinkageCache,
  computeDirectCupConfig,
  computeDirectRailConfig,
  computeHornLeverArmMm,
  computeInclinedRampConfig,
  computeTiltedCradleConfig,
  computeTrebuchetConfig,
  cordLen,
  getCordLinkageCacheStats,
  hornSide,
  type CordLinkageTable,
} from './linkage'
import { solveLaunch } from './launch_solver'
import { createNominalEnv, createSeededRng } from './simulate'

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
    expect(treb.startsInTrough).toBe(true)
    expect(treb.zBall0M).toBeCloseTo(treb.troughCenterZM, 6)
    expect(treb.cockedBallBottomHeightM).toBeCloseTo(0.022, 6)
    expect(treb.beta0Rad).toBeGreaterThan(Math.PI / 2)

    const trebClamped = computeTrebuchetConfig(
      {
        ...GRAVITY_SLING_TREBUCHET,
        linkage: {
          ...(GRAVITY_SLING_TREBUCHET.linkage as Extract<
            typeof GRAVITY_SLING_TREBUCHET.linkage,
            { kind: 'gravity_trebuchet' }
          >),
          cockAngleDeg: 0,
        },
      },
      defaultAdjustments(GRAVITY_SLING_TREBUCHET)
    )
    expect(trebClamped.startsInTrough).toBe(false)
    expect(trebClamped.zBall0M).toBeGreaterThan(trebClamped.troughCenterZM)
  })
})

interface TableSnapshot {
  cordLengthMm: number
  psiCockDeg: number
  psiStopDeg: number
  psiDeadDeg: number
  psiEndDeg: number
  thCockDeg: number
  reachable: boolean
  psisDeg: Float64Array
  thOfPsiDeg: Float64Array
  levBMm: Float64Array
  levHMm: Float64Array
  h1: Float64Array
  h2: Float64Array
  evals: ReturnType<CordLinkageTable['evalAtPsi']>[]
}

function snapshotTable(table: CordLinkageTable, probePsis: readonly number[]): TableSnapshot {
  return {
    cordLengthMm: table.cordLengthMm,
    psiCockDeg: table.psiCockDeg,
    psiStopDeg: table.psiStopDeg,
    psiDeadDeg: table.psiDeadDeg,
    psiEndDeg: table.psiEndDeg,
    thCockDeg: table.thCockDeg,
    reachable: table.reachable,
    psisDeg: new Float64Array(table.psisDeg),
    thOfPsiDeg: new Float64Array(table.thOfPsiDeg),
    levBMm: new Float64Array(table.levBMm),
    levHMm: new Float64Array(table.levHMm),
    h1: new Float64Array(table.h1),
    h2: new Float64Array(table.h2),
    evals: probePsis.map((psi) => table.evalAtPsi(psi)),
  }
}

function expectBitIdenticalTable(
  actual: CordLinkageTable,
  snap: TableSnapshot,
  probePsis: readonly number[]
): void {
  expect(Object.is(actual.cordLengthMm, snap.cordLengthMm)).toBe(true)
  expect(Object.is(actual.psiCockDeg, snap.psiCockDeg)).toBe(true)
  expect(Object.is(actual.psiStopDeg, snap.psiStopDeg)).toBe(true)
  expect(Object.is(actual.psiDeadDeg, snap.psiDeadDeg)).toBe(true)
  expect(Object.is(actual.psiEndDeg, snap.psiEndDeg)).toBe(true)
  expect(Object.is(actual.thCockDeg, snap.thCockDeg)).toBe(true)
  expect(actual.reachable).toBe(snap.reachable)

  const arrayPairs: readonly (readonly [Float64Array, Float64Array])[] = [
    [actual.psisDeg, snap.psisDeg],
    [actual.thOfPsiDeg, snap.thOfPsiDeg],
    [actual.levBMm, snap.levBMm],
    [actual.levHMm, snap.levHMm],
    [actual.h1, snap.h1],
    [actual.h2, snap.h2],
  ]
  for (const [a, b] of arrayPairs) {
    expect(a.length).toBe(b.length)
    for (let i = 0; i < a.length; i++) {
      if (!Object.is(a[i], b[i])) {
        throw new Error(`Float64Array mismatch at index ${i}: ${a[i]} !== ${b[i]}`)
      }
    }
  }

  for (let k = 0; k < probePsis.length; k++) {
    const ev = actual.evalAtPsi(probePsis[k])
    const ref = snap.evals[k]
    expect(ev.inRange).toBe(ref.inRange)
    expect(Object.is(ev.thDeg, ref.thDeg)).toBe(true)
    expect(Object.is(ev.levBMm, ref.levBMm)).toBe(true)
    expect(Object.is(ev.levHMm, ref.levHMm)).toBe(true)
    expect(Object.is(ev.h1, ref.h1)).toBe(true)
    expect(Object.is(ev.h2, ref.h2)).toBe(true)
  }
}

describe('buildCordLinkageTable memoization & LRU cache', () => {
  it('preserves bit-identical Object.is outputs and prevents model-clone/-0/non-finite collisions', () => {
    const probePsis = [-100, -8.2, 0, 20, 48, 80]
    const cases = [
      { model: V51_CORD_HORN, psiCock: -8.2, psiStop: 48.0, offset: undefined, reachable: true },
      { model: V51_CORD_HORN, psiCock: -8.2, psiStop: 48.0, offset: -25, reachable: false },
      { model: V50_CIRCULAR_CAM, psiCock: -6.74, psiStop: 48.0, offset: undefined, reachable: true },
    ] as const

    for (const c of cases) {
      clearCordLinkageCache()
      const cold = buildCordLinkageTable(c.model, c.psiCock, c.psiStop, c.offset)
      expect(cold.reachable).toBe(c.reachable)
      expect(Object.isFrozen(cold)).toBe(true)
      const snap = snapshotTable(cold, probePsis)

      const warm = buildCordLinkageTable(c.model, c.psiCock, c.psiStop, c.offset)
      expect(warm).not.toBe(cold)
      expectBitIdenticalTable(warm, snap, probePsis)

      const internal1 = buildCordLinkageTableInternal(c.model, c.psiCock, c.psiStop, c.offset)
      const internal2 = buildCordLinkageTableInternal(c.model, c.psiCock, c.psiStop, c.offset)
      expect(internal2).toBe(internal1)
      expectBitIdenticalTable(internal2, snap, probePsis)

      clearCordLinkageCache()
      const rebuilt = buildCordLinkageTable(c.model, c.psiCock, c.psiStop, c.offset)
      expect(rebuilt).not.toBe(cold)
      expectBitIdenticalTable(rebuilt, snap, probePsis)
    }

    clearCordLinkageCache()
    const base = buildCordLinkageTable(V51_CORD_HORN, -8.2, 48.0)
    const v51Lk = V51_CORD_HORN.linkage as Extract<typeof V51_CORD_HORN.linkage, { kind: 'cord_horn' }>
    const clonedOffset = {
      ...V51_CORD_HORN,
      linkage: { ...v51Lk, cordLengthOffsetMm: 4.0 },
    }
    const tOffset = buildCordLinkageTable(clonedOffset, -8.2, 48.0)
    expect(tOffset).not.toBe(base)
    expect(tOffset.cordLengthMm).not.toBe(base.cordLengthMm)

    const clonedRoller = {
      ...V51_CORD_HORN,
      linkage: { ...v51Lk, rollerPosMm: [v51Lk.rollerPosMm[0] + 2, v51Lk.rollerPosMm[1]] as const },
    }
    const tRoller = buildCordLinkageTable(clonedRoller, -8.2, 48.0)
    expect(tRoller).not.toBe(base)
    expect(tRoller.cordLengthMm).not.toBe(base.cordLengthMm)

    const tPosZero = buildCordLinkageTable(V51_CORD_HORN, +0, 48.0)
    const tNegZero = buildCordLinkageTable(V51_CORD_HORN, -0, 48.0)
    expect(tNegZero).not.toBe(tPosZero)
    expect(Object.is(tPosZero.psiCockDeg, +0)).toBe(true)
    expect(Object.is(tNegZero.psiCockDeg, -0)).toBe(true)

    clearCordLinkageCache()
    const nan1 = buildCordLinkageTable(V51_CORD_HORN, Number.NaN, 48.0)
    const nan2 = buildCordLinkageTable(V51_CORD_HORN, Number.NaN, 48.0)
    expect(nan2).not.toBe(nan1)
    expect(getCordLinkageCacheStats().tableCacheSize).toBe(0)
    expect(getCordLinkageCacheStats().bailSweepCacheSize).toBe(0)
  })

  it('delivers >10x cache hit speedup on repeated batch builds', () => {
    const iterations = 40
    const coldStart = performance.now()
    for (let i = 0; i < iterations; i++) {
      clearCordLinkageCache()
      buildCordLinkageTable(V51_CORD_HORN, -8.2, 48.0)
      buildCordLinkageTable(V50_CIRCULAR_CAM, -6.74, 48.0)
    }
    const coldMs = performance.now() - coldStart

    const warmStart = performance.now()
    for (let i = 0; i < iterations; i++) {
      buildCordLinkageTable(V51_CORD_HORN, -8.2, 48.0)
      buildCordLinkageTable(V50_CIRCULAR_CAM, -6.74, 48.0)
    }
    const warmMs = performance.now() - warmStart

    expect(coldMs).toBeGreaterThan(warmMs * 10)
  })

  it('enforces bounded cache sizes and true LRU eviction on both cache tiers', () => {
    clearCordLinkageCache()
    const { maxTableCacheSize, maxBailSweepCacheSize } = getCordLinkageCacheStats()

    const entry0 = buildCordLinkageTableInternal(V51_CORD_HORN, -8.2, 48.0)
    const entry1 = buildCordLinkageTableInternal(V51_CORD_HORN, -8.19, 48.0)
    for (let i = 2; i < maxTableCacheSize; i++) {
      buildCordLinkageTableInternal(V51_CORD_HORN, -8.2 + i * 0.01, 48.0)
    }

    // Refresh entry1 mid-way so entry0 becomes the least-recently-used entry
    expect(buildCordLinkageTableInternal(V51_CORD_HORN, -8.19, 48.0)).toBe(entry1)

    for (let i = maxTableCacheSize; i < maxTableCacheSize + 20; i++) {
      buildCordLinkageTableInternal(V51_CORD_HORN, -8.2 + i * 0.01, 48.0)
    }

    const stats = getCordLinkageCacheStats()
    expect(stats.tableCacheSize).toBe(maxTableCacheSize)
    expect(stats.bailSweepCacheSize).toBeLessThanOrEqual(maxBailSweepCacheSize)

    // Refreshed entry stayed cached; untouched oldest entry was evicted
    expect(buildCordLinkageTableInternal(V51_CORD_HORN, -8.19, 48.0)).toBe(entry1)
    expect(buildCordLinkageTableInternal(V51_CORD_HORN, -8.2, 48.0)).not.toBe(entry0)

    // Verify Level-1 bailSweepCache bound and LRU eviction
    clearCordLinkageCache()
    const v51Lk = V51_CORD_HORN.linkage as Extract<typeof V51_CORD_HORN.linkage, { kind: 'cord_horn' }>
    for (let i = 0; i < maxBailSweepCacheSize + 10; i++) {
      const cloned = {
        ...V51_CORD_HORN,
        linkage: {
          ...v51Lk,
          rollerPosMm: [v51Lk.rollerPosMm[0] + i * 0.05, v51Lk.rollerPosMm[1]] as const,
        },
      }
      buildCordLinkageTable(cloned, -8.2, 48.0)
    }
    expect(getCordLinkageCacheStats().bailSweepCacheSize).toBe(maxBailSweepCacheSize)
  })

  it('prevents external Float64Array mutation from poisoning cached tables or solveLaunch', () => {
    clearCordLinkageCache()
    const env = createNominalEnv({ deterministic: true })
    const baseline = solveLaunch(V51_CORD_HORN, { notch: 6, launchDeg: 42, yawDeg: 0 }, env, createSeededRng(1))

    const publicTable = buildCordLinkageTable(V51_CORD_HORN, -8.2, 48.0)
    const snap = snapshotTable(publicTable, [-8.2, 0, 20, 48])

    // Attempt to poison every Float64Array buffer on the returned public table
    publicTable.psisDeg.fill(-999)
    publicTable.thOfPsiDeg.fill(7.0)
    publicTable.levBMm.fill(0)
    publicTable.levHMm.fill(0)
    publicTable.h1.fill(0)
    publicTable.h2.fill(999)

    // Even evalAtPsi on the mutated wrapper reads immutable master buffers
    expect(Object.is(publicTable.evalAtPsi(20).thDeg, snap.evals[2].thDeg)).toBe(true)

    const freshPublic = buildCordLinkageTable(V51_CORD_HORN, -8.2, 48.0)
    expectBitIdenticalTable(freshPublic, snap, [-8.2, 0, 20, 48])

    const afterPoison = solveLaunch(V51_CORD_HORN, { notch: 6, launchDeg: 42, yawDeg: 0 }, env, createSeededRng(1))
    expect(afterPoison.leftCradle).toBe(true)
    expect(afterPoison.launchSpeedMps).toBe(baseline.launchSpeedMps)
  })

  it('preserves user cockAngleDeg in computeDirectCupConfig when stopAngleDeg >= cockAngleDeg', () => {
    const blocked = computeDirectCupConfig(DIRECT_CUP_2TRAP, {
      stopAngleDeg: 150,
      cockAngleDeg: 145,
      yawDeg: 0,
    })
    expect(blocked.thStopDeg).toBe(150)
    expect(blocked.thCockDeg).toBe(145)

    const equal = computeDirectCupConfig(DIRECT_CUP_2TRAP, {
      stopAngleDeg: 145,
      cockAngleDeg: 145,
      yawDeg: 0,
    })
    expect(equal.thStopDeg).toBe(145)
    expect(equal.thCockDeg).toBe(145)
  })
})
