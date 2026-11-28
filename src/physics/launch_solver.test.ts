import { describe, expect, it } from 'vitest'
import {
  DIRECT_ARM_1TRAP,
  DIRECT_ARM_RAIL,
  DIRECT_CUP_2TRAP,
  FLOOR_FLUSH_INCLINED_RAMP,
  GRAVITY_SLING_TREBUCHET,
  LAUNCHER_MODELS,
  V41_TILTED_CRADLE,
  V50_CIRCULAR_CAM,
  V51_CORD_HORN,
  defaultAdjustments,
  type LauncherModel,
} from '../models'
import {
  solveLaunch,
  validateDt,
  type EnergyBudget,
  type EnvConfig,
} from './launch_solver'

function makeRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeEnv(overrides: Partial<EnvConfig> = {}): EnvConfig {
  return {
    nominalEnergyJ: 2.12,
    energyVarianceJ: 0,
    energyDistribution: 'uniform',
    turfEn: 0.32,
    turfMuR: 0.12,
    turfScatterSigmaRad: 0.015,
    windVecMps: [0, 0, 0],
    airDensityKgM3: 1.225,
    projectile: 'golf_ball',
    gravityMps2: 9.80665,
    ...overrides,
  }
}

function sumEnergy(b: EnergyBudget): number {
  return (
    b.keTransBallJ +
    b.keRotBallJ +
    b.keRotArmBailsJ +
    b.peGravityDeltaJ +
    b.frictionLossJ
  )
}

function zeroFrictionDeterministic(model: LauncherModel): LauncherModel {
  return {
    ...model,
    trapBank: { ...model.trapBank, bearingFrictionNm: 0 },
    tolerances: {
      cockAngleSigmaDeg: 0,
      seatingOffsetSigmaM: 0,
      yawSigmaDeg: 0,
      stopAngleSigmaDeg: 0,
    },
    cycleTiming: { ...model.cycleTiming, humanSigmaS: 0 },
  }
}

describe('launch_solver (Test 2: Energy Budget Conservation)', () => {
  it('conserves energy within < 1% at release across all 9 registered models', () => {
    const env = makeEnv()
    for (const model of LAUNCHER_MODELS) {
      const rel = solveLaunch(
        model,
        defaultAdjustments(model),
        env,
        makeRng(33)
      )
      expect(rel.leftCradle).toBe(true)
      const initial = rel.energyBudget.springInitialJ
      const accounted = sumEnergy(rel.energyBudget)
      expect(initial).toBeGreaterThan(0)
      const relErr = Math.abs(accounted - initial) / initial
      expect(relErr, `${model.id} energy error ${relErr}`).toBeLessThan(0.01)
    }
  })

  it('conserves energy within < 1% under mid-stroke slack, snap-taut overrun, and high friction', () => {
    const env = makeEnv()
    const v50Slack = solveLaunch(
      V50_CIRCULAR_CAM,
      defaultAdjustments(V50_CIRCULAR_CAM),
      env,
      makeRng(12)
    )
    expect(v50Slack.cordSlackAtDeg).not.toBeNull()
    expect(
      Math.abs(sumEnergy(v50Slack.energyBudget) - v50Slack.energyBudget.springInitialJ) /
        v50Slack.energyBudget.springInitialJ
    ).toBeLessThan(0.01)

    const longCord: LauncherModel = {
      ...V51_CORD_HORN,
      linkage: {
        ...V51_CORD_HORN.linkage,
        cordLengthOffsetMm: 4.0,
      } as unknown as LauncherModel['linkage'],
    }
    const relLong = solveLaunch(
      longCord,
      { notch: 6, launchDeg: 42, yawDeg: 0 },
      env,
      makeRng(26)
    )
    expect(relLong.launchSpeedMps).toBeGreaterThan(0)
    expect(
      Math.abs(sumEnergy(relLong.energyBudget) - relLong.energyBudget.springInitialJ) /
        relLong.energyBudget.springInitialJ
    ).toBeLessThan(0.01)

    const highFric: LauncherModel = {
      ...V51_CORD_HORN,
      linkage: {
        ...V51_CORD_HORN.linkage,
        bearingFrictionCoeff: 0.12,
      } as unknown as LauncherModel['linkage'],
    }
    const relFric = solveLaunch(
      highFric,
      { notch: 6, launchDeg: 42, yawDeg: 0 },
      env,
      makeRng(10)
    )
    expect(
      Math.abs(sumEnergy(relFric.energyBudget) - relFric.energyBudget.springInitialJ) /
        relFric.energyBudget.springInitialJ
    ).toBeLessThan(0.01)
  })
})

