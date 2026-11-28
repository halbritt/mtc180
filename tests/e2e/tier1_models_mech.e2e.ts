import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
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
  loadTelemetryModule,
} from './helpers/contracts'
import {
  assertFinite,
  createNominalEnv,
  createSeededRng,
  createTurfPresetEnv,
  createVacuumEnv,
  defaultAdjustmentsForModel,
  REPO_CONSTANTS,
  sumEnergyBudget,
} from './helpers/fixtures'

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))

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

function findModel(modelsMod: Record<string, any>, topology: string, idSubstr?: string): LauncherModel {
  const models = listAllModels(modelsMod)
  const found = models.find(
    (m) => m.topology === topology && (!idSubstr || m.id.toLowerCase().includes(idSubstr.toLowerCase()))
  )
  if (!found) {
    throw new Error(`Model not found for topology=${topology} idSubstr=${idSubstr ?? ''}`)
  }
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

function cloneWithArmScale(model: LauncherModel, scale: number): LauncherModel {
  return {
    ...model,
    arm: {
      ...model.arm,
      massKg: model.arm.massKg * scale,
      inertiaKgM2: model.arm.inertiaKgM2 * scale,
    },
  }
}

describe('Tier 1 — F1: Zero-DOM Pure Physics Engine', () => {
  it('F1-T1.1: simulates full v5.1 Notch 6 @ 42 deg launch-to-rest in pure Node without DOM', async () => {
    expect(typeof window).toBe('undefined')
    expect(typeof document).toBe('undefined')
    const modelsMod = await loadModelsModule()
    const simMod = await loadSimulateModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const adj = adjustKeys(v51, { notch: 6, stop: 42 })
    const res = simMod.simulateShot(v51, adj, createNominalEnv(), { x: 4.8, y: 0 }, 101)
    expect(res.release.leftCradle).toBe(true)
    expect(assertFinite(res.carryDistanceM, 'carryDistanceM')).toBeGreaterThan(2.5)
    expect(assertFinite(res.totalDistanceM, 'totalDistanceM')).toBeGreaterThanOrEqual(res.carryDistanceM)
  })

  it('F1-T1.2: solveLaunch and simulateShot are bit-identical for identical seeds', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const simMod = await loadSimulateModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const adj = defaultAdjustmentsForModel(v51)
    const env = createNominalEnv({ energyVarianceJ: 0.1 })

    const r1: LaunchReleaseState = solverMod.solveLaunch(v51, adj, env, createSeededRng(4242))
    const r2: LaunchReleaseState = solverMod.solveLaunch(v51, adj, env, createSeededRng(4242))
    expect(r1.launchSpeedMps).toBe(r2.launchSpeedMps)
    expect(r1.launchAngleDeg).toBe(r2.launchAngleDeg)
    expect(r1.tReleaseS).toBe(r2.tReleaseS)

    const s1 = simMod.simulateShot(v51, adj, env, { x: 4.0, y: 0 }, 4242)
    const s2 = simMod.simulateShot(v51, adj, env, { x: 4.0, y: 0 }, 4242)
    expect(s1.totalDistanceM).toBe(s2.totalDistanceM)
    expect(s1.carryDistanceM).toBe(s2.carryDistanceM)
    expect(s1.trace).toEqual(s2.trace)
  })

  it('F1-T1.3: RK4 mechanical integration steps maintain dt <= 0.0005 s resolution', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const rel: LaunchReleaseState = solverMod.solveLaunch(
      v51,
      defaultAdjustmentsForModel(v51),
      createNominalEnv(),
      createSeededRng(7)
    )
    expect(rel.armTraceSamples.length).toBeGreaterThan(10)
    for (let i = 1; i < rel.armTraceSamples.length; i++) {
      const dt = rel.armTraceSamples[i].t - rel.armTraceSamples[i - 1].t
      expect(dt).toBeGreaterThan(0)
      expect(dt).toBeLessThanOrEqual(0.0005 + 1e-12)
    }
  })

  it('F1-T1.4: zero forbidden third-party physics libraries in src/physics or src/models', () => {
    const forbidden = ['cannon-es', 'cannon', 'rapier', '@dimforge/rapier', 'ammo.js', 'matter-js']
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
    const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
    for (const bad of forbidden) {
      expect(Object.keys(allDeps)).not.toContain(bad)
    }
    const collectTsFiles = (dir: string): string[] => {
      const files: string[] = []
      for (const name of readdirSync(dir)) {
        const entryPath = join(dir, name)
        const st = statSync(entryPath)
        if (st.isDirectory()) {
          files.push(...collectTsFiles(entryPath))
        } else if (st.isFile() && name.endsWith('.ts') && !name.endsWith('.test.ts')) {
          files.push(entryPath)
        }
      }
      return files
    }
    for (const dir of ['src/physics', 'src/models']) {
      const full = join(ROOT, dir)
      if (!existsSync(full)) continue
      for (const filePath of collectTsFiles(full)) {
        const text = readFileSync(filePath, 'utf8')
        for (const bad of forbidden) {
          expect(text.toLowerCase()).not.toContain(bad)
        }
        expect(text).not.toMatch(/\b(window|document)\./)
      }
    }
  })

  it('F1-T1.5: simulateShot trace passes existing telemetry.measure() without adapter loss', async () => {
    const modelsMod = await loadModelsModule()
    const simMod = await loadSimulateModule()
    const telMod = await loadTelemetryModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const target = { x: 4.5, y: 0.1 }
    const res = simMod.simulateShot(v51, defaultAdjustmentsForModel(v51), createNominalEnv(), target, 99)
    const measured = telMod.measure(res.trace, target)
    expect(assertFinite(measured.carry, 'carry')).toBeCloseTo(res.carryDistanceM, 4)
    expect(assertFinite(measured.total, 'total')).toBeCloseTo(res.totalDistanceM, 4)
    expect(assertFinite(measured.rollout, 'rollout')).toBeGreaterThanOrEqual(0)
    expect(assertFinite(measured.apex, 'apex')).toBeGreaterThan(0)
  })
})

