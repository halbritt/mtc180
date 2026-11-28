import { describe, expect, it } from 'vitest'
import { evaluateRubric } from '../physics/rubric'
import {
  computeDirectArmPegPositions,
  computeV51NotchBallPos,
  defaultAdjustments,
  DIRECT_ARM_1TRAP,
  DIRECT_ARM_2TRAP,
  DIRECT_ARM_RAIL,
  DIRECT_ARM_RAIL_GEOMETRY,
  DIRECT_CUP_2TRAP,
  FLOOR_FLUSH_INCLINED_RAMP,
  getLauncherModel,
  GRAVITY_SLING_TREBUCHET,
  isModelRubricCompliant,
  LAUNCHER_MODELS,
  LAUNCHER_MODELS_BY_ID,
  listLauncherModels,
  NOMINAL_ENERGY_PER_TRAP_J,
  REGULATION_GOLF_BALL,
  V41_TILTED_CRADLE,
  V50_CIRCULAR_CAM,
  V51_CORD_HORN,
  V51_TH_COCK_FULL_DEG,
  validateAndClampAdjustments,
  validateLauncherModel,
  type CradleType,
  type LauncherModel,
  type LauncherTopology,
} from './index'

const PYTHON_DIRECT_ARM_X0_MM: readonly number[] = [
  80.2713, 85.603, 90.9187, 96.2194, 101.5059, 106.779, 112.0396, 117.2882,
  122.5254, 127.7517, 132.9675, 138.1734, 143.3696, 148.5566, 153.7346,
  158.9039, 164.0649, 169.2177, 174.3625, 179.4997,
]

describe('launcher model registry and coverage', () => {
  it('validates every registered model and enforces unique ids', () => {
    expect(LAUNCHER_MODELS.length).toBe(9)
    for (const model of LAUNCHER_MODELS) {
      expect(() => validateLauncherModel(model)).not.toThrow()
      expect(getLauncherModel(model.id)).toBe(model)
      expect(LAUNCHER_MODELS_BY_ID[model.id]).toBe(model)
    }
    expect(() => getLauncherModel('nonexistent_model')).toThrow(RangeError)
    expect(() => getLauncherModel('toString')).toThrow(RangeError)
  })

  it('covers all 7 LauncherTopology values and all 4 CradleType values', () => {
    const expectedTopologies: readonly LauncherTopology[] = [
      'cord_horn',
      'circular_cam',
      'direct_rail',
      'tilted_cradle',
      'direct_cup',
      'gravity_trebuchet',
      'inclined_ramp',
    ]
    const expectedCradles: readonly CradleType[] = [
      'zero_lip_vcup',
      'pocketed_petals',
      'tangent_rail',
      'sling_pouch',
    ]
    const topologies = new Set(LAUNCHER_MODELS.map((m) => m.topology))
    const cradles = new Set(LAUNCHER_MODELS.map((m) => m.cradle.type))
    for (const topology of expectedTopologies) {
      expect(topologies.has(topology)).toBe(true)
    }
    for (const cradle of expectedCradles) {
      expect(cradles.has(cradle)).toBe(true)
    }
  })

  it('filters models cleanly via listLauncherModels', () => {
    const active = listLauncherModels({ activeOnly: true })
    expect(active.map((m) => m.id)).toEqual(['v51_cord_horn', 'direct_arm_rail'])

    const compliant = listLauncherModels({ rubricCompliantOnly: true })
    expect(compliant.some((m) => m.id === 'v41_tilted_cradle')).toBe(false)
    expect(compliant.some((m) => m.id === 'v51_cord_horn')).toBe(true)
    expect(compliant.some((m) => m.id === 'gravity_sling_trebuchet')).toBe(true)

    const directRails = listLauncherModels({ topology: 'direct_rail' })
    expect(directRails.map((m) => m.id)).toEqual([
      'direct_arm_rail',
      'direct_arm_1trap',
      'direct_arm_2trap',
    ])
  })

  it('matches regulation golf ball inertia I = 0.4 * m * R^2', () => {
    expect(REGULATION_GOLF_BALL.massKg).toBe(0.04593)
    expect(REGULATION_GOLF_BALL.radiusM).toBe(0.021335)
    expect(REGULATION_GOLF_BALL.isRealGolfBall).toBe(true)
    expect(REGULATION_GOLF_BALL.inertiaKgM2).toBeCloseTo(
      0.4 * 0.04593 * 0.021335 * 0.021335,
      12
    )
  })
})

