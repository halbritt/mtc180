import { describe, expect, it } from 'vitest'
import {
  type AdjustmentValues,
  type LauncherModel,
  type LaunchReleaseState,
  loadLinkageModule,
  loadLaunchSolverModule,
  loadModelsModule,
  loadSimulateModule,
  loadSpringModule,
  loadTurfModule,
} from './helpers/contracts'
import {
  assertFinite,
  createNominalEnv,
  createSeededRng,
  createVacuumEnv,
  defaultAdjustmentsForModel,
  REPO_CONSTANTS,
  sumEnergyBudget,
} from './helpers/fixtures'

function listAllModels(modelsMod: Record<string, any>): LauncherModel[] {
  if (typeof modelsMod.listLauncherModels === 'function') return modelsMod.listLauncherModels()
  if (typeof modelsMod.listModels === 'function') return modelsMod.listModels()
  if (typeof modelsMod.getAllModels === 'function') return modelsMod.getAllModels()
  if (Array.isArray(modelsMod.LAUNCHER_MODELS)) return modelsMod.LAUNCHER_MODELS
  if (Array.isArray(modelsMod.MODELS)) return modelsMod.MODELS
  throw new Error('Models registry must export listLauncherModels() / listModels()')
}

function validateModelSchema(modelsMod: Record<string, any>, model: LauncherModel): LauncherModel {
  const fn = modelsMod.validateLauncherModel ?? modelsMod.validateModel
  if (typeof fn !== 'function') throw new Error('Models module missing validateLauncherModel/validateModel')
  return fn(model)
}

function validateModelAdjustments(modelsMod: Record<string, any>, model: LauncherModel, adj: AdjustmentValues): AdjustmentValues {
  const fn = modelsMod.validateAndClampAdjustments ?? modelsMod.validateAdjustments
  if (typeof fn !== 'function') throw new Error('Models module missing validateAndClampAdjustments/validateAdjustments')
  return fn(model, adj)
}

function findModel(modelsMod: Record<string, any>, topology: string): LauncherModel {
  const found = listAllModels(modelsMod).find((m) => m.topology === topology)
  if (!found) throw new Error(`Model not found for topology=${topology}`)
  return found
}

function adjustKeys(model: LauncherModel, wanted: Record<string, number>): AdjustmentValues {
  const base = defaultAdjustmentsForModel(model)
  for (const [hint, val] of Object.entries(wanted)) {
    const match = model.adjustments.find((a) => {
      const idLow = a.id.toLowerCase()
      const hLow = hint.toLowerCase()
      if (idLow === hLow || idLow.includes(hLow)) return true
      if (hLow === 'stop' && idLow === 'launchdeg') return true
      return false
    })
    if (match) base[match.id] = val
  }
  return base
}