describe('Tier 1 — F2: Declarative Launcher Schema', () => {
  it('F2-T1.1: registry lists all 4 repository designs with exact topologies', async () => {
    const modelsMod = await loadModelsModule()
    const models = listAllModels(modelsMod)
    const topologies = new Set(models.map((m) => m.topology))
    expect(topologies.has('cord_horn')).toBe(true)
    expect(topologies.has('circular_cam')).toBe(true)
    expect(topologies.has('direct_rail')).toBe(true)
    expect(topologies.has('tilted_cradle')).toBe(true)
  })

  it('F2-T1.2: registry includes candidate topologies (1-trap/2-trap direct-arm and gravity_trebuchet)', async () => {
    const modelsMod = await loadModelsModule()
    const models = listAllModels(modelsMod)
    const treb = models.find((m) => m.topology === 'gravity_trebuchet')
    expect(treb).toBeDefined()
    const oneOrTwoTrap = models.filter((m) => m.trapBank.count === 1 || m.trapBank.count === 2)
    expect(oneOrTwoTrap.length).toBeGreaterThanOrEqual(2)
  })

  it('F2-T1.3: v5.1 schema encodes exact repo geometry, 3 traps, and rubric dimensions', async () => {
    const modelsMod = await loadModelsModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    expect(v51.trapBank.count).toBe(3)
    expect(v51.arm.lengthBallM).toBeCloseTo(0.1713, 2)
    expect(v51.rubricCompliance.baseFits2ft).toBe(true)
    expect(v51.rubricCompliance.diameterMm).toBeLessThan(REPO_CONSTANTS.MAX_DIAMETER_MM)
  })

  it('F2-T1.4: gravity_trebuchet schema declares 0 mousetraps and trebuchet equipment bonus', async () => {
    const modelsMod = await loadModelsModule()
    const treb = findModel(modelsMod, 'gravity_trebuchet')
    expect(treb.trapBank.count).toBe(0)
    expect(['trebuchet', 'both']).toContain(treb.rubricCompliance.equipmentBonus)
  })

  it('F2-T1.5: every registered model passes validateModel cleanly', async () => {
    const modelsMod = await loadModelsModule()
    const models = listAllModels(modelsMod)
    expect(models.length).toBeGreaterThanOrEqual(6)
    for (const model of models) {
      expect(() => validateModelSchema(modelsMod, model)).not.toThrow()
    }
  })
})