describe('exact CAD & Python constant parity', () => {
  it('matches v5.1 cord-and-horn geometry, 6 notches, 3 stop holes, and <3 in ball heights', () => {
    expect(V51_CORD_HORN.arm.massKg).toBe(0.0594)
    expect(V51_CORD_HORN.arm.inertiaKgM2).toBe(4.447e-4)
    expect(V51_CORD_HORN.arm.cgArmMm).toEqual([-22.0, 6.0])
    expect(V51_CORD_HORN.arm.pivotPosMm).toEqual([-96.0, 72.0])
    expect(V51_CORD_HORN.trapBank.hingePosMm).toEqual([124.0, 29.5])
    expect(V51_CORD_HORN.trapBank.bailInertiaKgM2).toBe(0.579e-4)
    expect(V51_CORD_HORN.linkage.kind).toBe('cord_horn')
    if (V51_CORD_HORN.linkage.kind === 'cord_horn') {
      expect(V51_CORD_HORN.linkage.hornADeg).toBe(39.0)
      expect(V51_CORD_HORN.linkage.hornRMm).toBe(108.0)
      expect(V51_TH_COCK_FULL_DEG).toBe(171.0)
      expect(V51_CORD_HORN.linkage.cordTieThCockDeg).toBe(171.0)
      expect(V51_CORD_HORN.linkage.rollerPosMm).toEqual([48.0, 43.0])
      expect(V51_CORD_HORN.linkage.rRollEffMm).toBe(6.85)
      expect(V51_CORD_HORN.linkage.notchPsisDeg).toEqual([
        34.5, 25.5, 16.5, 7.8, -0.2, -8.2,
      ])
      expect(V51_CORD_HORN.linkage.stopHolesMm).toEqual({
        42: [-120.9, 134.1],
        50: [-131.8, 129.8],
        58: [-142.0, 124.1],
      })

      const expectedHeightIn = [5.86, 4.94, 3.96, 2.96, 2.02, 1.08]
      V51_CORD_HORN.linkage.notchPsisDeg.forEach((psi, index) => {
        const pos = computeV51NotchBallPos(
          psi,
          V51_CORD_HORN.arm.pivotPosMm,
          V51_CORD_HORN.arm.ballOffsetArmMm
        )
        expect(pos.zBotIn).toBeCloseTo(expectedHeightIn[index], 2)
        if (index >= 3) {
          expect(pos.zBotIn).toBeLessThan(3.0)
        } else {
          expect(pos.zBotIn).toBeGreaterThan(3.0)
        }
      })
    }
  })

  it('matches v5.0 circular-cam d898349 CAD coordinates and inertia', () => {
    expect(V50_CIRCULAR_CAM.rubricCompliance.baseDimensionsMm).toEqual([
      450, 204, 18,
    ])
    expect(V50_CIRCULAR_CAM.trapBank.hingePosMm).toEqual([112.0, 29.5])
    expect(V50_CIRCULAR_CAM.arm.pivotPosMm).toEqual([-86.0, 72.0])
    expect(V50_CIRCULAR_CAM.arm.massKg).toBe(0.072)
    expect(V50_CIRCULAR_CAM.arm.inertiaKgM2).toBe(6.096e-4)
    expect(V50_CIRCULAR_CAM.arm.cgArmMm).toEqual([-26.2, 22.2])
    if (V50_CIRCULAR_CAM.linkage.kind === 'circular_cam') {
      expect(V50_CIRCULAR_CAM.linkage.rollerPosMm).toEqual([34.0, 39.0])
      expect(V50_CIRCULAR_CAM.linkage.rCamMm).toBe(98.0)
      expect(V50_CIRCULAR_CAM.linkage.rCamEffMm).toBe(96.5)
      expect(V50_CIRCULAR_CAM.linkage.camKnotDeg).toBe(123.0)
      expect(V50_CIRCULAR_CAM.linkage.cordTieThCockDeg).toBe(156.0)
      expect(V50_CIRCULAR_CAM.linkage.notchPsisDeg).toEqual([
        35.8, 28.0, 19.6, 11.2, 2.2, -6.74,
      ])
      expect(V50_CIRCULAR_CAM.linkage.stopHolesMm).toEqual({
        34: [-102.3, 139.0],
        42: [-114.0, 135.9],
        50: [-125.1, 131.2],
      })
    }
  })

  it('matches all 20 direct_arm 1A..10B peg x0 positions from direct_arm_sim.py and <3 in rule', () => {
    expect(DIRECT_ARM_RAIL.rubricCompliance.baseDimensionsMm).toEqual([
      390, 204, 18,
    ])
    expect(DIRECT_ARM_RAIL.arm.inertiaKgM2).toBe(3.08e-4)
    expect(DIRECT_ARM_RAIL.arm.massKg * (DIRECT_ARM_RAIL.arm.cgArmMm[0] * 1e-3)).toBeCloseTo(
      2.68e-3,
      9
    )
    expect(DIRECT_ARM_RAIL.trapBank.bailInertiaKgM2).toBe(0.59e-4)
    expect(DIRECT_ARM_RAIL.trapBank.bailMassXKgM).toBe(9.87e-4)
    expect(DIRECT_ARM_RAIL.trapBank.thCockMaxDeg).toBe(173.0)
    expect(DIRECT_ARM_RAIL.trapBank.thRestDeg).toBe(14.0)
    expect(DIRECT_ARM_RAIL.trapBank.springZeroOffsetDeg).toBe(0.0)
    expect(DIRECT_ARM_1TRAP.trapBank.springZeroOffsetDeg).toBe(0.0)
    expect(DIRECT_ARM_2TRAP.trapBank.springZeroOffsetDeg).toBe(0.0)
    expect(DIRECT_CUP_2TRAP.trapBank.springZeroOffsetDeg).toBe(0.0)
    expect(V51_CORD_HORN.trapBank.springZeroOffsetDeg).toBe(0.0)
    expect(V50_CIRCULAR_CAM.trapBank.springZeroOffsetDeg).toBe(0.0)
    expect(FLOOR_FLUSH_INCLINED_RAMP.trapBank.springZeroOffsetDeg).toBe(0.0)
    expect(DIRECT_ARM_RAIL_GEOMETRY.rideHMm).toBeCloseTo(
      Math.sqrt(21.335 * 21.335 - 7.44 * 7.44),
      6
    )

    const positions = computeDirectArmPegPositions(DIRECT_ARM_RAIL_GEOMETRY)
    expect(positions).toHaveLength(20)
    expect(positions[0].label).toBe('1A')
    expect(positions[19].label).toBe('10B')
    positions.forEach((pos, idx) => {
      expect(pos.x0Mm).toBeCloseTo(PYTHON_DIRECT_ARM_X0_MM[idx], 3)
      expect(pos.xbMm).toBeCloseTo(pos.x0Mm - 20.0, 6)
      expect(pos.zBotIn).toBeLessThan(3.0)
      expect(pos.zBotIn).toBeGreaterThan(2.0)
    })
  })

  it('flags v4.1 tilted-cradle as violating floor-flush rubric rules', () => {
    expect(V41_TILTED_CRADLE.rubricCompliance.baseDimensionsMm).toEqual([
      300, 204, 12,
    ])
    expect(V41_TILTED_CRADLE.rubricCompliance.baseFlushOnFloor).toBe(false)
    expect(V41_TILTED_CRADLE.rubricCompliance.trapsFlatOnBase).toBe(false)
    expect(V41_TILTED_CRADLE.rubricCompliance.ballUnder3In).toBe(false)
    expect(isModelRubricCompliant(V41_TILTED_CRADLE)).toBe(false)
    expect(V41_TILTED_CRADLE.cradle.type).toBe('pocketed_petals')
    expect(V41_TILTED_CRADLE.cradle.retentionForceN).toBe(3.5)
    expect(V41_TILTED_CRADLE.cradle.snapEnergyJ).toBe(0.025)
  })
})