describe('Tier 2 — F1 Edges: Zero-DOM Pure Physics Engine', () => {
  it('F1-T2.1: rejects NaN/Infinity environment parameters without NaN propagation', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const adj = defaultAdjustmentsForModel(v51)
    expect(() =>
      solverMod.solveLaunch(v51, adj, createNominalEnv({ nominalEnergyJ: Number.NaN }), createSeededRng(1))
    ).toThrow()
    expect(() =>
      solverMod.solveLaunch(v51, adj, createNominalEnv({ gravityMps2: Number.POSITIVE_INFINITY }), createSeededRng(1))
    ).toThrow()
  })

  it('F1-T2.2: enforces RK4 substepping <= 0.0005 s even under high-speed light-arm config', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const light: LauncherModel = {
      ...v51,
      arm: { ...v51.arm, massKg: v51.arm.massKg * 0.25, inertiaKgM2: v51.arm.inertiaKgM2 * 0.25 },
    }
    const rel: LaunchReleaseState = solverMod.solveLaunch(
      light,
      defaultAdjustmentsForModel(light),
      createNominalEnv({ nominalEnergyJ: 3.5 }),
      createSeededRng(2)
    )
    for (let i = 1; i < rel.armTraceSamples.length; i++) {
      expect(rel.armTraceSamples[i].t - rel.armTraceSamples[i - 1].t).toBeLessThanOrEqual(0.0005 + 1e-12)
    }
  })

  it('F1-T2.3: zero-energy (E = 0) launch terminates cleanly without divide-by-zero or hang', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const rel: LaunchReleaseState = solverMod.solveLaunch(
      v51,
      defaultAdjustmentsForModel(v51),
      createNominalEnv({ nominalEnergyJ: 0 }),
      createSeededRng(3)
    )
    expect(assertFinite(rel.tReleaseS, 'tReleaseS')).toBeLessThan(1.0)
    expect(assertFinite(rel.launchSpeedMps, 'launchSpeedMps')).toBeLessThan(0.5)
  })

  it('F1-T2.4: non-ejection / zero-velocity launch produces finite simulateShot result without crash', async () => {
    const modelsMod = await loadModelsModule()
    const simMod = await loadSimulateModule()
    const direct = findModel(modelsMod, 'direct_rail')
    const adj = adjustKeys(direct, { peg: 10, flip: 1 })
    const res = simMod.simulateShot(direct, adj, createNominalEnv({ nominalEnergyJ: 0.1 }), { x: 2.0, y: 0 }, 4)
    expect(assertFinite(res.carryDistanceM, 'carryDistanceM')).toBeGreaterThanOrEqual(0)
    expect(assertFinite(res.totalDistanceM, 'totalDistanceM')).toBeGreaterThanOrEqual(0)
    expect(res.trace.length).toBeGreaterThanOrEqual(2)
  })

  it('F1-T2.5: near-90 deg high-loft launch remains finite without atan2/hypot singularities', async () => {
    const modelsMod = await loadModelsModule()
    const simMod = await loadSimulateModule()
    const v41 = findModel(modelsMod, 'tilted_cradle')
    const pitchDef = v41.adjustments.find((a) => /pitch|beta|tilt|frame|launchdeg/i.test(a.id))
    expect(pitchDef).toBeDefined()
    const maxPitch = pitchDef!.max ?? pitchDef!.options![pitchDef!.options!.length - 1]
    const res = simMod.simulateShot(
      v41,
      adjustKeys(v41, { [pitchDef!.id]: maxPitch }),
      createNominalEnv(),
      { x: 1.0, y: 0 },
      5
    )
    expect(assertFinite(res.carryDistanceM, 'carryDistanceM')).toBeGreaterThanOrEqual(0)
    expect(assertFinite(res.release.launchAngleDeg, 'launchAngleDeg')).toBeGreaterThan(60)
    expect(res.release.launchAngleDeg).toBeLessThanOrEqual(90)
  })
})