describe('Tier 1 — F3: Per-Model Adjustment DOFs', () => {
  it('F3-T1.1: v5.1 exposes discrete stop angles {42, 50, 58}, 6 notches, and continuous yaw DOF', async () => {
    const modelsMod = await loadModelsModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const stopDef = v51.adjustments.find((a) => /stop|launchdeg/i.test(a.id))
    const notchDef = v51.adjustments.find((a) => a.id.toLowerCase().includes('notch'))
    const yawDef = v51.adjustments.find((a) => a.id.toLowerCase().includes('yaw'))
    expect(stopDef?.options).toEqual([42, 50, 58])
    expect(notchDef).toBeDefined()
    expect(notchDef!.options).toEqual([1, 2, 3, 4, 5, 6])
    expect(yawDef?.kind).toBe('continuous')
    expect(yawDef?.min).toBeLessThan(0)
    expect(yawDef?.max).toBeGreaterThan(0)
  })

  it('F3-T1.2: direct_arm exposes 20 discrete backstop stations and yaw DOF without cord stop pin', async () => {
    const modelsMod = await loadModelsModule()
    const direct = findModel(modelsMod, 'direct_rail')
    const pegDef = direct.adjustments.find((a) => a.id.toLowerCase().includes('peg'))
    const flipDef = direct.adjustments.find((a) => a.id.toLowerCase().includes('flip'))
    const stopDef = direct.adjustments.find((a) => a.id.toLowerCase().includes('stop'))
    expect(pegDef).toBeDefined()
    expect(flipDef).toBeDefined()
    expect(stopDef).toBeUndefined()
    const pegCount = pegDef?.options?.length ?? ((pegDef?.max ?? 0) - (pegDef?.min ?? 1) + 1)
    const flipCount = flipDef?.options?.length ?? 2
    expect(pegCount * flipCount).toBe(20)
    expect(typeof modelsMod.computeDirectArmPegPositions).toBe('function')
    const pegPositions = modelsMod.computeDirectArmPegPositions(direct.cradle.railGeometry)
    expect(pegPositions).toHaveLength(20)
    for (const pos of pegPositions) {
      expect(pos.zBotMm).toBeLessThan(REPO_CONSTANTS.THREE_INCHES_M * 1000)
    }
  })

  it('F3-T1.3: v4.1 exposes frame pitch DOF that shifts launch elevation monotonically', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const v41 = findModel(modelsMod, 'tilted_cradle')
    const pitchDef = v41.adjustments.find(
      (a) => /pitch|beta|tilt|frame|launchdeg/i.test(a.id)
    )
    expect(pitchDef).toBeDefined()
    const lowVal = pitchDef!.options ? pitchDef!.options[0] : pitchDef!.min!
    const highVal = pitchDef!.options ? pitchDef!.options[pitchDef!.options.length - 1] : pitchDef!.max!
    expect(highVal).toBeGreaterThan(lowVal)
    const rLow = solverMod.solveLaunch(v41, adjustKeys(v41, { [pitchDef!.id]: lowVal }), createNominalEnv(), createSeededRng(1))
    const rHigh = solverMod.solveLaunch(v41, adjustKeys(v41, { [pitchDef!.id]: highVal }), createNominalEnv(), createSeededRng(1))
    expect(rLow.launchAngleDeg).not.toBeCloseTo(rHigh.launchAngleDeg, 1)
  })

  it('F3-T1.4: gravity_trebuchet, inclined_ramp, and direct_cup expose valid DOFs with launch sensitivity', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const treb = findModel(modelsMod, 'gravity_trebuchet')
    expect(treb.adjustments.length).toBeGreaterThanOrEqual(2)
    for (const adj of treb.adjustments) {
      if (adj.kind === 'continuous') {
        expect(adj.max!).toBeGreaterThan(adj.min!)
      } else {
        expect(adj.options!.length).toBeGreaterThanOrEqual(2)
      }
    }

    const env = createNominalEnv()
    const cwDef = treb.adjustments.find((a) => a.id === 'counterweightKg')!
    const rCwLo = solverMod.solveLaunch(treb, adjustKeys(treb, { counterweightKg: cwDef.min! }), env, createSeededRng(10))
    const rCwHi = solverMod.solveLaunch(treb, adjustKeys(treb, { counterweightKg: cwDef.max! }), env, createSeededRng(10))
    expect(rCwHi.launchSpeedMps).toBeGreaterThan(rCwLo.launchSpeedMps)

    const dropDef = treb.adjustments.find((a) => a.id === 'dropHeightM')!
    const rDropLo = solverMod.solveLaunch(treb, adjustKeys(treb, { dropHeightM: dropDef.min! }), env, createSeededRng(10))
    const rDropHi = solverMod.solveLaunch(treb, adjustKeys(treb, { dropHeightM: dropDef.max! }), env, createSeededRng(10))
    expect(rDropHi.launchSpeedMps).toBeGreaterThan(rDropLo.launchSpeedMps)

    const pinDef = treb.adjustments.find((a) => a.id === 'releasePinAngleDeg')!
    const rPinLo = solverMod.solveLaunch(treb, adjustKeys(treb, { releasePinAngleDeg: pinDef.min! }), env, createSeededRng(10))
    const rPinHi = solverMod.solveLaunch(treb, adjustKeys(treb, { releasePinAngleDeg: pinDef.max! }), env, createSeededRng(10))
    expect(rPinHi.launchAngleDeg).not.toBeCloseTo(rPinLo.launchAngleDeg, 1)

    const slingDef = treb.adjustments.find((a) => a.id === 'slingLengthM')!
    const rSlingLo = solverMod.solveLaunch(treb, adjustKeys(treb, { slingLengthM: slingDef.min! }), env, createSeededRng(10))
    const rSlingHi = solverMod.solveLaunch(treb, adjustKeys(treb, { slingLengthM: slingDef.max! }), env, createSeededRng(10))
    expect(
      Math.abs(rSlingHi.launchSpeedMps - rSlingLo.launchSpeedMps) > 1e-3 ||
        Math.abs(rSlingHi.launchAngleDeg - rSlingLo.launchAngleDeg) > 0.1
    ).toBe(true)

    const ramp = findModel(modelsMod, 'inclined_ramp')
    const rRampLo = solverMod.solveLaunch(ramp, adjustKeys(ramp, { rampAngleDeg: 28 }), env, createSeededRng(10))
    const rRampHi = solverMod.solveLaunch(ramp, adjustKeys(ramp, { rampAngleDeg: 52 }), env, createSeededRng(10))
    expect(rRampHi.launchAngleDeg).toBeGreaterThan(rRampLo.launchAngleDeg)
    const rRampCockLo = solverMod.solveLaunch(ramp, adjustKeys(ramp, { cockAngleDeg: 100 }), env, createSeededRng(10))
    const rRampCockHi = solverMod.solveLaunch(ramp, adjustKeys(ramp, { cockAngleDeg: 171 }), env, createSeededRng(10))
    expect(rRampCockHi.launchSpeedMps).toBeGreaterThan(rRampCockLo.launchSpeedMps)

    const cup = findModel(modelsMod, 'direct_cup')
    const rCupStopLo = solverMod.solveLaunch(cup, adjustKeys(cup, { stopAngleDeg: 115 }), env, createSeededRng(10))
    const rCupStopHi = solverMod.solveLaunch(cup, adjustKeys(cup, { stopAngleDeg: 150 }), env, createSeededRng(10))
    expect(rCupStopHi.launchAngleDeg).not.toBeCloseTo(rCupStopLo.launchAngleDeg, 1)
    const rCupCockLo = solverMod.solveLaunch(cup, adjustKeys(cup, { cockAngleDeg: 145 }), env, createSeededRng(10))
    const rCupCockHi = solverMod.solveLaunch(cup, adjustKeys(cup, { cockAngleDeg: 173 }), env, createSeededRng(10))
    expect(rCupCockHi.launchSpeedMps).toBeGreaterThan(rCupCockLo.launchSpeedMps)
  })

  it('F3-T1.5: default adjustments for every registered model validate and launch cleanly', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const models = listAllModels(modelsMod)
    for (const model of models) {
      const def = defaultAdjustmentsForModel(model)
      expect(() => validateModelAdjustments(modelsMod, model, def)).not.toThrow()
      const rel: LaunchReleaseState = solverMod.solveLaunch(model, def, createNominalEnv(), createSeededRng(12))
      expect(assertFinite(rel.launchSpeedMps, `${model.id}.speed`)).toBeGreaterThan(0)
    }
  })
})