describe('candidate topologies and energy scaling', () => {
  it('scales 1-trap, 2-trap, and 3-trap direct-rail spring energies linearly', () => {
    const e1 =
      DIRECT_ARM_1TRAP.trapBank.count *
      DIRECT_ARM_1TRAP.trapBank.nominalEnergyPerTrapJ
    const e2 =
      DIRECT_ARM_2TRAP.trapBank.count *
      DIRECT_ARM_2TRAP.trapBank.nominalEnergyPerTrapJ
    const e3 =
      DIRECT_ARM_RAIL.trapBank.count *
      DIRECT_ARM_RAIL.trapBank.nominalEnergyPerTrapJ

    expect(NOMINAL_ENERGY_PER_TRAP_J).toBeCloseTo(2.12 / 3, 12)
    expect(e1).toBeCloseTo(0.7066666667, 8)
    expect(e2).toBeCloseTo(1.4133333333, 8)
    expect(e3).toBeCloseTo(2.12, 10)
    expect(DIRECT_ARM_1TRAP.trapBank.bailInertiaKgM2).toBe(0.17e-4)
    expect(DIRECT_ARM_2TRAP.trapBank.bailInertiaKgM2).toBe(0.34e-4)
    expect(DIRECT_CUP_2TRAP.topology).toBe('direct_cup')
    expect(DIRECT_CUP_2TRAP.cradle.type).toBe('zero_lip_vcup')
    expect(DIRECT_CUP_2TRAP.trapBank.count).toBe(2)
  })

  it('configures floor-flush inclined ramp and +8 trebuchet within rubric bounds', () => {
    expect(isModelRubricCompliant(FLOOR_FLUSH_INCLINED_RAMP)).toBe(true)
    expect(FLOOR_FLUSH_INCLINED_RAMP.rubricCompliance.ballUnder3In).toBe(true)
    if (FLOOR_FLUSH_INCLINED_RAMP.linkage.kind === 'inclined_ramp') {
      expect(FLOOR_FLUSH_INCLINED_RAMP.linkage.rampStartZMm / 25.4).toBeCloseTo(
        0.945,
        2
      )
    }

    expect(GRAVITY_SLING_TREBUCHET.trapBank.count).toBe(0)
    expect(GRAVITY_SLING_TREBUCHET.rubricCompliance.equipmentBonus).toBe('both')
    expect(GRAVITY_SLING_TREBUCHET.rubricCompliance.diameterMm).toBeLessThan(
      914.4
    )
    expect(isModelRubricCompliant(GRAVITY_SLING_TREBUCHET)).toBe(true)
    expect(
      evaluateRubric({
        equipment: GRAVITY_SLING_TREBUCHET.rubricCompliance.equipmentBonus,
      }).equipmentBonus
    ).toBe(8)
  })
})