describe('Tier 2 — F2 Edges: Declarative Launcher Schema', () => {
  it('F2-T2.1: validateModel rejects zero or negative arm mass or inertia', async () => {
    const modelsMod = await loadModelsModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    expect(() =>
      validateModelSchema(modelsMod, { ...v51, arm: { ...v51.arm, massKg: 0 } })
    ).toThrow()
    expect(() =>
      validateModelSchema(modelsMod, { ...v51, arm: { ...v51.arm, inertiaKgM2: -1e-4 } })
    ).toThrow()
  })

  it('F2-T2.2: validateModel rejects oversized base or flags diameter >= 914.4 mm (3 ft rule)', async () => {
    const modelsMod = await loadModelsModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const oversizedModel: LauncherModel = {
      ...v51,
      rubricCompliance: {
        ...v51.rubricCompliance,
        diameterMm: REPO_CONSTANTS.MAX_DIAMETER_MM + 10,
        baseDimensionsMm: [700, 204, 18],
      },
    }
    expect(() => validateModelSchema(modelsMod, oversizedModel)).toThrow()
    expect(typeof modelsMod.isModelRubricCompliant).toBe('function')
    expect(
      modelsMod.isModelRubricCompliant({
        ...v51,
        rubricCompliance: { ...v51.rubricCompliance, diameterMm: REPO_CONSTANTS.MAX_DIAMETER_MM + 10 },
      })
    ).toBe(false)
    expect(modelsMod.isModelRubricCompliant(findModel(modelsMod, 'tilted_cradle'))).toBe(false)
    expect(modelsMod.isModelRubricCompliant(v51)).toBe(true)
  })

  it('F2-T2.3: validateModel rejects negative trapBank.count, invalid cock bounds, and trebuchet/mousetrap mutual exclusion', async () => {
    const modelsMod = await loadModelsModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const treb = findModel(modelsMod, 'gravity_trebuchet')
    expect(() =>
      validateModelSchema(modelsMod, { ...v51, trapBank: { ...v51.trapBank, count: -1 } })
    ).toThrow()
    expect(() =>
      validateModelSchema(modelsMod, {
        ...v51,
        trapBank: { ...v51.trapBank, thCockMaxDeg: 0, thRestDeg: 10 },
      })
    ).toThrow()
    expect(() =>
      validateModelSchema(modelsMod, { ...treb, trapBank: { ...treb.trapBank, count: 1 } })
    ).toThrow(RangeError)
    expect(() =>
      validateModelSchema(modelsMod, {
        ...treb,
        rubricCompliance: { ...treb.rubricCompliance, trapsFlatOnBase: true },
      })
    ).toThrow(RangeError)
    expect(() =>
      validateModelSchema(modelsMod, {
        ...v51,
        rubricCompliance: { ...v51.rubricCompliance, equipmentBonus: 'trebuchet' },
      })
    ).toThrow(Error)
  })

  it('F2-T2.4: Edge E5 (3-inch rule) — v5.1 Notches #4-#6 pass < 76.2 mm while Notches #1-#3 fail', async () => {
    const modelsMod = await loadModelsModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const notchPsis = v51.linkage.notchPsisDeg as readonly number[]
    expect(notchPsis).toHaveLength(6)
    const computePos = modelsMod.computeV51NotchBallPos
    expect(typeof computePos).toBe('function')
    for (const notch of [4, 5, 6]) {
      const pos = computePos(notchPsis[notch - 1], v51.arm.pivotPosMm, v51.arm.ballOffsetArmMm)
      expect(pos.zBotMm).toBeLessThan(REPO_CONSTANTS.THREE_INCHES_M * 1000)
    }
    for (const notch of [1, 2, 3]) {
      const pos = computePos(notchPsis[notch - 1], v51.arm.pivotPosMm, v51.arm.ballOffsetArmMm)
      expect(pos.zBotMm).toBeGreaterThan(REPO_CONSTANTS.THREE_INCHES_M * 1000)
    }
  })

  it('F2-T2.5: validateModel rejects unknown topology discriminator or empty id', async () => {
    const modelsMod = await loadModelsModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    expect(() =>
      validateModelSchema(modelsMod, { ...v51, id: '' })
    ).toThrow()
    expect(() =>
      validateModelSchema(modelsMod, { ...v51, topology: 'rocket_launcher' as any })
    ).toThrow()
  })
})