describe('launch_solver (Test 3: Inertia Sensitivity)', () => {
  it('strictly decreases launch speed and increases wasted hard-stop KE as arm mass/inertia grows (0.5x -> 1x -> 2x)', () => {
    const env = makeEnv()
    const adj = { notch: 6, launchDeg: 42, yawDeg: 0 }
    const results = [0.5, 1.0, 2.0].map((scale) => {
      const scaled: LauncherModel = {
        ...V51_CORD_HORN,
        arm: {
          ...V51_CORD_HORN.arm,
          massKg: V51_CORD_HORN.arm.massKg * scale,
          inertiaKgM2: V51_CORD_HORN.arm.inertiaKgM2 * scale,
        },
      }
      return solveLaunch(scaled, adj, env, makeRng(9))
    })

    expect(results[0].launchSpeedMps).toBeGreaterThan(results[1].launchSpeedMps)
    expect(results[1].launchSpeedMps).toBeGreaterThan(results[2].launchSpeedMps)
    expect(results[2].wastedStopKeJ).toBeGreaterThan(results[1].wastedStopKeJ)
    expect(results[1].wastedStopKeJ).toBeGreaterThan(results[0].wastedStopKeJ)
  })
})

describe('launch_solver (Python Reference Parity)', () => {
  it('matches analysis/cam_launch_sim.py for v5.1 Notch 6 at 42/50/58 deg', () => {
    const v51Zero = zeroFrictionDeterministic(V51_CORD_HORN)
    const env = makeEnv({ airDensityKgM3: 0, cdOverride: 0 })

    // Point-mass cup parity with cam_launch_sim.py (~6.93 m/s)
    const r42Point = solveLaunch(
      v51Zero,
      { notch: 6, launchDeg: 42, yawDeg: 0 },
      env,
      makeRng(1),
      { includeBallRotInertiaInCup: false, deterministic: true }
    )
    expect(r42Point.launchSpeedMps).toBeCloseTo(6.93, 1)
    expect(Math.abs(r42Point.launchSpeedMps - 6.93) / 6.93).toBeLessThan(0.005)
    expect(r42Point.peakCordTensionN).toBeGreaterThan(75)
    expect(r42Point.cordSlackAtDeg).toBeNull()

    // Physical cup with ball rotational inertia (still ~6.90 m/s, positive topspin)
    const r42Phys = solveLaunch(
      v51Zero,
      { notch: 6, launchDeg: 42, yawDeg: 0 },
      env,
      makeRng(1),
      { deterministic: true }
    )
    expect(r42Phys.launchSpeedMps).toBeCloseTo(6.90, 1)
    expect(r42Phys.omegaBallRadps[1]).toBeGreaterThan(30)

    const r50 = solveLaunch(
      v51Zero,
      { notch: 6, launchDeg: 50, yawDeg: 0 },
      env,
      makeRng(1),
      { includeBallRotInertiaInCup: false, deterministic: true }
    )
    expect(r50.launchSpeedMps).toBeCloseTo(6.21, 1)

    const r58 = solveLaunch(
      v51Zero,
      { notch: 6, launchDeg: 58, yawDeg: 0 },
      env,
      makeRng(1),
      { includeBallRotInertiaInCup: false, deterministic: true }
    )
    expect(r58.launchSpeedMps).toBeCloseTo(5.76, 1)
  })

  it('matches analysis/cam_launch_sim.py for v5.0 circular cam (th_cock=156 deg, mid-stroke slack)', () => {
    const v50Zero = zeroFrictionDeterministic(V50_CIRCULAR_CAM)
    const env = makeEnv({ airDensityKgM3: 0, cdOverride: 0 })

    // d898349 coordinates -> ~5.16 m/s, slack ~53 deg
    const r50 = solveLaunch(
      v50Zero,
      defaultAdjustments(v50Zero),
      env,
      makeRng(1),
      { includeBallRotInertiaInCup: false, deterministic: true }
    )
    expect(r50.launchSpeedMps).toBeCloseTo(5.16, 1)
    expect(r50.cordSlackAtDeg).not.toBeNull()
    expect(r50.cordSlackAtDeg!).toBeGreaterThan(45)
    expect(r50.cordSlackAtDeg!).toBeLessThan(60)

    // With v5.1 stanchions (--cam 96.5 --th-cock 156) -> ~5.21 m/s
    const v50OnV51Stanchions: LauncherModel = {
      ...v50Zero,
      trapBank: { ...v50Zero.trapBank, hingePosMm: V51_CORD_HORN.trapBank.hingePosMm },
      arm: { ...v50Zero.arm, pivotPosMm: V51_CORD_HORN.arm.pivotPosMm },
      linkage: {
        ...v50Zero.linkage,
        rollerPosMm:
          V51_CORD_HORN.linkage.kind === 'cord_horn'
            ? V51_CORD_HORN.linkage.rollerPosMm
            : [48, 43],
      } as LauncherModel['linkage'],
    }
    const r50V51 = solveLaunch(
      v50OnV51Stanchions,
      defaultAdjustments(v50OnV51Stanchions),
      env,
      makeRng(1),
      { includeBallRotInertiaInCup: false, deterministic: true }
    )
    expect(r50V51.launchSpeedMps).toBeCloseTo(5.21, 1)
  })

  it('matches analysis/direct_arm_sim.py for direct_arm_rail 1A rolling & sliding and 10B drop', () => {
    const directZero = zeroFrictionDeterministic(DIRECT_ARM_RAIL)
    const env = makeEnv({ airDensityKgM3: 0, cdOverride: 0, gravityMps2: 9.81 })

    const r1ARoll = solveLaunch(
      directZero,
      { peg: 1, flip: 0, rolling: 1, yawDeg: 0 },
      env,
      makeRng(1),
      { deterministic: true }
    )
    expect(r1ARoll.leftCradle).toBe(true)
    expect(r1ARoll.launchSpeedMps).toBeCloseTo(5.86, 1)
    expect(r1ARoll.launchAngleDeg).toBeCloseTo(33.5, 0)
    const lastSample = r1ARoll.armTraceSamples[r1ARoll.armTraceSamples.length - 1]
    expect(lastSample.thDeg).toBeCloseTo(87.5, 0)
    expect(r1ARoll.omegaBallRadps[1]).toBeLessThan(-150)

    const r1ASlide = solveLaunch(
      directZero,
      { peg: 1, flip: 0, rolling: 0, yawDeg: 0 },
      env,
      makeRng(1),
      { deterministic: true }
    )
    expect(r1ASlide.leftCradle).toBe(true)
    expect(r1ASlide.launchSpeedMps).toBeCloseTo(5.82, 1)
    expect(r1ASlide.launchAngleDeg).toBeCloseTo(54.5, 0)
    expect(Math.hypot(...r1ASlide.omegaBallRadps)).toBe(0)

    const r10B = solveLaunch(
      directZero,
      { peg: 10, flip: 1, rolling: 1, yawDeg: 0 },
      env,
      makeRng(1),
      { deterministic: true }
    )
    expect(r10B.launchSpeedMps).toBeLessThan(r1ARoll.launchSpeedMps)
  })
})