describe('Tier 1 — F5: Linear Torsion Spring & Bank', () => {
  it('F5-T1.1: numerical integration of tau(theta) over 180 deg matches 2.12 J and 2.0 J within < 0.5%', async () => {
    const springMod = await loadSpringModule()
    for (const targetE of [REPO_CONSTANTS.E_SPRING_NOMINAL, REPO_CONSTANTS.E_SPRING_TWO_J]) {
      const steps = 1800
      const dThetaDeg = 180 / steps
      const dThetaRad = (dThetaDeg * Math.PI) / 180
      let numericJ = 0
      for (let i = 0; i < steps; i++) {
        const th0 = i * dThetaDeg
        const th1 = (i + 1) * dThetaDeg
        const t0 = springMod.springTorque(th0, targetE, REPO_CONSTANTS.TORQUE_RATIO)
        const t1 = springMod.springTorque(th1, targetE, REPO_CONSTANTS.TORQUE_RATIO)
        numericJ += 0.5 * (t0 + t1) * dThetaRad
      }
      const relErr = Math.abs(numericJ - targetE) / targetE
      expect(relErr).toBeLessThan(0.005)
    }
  })

  it('F5-T1.2: linear torque ratio satisfies tau(0) / tau(180) === torqueRatio (0.5)', async () => {
    const springMod = await loadSpringModule()
    const t0 = springMod.springTorque(0, 2.12, 0.5)
    const t180 = springMod.springTorque(180, 2.12, 0.5)
    expect(t0 / t180).toBeCloseTo(0.5, 6)
  })

  it('F5-T1.3: scaling trap count 1 -> 2 -> 3 at fixed per-trap energy scales total work 1x : 2x : 3x', async () => {
    const springMod = await loadSpringModule()
    const perTrapJ = REPO_CONSTANTS.E_SPRING_NOMINAL / 3
    const w1 = springMod.springWork(180, 0, perTrapJ * 1, 0.5)
    const w2 = springMod.springWork(180, 0, perTrapJ * 2, 0.5)
    const w3 = springMod.springWork(180, 0, perTrapJ * 3, 0.5)
    expect(w2 / w1).toBeCloseTo(2.0, 4)
    expect(w3 / w1).toBeCloseTo(3.0, 4)
  })

  it('F5-T1.4: stochastic energy variance across 100 seeded trials produces expected mean and spread', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const v51ZeroTol: LauncherModel = {
      ...v51,
      tolerances: {
        ...v51.tolerances,
        cockAngleSigmaDeg: 0,
        seatingOffsetSigmaM: 0,
        yawSigmaDeg: 0,
        stopAngleSigmaDeg: 0,
      },
    }
    const adj = defaultAdjustmentsForModel(v51ZeroTol)
    const env = createNominalEnv({ nominalEnergyJ: 2.0, energyVarianceJ: 0.1, energyDistribution: 'uniform' })
    const rng = createSeededRng(777)
    const storedEnergies: number[] = []
    const releasedEnergies: number[] = []
    for (let i = 0; i < 100; i++) {
      const rel: LaunchReleaseState = solverMod.solveLaunch(v51ZeroTol, adj, env, rng)
      storedEnergies.push(
        rel.springTotalStoredJ ?? rel.energyBudget.springInitialJ + (rel.springResidualPeJ ?? 0)
      )
      releasedEnergies.push(rel.energyBudget.springInitialJ)
    }
    const meanStored = storedEnergies.reduce((a, b) => a + b, 0) / storedEnergies.length
    const stdStored = Math.sqrt(
      storedEnergies.reduce((a, b) => a + (b - meanStored) ** 2, 0) / storedEnergies.length
    )
    const meanReleased = releasedEnergies.reduce((a, b) => a + b, 0) / releasedEnergies.length
    expect(meanStored).toBeGreaterThan(1.75)
    expect(meanStored).toBeLessThan(2.15)
    expect(stdStored).toBeGreaterThan(0.03)
    expect(meanReleased).toBeGreaterThan(1.3)

    const envZero = createNominalEnv({ nominalEnergyJ: 2.0, energyVarianceJ: 0.0, energyDistribution: 'uniform' })
    const rngZero = createSeededRng(777)
    const zeroStored: number[] = []
    for (let i = 0; i < 20; i++) {
      const rel: LaunchReleaseState = solverMod.solveLaunch(v51ZeroTol, adj, envZero, rngZero)
      zeroStored.push(
        rel.springTotalStoredJ ?? rel.energyBudget.springInitialJ + (rel.springResidualPeJ ?? 0)
      )
    }
    const meanStoredZero = zeroStored.reduce((a, b) => a + b, 0) / zeroStored.length
    const stdStoredZero = Math.sqrt(
      zeroStored.reduce((a, b) => a + (b - meanStoredZero) ** 2, 0) / zeroStored.length
    )
    expect(stdStoredZero).toBeLessThan(1e-6)
  })

  it('F5-T1.5: partial cocking stroke (120 deg vs 180 deg) matches trapezoidal analytic integral', async () => {
    const springMod = await loadSpringModule()
    const full = springMod.springWork(180, 0, 2.12, 0.5)
    const partial = springMod.springWork(120, 0, 2.12, 0.5)
    const expectedPartial =
      0.5 *
      (springMod.springTorque(0, 2.12, 0.5) + springMod.springTorque(120, 2.12, 0.5)) *
      ((120 * Math.PI) / 180)
    expect(partial).toBeLessThan(full)
    expect(Math.abs(partial - expectedPartial) / expectedPartial).toBeLessThan(0.005)
  })
})