describe('validateLauncherModel error rejection', () => {
  it('rejects negative or zero mass/inertia and invalid torqueRatio', () => {
    const badMass: LauncherModel = {
      ...V51_CORD_HORN,
      arm: { ...V51_CORD_HORN.arm, massKg: -0.01 },
    }
    expect(() => validateLauncherModel(badMass)).toThrow(RangeError)

    const badInertia: LauncherModel = {
      ...V51_CORD_HORN,
      arm: { ...V51_CORD_HORN.arm, inertiaKgM2: 0 },
    }
    expect(() => validateLauncherModel(badInertia)).toThrow(RangeError)

    const badRatioLow: LauncherModel = {
      ...V51_CORD_HORN,
      trapBank: { ...V51_CORD_HORN.trapBank, torqueRatio: 0 },
    }
    expect(() => validateLauncherModel(badRatioLow)).toThrow(RangeError)

    const badRatioHigh: LauncherModel = {
      ...V51_CORD_HORN,
      trapBank: { ...V51_CORD_HORN.trapBank, torqueRatio: 1.2 },
    }
    expect(() => validateLauncherModel(badRatioHigh)).toThrow(RangeError)
  })

  it('enforces trebuchet vs mousetrap mutual exclusion', () => {
    const trebWithTrap: LauncherModel = {
      ...GRAVITY_SLING_TREBUCHET,
      trapBank: { ...GRAVITY_SLING_TREBUCHET.trapBank, count: 1 },
    }
    expect(() => validateLauncherModel(trebWithTrap)).toThrow(RangeError)

    const trapWithTrebBonus: LauncherModel = {
      ...V51_CORD_HORN,
      rubricCompliance: {
        ...V51_CORD_HORN.rubricCompliance,
        equipmentBonus: 'trebuchet',
      },
    }
    expect(() => validateLauncherModel(trapWithTrebBonus)).toThrow()
  })

  it('rejects oversized base claiming baseFits2ft, bad cock/rest sweep, and bad adjustments', () => {
    const thickBase: LauncherModel = {
      ...V51_CORD_HORN,
      rubricCompliance: {
        ...V51_CORD_HORN.rubricCompliance,
        baseDimensionsMm: [470, 204, 26],
      },
    }
    expect(() => validateLauncherModel(thickBase)).toThrow(RangeError)

    const badSweep: LauncherModel = {
      ...V51_CORD_HORN,
      trapBank: { ...V51_CORD_HORN.trapBank, thCockMaxDeg: 5 },
    }
    expect(() => validateLauncherModel(badSweep)).toThrow(RangeError)

    const badDefault: LauncherModel = {
      ...V51_CORD_HORN,
      adjustments: [
        { ...V51_CORD_HORN.adjustments[0], defaultValue: 99 },
        ...V51_CORD_HORN.adjustments.slice(1),
      ],
    }
    expect(() => validateLauncherModel(badDefault)).toThrow(RangeError)

    const badDiscreteDefault: LauncherModel = {
      ...V51_CORD_HORN,
      adjustments: [
        V51_CORD_HORN.adjustments[0],
        { ...V51_CORD_HORN.adjustments[1], defaultValue: 45 },
        ...V51_CORD_HORN.adjustments.slice(2),
      ],
    }
    expect(() => validateLauncherModel(badDiscreteDefault)).toThrow(RangeError)
  })

  it('enforces parallel-axis inertia lower bound, finite linkage arrays, ramp defaults, cordTieThCockDeg bounds, adjustment linkage cross-checks, and golf ball bonus rule', () => {
    const badParallelAxis: LauncherModel = {
      ...V51_CORD_HORN,
      arm: {
        ...V51_CORD_HORN.arm,
        massKg: 10,
        cgArmMm: [150, 0],
        inertiaKgM2: 1e-6,
      },
    }
    expect(() => validateLauncherModel(badParallelAxis)).toThrow(RangeError)

    if (V51_CORD_HORN.linkage.kind === 'cord_horn') {
      const nanNotch: LauncherModel = {
        ...V51_CORD_HORN,
        linkage: {
          ...V51_CORD_HORN.linkage,
          notchPsisDeg: [34.5, Number.NaN, 16.5, 7.8, -0.2, -8.2],
        },
      }
      expect(() => validateLauncherModel(nanNotch)).toThrow(RangeError)

      const nanStopHole: LauncherModel = {
        ...V51_CORD_HORN,
        linkage: {
          ...V51_CORD_HORN.linkage,
          stopHolesMm: {
            ...V51_CORD_HORN.linkage.stopHolesMm,
            42: [Number.NaN, 134.1],
          },
        },
      }
      expect(() => validateLauncherModel(nanStopHole)).toThrow(RangeError)

      const cordTieTooHigh: LauncherModel = {
        ...V51_CORD_HORN,
        linkage: {
          ...V51_CORD_HORN.linkage,
          cordTieThCockDeg: 174.0,
        },
      }
      expect(() => validateLauncherModel(cordTieTooHigh)).toThrow(RangeError)

      const cordTieTooLow: LauncherModel = {
        ...V51_CORD_HORN,
        linkage: {
          ...V51_CORD_HORN.linkage,
          cordTieThCockDeg: 7.0,
        },
      }
      expect(() => validateLauncherModel(cordTieTooLow)).toThrow(RangeError)

      const badLaunchOpt: LauncherModel = {
        ...V51_CORD_HORN,
        adjustments: [
          V51_CORD_HORN.adjustments[0],
          {
            ...V51_CORD_HORN.adjustments[1],
            options: [42, 46, 58],
            defaultValue: 42,
          },
          ...V51_CORD_HORN.adjustments.slice(2),
        ],
      }
      expect(() => validateLauncherModel(badLaunchOpt)).toThrow(RangeError)

      const badNotchOpt: LauncherModel = {
        ...V51_CORD_HORN,
        adjustments: [
          {
            ...V51_CORD_HORN.adjustments[0],
            options: [1, 2, 3, 4, 5, 7],
            max: 7,
            defaultValue: 1,
          },
          ...V51_CORD_HORN.adjustments.slice(1),
        ],
      }
      expect(() => validateLauncherModel(badNotchOpt)).toThrow(RangeError)
    }

    if (V50_CIRCULAR_CAM.linkage.kind === 'circular_cam') {
      const badCamTie: LauncherModel = {
        ...V50_CIRCULAR_CAM,
        linkage: {
          ...V50_CIRCULAR_CAM.linkage,
          cordTieThCockDeg: 180.0,
        },
      }
      expect(() => validateLauncherModel(badCamTie)).toThrow(RangeError)
    }

    if (FLOOR_FLUSH_INCLINED_RAMP.linkage.kind === 'inclined_ramp') {
      const badRampDefault: LauncherModel = {
        ...FLOOR_FLUSH_INCLINED_RAMP,
        linkage: {
          ...FLOOR_FLUSH_INCLINED_RAMP.linkage,
          defaultRampAngleDeg: 90,
        },
      }
      expect(() => validateLauncherModel(badRampDefault)).toThrow(RangeError)
    }

    const fakeBallBonus: LauncherModel = {
      ...V51_CORD_HORN,
      projectile: {
        ...V51_CORD_HORN.projectile,
        isRealGolfBall: false,
      },
    }
    expect(() => validateLauncherModel(fakeBallBonus)).toThrow(RangeError)
  })
})