describe('launch_solver edge cases, cycle timing, and zero-DOM isolation', () => {
  it('validates dt <= 0.0005 s strictly and rejects invalid dt or inputs', () => {
    expect(validateDt(0.00025)).toBe(0.00025)
    expect(validateDt(0.0005)).toBe(0.0005)
    expect(() => validateDt(0)).toThrow(RangeError)
    expect(() => validateDt(-0.0001)).toThrow(RangeError)
    expect(() => validateDt(0.0006)).toThrow(RangeError)
    expect(() => validateDt(Number.NaN)).toThrow(RangeError)

    expect(() =>
      solveLaunch(
        V51_CORD_HORN,
        defaultAdjustments(V51_CORD_HORN),
        makeEnv({ dtS: 0.001 }),
        makeRng(1)
      )
    ).toThrow(RangeError)
  })

  it('handles E = 0, trapBank.count = 0, bearingFrictionCoeff = 2.5 stall, and cordLengthOffsetMm = -25 Notch 6', () => {
    const adj = defaultAdjustments(V51_CORD_HORN)

    const zeroE = solveLaunch(V51_CORD_HORN, adj, makeEnv({ nominalEnergyJ: 0 }), makeRng(3))
    expect(zeroE.leftCradle).toBe(false)
    expect(zeroE.launchSpeedMps).toBe(0)
    expect(zeroE.tReleaseS).toBeLessThan(1.0)

    const zeroTraps: LauncherModel = {
      ...V51_CORD_HORN,
      trapBank: { ...V51_CORD_HORN.trapBank, count: 0 },
    }
    const rZeroTraps = solveLaunch(zeroTraps, adj, makeEnv(), makeRng(4))
    expect(rZeroTraps.energyBudget.springInitialJ).toBe(0)
    expect(Number.isFinite(rZeroTraps.launchSpeedMps)).toBe(true)

    const highFric: LauncherModel = {
      ...V51_CORD_HORN,
      linkage: {
        ...V51_CORD_HORN.linkage,
        bearingFrictionCoeff: 2.5,
      } as unknown as LauncherModel['linkage'],
    }
    const rStall = solveLaunch(highFric, adj, makeEnv(), makeRng(5))
    expect(rStall.leftCradle).toBe(false)
    expect(rStall.armTraceSamples.every((s) => s.omegaArm >= -1e-6)).toBe(true)

    const shortCord: LauncherModel = {
      ...V51_CORD_HORN,
      linkage: {
        ...V51_CORD_HORN.linkage,
        cordLengthOffsetMm: -25,
      } as unknown as LauncherModel['linkage'],
    }
    const rUnreach = solveLaunch(shortCord, { notch: 6, launchDeg: 42, yawDeg: 0 }, makeEnv(), makeRng(6))
    expect(rUnreach.reachable).toBe(false)
    expect(rUnreach.leftCradle).toBe(false)
    expect(Number.isFinite(rUnreach.launchSpeedMps)).toBe(true)
  })

  it('supports launchDeg absent from stopAnglesDeg, excessive petal retention trapping, and yaw spin rotation', () => {
    const customStopV51: LauncherModel = {
      ...V51_CORD_HORN,
      adjustments: V51_CORD_HORN.adjustments.map((a) =>
        a.id === 'launchDeg' ? { ...a, min: 37, options: [37, 42, 50, 58] } : a
      ),
    }
    const r37 = solveLaunch(
      customStopV51,
      { notch: 6, launchDeg: 37, yawDeg: 0 },
      makeEnv(),
      makeRng(7)
    )
    expect(r37.leftCradle).toBe(true)
    expect(r37.launchSpeedMps).toBeGreaterThan(6.5)

    const lockedPetal: LauncherModel = {
      ...V41_TILTED_CRADLE,
      cradle: { ...V41_TILTED_CRADLE.cradle, retentionForceN: 500 },
    }
    const rLocked = solveLaunch(
      lockedPetal,
      defaultAdjustments(lockedPetal),
      makeEnv(),
      makeRng(8)
    )
    expect(rLocked.leftCradle).toBe(false)

    const yawed = solveLaunch(
      V51_CORD_HORN,
      { notch: 6, launchDeg: 42, yawDeg: 15 },
      makeEnv(),
      makeRng(9),
      { deterministic: true }
    )
    expect(yawed.velMps[1]).toBeGreaterThan(0)
    // Transverse spin remains orthogonal to horizontal velocity
    const dotHoriz =
      yawed.velMps[0] * yawed.omegaBallRadps[0] +
      yawed.velMps[1] * yawed.omegaBallRadps[1]
    expect(Math.abs(dotHoriz)).toBeLessThan(1e-9)
  })

  it('is bit-identical for identical seeds and computes cycle time from trap count', () => {
    const env = makeEnv({ energyVarianceJ: 0.1 })
    const adj = defaultAdjustments(V51_CORD_HORN)
    const r1 = solveLaunch(V51_CORD_HORN, adj, env, makeRng(4242))
    const r2 = solveLaunch(V51_CORD_HORN, adj, env, makeRng(4242))
    expect(r1).toEqual(r2)

    const rTreb = solveLaunch(
      GRAVITY_SLING_TREBUCHET,
      defaultAdjustments(GRAVITY_SLING_TREBUCHET),
      env,
      makeRng(1),
      { deterministic: true }
    )
    expect(rTreb.cycleTimeS).toBeCloseTo(10.5, 6)
    expect(rTreb.posM[2]).toBeGreaterThanOrEqual(0)
  })

  it('remediates all M2 adversarial energy-conservation, stall, crossing, and stop-blocked edge cases', () => {
    const env = makeEnv()

    // 1. pocketed_petals trapped ball does not double-count KE in frictionLossJ & keRotArmBailsJ
    for (const baseModel of [
      V41_TILTED_CRADLE,
      {
        ...DIRECT_CUP_2TRAP,
        cradle: { ...DIRECT_CUP_2TRAP.cradle, type: 'pocketed_petals' as const },
      },
    ]) {
      const trapped: LauncherModel = {
        ...baseModel,
        cradle: { ...baseModel.cradle, retentionForceN: 500 },
      }
      const rTrap = solveLaunch(
        trapped,
        defaultAdjustments(trapped),
        env,
        makeRng(101),
        { deterministic: true }
      )
      expect(rTrap.leftCradle).toBe(false)
      expect(rTrap.energyBudget.keTransBallJ).toBe(0)
      expect(rTrap.energyBudget.keRotBallJ).toBe(0)
      const relErr =
        Math.abs(sumEnergy(rTrap.energyBudget) - rTrap.energyBudget.springInitialJ) /
        rTrap.energyBudget.springInitialJ
      expect(relErr, `${baseModel.id} trapped err=${relErr}`).toBeLessThan(0.001)
    }

    // 2. gravity_sling_trebuchet static friction stall (mu=2.5) and timeout/non-release ball KE (mu=0.7)
    const trebStall: LauncherModel = {
      ...GRAVITY_SLING_TREBUCHET,
      linkage: {
        ...GRAVITY_SLING_TREBUCHET.linkage,
        bearingFrictionCoeff: 2.5,
      } as unknown as LauncherModel['linkage'],
    }
    const rTrebStall = solveLaunch(
      trebStall,
      defaultAdjustments(trebStall),
      env,
      makeRng(102),
      { deterministic: true }
    )
    expect(rTrebStall.leftCradle).toBe(false)
    expect(rTrebStall.armTraceSamples.length).toBe(1)
    expect(rTrebStall.energyBudget.springInitialJ).toBe(0)
    expect(sumEnergy(rTrebStall.energyBudget)).toBe(0)

    const trebHighFric: LauncherModel = {
      ...GRAVITY_SLING_TREBUCHET,
      linkage: {
        ...GRAVITY_SLING_TREBUCHET.linkage,
        bearingFrictionCoeff: 0.7,
      } as unknown as LauncherModel['linkage'],
    }
    const rTrebFric = solveLaunch(
      trebHighFric,
      defaultAdjustments(trebHighFric),
      env,
      makeRng(103),
      { deterministic: true }
    )
    expect(rTrebFric.leftCradle).toBe(false)
    const trebErr =
      rTrebFric.energyBudget.springInitialJ > 0
        ? Math.abs(sumEnergy(rTrebFric.energyBudget) - rTrebFric.energyBudget.springInitialJ) /
          rTrebFric.energyBudget.springInitialJ
        : Math.abs(sumEnergy(rTrebFric.energyBudget))
    expect(trebErr).toBeLessThan(0.01)

    // 3. direct_rail mid-stroke timeout/stall includes full 2-DOF radial sd KE
    const railTimeout: LauncherModel = {
      ...DIRECT_ARM_RAIL,
      linkage: {
        ...DIRECT_ARM_RAIL.linkage,
        bearingFrictionCoeff: 0.7,
      } as unknown as LauncherModel['linkage'],
    }
    const rRailTimeout = solveLaunch(
      railTimeout,
      defaultAdjustments(railTimeout),
      env,
      makeRng(104),
      { deterministic: true }
    )
    expect(rRailTimeout.leftCradle).toBe(false)
    const railErr =
      Math.abs(sumEnergy(rRailTimeout.energyBudget) - rRailTimeout.energyBudget.springInitialJ) /
      rRailTimeout.energyBudget.springInitialJ
    expect(railErr).toBeLessThan(0.01)

    const rail1TrapStall: LauncherModel = {
      ...DIRECT_ARM_1TRAP,
      linkage: {
        ...DIRECT_ARM_1TRAP.linkage,
        bearingFrictionCoeff: 0.2,
      } as unknown as LauncherModel['linkage'],
    }
    const rRail1Trap = solveLaunch(
      rail1TrapStall,
      defaultAdjustments(rail1TrapStall),
      env,
      makeRng(105),
      { deterministic: true }
    )
    expect(rRail1Trap.leftCradle).toBe(false)
    const rail1Err =
      Math.abs(sumEnergy(rRail1Trap.energyBudget) - rRail1Trap.energyBudget.springInitialJ) /
      rRail1Trap.energyBudget.springInitialJ
    expect(rail1Err).toBeLessThan(0.01)

    // 4. v50_circular_cam (notch: 2, launchDeg: 34, dtS: 0.0005) th == thRestDeg crossing interpolation
    const rV50MaxDt = solveLaunch(
      V50_CIRCULAR_CAM,
      { notch: 2, launchDeg: 34, yawDeg: 0 },
      makeEnv({ dtS: 0.0005 }),
      makeRng(106),
      { deterministic: true }
    )
    const v50Err =
      Math.abs(sumEnergy(rV50MaxDt.energyBudget) - rV50MaxDt.energyBudget.springInitialJ) /
      rV50MaxDt.energyBudget.springInitialJ
    expect(v50Err).toBeLessThan(0.005)

    // 5. v51_cord_horn (notch: 1, launchDeg: 58) stop-blocked guard (0.00 m/s)
    const rV51Blocked = solveLaunch(
      V51_CORD_HORN,
      { notch: 1, launchDeg: 58, yawDeg: 0 },
      env,
      makeRng(107),
      { deterministic: true }
    )
    expect(rV51Blocked.leftCradle).toBe(false)
    expect(rV51Blocked.launchSpeedMps).toBe(0)
    expect(rV51Blocked.launchAngleDeg).toBe(58)
    expect(rV51Blocked.energyBudget.springInitialJ).toBe(0)
    expect(sumEnergy(rV51Blocked.energyBudget)).toBe(0)
  })

  it('stalls cleanly without Coulomb sign-chatter, interpolates psiEndDeg slack crossings, and uses actual zBall0M on clamped trebuchet starts', () => {
    // 1. RK4 Coulomb stall without sign-chatter across cord_horn, inclined_ramp, and tilted_cradle
    const v51NearStall: LauncherModel = {
      ...V51_CORD_HORN,
      trapBank: { ...V51_CORD_HORN.trapBank, bearingFrictionNm: 0.05 },
    }
    const rampNearStall: LauncherModel = {
      ...FLOOR_FLUSH_INCLINED_RAMP,
      trapBank: { ...FLOOR_FLUSH_INCLINED_RAMP.trapBank, bearingFrictionNm: 0.3 },
      linkage: {
        ...FLOOR_FLUSH_INCLINED_RAMP.linkage,
        muChute: 0.8,
      } as LauncherModel['linkage'],
    }
    const v41NearStall: LauncherModel = {
      ...V41_TILTED_CRADLE,
      trapBank: {
        ...V41_TILTED_CRADLE.trapBank,
        bearingFrictionNm: 1.2,
        torqueRatio: 0,
      },
    }

    for (const dtS of [0.0005, 0.00025]) {
      for (const [label, m, nomE] of [
        ['v51_near_stall', v51NearStall, 0.2],
        ['ramp_near_stall', rampNearStall, 0.8],
        ['v41_near_stall', v41NearStall, 2.12],
      ] as const) {
        const res = solveLaunch(
          m,
          defaultAdjustments(m),
          makeEnv({ nominalEnergyJ: nomE, dtS }),
          makeRng(201),
          { deterministic: true }
        )
        expect(res.leftCradle, `${label} dt=${dtS}`).toBe(false)
        expect(res.tReleaseS, `${label} dt=${dtS} tReleaseS`).toBeLessThan(0.5)
        expect(res.launchSpeedMps, `${label} dt=${dtS}`).toBe(0)
        const err =
          Math.abs(sumEnergy(res.energyBudget) - res.energyBudget.springInitialJ) /
          res.energyBudget.springInitialJ
        expect(err, `${label} dt=${dtS} err=${err}`).toBeLessThan(0.01)
      }

      // 2. Interpolated psi == psiEndDeg slack crossing on cordLengthOffsetMm = +20
      const v50LongCord: LauncherModel = {
        ...V50_CIRCULAR_CAM,
        linkage: {
          ...V50_CIRCULAR_CAM.linkage,
          cordLengthOffsetMm: 20,
        } as unknown as LauncherModel['linkage'],
      }
      const rV50Off = solveLaunch(
        v50LongCord,
        { notch: 1, launchDeg: 34, yawDeg: 0 },
        makeEnv({ dtS }),
        makeRng(202),
        { deterministic: true }
      )
      const v50OffErr =
        Math.abs(sumEnergy(rV50Off.energyBudget) - rV50Off.energyBudget.springInitialJ) /
        rV50Off.energyBudget.springInitialJ
      expect(v50OffErr, `v50 off=20 dt=${dtS} err=${v50OffErr}`).toBeLessThan(0.01)

      const v51LongCord: LauncherModel = {
        ...V51_CORD_HORN,
        trapBank: { ...V51_CORD_HORN.trapBank, bearingFrictionNm: 0 },
        linkage: {
          ...V51_CORD_HORN.linkage,
          cordLengthOffsetMm: 20,
        } as unknown as LauncherModel['linkage'],
      }
      const rV51Off = solveLaunch(
        v51LongCord,
        { notch: 1, launchDeg: 42, yawDeg: 0 },
        makeEnv({ nominalEnergyJ: 0.15, dtS }),
        makeRng(203),
        { deterministic: true }
      )
      const v51OffErr =
        Math.abs(sumEnergy(rV51Off.energyBudget) - rV51Off.energyBudget.springInitialJ) /
        rV51Off.energyBudget.springInitialJ
      expect(v51OffErr, `v51 off=20 dt=${dtS} err=${v51OffErr}`).toBeLessThan(0.01)
    }

    // 3. Trebuchet clamped sinB0 (cockAngleDeg = 0, mu = 0) uses actual initial ball height
    const trebCock0: LauncherModel = {
      ...GRAVITY_SLING_TREBUCHET,
      trapBank: { ...GRAVITY_SLING_TREBUCHET.trapBank, bearingFrictionNm: 0 },
      linkage: {
        ...GRAVITY_SLING_TREBUCHET.linkage,
        cockAngleDeg: 0,
      } as LauncherModel['linkage'],
    }
    const rTreb0 = solveLaunch(
      trebCock0,
      defaultAdjustments(trebCock0),
      makeEnv({ dtS: 0.0005 }),
      makeRng(204),
      { deterministic: true }
    )
    expect(rTreb0.leftCradle).toBe(true)
    const treb0Err =
      Math.abs(sumEnergy(rTreb0.energyBudget) - rTreb0.energyBudget.springInitialJ) /
      rTreb0.energyBudget.springInitialJ
    expect(treb0Err, `treb cock=0 err=${treb0Err}`).toBeLessThan(0.001)
  })

  it('returns leftCradle=false, speed=0 on direct_cup when stopAngleDeg >= cockAngleDeg and conserves energy across full DOF sweeps', () => {
    const env = makeEnv()

    for (const stopAngleDeg of [145, 150]) {
      const blocked = solveLaunch(
        DIRECT_CUP_2TRAP,
        { stopAngleDeg, cockAngleDeg: 145, yawDeg: 0 },
        env,
        makeRng(301),
        { deterministic: true }
      )
      expect(blocked.leftCradle).toBe(false)
      expect(blocked.launchSpeedMps).toBe(0)
      expect(blocked.reachable).toBe(false)
      expect(blocked.energyBudget.springInitialJ).toBe(0)
      expect(sumEnergy(blocked.energyBudget)).toBe(0)
    }

    // 81-corner DOF sweep on GRAVITY_SLING_TREBUCHET (including negative launch angles at pin=15..35)
    let sawNegativeAngle = false
    for (const counterweightKg of [0.6, 1.0, 1.6]) {
      for (const dropHeightM of [0.18, 0.25, 0.32]) {
        for (const slingLengthM of [0.24, 0.32, 0.4]) {
          for (const releasePinAngleDeg of [15, 35, 55]) {
            const rel = solveLaunch(
              GRAVITY_SLING_TREBUCHET,
              { counterweightKg, dropHeightM, slingLengthM, releasePinAngleDeg, yawDeg: 0 },
              env,
              makeRng(302),
              { deterministic: true }
            )
            expect(Number.isFinite(rel.launchSpeedMps)).toBe(true)
            expect(Number.isFinite(rel.launchAngleDeg)).toBe(true)
            if (rel.leftCradle && rel.launchAngleDeg < 0) sawNegativeAngle = true
            if (rel.energyBudget.springInitialJ > 1e-6) {
              const err =
                Math.abs(sumEnergy(rel.energyBudget) - rel.energyBudget.springInitialJ) /
                rel.energyBudget.springInitialJ
              expect(err).toBeLessThan(0.01)
            }
          }
        }
      }
    }
    expect(sawNegativeAngle).toBe(true)

    // Full DOF corner sweeps on inclined_ramp, tilted_cradle, circular_cam, and cord_horn
    for (const rampAngleDeg of [28, 40, 52]) {
      for (const cockAngleDeg of [100, 135, 171]) {
        const rel = solveLaunch(
          FLOOR_FLUSH_INCLINED_RAMP,
          { rampAngleDeg, cockAngleDeg, yawDeg: 0 },
          env,
          makeRng(303),
          { deterministic: true }
        )
        expect(Number.isFinite(rel.launchSpeedMps)).toBe(true)
        const err =
          Math.abs(sumEnergy(rel.energyBudget) - rel.energyBudget.springInitialJ) /
          rel.energyBudget.springInitialJ
        expect(err).toBeLessThan(0.01)
      }
    }

    for (const launchDeg of [10, 42, 80]) {
      for (const stopDeg of [7, 11, 15]) {
        const rel = solveLaunch(
          V41_TILTED_CRADLE,
          { launchDeg, stopDeg, yawDeg: 0 },
          env,
          makeRng(304),
          { deterministic: true }
        )
        expect(Number.isFinite(rel.launchSpeedMps)).toBe(true)
        const err =
          Math.abs(sumEnergy(rel.energyBudget) - rel.energyBudget.springInitialJ) /
          rel.energyBudget.springInitialJ
        expect(err).toBeLessThan(0.01)
      }
    }

    for (const model of [V50_CIRCULAR_CAM, V51_CORD_HORN]) {
      const notchOpt = model.adjustments.find((a) => a.id === 'notch')!.options!
      const stopOpt = model.adjustments.find((a) => a.id === 'launchDeg')!.options!
      for (const notch of notchOpt) {
        for (const launchDeg of stopOpt) {
          const rel = solveLaunch(model, { notch, launchDeg, yawDeg: 0 }, env, makeRng(305), {
            deterministic: true,
          })
          expect(Number.isFinite(rel.launchSpeedMps)).toBe(true)
          if (rel.energyBudget.springInitialJ > 1e-6) {
            const err =
              Math.abs(sumEnergy(rel.energyBudget) - rel.energyBudget.springInitialJ) /
              rel.energyBudget.springInitialJ
            expect(err).toBeLessThan(0.01)
          }
        }
      }
    }
  })

  it('contains zero DOM, node:*, or third-party physics engine imports in M2 physics modules', () => {
    const sources = import.meta.glob<string>('./*.ts', {
      query: '?raw',
      import: 'default',
      eager: true,
    })
    const m2Files = ['spring.ts', 'linkage.ts', 'launch_solver.ts']
    const forbidden = [
      /\bwindow\b/,
      /\bdocument\b/,
      /\bHTMLElement\b/,
      /\bnode:/,
      /cannon-es/,
      /rapier/,
      /ammo\.js/,
      /matter-js/,
    ]
    for (const name of m2Files) {
      const key = `./${name}`
      expect(sources[key], `Missing ${key}`).toBeDefined()
      for (const pat of forbidden) {
        expect(sources[key], `${key} matched ${pat}`).not.toMatch(pat)
      }
    }
  })
})