describe('Tier 1 — F6: Linkage, Cam & String Kinematics', () => {
  it('F6-T1.1: v5.1 Notch 6 @ 42 deg matches cam_launch_sim.py release speed (~6.93 m/s)', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const adj = adjustKeys(v51, { notch: 6, stop: 42 })
    const rel: LaunchReleaseState = solverMod.solveLaunch(v51, adj, createVacuumEnv(), createSeededRng(1))
    expect(rel.leftCradle).toBe(true)
    expect(rel.launchSpeedMps).toBeGreaterThan(6.4)
    expect(rel.launchSpeedMps).toBeLessThan(7.4)
  })

  it('F6-T1.2: v5.0 circular cam reproduces mid-stroke cord slack and slower speed (~5.21 m/s)', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const v50 = findModel(modelsMod, 'circular_cam')
    const v51 = findModel(modelsMod, 'cord_horn')
    const rel50: LaunchReleaseState = solverMod.solveLaunch(
      v50,
      defaultAdjustmentsForModel(v50),
      createVacuumEnv(),
      createSeededRng(1)
    )
    const rel51: LaunchReleaseState = solverMod.solveLaunch(
      v51,
      adjustKeys(v51, { notch: 6, stop: 42 }),
      createVacuumEnv(),
      createSeededRng(1)
    )
    expect(rel50.cordSlackAtDeg).not.toBeNull()
    expect(assertFinite(rel50.cordSlackAtDeg ?? NaN, 'cordSlackAtDeg')).toBeLessThan(156)
    expect(rel50.launchSpeedMps).toBeLessThan(rel51.launchSpeedMps)
    expect(rel50.launchSpeedMps).toBeGreaterThan(4.6)
    expect(rel50.launchSpeedMps).toBeLessThan(5.8)
  })

  it('F6-T1.3: direct_arm coaxial kinematics move bails and arm 1:1 without cord slack', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const direct = findModel(modelsMod, 'direct_rail')
    const rel: LaunchReleaseState = solverMod.solveLaunch(
      direct,
      defaultAdjustmentsForModel(direct),
      createNominalEnv(),
      createSeededRng(2)
    )
    expect(rel.cordSlackAtDeg ?? null).toBeNull()
    expect(rel.armTraceSamples.length).toBeGreaterThan(5)
    const first = rel.armTraceSamples[0]
    const last = rel.armTraceSamples[rel.armTraceSamples.length - 1]
    expect(Math.abs(last.thDeg - first.thDeg)).toBeGreaterThan(20)
  })

  it('F6-T1.4: v5.1 horn linkage records positive mechanical advantage and peak cord tension > 0', async () => {
    const modelsMod = await loadModelsModule()
    const linkageMod = await loadLinkageModule()
    const solverMod = await loadLaunchSolverModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const rel: LaunchReleaseState = solverMod.solveLaunch(
      v51,
      adjustKeys(v51, { notch: 6, stop: 42 }),
      createNominalEnv(),
      createSeededRng(3)
    )
    expect(assertFinite(rel.peakCordTensionN ?? NaN, 'peakCordTensionN')).toBeGreaterThan(5)
    if (typeof linkageMod.computeHornLeverArmMm === 'function') {
      expect(linkageMod.computeHornLeverArmMm(0)).toBeGreaterThan(0)
    }
  })

  it('F6-T1.5: gravity_trebuchet couples counterweight drop and sling rotation before release', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const treb = findModel(modelsMod, 'gravity_trebuchet')
    const rel: LaunchReleaseState = solverMod.solveLaunch(
      treb,
      defaultAdjustmentsForModel(treb),
      createNominalEnv(),
      createSeededRng(4)
    )
    expect(rel.leftCradle).toBe(true)
    expect(rel.launchSpeedMps).toBeGreaterThan(1.5)
    expect(rel.energyBudget.springInitialJ).toBeGreaterThan(0)
  })
})