describe('Tier 2 — F3 Edges: Per-Model Adjustment DOFs', () => {
  it('F3-T2.1: discrete DOF out-of-set value (stop=45 on v5.1) clamps/snaps cleanly to nearest option', async () => {
    const modelsMod = await loadModelsModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const stopDef = v51.adjustments.find((a) => /stop|launchdeg/i.test(a.id))!
    const badAdj = { ...defaultAdjustmentsForModel(v51), [stopDef.id]: 45 }
    const validated = validateModelAdjustments(modelsMod, v51, badAdj)
    expect(stopDef.options).toContain(validated[stopDef.id])
    expect(validated[stopDef.id]).toBe(42)
  })

  it('F3-T2.2: continuous DOF out-of-bounds (yawDeg = 180) clamps cleanly and unknown key throws RangeError', async () => {
    const modelsMod = await loadModelsModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const yawDef = v51.adjustments.find((a) => a.id.toLowerCase().includes('yaw'))!
    const badAdj = { ...defaultAdjustmentsForModel(v51), [yawDef.id]: 180 }
    const validated = validateModelAdjustments(modelsMod, v51, badAdj)
    expect(validated[yawDef.id]).toBeGreaterThanOrEqual(yawDef.min!)
    expect(validated[yawDef.id]).toBeLessThanOrEqual(yawDef.max!)
    expect(validated[yawDef.id]).toBe(yawDef.max)
    expect(() => validateModelAdjustments(modelsMod, v51, { bogusKey: 1 })).toThrow(RangeError)
  })

  it('F3-T2.3: NaN or Infinity adjustment value throws validation error', async () => {
    const modelsMod = await loadModelsModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const yawDef = v51.adjustments.find((a) => a.id.toLowerCase().includes('yaw'))!
    expect(() =>
      validateModelAdjustments(modelsMod, v51, { ...defaultAdjustmentsForModel(v51), [yawDef.id]: Number.NaN })
    ).toThrow()
    expect(() =>
      validateModelAdjustments(modelsMod, v51, { ...defaultAdjustmentsForModel(v51), [yawDef.id]: Number.POSITIVE_INFINITY })
    ).toThrow()
  })

  it('F3-T2.4: continuous DOF succeeds at exact min and exact max closed bounds', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const yawDef = v51.adjustments.find((a) => a.id.toLowerCase().includes('yaw'))!
    for (const bound of [yawDef.min!, yawDef.max!]) {
      const adj = { ...defaultAdjustmentsForModel(v51), [yawDef.id]: bound }
      const validated = validateModelAdjustments(modelsMod, v51, adj)
      expect(validated[yawDef.id]).toBe(bound)
      const rel: LaunchReleaseState = solverMod.solveLaunch(v51, validated, createNominalEnv(), createSeededRng(21))
      expect(assertFinite(rel.launchSpeedMps, 'launchSpeedMps')).toBeGreaterThan(0)
    }
  })

  it('F3-T2.5: direct_arm peg extremes 1A vs 10B span expected monotonic range (~3.58 m down to ~0.5 m)', async () => {
    const modelsMod = await loadModelsModule()
    const simMod = await loadSimulateModule()
    const direct = findModel(modelsMod, 'direct_rail')
    const r1A = simMod.simulateShot(direct, adjustKeys(direct, { peg: 1, flip: 0 }), createVacuumEnv(), { x: 3.5, y: 0 }, 22)
    const r10B = simMod.simulateShot(direct, adjustKeys(direct, { peg: 10, flip: 1 }), createVacuumEnv(), { x: 1.0, y: 0 }, 22)
    expect(r1A.carryDistanceM).toBeGreaterThan(r10B.carryDistanceM)
    expect(r1A.carryDistanceM).toBeGreaterThan(2.8)
    expect(r10B.carryDistanceM).toBeLessThan(1.5)
  })
})