describe('validateAndClampAdjustments', () => {
  it('returns model defaults when raw is omitted', () => {
    expect(defaultAdjustments(V51_CORD_HORN)).toEqual({
      notch: 6,
      launchDeg: 42,
      yawDeg: 0,
    })
    expect(validateAndClampAdjustments(V51_CORD_HORN)).toEqual({
      notch: 6,
      launchDeg: 42,
      yawDeg: 0,
    })
  })

  it('snaps discrete options and clamps/steps continuous adjustments', () => {
    expect(
      validateAndClampAdjustments(V51_CORD_HORN, {
        notch: 3.7,
        launchDeg: 47,
        yawDeg: 2.3,
      })
    ).toEqual({
      notch: 4,
      launchDeg: 50,
      yawDeg: 2.5,
    })

    expect(
      validateAndClampAdjustments(DIRECT_ARM_RAIL, {
        peg: 15,
        flip: 0.7,
        rolling: -2,
        yawDeg: -99,
      })
    ).toEqual({
      peg: 10,
      flip: 1,
      rolling: 0,
      yawDeg: -15,
    })

    expect(
      validateAndClampAdjustments(GRAVITY_SLING_TREBUCHET, {
        counterweightKg: 1.24,
        dropHeightM: 0.256,
        slingLengthM: 0.31,
        releasePinAngleDeg: 36.1,
        yawDeg: 1.2,
      })
    ).toEqual({
      counterweightKg: 1.2,
      dropHeightM: 0.26,
      slingLengthM: 0.32,
      releasePinAngleDeg: 35,
      yawDeg: 1,
    })
  })

  it('rejects unknown keys and NaN/Infinity values with RangeError', () => {
    expect(() =>
      validateAndClampAdjustments(V51_CORD_HORN, { bogusKey: 1 })
    ).toThrow(RangeError)
    expect(() =>
      validateAndClampAdjustments(V51_CORD_HORN, { yawDeg: Number.NaN })
    ).toThrow(RangeError)
    expect(() =>
      validateAndClampAdjustments(V51_CORD_HORN, {
        yawDeg: Number.POSITIVE_INFINITY,
      })
    ).toThrow(RangeError)
  })

  it('snaps micro-steps < 1e-10 cleanly inside [min, max]', () => {
    const microModel: LauncherModel = {
      ...DIRECT_ARM_RAIL,
      adjustments: [
        {
          id: 'micro',
          label: 'Micro Adjustment',
          unit: 'm',
          kind: 'continuous',
          min: 1e-11,
          max: 2e-11,
          step: 1e-12,
          defaultValue: 1.5e-11,
        },
      ],
    }
    const snapped = validateAndClampAdjustments(microModel, {
      micro: 1.54e-11,
    })
    expect(snapped.micro).toBeGreaterThanOrEqual(1e-11)
    expect(snapped.micro).toBeLessThanOrEqual(2e-11)
    expect(snapped.micro).toBeCloseTo(1.5e-11, 22)
  })
})