describe('Tier 1 — F7: Configuration-Dependent Inertia & Losses', () => {
  it('F7-T1.1: direct_arm total inertia shifts with radial ball station (inner peg vs outer peg)', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const direct = findModel(modelsMod, 'direct_rail')
    const inner = solverMod.solveLaunch(direct, adjustKeys(direct, { peg: 1, flip: 0 }), createNominalEnv(), createSeededRng(5))
    const outer = solverMod.solveLaunch(direct, adjustKeys(direct, { peg: 10, flip: 1 }), createNominalEnv(), createSeededRng(5))
    expect(inner.launchSpeedMps).not.toBeCloseTo(outer.launchSpeedMps, 2)
    expect(inner.tReleaseS).not.toBeCloseTo(outer.tReleaseS, 3)
  })

  it('F7-T1.2: release instant energy budget balances within < 1% (DISPATCH §5.2)', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const rel: LaunchReleaseState = solverMod.solveLaunch(
      v51,
      adjustKeys(v51, { notch: 6, stop: 42 }),
      createNominalEnv(),
      createSeededRng(8)
    )
    const initial = rel.energyBudget.springInitialJ
    const accounted = sumEnergyBudget(rel.energyBudget)
    expect(initial).toBeGreaterThan(0)
    expect(Math.abs(accounted - initial) / initial).toBeLessThan(0.01)
  })

  it('F7-T1.3: increasing arm mass/inertia strictly decreases ball speed and increases wasted hard-stop KE', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const adj = adjustKeys(v51, { notch: 6, stop: 42 })
    const env = createNominalEnv()
    const rLight: LaunchReleaseState = solverMod.solveLaunch(cloneWithArmScale(v51, 0.5), adj, env, createSeededRng(9))
    const rBase: LaunchReleaseState = solverMod.solveLaunch(cloneWithArmScale(v51, 1.0), adj, env, createSeededRng(9))
    const rHeavy: LaunchReleaseState = solverMod.solveLaunch(cloneWithArmScale(v51, 2.0), adj, env, createSeededRng(9))

    expect(rLight.launchSpeedMps).toBeGreaterThan(rBase.launchSpeedMps)
    expect(rBase.launchSpeedMps).toBeGreaterThan(rHeavy.launchSpeedMps)
    expect(rHeavy.wastedStopKeJ).toBeGreaterThan(rBase.wastedStopKeJ)
    expect(rBase.wastedStopKeJ).toBeGreaterThan(rLight.wastedStopKeJ)
  })

  it('F7-T1.4: increasing pivot bearing friction decreases launch speed and increases frictionLossJ while conserving < 1%', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const adj = adjustKeys(v51, { notch: 6, stop: 42 })
    const lowFricModel: LauncherModel = {
      ...v51,
      linkage: { ...v51.linkage, bearingFrictionCoeff: 0.005 },
    }
    const highFricModel: LauncherModel = {
      ...v51,
      linkage: { ...v51.linkage, bearingFrictionCoeff: 0.12 },
    }
    const rLow: LaunchReleaseState = solverMod.solveLaunch(lowFricModel, adj, createNominalEnv(), createSeededRng(10))
    const rHigh: LaunchReleaseState = solverMod.solveLaunch(highFricModel, adj, createNominalEnv(), createSeededRng(10))

    expect(rHigh.launchSpeedMps).toBeLessThan(rLow.launchSpeedMps)
    expect(rHigh.energyBudget.frictionLossJ).toBeGreaterThan(rLow.energyBudget.frictionLossJ)
    const errHigh = Math.abs(sumEnergyBudget(rHigh.energyBudget) - rHigh.energyBudget.springInitialJ) / rHigh.energyBudget.springInitialJ
    expect(errHigh).toBeLessThan(0.01)
  })

  it('F7-T1.5: energy transfer efficiency lies strictly in (0%, 100%) with positive wasted hard-stop KE', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const rel: LaunchReleaseState = solverMod.solveLaunch(
      v51,
      adjustKeys(v51, { notch: 6, stop: 42 }),
      createNominalEnv(),
      createSeededRng(11)
    )
    const eff = ((rel.energyBudget.keTransBallJ + rel.energyBudget.keRotBallJ) / rel.energyBudget.springInitialJ) * 100
    expect(eff).toBeGreaterThan(5)
    expect(eff).toBeLessThan(95)
    expect(rel.wastedStopKeJ).toBeGreaterThan(0)
  })
})