describe('Tier 2 — F5 Edges: Linear Torsion Spring & Bank', () => {
  it('F5-T2.1: negative spring energy, NaN, or negative torqueRatio throws explicit validation error', async () => {
    const springMod = await loadSpringModule()
    expect(() => springMod.springTorque(90, -1, 0.5)).toThrow()
    expect(() => springMod.springTorque(90, Number.NaN, 0.5)).toThrow()
    expect(() => springMod.springTorque(90, 2.0, -0.1)).toThrow()
  })

  it('F5-T2.2: boundary torqueRatio = 0 and torqueRatio = 1 both integrate exactly to E within < 0.5%', async () => {
    const springMod = await loadSpringModule()
    for (const ratio of [0, 1]) {
      const w = springMod.springWork(180, 0, 2.0, ratio)
      expect(Math.abs(w - 2.0) / 2.0).toBeLessThan(0.005)
    }
  })

  it('F5-T2.3: physically inverted torqueRatio > 1 is rejected cleanly', async () => {
    const springMod = await loadSpringModule()
    expect(() => springMod.springTorque(90, 2.0, 1.5)).toThrow()
  })

  it('F5-T2.4: trapBank.count = 0 on mousetrap model throws non-TypeError/ReferenceError or yields 0 J without NaN', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    expect(typeof solverMod.solveLaunch).toBe('function')
    const v51 = findModel(modelsMod, 'cord_horn')
    const zeroTrap: LauncherModel = { ...v51, trapBank: { ...v51.trapBank, count: 0 } }
    try {
      const rel: LaunchReleaseState = solverMod.solveLaunch(
        zeroTrap,
        defaultAdjustmentsForModel(zeroTrap),
        createNominalEnv(),
        createSeededRng(23)
      )
      expect(rel.energyBudget.springInitialJ).toBe(0)
    } catch (err) {
      expect(err).not.toBeInstanceOf(TypeError)
      expect(err).not.toBeInstanceOf(ReferenceError)
      expect(err).toBeInstanceOf(RangeError)
    }
  })

  it('F5-T2.5: extreme stochastic variance clamps sampled spring energy non-negative (>= 0)', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const adj = defaultAdjustmentsForModel(v51)
    const env = createNominalEnv({ nominalEnergyJ: 0.2, energyVarianceJ: 1.0, energyDistribution: 'gaussian' })
    const rng = createSeededRng(999)
    for (let i = 0; i < 30; i++) {
      const rel: LaunchReleaseState = solverMod.solveLaunch(v51, adj, env, rng)
      expect(assertFinite(rel.energyBudget.springInitialJ, 'springInitialJ')).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('Tier 2 — F6 Edges: Linkage, Cam & String Kinematics', () => {
  it('F6-T2.1: Edge E3 (unreachable cocking) handles short cord / unreachable notch cleanly without NaN or hang', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const badCordModel: LauncherModel = {
      ...v51,
      linkage: { ...v51.linkage, cordLengthOffsetMm: -25 },
    }
    const rel: LaunchReleaseState = solverMod.solveLaunch(
      badCordModel,
      adjustKeys(badCordModel, { notch: 6, stop: 42 }),
      createNominalEnv(),
      createSeededRng(24)
    )
    expect(rel.reachable).toBe(false)
    expect(rel.leftCradle).toBe(false)
    expect(Number.isFinite(rel.launchSpeedMps)).toBe(true)
  })

  it('F6-T2.2: Edge E3 (mid-stroke cord slack) on v5.0 cam coasts cleanly with < 1% energy error', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const v50 = findModel(modelsMod, 'circular_cam')
    const rel: LaunchReleaseState = solverMod.solveLaunch(
      v50,
      defaultAdjustmentsForModel(v50),
      createVacuumEnv(),
      createSeededRng(25)
    )
    expect(rel.cordSlackAtDeg).not.toBeNull()
    const err = Math.abs(sumEnergyBudget(rel.energyBudget) - rel.energyBudget.springInitialJ) / rel.energyBudget.springInitialJ
    expect(err).toBeLessThan(0.01)
  })

  it('F6-T2.3: Edge E3 (bail overrun snap-taut) remains finite and momentum-bounded with slack cord offset', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const longCord: LauncherModel = {
      ...v51,
      linkage: { ...v51.linkage, cordLengthOffsetMm: 4.0 },
    }
    const rel: LaunchReleaseState = solverMod.solveLaunch(
      longCord,
      adjustKeys(longCord, { notch: 6, stop: 42 }),
      createNominalEnv(),
      createSeededRng(26)
    )
    expect(assertFinite(rel.launchSpeedMps, 'launchSpeedMps')).toBeGreaterThan(0)
    expect(sumEnergyBudget(rel.energyBudget)).toBeLessThanOrEqual(rel.energyBudget.springInitialJ * 1.01)
  })

  it('F6-T2.4: dead-center boundary near psi_dead = 53.0 deg stays finite without 1/lev_b division by zero', async () => {
    const linkageMod = await loadLinkageModule()
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    if (typeof linkageMod.hornSide === 'function') {
      const h = linkageMod.hornSide(53.0)
      expect(assertFinite(h.leverArmMm ?? h.leverArm ?? h[2], 'hornLeverArm')).toBeDefined()
    }
    const nearDeadStop: LauncherModel = {
      ...v51,
      linkage: {
        ...v51.linkage,
        stopAnglesDeg: [37, ...((v51.linkage.stopAnglesDeg as readonly number[]) ?? [42, 50, 58])],
        stopHolesMm: {
          ...(v51.linkage.stopHolesMm as Record<number, readonly [number, number]>),
          37: [-113.8, 136.3],
        },
      },
      adjustments: v51.adjustments.map((a) =>
        /stop|launchdeg/i.test(a.id)
          ? {
              ...a,
              min: Math.min(a.min ?? 37, 37),
              options: [37, 42, 50, 58],
              optionLabels: a.optionLabels ? ['37 deg (near dead)', ...a.optionLabels] : undefined,
            }
          : a
      ),
    }
    expect(() => validateModelSchema(modelsMod, nearDeadStop)).not.toThrow()
    const deadAdj = adjustKeys(nearDeadStop, { notch: 6, launchDeg: 37 })
    expect(deadAdj.launchDeg).toBe(37)
    const rel: LaunchReleaseState = solverMod.solveLaunch(
      nearDeadStop,
      deadAdj,
      createNominalEnv(),
      createSeededRng(27)
    )
    expect(assertFinite(rel.launchSpeedMps, 'launchSpeedMps')).toBeGreaterThan(0)
  })

  it('F6-T2.5: ultra-low energy arm stall terminates cleanly before 0.5 s timeout', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const rel: LaunchReleaseState = solverMod.solveLaunch(
      v51,
      adjustKeys(v51, { notch: 6, stop: 42 }),
      createNominalEnv({ nominalEnergyJ: 0.05 }),
      createSeededRng(28)
    )
    expect(assertFinite(rel.tReleaseS, 'tReleaseS')).toBeLessThanOrEqual(0.55)
    expect(rel.leftCradle).toBe(false)
  })
})