describe('registry immutability', () => {
  it('deep-freezes LAUNCHER_MODELS, LAUNCHER_MODELS_BY_ID, and all nested model properties', () => {
    expect(Object.isFrozen(LAUNCHER_MODELS)).toBe(true)
    expect(Object.isFrozen(LAUNCHER_MODELS_BY_ID)).toBe(true)

    for (const model of LAUNCHER_MODELS) {
      const fetched = getLauncherModel(model.id)
      expect(Object.isFrozen(fetched)).toBe(true)
      expect(Object.isFrozen(fetched.projectile)).toBe(true)
      expect(Object.isFrozen(fetched.rubricCompliance)).toBe(true)
      expect(Object.isFrozen(fetched.rubricCompliance.baseDimensionsMm)).toBe(
        true
      )
      expect(Object.isFrozen(fetched.trapBank)).toBe(true)
      expect(Object.isFrozen(fetched.arm)).toBe(true)
      expect(Object.isFrozen(fetched.arm.cgArmMm)).toBe(true)
      expect(Object.isFrozen(fetched.cradle)).toBe(true)
      if (fetched.cradle.railGeometry) {
        expect(Object.isFrozen(fetched.cradle.railGeometry)).toBe(true)
      }
      expect(Object.isFrozen(fetched.linkage)).toBe(true)
      if (
        fetched.linkage.kind === 'cord_horn' ||
        fetched.linkage.kind === 'circular_cam'
      ) {
        expect(Object.isFrozen(fetched.linkage.notchPsisDeg)).toBe(true)
        expect(Object.isFrozen(fetched.linkage.stopAnglesDeg)).toBe(true)
        expect(Object.isFrozen(fetched.linkage.stopHolesMm)).toBe(true)
        for (const deg of fetched.linkage.stopAnglesDeg) {
          expect(Object.isFrozen(fetched.linkage.stopHolesMm[deg])).toBe(true)
        }
      }
      expect(Object.isFrozen(fetched.adjustments)).toBe(true)
      for (const adj of fetched.adjustments) {
        expect(Object.isFrozen(adj)).toBe(true)
        if (adj.options) expect(Object.isFrozen(adj.options)).toBe(true)
        if (adj.optionLabels) expect(Object.isFrozen(adj.optionLabels)).toBe(true)
      }
    }

    expect(() => {
      ;(getLauncherModel('v51_cord_horn').arm as { massKg: number }).massKg =
        -999
    }).toThrow(TypeError)
  })
})

describe('zero-DOM isolation in src/models', () => {
  it('contains no browser/DOM globals in non-test src/models modules', () => {
    const sources = import.meta.glob<string>('./*.ts', {
      query: '?raw',
      import: 'default',
      eager: true,
    })
    const moduleEntries = Object.entries(sources).filter(
      ([file]) => !file.endsWith('.test.ts')
    )
    expect(moduleEntries.length).toBeGreaterThanOrEqual(9)
    const forbidden = [
      /\bwindow\b/,
      /\bdocument\b/,
      /\bHTMLElement\b/,
      /\blocalStorage\b/,
      /\bnavigator\b/,
      /\brequestAnimationFrame\b/,
    ]
    for (const [file, content] of moduleEntries) {
      for (const pattern of forbidden) {
        expect(content, `${file} matched ${pattern}`).not.toMatch(pattern)
      }
    }
  })
})