describe('Tier 1 — F8: Cradle / Rail Separation & Spin', () => {
  it('F8-T1.1: v5.1 zero-lip V-cradle releases tangentially at hard stop matching stopAngleDeg', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    for (const stopDeg of [42, 50, 58]) {
      const rel: LaunchReleaseState = solverMod.solveLaunch(
        v51,
        adjustKeys(v51, { notch: 6, stop: stopDeg }),
        createNominalEnv(),
        createSeededRng(15)
      )
      expect(rel.leftCradle).toBe(true)
      expect(Math.abs(rel.launchAngleDeg - stopDeg)).toBeLessThan(3.0)
    }
  })

  it('F8-T1.2: direct_arm rolling rail (1A) separates off tip before stop (~5.86 m/s, ~33.5 deg)', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const direct = findModel(modelsMod, 'direct_rail')
    const rel: LaunchReleaseState = solverMod.solveLaunch(
      direct,
      adjustKeys(direct, { peg: 1, flip: 0 }),
      createVacuumEnv(),
      createSeededRng(16)
    )
    expect(rel.leftCradle).toBe(true)
    expect(rel.launchSpeedMps).toBeGreaterThan(5.3)
    expect(rel.launchSpeedMps).toBeLessThan(6.4)
    expect(rel.launchAngleDeg).toBeGreaterThan(28)
    expect(rel.launchAngleDeg).toBeLessThan(40)
  })

  it('F8-T1.3: direct_arm rolling vs frictionless sliding imparts distinct ball spin and carry', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const direct = findModel(modelsMod, 'direct_rail')
    const rollingAdj = adjustKeys(direct, { peg: 1, flip: 0, rolling: 1 })
    const slidingAdj = adjustKeys(direct, { peg: 1, flip: 0, rolling: 0 })
    expect(rollingAdj.rolling).toBe(1)
    expect(slidingAdj.rolling).toBe(0)
    const rollingRel: LaunchReleaseState = solverMod.solveLaunch(direct, rollingAdj, createVacuumEnv(), createSeededRng(17))
    const slidingRel: LaunchReleaseState = solverMod.solveLaunch(direct, slidingAdj, createVacuumEnv(), createSeededRng(17))
    const rollSpinMag = Math.hypot(...rollingRel.omegaBallRadps)
    const slideSpinMag = Math.hypot(...slidingRel.omegaBallRadps)
    expect(rollSpinMag).toBeGreaterThan(10)
    expect(slideSpinMag).toBeLessThan(rollSpinMag)
  })

  it('F8-T1.4: v4.1 pocketed-petal cradle deducts retention energy cleanly without trapping under 3-trap energy', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const v41 = findModel(modelsMod, 'tilted_cradle')
    expect(v41.cradle.type).toBe('pocketed_petals')
    expect(v41.cradle.retentionForceN).toBeGreaterThan(0)
    const rel: LaunchReleaseState = solverMod.solveLaunch(
      v41,
      defaultAdjustmentsForModel(v41),
      createNominalEnv(),
      createSeededRng(18)
    )
    expect(rel.leftCradle).toBe(true)
    expect(rel.launchSpeedMps).toBeGreaterThan(2.0)

    const zeroRetModel: LauncherModel = { ...v41, cradle: { ...v41.cradle, retentionForceN: 0 } }
    const zeroRetRel: LaunchReleaseState = solverMod.solveLaunch(
      zeroRetModel,
      defaultAdjustmentsForModel(v41),
      createNominalEnv(),
      createSeededRng(18)
    )
    expect(rel.launchSpeedMps).toBeLessThanOrEqual(zeroRetRel.launchSpeedMps)
  })

  it('F8-T1.5: gravity_trebuchet sling-pouch releases forward (+vx) and upward (+vz)', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const treb = findModel(modelsMod, 'gravity_trebuchet')
    const rel: LaunchReleaseState = solverMod.solveLaunch(
      treb,
      defaultAdjustmentsForModel(treb),
      createNominalEnv(),
      createSeededRng(19)
    )
    expect(rel.leftCradle).toBe(true)
    expect(rel.velMps[0]).toBeGreaterThan(0)
    expect(rel.velMps[2]).toBeGreaterThan(0)
  })

  it('F8-T1.6: rolling direct_arm imparts physically consistent backspin vector', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const direct = findModel(modelsMod, 'direct_rail')
    const rel: LaunchReleaseState = solverMod.solveLaunch(
      direct,
      adjustKeys(direct, { peg: 1, flip: 0, rolling: 1 }),
      createNominalEnv(),
      createSeededRng(20)
    )
    // Right-handed pitch spin axis (x-downrange, y-crossrange, z-up): backspin has negative omega_y
    expect(rel.omegaBallRadps[1]).toBeLessThan(-10)
  })
})