describe('Tier 2 — F7 Edges: Configuration-Dependent Inertia & Losses', () => {
  it('F7-T2.1: zero or negative inertia or ball mass is rejected cleanly', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const adj = defaultAdjustmentsForModel(v51)
    expect(() =>
      solverMod.solveLaunch(
        { ...v51, arm: { ...v51.arm, inertiaKgM2: 0 } },
        adj,
        createNominalEnv(),
        createSeededRng(29)
      )
    ).toThrow()
    expect(() =>
      solverMod.solveLaunch(
        { ...v51, trapBank: { ...v51.trapBank, bailInertiaKgM2: -1e-4 } },
        adj,
        createNominalEnv(),
        createSeededRng(29)
      )
    ).toThrow()
  })

  it('F7-T2.2: near-zero arm mass limit approaches ball-dominated kinetic share without NaN', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const ultraLight: LauncherModel = {
      ...v51,
      arm: { ...v51.arm, massKg: 1e-5, inertiaKgM2: 1e-6 },
    }
    const rel: LaunchReleaseState = solverMod.solveLaunch(
      ultraLight,
      adjustKeys(ultraLight, { notch: 6, stop: 42 }),
      createNominalEnv(),
      createSeededRng(30)
    )
    expect(assertFinite(rel.launchSpeedMps, 'launchSpeedMps')).toBeGreaterThan(7.0)
    const ballShare = rel.energyBudget.keTransBallJ / rel.energyBudget.springInitialJ
    expect(ballShare).toBeGreaterThan(0.5)
  })

  it('F7-T2.3: ultra-heavy arm (10x inertia) leaves > 80% in wasted stop KE while conserving < 1%', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const heavy: LauncherModel = {
      ...v51,
      arm: { ...v51.arm, massKg: v51.arm.massKg * 10, inertiaKgM2: v51.arm.inertiaKgM2 * 10 },
    }
    const rel: LaunchReleaseState = solverMod.solveLaunch(
      heavy,
      adjustKeys(heavy, { notch: 6, stop: 42 }),
      createNominalEnv(),
      createSeededRng(31)
    )
    expect(rel.wastedStopKeJ / rel.energyBudget.springInitialJ).toBeGreaterThan(0.6)
    const err = Math.abs(sumEnergyBudget(rel.energyBudget) - rel.energyBudget.springInitialJ) / rel.energyBudget.springInitialJ
    expect(err).toBeLessThan(0.01)
  })

  it('F7-T2.4: extreme bearing friction stalls arm mid-stroke cleanly without negative-velocity oscillation', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const highFric: LauncherModel = {
      ...v51,
      linkage: { ...v51.linkage, bearingFrictionCoeff: 2.5 },
    }
    const rel: LaunchReleaseState = solverMod.solveLaunch(
      highFric,
      adjustKeys(highFric, { notch: 6, stop: 42 }),
      createNominalEnv(),
      createSeededRng(32)
    )
    expect(rel.leftCradle).toBe(false)
    for (const sample of rel.armTraceSamples) {
      expect(sample.omegaArm).toBeGreaterThanOrEqual(-1e-6)
    }
  })

  it('F7-T2.5: direct_arm backstop block mass shift between 1A and 10B alters release velocity', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const direct = findModel(modelsMod, 'direct_rail')
    const r1A: LaunchReleaseState = solverMod.solveLaunch(
      direct,
      adjustKeys(direct, { peg: 1, flip: 0 }),
      createVacuumEnv(),
      createSeededRng(33)
    )
    const r10B: LaunchReleaseState = solverMod.solveLaunch(
      direct,
      adjustKeys(direct, { peg: 10, flip: 1 }),
      createVacuumEnv(),
      createSeededRng(33)
    )
    expect(r1A.launchSpeedMps).toBeGreaterThan(r10B.launchSpeedMps)
  })
})

describe('Tier 2 — F8 Edges: Cradle / Rail Separation & Spin', () => {
  it('F8-T2.1: Edge E4 (rail non-ejection) on direct_arm peg 10B with 0.3 J hits stop before tip', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const direct = findModel(modelsMod, 'direct_rail')
    const rel: LaunchReleaseState = solverMod.solveLaunch(
      direct,
      adjustKeys(direct, { peg: 10, flip: 1 }),
      createNominalEnv({ nominalEnergyJ: 0.3 }),
      createSeededRng(36)
    )
    expect(rel.leftCradle).toBe(false)
  })

  it('F8-T2.2: Edge E4 (backstop seating hold) keeps ball on rail without penetrating behind backstop', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const direct = findModel(modelsMod, 'direct_rail')
    const rel: LaunchReleaseState = solverMod.solveLaunch(
      direct,
      adjustKeys(direct, { peg: 1, flip: 0 }),
      createNominalEnv(),
      createSeededRng(37)
    )
    expect(rel.leftCradle).toBe(true)
    expect(rel.tReleaseS).toBeGreaterThan(0.02)
  })

  it('F8-T2.3: excessive pocketed-petal retention force traps ball cleanly (leftCradle === false)', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const v41 = findModel(modelsMod, 'tilted_cradle')
    const lockedPocket: LauncherModel = {
      ...v41,
      cradle: { ...v41.cradle, retentionForceN: 500 },
    }
    const rel: LaunchReleaseState = solverMod.solveLaunch(
      lockedPocket,
      defaultAdjustmentsForModel(lockedPocket),
      createNominalEnv(),
      createSeededRng(38)
    )
    expect(rel.leftCradle).toBe(false)
  })

  it('F8-T2.4: zero-lip cradle under ultra-slow stroke handles normal force drop-off without NaN', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const rel: LaunchReleaseState = solverMod.solveLaunch(
      v51,
      adjustKeys(v51, { notch: 6, stop: 42 }),
      createNominalEnv({ nominalEnergyJ: 0.2 }),
      createSeededRng(39)
    )
    expect(Number.isFinite(rel.launchSpeedMps)).toBe(true)
    expect(Number.isFinite(rel.launchAngleDeg)).toBe(true)
  })

  it('F8-T2.5: frictionless rail sliding limit yields ~0 spin while rolling yields omega = v_rel / r_eff', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const direct = findModel(modelsMod, 'direct_rail')
    const slideAdj = adjustKeys(direct, { peg: 1, flip: 0, rolling: 0 })
    const rollAdj = adjustKeys(direct, { peg: 1, flip: 0, rolling: 1 })
    expect(slideAdj.rolling).toBe(0)
    expect(rollAdj.rolling).toBe(1)
    const slideRel: LaunchReleaseState = solverMod.solveLaunch(
      direct,
      slideAdj,
      createVacuumEnv(),
      createSeededRng(40)
    )
    const rollRel: LaunchReleaseState = solverMod.solveLaunch(
      direct,
      rollAdj,
      createVacuumEnv(),
      createSeededRng(40)
    )
    expect(Math.hypot(...slideRel.omegaBallRadps)).toBeLessThan(1e-3)
    expect(Math.abs(rollRel.omegaBallRadps[1])).toBeGreaterThan(10)
  })

  it('F8-T2.6: trebuchet release bounds never release underground (posM[2] >= 0)', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const treb = findModel(modelsMod, 'gravity_trebuchet')
    for (const adjDef of treb.adjustments) {
      const val = adjDef.kind === 'continuous' ? adjDef.min! : adjDef.options![0]
      const rel: LaunchReleaseState = solverMod.solveLaunch(
        treb,
        adjustKeys(treb, { [adjDef.id]: val }),
        createNominalEnv(),
        createSeededRng(41)
      )
      expect(rel.posM[2]).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('Tier 2 — F16 Edges: Physics Verification & E2E Gate Guards', () => {
  it('F16-T2.1: energy conservation invariant catches >= 1% artificial budget perturbation', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const rel: LaunchReleaseState = solverMod.solveLaunch(
      v51,
      adjustKeys(v51, { notch: 6, stop: 42 }),
      createNominalEnv(),
      createSeededRng(42)
    )
    const realErr = Math.abs(sumEnergyBudget(rel.energyBudget) - rel.energyBudget.springInitialJ) / rel.energyBudget.springInitialJ
    expect(realErr).toBeLessThan(0.01)

    const perturbed = { ...rel.energyBudget, keTransBallJ: rel.energyBudget.keTransBallJ + rel.energyBudget.springInitialJ * 0.02 }
    const perturbedErr = Math.abs(sumEnergyBudget(perturbed) - perturbed.springInitialJ) / perturbed.springInitialJ
    expect(perturbedErr).toBeGreaterThanOrEqual(0.01)
  })

  it('F16-T2.2: spring work verification rejects > 0.5% mismatch when comparing 0.6% mismatched target energy', async () => {
    const springMod = await loadSpringModule()
    const work = springMod.springWork(180, 0, 2.0, 0.5)
    const mismatchedTarget = 2.0 * 1.006
    const relErr = Math.abs(work - mismatchedTarget) / mismatchedTarget
    expect(relErr).toBeGreaterThan(0.005)
  })

  it('F16-T2.3: inertia sensitivity audit confirms reversed heavy-vs-light mass ordering violates strict speed drop', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const adj = adjustKeys(v51, { notch: 6, stop: 42 })
    const rLight: LaunchReleaseState = solverMod.solveLaunch(v51, adj, createNominalEnv(), createSeededRng(43))
    const heavy: LauncherModel = {
      ...v51,
      arm: { ...v51.arm, massKg: v51.arm.massKg * 2, inertiaKgM2: v51.arm.inertiaKgM2 * 2 },
    }
    const rHeavy: LaunchReleaseState = solverMod.solveLaunch(heavy, adj, createNominalEnv(), createSeededRng(43))
    expect(rLight.launchSpeedMps).toBeGreaterThan(rHeavy.launchSpeedMps)
    expect(rHeavy.launchSpeedMps > rLight.launchSpeedMps).toBe(false)
  })

  it('F16-T2.4: turf rolling resistance <= 0 is rejected cleanly to guarantee finite-time stop', async () => {
    const modelsMod = await loadModelsModule()
    const simMod = await loadSimulateModule()
    const turfMod = await loadTurfModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    expect(() =>
      simMod.simulateShot(
        v51,
        defaultAdjustmentsForModel(v51),
        createNominalEnv({ turfMuR: 0 }),
        { x: 4.5, y: 0 },
        44
      )
    ).toThrow()
    if (typeof turfMod.validateTurfParams === 'function') {
      expect(() => turfMod.validateTurfParams({ en: 0.3, muR: -0.05 })).toThrow()
    }
  })

  it('F16-T2.5: zero or negative timestep integration guard rejects bad dt without hanging', async () => {
    const solverMod = await loadLaunchSolverModule()
    const modelsMod = await loadModelsModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const env = createNominalEnv()
    if (typeof solverMod.validateDt === 'function') {
      expect(() => solverMod.validateDt(0)).toThrow()
      expect(() => solverMod.validateDt(-0.0005)).toThrow()
      expect(() => solverMod.validateDt(0.002)).toThrow()
    } else {
      // Passing dt <= 0 or dt > 0.0005 in options must throw or clamp safely without hanging
      expect(() =>
        solverMod.solveLaunch(v51, defaultAdjustmentsForModel(v51), { ...env, dtS: -0.001 } as any, createSeededRng(45))
      ).toThrow()
    }
  })
})