describe('Tier 1 — F16: Physics Verification & E2E Gate', () => {
  it('F16-T1.1: automated spring work integration < 0.5% error across all mousetrap models', async () => {
    const modelsMod = await loadModelsModule()
    const springMod = await loadSpringModule()
    const models = listAllModels(modelsMod).filter((m) => m.trapBank.count > 0)
    expect(models.length).toBeGreaterThanOrEqual(5)
    for (const model of models) {
      const eTotal = model.trapBank.count * model.trapBank.nominalEnergyPerTrapJ
      const th0 = model.trapBank.thRestDeg
      const th1 = model.trapBank.thCockMaxDeg
      const steps = 1000
      const dDeg = (th1 - th0) / steps
      const dRad = (dDeg * Math.PI) / 180
      let integral = 0
      for (let i = 0; i < steps; i++) {
        const t0 = springMod.springTorque(th0 + i * dDeg, eTotal, model.trapBank.torqueRatio)
        const t1 = springMod.springTorque(th0 + (i + 1) * dDeg, eTotal, model.trapBank.torqueRatio)
        integral += 0.5 * (t0 + t1) * dRad
      }
      const analytic = springMod.springWork(th1, th0, eTotal, model.trapBank.torqueRatio)
      expect(Math.abs(integral - analytic) / analytic).toBeLessThan(0.005)
    }
  })

  it('F16-T1.2: conservation of energy budget < 1.0% across all registered models', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const models = listAllModels(modelsMod)
    for (const model of models) {
      const rel: LaunchReleaseState = solverMod.solveLaunch(
        model,
        defaultAdjustmentsForModel(model),
        createNominalEnv(),
        createSeededRng(33)
      )
      const initial = rel.energyBudget.springInitialJ
      const accounted = sumEnergyBudget(rel.energyBudget)
      expect(Math.abs(accounted - initial) / initial).toBeLessThan(0.01)
    }
  })

  it('F16-T1.3: inertia sensitivity check confirms monotonic speed drop and wasted-KE rise across 0.5x, 1x, 2x', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const adj = adjustKeys(v51, { notch: 6, stop: 42 })
    const scales = [0.5, 1.0, 2.0]
    const speeds: number[] = []
    const wasted: number[] = []
    for (const s of scales) {
      const rel: LaunchReleaseState = solverMod.solveLaunch(
        cloneWithArmScale(v51, s),
        adj,
        createNominalEnv(),
        createSeededRng(34)
      )
      speeds.push(rel.launchSpeedMps)
      wasted.push(rel.wastedStopKeJ)
    }
    expect(speeds[0]).toBeGreaterThan(speeds[1])
    expect(speeds[1]).toBeGreaterThan(speeds[2])
    expect(wasted[2]).toBeGreaterThan(wasted[1])
    expect(wasted[1]).toBeGreaterThan(wasted[0])
  })

  it('F16-T1.4: turf termination reaches exact v = 0 rest event in finite time across all turf presets', async () => {
    const modelsMod = await loadModelsModule()
    const simMod = await loadSimulateModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const adj = adjustKeys(v51, { notch: 6, stop: 42 })
    for (const preset of ['firm', 'soft', 'wet', 'dry'] as const) {
      const res = simMod.simulateShot(v51, adj, createTurfPresetEnv(preset), { x: 4.5, y: 0 }, 35)
      const last = res.trace[res.trace.length - 1]
      expect(last.event).toBe('rest')
      expect(last.t).toBeLessThan(30)
      expect(last.z).toBeCloseTo(0, 3)
    }
  })

  it('F16-T1.5: npm test (unit suite) and tsc --noEmit pass cleanly without E2E interference', () => {
    const out = execFileSync('npm', ['test'], { cwd: ROOT, encoding: 'utf8', timeout: 30_000 })
    expect(out).not.toContain('FAIL')
    const tscOut = execFileSync('npx', ['tsc', '--noEmit'], { cwd: ROOT, encoding: 'utf8', timeout: 30_000 })
    expect(tscOut).toBeDefined()
  })
})
