import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  type AdjustmentValues,
  type LauncherModel,
  type MonteCarloRequest,
  M4_SELECTORS,
  loadAeroModule,
  loadAutoSightModule,
  loadModelsModule,
  loadMonteCarloModule,
  loadPracticeModule,
  loadReplayModule,
  loadRubricModule,
  loadSequenceModule,
  loadSimulateModule,
  loadTelemetryModule,
  loadTurfModule,
} from './helpers/contracts'
import {
  assertFinite,
  createNominalEnv,
  createRubricInput,
  createTurfPresetEnv,
  createVacuumEnv,
  defaultAdjustmentsForModel,
  REPO_CONSTANTS,
} from './helpers/fixtures'
import { launchApp, type BrowserAppSession } from './helpers/browser_cdp'
import { runWorkerJob, runWorkerSequence } from './helpers/worker_harness'

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))

function listAllModels(modelsMod: Record<string, any>): LauncherModel[] {
  if (typeof modelsMod.listLauncherModels === 'function') return [...modelsMod.listLauncherModels()]
  if (typeof modelsMod.listModels === 'function') return modelsMod.listModels()
  if (typeof modelsMod.getAllModels === 'function') return modelsMod.getAllModels()
  if (Array.isArray(modelsMod.LAUNCHER_MODELS)) return [...modelsMod.LAUNCHER_MODELS]
  if (Array.isArray(modelsMod.MODELS)) return modelsMod.MODELS
  throw new Error('Models registry must export listLauncherModels() / listModels() / LAUNCHER_MODELS')
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
    const h = hint.toLowerCase()
    const match = model.adjustments.find(
      (a) => a.id === hint || a.id.toLowerCase().includes(h) || a.label.toLowerCase().includes(h)
    )
    if (match) base[match.id] = val
  }
  return base
}

async function withBrowserApp<T>(
  fn: (app: BrowserAppSession) => Promise<T>,
  options: Parameters<typeof launchApp>[0] = {}
): Promise<T> {
  const app = await launchApp(options)
  try {
    return await fn(app)
  } finally {
    await app.close()
  }
}

function resolveFlightFn(aeroMod: Record<string, any>): ((...args: any[]) => any) | undefined {
  return aeroMod.simulateFlight ?? aeroMod.integrateFlight ?? aeroMod.flyProjectile
}

function resolveAutoSightFn(mod: Record<string, any>): (...args: any[]) => any {
  const fn = mod.autoSight ?? mod.calibrateModel ?? mod.solveAutoSight
  if (typeof fn !== 'function') throw new Error('autosight module missing autoSight/calibrateModel export')
  return fn
}

function resolveSequenceFn(mod: Record<string, any>): (...args: any[]) => any {
  const fn = mod.simulateSequence ?? mod.runTimedSequence ?? mod.simulateTimedEvent
  if (typeof fn !== 'function') throw new Error('sequence module missing simulateSequence export')
  return fn
}

function resolveMonteCarloFn(mod: Record<string, any>): (...args: any[]) => any {
  const fn = mod.runMonteCarlo ?? mod.evaluateMonteCarlo
  if (typeof fn !== 'function') throw new Error('montecarlo module missing runMonteCarlo export')
  return fn
}

describe('Tier 1 — F4: Web Worker Monte Carlo Runner', () => {
  it('F4-T1.1: worker executes request and emits progress then done with matching jobId', async () => {
    const modelsMod = await loadModelsModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const direct = findModel(modelsMod, 'direct_rail')
    const req: MonteCarloRequest = {
      jobId: 'job-f4-t1-1',
      models: [v51, direct],
      adjustmentsByModel: {
        [v51.id]: defaultAdjustmentsForModel(v51),
        [direct.id]: defaultAdjustmentsForModel(direct),
      },
      env: createNominalEnv({ energyVarianceJ: 0.1 }),
      rubricConfig: { task: 'day1_distance', timeWindowS: 210, fieldHalfWidthM: 3 },
      trialsPerModel: 20,
      baseSeed: 1001,
    }
    const outcome = await runWorkerJob(req)
    expect(outcome.error).toBeUndefined()
    expect(outcome.done).toBeDefined()
    expect(outcome.done!.jobId).toBe('job-f4-t1-1')
    expect(outcome.progressMessages.length).toBeGreaterThan(0)
    for (const msg of outcome.messages) {
      expect(msg.jobId).toBe('job-f4-t1-1')
    }
  })

  it('F4-T1.2: worker done payload contains full finite summaries and exact landing counts', async () => {
    const modelsMod = await loadModelsModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const v50 = findModel(modelsMod, 'circular_cam')
    const req: MonteCarloRequest = {
      jobId: 'job-f4-t1-2',
      models: [v51, v50],
      adjustmentsByModel: {
        [v51.id]: defaultAdjustmentsForModel(v51),
        [v50.id]: defaultAdjustmentsForModel(v50),
      },
      env: createNominalEnv({ energyVarianceJ: 0.08 }),
      rubricConfig: { task: 'day2_accuracy', target: { x: 3.5, y: 0 }, targetRadiusM: 0.5, timeWindowS: 210 },
      trialsPerModel: 25,
      baseSeed: 2026,
    }
    const outcome = await runWorkerJob(req)
    const results = outcome.done?.results ?? []
    expect(results).toHaveLength(2)
    for (const s of results) {
      assertFinite(s.meanScore, 'meanScore')
      assertFinite(s.medianScore, 'medianScore')
      assertFinite(s.p10Score, 'p10Score')
      assertFinite(s.p90Score, 'p90Score')
      expect(s.p10Score).toBeLessThanOrEqual(s.medianScore + 1e-9)
      expect(s.medianScore).toBeLessThanOrEqual(s.p90Score + 1e-9)
      assertFinite(s.cep95Ellipse.semiMajorM, 'semiMajorM')
      assertFinite(s.cep95Ellipse.semiMinorM, 'semiMinorM')
      expect(s.landings).toHaveLength(25)
    }
  })

  it('F4-T1.3: worker produces deterministic identical landings for identical baseSeed', async () => {
    const modelsMod = await loadModelsModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const req: MonteCarloRequest = {
      jobId: 'job-f4-det-a',
      models: [v51],
      adjustmentsByModel: { [v51.id]: defaultAdjustmentsForModel(v51) },
      env: createNominalEnv({ energyVarianceJ: 0.1 }),
      rubricConfig: { task: 'day1_distance', timeWindowS: 210 },
      trialsPerModel: 30,
      baseSeed: 7777,
    }
    const a = await runWorkerJob(req)
    const b = await runWorkerJob({ ...req, jobId: 'job-f4-det-b' })
    expect(a.done?.results?.[0].meanScore).toBe(b.done?.results?.[0].meanScore)
    expect(a.done?.results?.[0].landings).toEqual(b.done?.results?.[0].landings)
  })

  it('F4-T1.4: browser Monte Carlo Shootout completes N=500 via real Web Worker without errors', async () => {
    await withBrowserApp(async (app) => {
      const btnFound = await app.evalExpr<boolean>(`
        const btn = document.querySelector(${JSON.stringify(M4_SELECTORS.runShootoutBtn)})
          || Array.from(document.querySelectorAll('button')).find((b) => /shootout|monte\\s*carlo/i.test(b.textContent || ''));
        if (!btn) return false;
        btn.click();
        return true;
      `)
      expect(btnFound).toBe(true)
      await app.waitForFunction(`
        document.querySelectorAll(${JSON.stringify(M4_SELECTORS.shootoutRows)}).length >= 2
      `, 20_000)
      expect(app.getPageErrors()).toEqual([])
      expect(app.getConsoleErrors()).toEqual([])
    })
  })

  it('F4-T1.5: sequential worker jobs with distinct jobIds isolate results cleanly', async () => {
    const modelsMod = await loadModelsModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const direct = findModel(modelsMod, 'direct_rail')
    const [out1, out2] = await runWorkerSequence([
      {
        jobId: 'seq-1',
        models: [v51],
        adjustmentsByModel: { [v51.id]: defaultAdjustmentsForModel(v51) },
        env: createNominalEnv(),
        rubricConfig: { task: 'day1_distance' },
        trialsPerModel: 10,
        baseSeed: 11,
      },
      {
        jobId: 'seq-2',
        models: [direct],
        adjustmentsByModel: { [direct.id]: defaultAdjustmentsForModel(direct) },
        env: createNominalEnv(),
        rubricConfig: { task: 'day1_distance' },
        trialsPerModel: 12,
        baseSeed: 22,
      },
    ])
    expect(out1.done?.jobId).toBe('seq-1')
    expect(out1.done?.results).toHaveLength(1)
    expect(out1.done?.results?.[0].modelId).toBe(v51.id)
    expect(out1.done?.results?.[0].landings).toHaveLength(10)
    expect(out2.done?.jobId).toBe('seq-2')
    expect(out2.done?.results).toHaveLength(1)
    expect(out2.done?.results?.[0].modelId).toBe(direct.id)
    expect(out2.done?.results?.[0].landings).toHaveLength(12)
  })
})

describe('Tier 1 — F9: 3D Flight Aerodynamics', () => {
  it('F9-T1.1: quadratic drag (Cd > 0) reduces carry distance and apex vs Cd = 0 vacuum', async () => {
    const modelsMod = await loadModelsModule()
    const simMod = await loadSimulateModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const adj = adjustKeys(v51, { notch: 6, stop: 42 })

    const vac = simMod.simulateShot(v51, adj, createVacuumEnv({ cdOverride: 0, airDensityKgM3: 0 }), { x: 4.8, y: 0 }, 1)
    const air = simMod.simulateShot(
      v51,
      adj,
      createNominalEnv({ projectile: 'smooth_ball', cdOverride: 0.47, turfScatterSigmaRad: 0 }),
      { x: 4.8, y: 0 },
      1
    )
    const maxZ = (trace: Array<{ z: number }>) => Math.max(...trace.map((s) => s.z))
    expect(air.carryDistanceM).toBeLessThan(vac.carryDistanceM)
    expect(maxZ(air.trace)).toBeLessThan(maxZ(vac.trace))
  })

  it('F9-T1.2: dimpled golf ball carries farther than smooth sphere at identical launch', async () => {
    const modelsMod = await loadModelsModule()
    const simMod = await loadSimulateModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const adj = adjustKeys(v51, { notch: 6, stop: 42 })

    const golf = simMod.simulateShot(
      v51,
      adj,
      createNominalEnv({ projectile: 'golf_ball', turfScatterSigmaRad: 0 }),
      { x: 4.8, y: 0 },
      5
    )
    const smooth = simMod.simulateShot(
      v51,
      adj,
      createNominalEnv({ projectile: 'smooth_ball', turfScatterSigmaRad: 0 }),
      { x: 4.8, y: 0 },
      5
    )
    expect(golf.carryDistanceM).toBeGreaterThan(smooth.carryDistanceM)
  })

  it('F9-T1.3: Magnus backspin increases apex/carry relative to zero-spin and topspin', async () => {
    const aeroMod = await loadAeroModule()
    const fly = resolveFlightFn(aeroMod)
    expect(typeof fly).toBe('function')
    const env = createNominalEnv({ turfScatterSigmaRad: 0 })
    const baseRelease = { posM: [0, 0, 0.25] as [number, number, number], velMps: [6.5, 0, 6.5] as [number, number, number] }

    const backspin = fly!({ ...baseRelease, omegaBallRadps: [0, -80, 0] }, env)
    const nospin = fly!({ ...baseRelease, omegaBallRadps: [0, 0, 0] }, env)
    const topspin = fly!({ ...baseRelease, omegaBallRadps: [0, 80, 0] }, env)

    const carryOf = (r: { carryDistanceM: number }) => assertFinite(r.carryDistanceM, 'carryDistanceM')
    expect(carryOf(backspin)).toBeGreaterThan(carryOf(nospin))
    expect(carryOf(nospin)).toBeGreaterThan(carryOf(topspin))
  })

  it('F9-T1.4: crosswind deflects restY laterally and headwind shortens carry vs tailwind', async () => {
    const modelsMod = await loadModelsModule()
    const simMod = await loadSimulateModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const adj = adjustKeys(v51, { notch: 6, stop: 42 })

    const posCross = simMod.simulateShot(v51, adj, createNominalEnv({ windVecMps: [0, 3.0, 0], turfScatterSigmaRad: 0 }), { x: 4.8, y: 0 }, 9)
    const negCross = simMod.simulateShot(v51, adj, createNominalEnv({ windVecMps: [0, -3.0, 0], turfScatterSigmaRad: 0 }), { x: 4.8, y: 0 }, 9)
    const head = simMod.simulateShot(v51, adj, createNominalEnv({ windVecMps: [-3.0, 0, 0], turfScatterSigmaRad: 0 }), { x: 4.8, y: 0 }, 9)
    const tail = simMod.simulateShot(v51, adj, createNominalEnv({ windVecMps: [3.0, 0, 0], turfScatterSigmaRad: 0 }), { x: 4.8, y: 0 }, 9)

    const contactOf = (res: any) => res.trace.find((s: any) => s.event === 'contact')!
    expect(contactOf(posCross).y).toBeGreaterThan(0.02)
    expect(contactOf(negCross).y).toBeLessThan(-0.02)
    expect(head.carryDistanceM).toBeLessThan(tail.carryDistanceM)
  })

  it('F9-T1.5: spin decays during airborne flight and terminates cleanly at ground contact', async () => {
    const aeroMod = await loadAeroModule()
    const fly = resolveFlightFn(aeroMod)
    expect(typeof fly).toBe('function')
    const env = createNominalEnv()
    const res = fly!({ posM: [0, 0, 0.25], velMps: [6.5, 0, 6.5], omegaBallRadps: [0, -100, 0] }, env)
    const endOmega = res.omegaAtImpactRadps
    expect(Array.isArray(endOmega)).toBe(true)
    expect(endOmega).toHaveLength(3)
    const wx = assertFinite(endOmega[0], 'omegaAtImpactRadps[0]')
    const wy = assertFinite(endOmega[1], 'omegaAtImpactRadps[1]')
    const wz = assertFinite(endOmega[2], 'omegaAtImpactRadps[2]')
    const magEnd = Math.hypot(wx, wy, wz)
    expect(magEnd).toBeGreaterThan(0)
    expect(magEnd).toBeLessThan(100)
    expect(wy).toBeLessThan(0)
    expect(wy).toBeGreaterThan(-100)
    const impactZ = res.impactPosM?.[2]
    expect(assertFinite(impactZ, 'impactZ')).toBeLessThanOrEqual(REPO_CONSTANTS.R_BALL + 1e-3)
  })
})

describe('Tier 1 — F10: Turf Impact, Bounce & Rollout', () => {
  it('F10-T1.1: records first contact carry, bounce points, and final rest with total >= carry', async () => {
    const modelsMod = await loadModelsModule()
    const simMod = await loadSimulateModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const res = simMod.simulateShot(v51, adjustKeys(v51, { notch: 6, stop: 42 }), createNominalEnv(), { x: 4.8, y: 0 }, 12)
    const contacts = res.trace.filter((s: any) => s.event === 'contact')
    expect(contacts.length).toBeGreaterThanOrEqual(1)
    expect(res.trace[res.trace.length - 1].event).toBe('rest')
    expect(res.bouncePoints.length).toBeGreaterThanOrEqual(1)
    expect(res.totalDistanceM).toBeGreaterThanOrEqual(res.carryDistanceM)
  })

  it('F10-T1.2: higher turf firmness (e_n=0.40 vs 0.25) increases bounce height and rollout', async () => {
    const modelsMod = await loadModelsModule()
    const simMod = await loadSimulateModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const adj = adjustKeys(v51, { notch: 6, stop: 42 })

    const firm = simMod.simulateShot(v51, adj, createNominalEnv({ turfEn: 0.4, turfMuR: 0.12, turfScatterSigmaRad: 0 }), { x: 4.8, y: 0 }, 15)
    const soft = simMod.simulateShot(v51, adj, createNominalEnv({ turfEn: 0.25, turfMuR: 0.12, turfScatterSigmaRad: 0 }), { x: 4.8, y: 0 }, 15)
    expect(firm.rollDistanceM).toBeGreaterThan(soft.rollDistanceM)
    const postBounceMaxZ = (trace: Array<{ z: number; event?: string }>) => {
      const idx = trace.findIndex((s) => s.event === 'contact')
      return Math.max(...trace.slice(idx).map((s) => s.z))
    }
    expect(postBounceMaxZ(firm.trace)).toBeGreaterThan(postBounceMaxZ(soft.trace))
  })

  it('F10-T1.3: higher grass rolling resistance (mu_r=0.20 vs 0.08) strictly shortens rollout', async () => {
    const modelsMod = await loadModelsModule()
    const simMod = await loadSimulateModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const adj = adjustKeys(v51, { notch: 6, stop: 42 })

    const dry = simMod.simulateShot(v51, adj, createNominalEnv({ turfEn: 0.3, turfMuR: 0.08, turfScatterSigmaRad: 0 }), { x: 4.8, y: 0 }, 16)
    const wet = simMod.simulateShot(v51, adj, createNominalEnv({ turfEn: 0.3, turfMuR: 0.2, turfScatterSigmaRad: 0 }), { x: 4.8, y: 0 }, 16)
    expect(wet.rollDistanceM).toBeLessThan(dry.rollDistanceM)
  })

  it('F10-T1.4: turf micro-deflection scatter produces crossrange y spread across seeds', async () => {
    const modelsMod = await loadModelsModule()
    const simMod = await loadSimulateModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const adj = adjustKeys(v51, { notch: 6, stop: 42 })
    const env = createNominalEnv({ turfScatterSigmaRad: 0.03 })

    const ys = [1, 2, 3, 4, 5, 6].map((seed) => {
      const r = simMod.simulateShot(v51, adj, env, { x: 4.8, y: 0 }, seed)
      return r.trace[r.trace.length - 1].y
    })
    const distinct = new Set(ys.map((y) => y.toFixed(6)))
    expect(distinct.size).toBeGreaterThan(1)
  })

  it('F10-T1.5: static turf-capture reaches exact rest in finite time across all turf presets', async () => {
    const modelsMod = await loadModelsModule()
    const simMod = await loadSimulateModule()
    const turfMod = await loadTurfModule()
    expect(turfMod).toBeDefined()
    const v51 = findModel(modelsMod, 'cord_horn')
    const adj = adjustKeys(v51, { notch: 6, stop: 42 })

    for (const preset of ['firm', 'soft', 'wet', 'dry'] as const) {
      const res = simMod.simulateShot(v51, adj, createTurfPresetEnv(preset), { x: 4.8, y: 0 }, 21)
      const last = res.trace[res.trace.length - 1]
      expect(last.event).toBe('rest')
      expect(last.t).toBeLessThan(30)
      expect(assertFinite(last.x, `${preset}.rest.x`)).toBeGreaterThan(0)
    }
  })
})

describe('Tier 1 — F11: Cycle/Reload Timing & Jitter', () => {
  it('F11-T1.1: nominal cycleTimeS equals cockPerTrapS * count + loadS + aimAdjustS when humanSigmaS=0', async () => {
    const modelsMod = await loadModelsModule()
    const simMod = await loadSimulateModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const zeroJitterModel: LauncherModel = {
      ...v51,
      cycleTiming: { ...v51.cycleTiming, humanSigmaS: 0 },
      tolerances: { cockAngleSigmaDeg: 0, seatingOffsetSigmaM: 0, yawSigmaDeg: 0, stopAngleSigmaDeg: 0 },
    }
    const res = simMod.simulateShot(zeroJitterModel, defaultAdjustmentsForModel(v51), createNominalEnv(), { x: 4.8, y: 0 }, 1)
    const expected =
      zeroJitterModel.cycleTiming.cockPerTrapS * zeroJitterModel.trapBank.count +
      zeroJitterModel.cycleTiming.loadS +
      zeroJitterModel.cycleTiming.aimAdjustS
    expect(res.cycleTimeS).toBeCloseTo(expected, 6)
  })

  it('F11-T1.2: 3-trap launcher has strictly longer nominal cycle time than 1-trap launcher with same timing constants', async () => {
    const modelsMod = await loadModelsModule()
    const simMod = await loadSimulateModule()
    const models = listAllModels(modelsMod)
    const threeTrap = models.find((m) => m.trapBank.count === 3)!
    const oneTrapBase = models.find((m) => m.trapBank.count === 1) ?? {
      ...threeTrap,
      id: `${threeTrap.id}_1trap`,
      trapBank: { ...threeTrap.trapBank, count: 1 },
    }
    const sharedTiming = { cockPerTrapS: 5, loadS: 3, aimAdjustS: 2, humanSigmaS: 0 }
    const m3: LauncherModel = { ...threeTrap, cycleTiming: sharedTiming }
    const m1: LauncherModel = { ...oneTrapBase, cycleTiming: sharedTiming }

    const r3 = simMod.simulateShot(m3, defaultAdjustmentsForModel(m3), createNominalEnv(), { x: 3, y: 0 }, 4)
    const r1 = simMod.simulateShot(m1, defaultAdjustmentsForModel(m1), createNominalEnv(), { x: 3, y: 0 }, 4)
    expect(r3.cycleTimeS).toBeGreaterThan(r1.cycleTimeS)
    expect(r3.cycleTimeS - r1.cycleTimeS).toBeCloseTo(10, 5)
  })

  it('F11-T1.3: setup tolerances produce spread in launch angle, restY, and total distance across seeds', async () => {
    const modelsMod = await loadModelsModule()
    const simMod = await loadSimulateModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const jittered: LauncherModel = {
      ...v51,
      tolerances: {
        cockAngleSigmaDeg: 2.0,
        seatingOffsetSigmaM: 0.003,
        yawSigmaDeg: 1.5,
        stopAngleSigmaDeg: 1.0,
      },
    }
    const adj = adjustKeys(jittered, { notch: 6, stop: 42 })
    const env = createNominalEnv({ turfScatterSigmaRad: 0 })
    const runs = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => simMod.simulateShot(jittered, adj, env, { x: 4.8, y: 0 }, seed))

    expect(new Set(runs.map((r) => r.release.launchAngleDeg.toFixed(4))).size).toBeGreaterThan(1)
    expect(new Set(runs.map((r) => r.trace[r.trace.length - 1].y.toFixed(4))).size).toBeGreaterThan(1)
    expect(new Set(runs.map((r) => r.totalDistanceM.toFixed(4))).size).toBeGreaterThan(1)
  })

  it('F11-T1.4: timed sequence executes multiple shots within 210s window and counts 6-8 shots', async () => {
    const modelsMod = await loadModelsModule()
    const seqMod = await loadSequenceModule()
    const simSeq = resolveSequenceFn(seqMod)
    const v51 = findModel(modelsMod, 'cord_horn')
    const tuned: LauncherModel = {
      ...v51,
      cycleTiming: { cockPerTrapS: 5, loadS: 6, aimAdjustS: 8, humanSigmaS: 0 },
    }
    // Nominal cycle = 5*3 + 6 + 8 = 29s -> floor(210 / 29) = 7 shots
    const res = simSeq(tuned, defaultAdjustmentsForModel(tuned), createNominalEnv(), {
      windowS: 210,
      target: { x: 4.0, y: 0 },
      targetRadiusM: 0.5,
      seed: 99,
    })
    expect(res.shotsCompleted).toBeGreaterThanOrEqual(6)
    expect(res.shotsCompleted).toBeLessThanOrEqual(8)
    expect(res.totalElapsedS).toBeLessThanOrEqual(210 + 1e-6)
    expect(res.shots).toHaveLength(res.shotsCompleted)
  })

  it('F11-T1.5: timed dual-target sequence switches targets mid-window and scores target1Hits and target2Hits', async () => {
    const modelsMod = await loadModelsModule()
    const autoMod = await loadAutoSightModule()
    const seqMod = await loadSequenceModule()
    const autoSight = resolveAutoSightFn(autoMod)
    const simSeq = resolveSequenceFn(seqMod)
    const v51 = findModel(modelsMod, 'cord_horn')
    const env = createNominalEnv({ energyVarianceJ: 0.03, turfScatterSigmaRad: 0.005 })
    const auto1 = autoSight(v51, env, 2.2)
    const auto2 = autoSight(v51, env, 4.2)
    expect(auto1.reachable).toBe(true)
    expect(auto2.reachable).toBe(true)

    const res = simSeq(v51, auto1.adjustments, env, {
      windowS: 210,
      targets: [
        { x: 2.2, y: 0 },
        { x: 4.2, y: 0 },
      ],
      targetAdjustments: [auto1.adjustments, auto2.adjustments],
      targetRadiusM: 0.6,
      seed: 123,
    })
    expect(res.shotsCompleted).toBeGreaterThanOrEqual(2)
    expect(res.totalElapsedS).toBeLessThanOrEqual(210 + 1e-6)
    expect(res.target1Hits).toBeGreaterThan(0)
    expect(res.target2Hits).toBeGreaterThan(0)
    expect(res.target1Hits + res.target2Hits).toBeLessThanOrEqual(res.shotsCompleted)
  })
})

describe('Tier 1 — F12: Three.js Parametric Launcher & Field (Chromium CDP)', () => {
  it('F12-T1.1: initializes WebGL canvas in #field with zero console/page errors and no fallback text', async () => {
    await withBrowserApp(async (app) => {
      const info = await app.evalExpr<{
        hasCanvas: boolean
        width: number
        height: number
        hasFallback: boolean
        glVersion: string | null
      }>(`
        const canvas = document.querySelector('#field canvas');
        const fallback = document.querySelector('#field p');
        const gl = canvas ? (canvas.getContext('webgl2') || canvas.getContext('webgl')) : null;
        return {
          hasCanvas: Boolean(canvas),
          width: canvas ? canvas.width : 0,
          height: canvas ? canvas.height : 0,
          hasFallback: Boolean(fallback),
          glVersion: gl ? String(gl.getParameter(gl.VERSION)) : null,
        };
      `)
      expect(info.hasCanvas).toBe(true)
      expect(info.width).toBeGreaterThan(0)
      expect(info.height).toBeGreaterThan(0)
      expect(info.hasFallback).toBe(false)
      expect(info.glVersion).toMatch(/WebGL/i)
      expect(app.getPageErrors()).toEqual([])
      expect(app.getConsoleErrors()).toEqual([])
    })
  })

  it('F12-T1.2: parametric 3D launcher renders and animates arm/bail sweep during launch/replay', async () => {
    await withBrowserApp(async (app) => {
      const launchClicked = await app.evalExpr<boolean>(`
        const btn = document.querySelector(${JSON.stringify(M4_SELECTORS.launchBtn)})
          || Array.from(document.querySelectorAll('button')).find((b) => /^\\s*(launch|fire|simulate)\\b/i.test(b.textContent || ''));
        if (!btn) return false;
        btn.click();
        return true;
      `)
      expect(launchClicked).toBe(true)
      await app.waitForFunction(`
        document.querySelector('#replay') && !document.querySelector('#replay').hidden
      `, 10_000)
      await app.selectOption('#replay-speed', '0.5')

      const sampleCanvasExpr = `
        return await new Promise((resolve) => {
          const step = (tries) => {
            requestAnimationFrame(() => {
              const glCanvas = document.querySelector('#field canvas');
              if (!glCanvas || !glCanvas.width || !glCanvas.height) {
                resolve({ hash: 0, distinctColors: 0 });
                return;
              }
              const w = Math.min(160, glCanvas.width);
              const h = Math.min(120, glCanvas.height);
              const off = document.createElement('canvas');
              off.width = w;
              off.height = h;
              const ctx = off.getContext('2d');
              if (!ctx) {
                resolve({ hash: 0, distinctColors: 0 });
                return;
              }
              ctx.drawImage(glCanvas, 0, 0, w, h);
              const data = ctx.getImageData(0, 0, w, h).data;
              let hash = 2166136261;
              const colors = new Set();
              for (let i = 0; i < data.length; i += 16) {
                const key = ((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3]) >>> 0;
                colors.add(key);
                hash = Math.imul(hash ^ key, 16777619) >>> 0;
              }
              if (colors.size <= 1 && tries > 0) {
                step(tries - 1);
              } else {
                resolve({ hash, distinctColors: colors.size });
              }
            });
          };
          step(4);
        });
      `

      const beforeClock = await app.getText('#replay-clock')
      const beforeBall = await app.evalExpr<string>(
        `return document.querySelector('#field .field-ball')?.style.transform || '';`
      )
      await app.click('#replay-play')
      const beforeFrame = await app.evalExpr<{ hash: number; distinctColors: number }>(sampleCanvasExpr)

      await app.waitForFunction(
        `(document.querySelector('#replay-clock')?.textContent || '').trim() !== ${JSON.stringify(beforeClock)}`,
        5_000
      )
      await new Promise((r) => setTimeout(r, 80))
      const afterClock = await app.getText('#replay-clock')
      const afterBall = await app.evalExpr<string>(
        `return document.querySelector('#field .field-ball')?.style.transform || '';`
      )
      const afterFrame = await app.evalExpr<{ hash: number; distinctColors: number }>(sampleCanvasExpr)
      const canvasCount = await app.evalExpr<number>(
        `return document.querySelectorAll('#field canvas').length;`
      )

      expect(canvasCount).toBe(1)
      expect(afterClock).not.toBe(beforeClock)
      expect(afterBall).not.toBe(beforeBall)
      expect(beforeFrame.distinctColors).toBeGreaterThan(1)
      expect(afterFrame.hash).not.toBe(beforeFrame.hash)
      expect(app.getPageErrors()).toEqual([])
      expect(app.getConsoleErrors()).toEqual([])
    })
  })

  it('F12-T1.3: renders trajectory, carry divot, bounce marker, rest flag, and target labels for example trace', async () => {
    await withBrowserApp(async (app) => {
      await app.waitForFunction(`document.querySelectorAll('#field .field-label').length >= 5`, 5_000)
      const labels = await app.evalExpr<string[]>(`
        return Array.from(document.querySelectorAll('#field .field-label')).map((el) => (el.textContent || '').trim());
      `)
      expect(labels.some((t) => t.startsWith('Release'))).toBe(true)
      expect(labels.some((t) => t.startsWith('Carry'))).toBe(true)
      expect(labels.some((t) => t.startsWith('Bounce'))).toBe(true)
      expect(labels.some((t) => t.startsWith('Rest'))).toBe(true)
      expect(labels.some((t) => t.includes('Target'))).toBe(true)
      expect(app.getPageErrors()).toEqual([])
    })
  })

  it('F12-T1.4: CSS2DRenderer renders visible .field-label overlays with non-zero rects', async () => {
    await withBrowserApp(async (app) => {
      await new Promise((r) => setTimeout(r, 120))
      const visibleRects = await app.evalExpr<Array<{ text: string; w: number; h: number }>>(`
        return Array.from(document.querySelectorAll('#field .field-label span')).map((el) => {
          const r = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return { text: el.textContent || '', w: r.width, h: r.height, vis: style.visibility };
        }).filter((x) => x.vis === 'visible');
      `)
      expect(visibleRects.length).toBeGreaterThanOrEqual(4)
      for (const item of visibleRects) {
        expect(item.w).toBeGreaterThan(10)
        expect(item.h).toBeGreaterThan(8)
      }
    })
  })

  it('F12-T1.5: switching #camera across all 4 presets updates projection without errors', async () => {
    await withBrowserApp(async (app) => {
      const positions: Record<string, string> = {}
      for (const preset of ['orbit', 'side', 'overhead', 'downrange']) {
        await app.selectOption('#camera', preset)
        await new Promise((r) => setTimeout(r, 120))
        positions[preset] = await app.evalExpr<string>(`
          const labels = Array.from(document.querySelectorAll('#field .field-label span'));
          return labels.map((s) => s.style.transform + ':' + getComputedStyle(s).visibility).join('|');
        `)
      }
      expect(new Set(Object.values(positions)).size).toBeGreaterThanOrEqual(3)
      expect(app.getPageErrors()).toEqual([])
      expect(app.getConsoleErrors()).toEqual([])
    })
  })

  it('F12-T1.6: field canvas fills container and frames traces on resize without error', async () => {
    await withBrowserApp(async (app) => {
      await app.send('Emulation.setDeviceMetricsOverride', {
        width: 900,
        height: 700,
        deviceScaleFactor: 1,
        mobile: false,
      })
      await new Promise((r) => setTimeout(r, 150))
      const box = await app.evalExpr<{ w: number; h: number }>(`
        const c = document.querySelector('#field canvas');
        const r = c.getBoundingClientRect();
        return { w: r.width, h: r.height };
      `)
      expect(box.w).toBeGreaterThan(200)
      expect(box.h).toBeGreaterThan(150)
      expect(app.getPageErrors()).toEqual([])
    })
  })
})

describe('Tier 1 — F13: Telemetry Overlay & Auto-Sight', () => {
  it('F13-T1.1: HUD displays required distance, speed/angle, efficiency, cycle time, and rubric readouts', async () => {
    await withBrowserApp(async (app) => {
      const texts = await app.evalExpr<string>(`
        const body = document.body.textContent || '';
        return body;
      `)
      const requiredLabels = [
        /total\s*distance/i,
        /carry/i,
        /roll/i,
        /target\s*distance/i,
        /radial\s*error/i,
        /apex/i,
        /launch\s*speed/i,
        /launch\s*angle/i,
        /efficiency/i,
        /cycle\s*time|reload/i,
        /rubric\s*score/i,
      ]
      for (const re of requiredLabels) {
        expect(texts).toMatch(re)
      }
    })
  })

  it('F13-T1.2: switching launcher model updates dynamic adjustment controls to match model DOFs', async () => {
    await withBrowserApp(async (app) => {
      const modelsMod = await loadModelsModule()
      const v51 = findModel(modelsMod, 'cord_horn')
      const direct = findModel(modelsMod, 'direct_rail')
      const ok = await app.evalExpr<boolean>(`
        const sel = document.querySelector('#model-select, select[name="model"], [data-testid="model-select"]');
        if (!sel) return false;
        sel.value = ${JSON.stringify(v51.id)};
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      `)
      expect(ok).toBe(true)
      const v51Html = await app.evalExpr<string>(`
        return (document.querySelector('#model-controls, [data-testid="model-controls"], .model-controls')?.textContent || '').toLowerCase();
      `)
      await app.evalExpr(`
        const sel = document.querySelector('#model-select, select[name="model"], [data-testid="model-select"]');
        sel.value = ${JSON.stringify(direct.id)};
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      `)
      const directHtml = await app.evalExpr<string>(`
        return (document.querySelector('#model-controls, [data-testid="model-controls"], .model-controls')?.textContent || '').toLowerCase();
      `)
      expect(v51Html).not.toBe(directHtml)
      expect(v51Html.length).toBeGreaterThan(5)
      expect(directHtml.length).toBeGreaterThan(5)
    })
  })

  it('F13-T1.3: global environment controls alter simulated shot telemetry in browser', async () => {
    const parseTotalM = (text: string, label: string): number => {
      expect(text).not.toMatch(/\b(NaN|Infinity|undefined)\b/i)
      const match = text.match(/total\s*distance[^0-9.-]*(-?\d+(?:\.\d+)?)\s*m/i)
      expect(match).not.toBeNull()
      return assertFinite(Number(match![1]), label)
    }

    await withBrowserApp(async (app) => {
      const launchAndReadTotal = async () => {
        const clicked = await app.evalExpr<boolean>(`
          const btn = document.querySelector(${JSON.stringify(M4_SELECTORS.launchBtn)})
            || Array.from(document.querySelectorAll('button')).find((b) => /^\\s*(launch|fire|simulate)\\b/i.test(b.textContent || ''));
          if (!btn) return false;
          btn.click();
          return true;
        `)
        expect(clicked).toBe(true)
        await new Promise((r) => setTimeout(r, 100))
        return app.evalExpr<string>(`
          return (document.querySelector('#metrics')?.textContent || '') + ' ' + (document.querySelector('#hud')?.textContent || '');
        `)
      }
      const before = await launchAndReadTotal()
      const beforeTotal = parseTotalM(before, 'beforeTotal')
      const changed = await app.evalExpr<boolean>(`
        const energyInput = document.querySelector('#env-energy, input[name="nominalEnergyJ"], [data-env="nominalEnergyJ"]');
        if (!energyInput) return false;
        energyInput.value = '1.2';
        energyInput.dispatchEvent(new Event('input', { bubbles: true }));
        energyInput.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      `)
      expect(changed).toBe(true)
      const after = await launchAndReadTotal()
      const afterTotal = parseTotalM(after, 'afterTotal')
      expect(afterTotal).toBeGreaterThan(0)
      expect(afterTotal).toBeLessThan(beforeTotal)
    })
  })

  it('F13-T1.4: Auto-Sight solver finds valid adjustments hitting 3.50 m on v5.1 and 2.50 m on direct_arm', async () => {
    const modelsMod = await loadModelsModule()
    const autoMod = await loadAutoSightModule()
    const simMod = await loadSimulateModule()
    const autoSight = resolveAutoSightFn(autoMod)
    const v51 = findModel(modelsMod, 'cord_horn')
    const direct = findModel(modelsMod, 'direct_rail')
    const env = createNominalEnv({ turfScatterSigmaRad: 0 })

    const resV51 = autoSight(v51, env, 3.5)
    expect(resV51.reachable).toBe(true)
    const shotV51 = simMod.simulateShot(v51, resV51.adjustments, env, { x: 3.5, y: 0 }, 1)
    expect(Math.abs(shotV51.totalDistanceM - 3.5)).toBeLessThan(0.5)

    const resDirect = autoSight(direct, env, 2.5)
    expect(resDirect.reachable).toBe(true)
    const shotDirect = simMod.simulateShot(direct, resDirect.adjustments, env, { x: 2.5, y: 0 }, 1)
    expect(Math.abs(shotDirect.totalDistanceM - 2.5)).toBeLessThan(0.5)
  })

  it('F13-T1.5: clicking Auto-Sight / Calibrate in browser updates controls and lands near target', async () => {
    const modelsMod = await loadModelsModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    await withBrowserApp(async (app) => {
      const beforeControls = await app.evalExpr<string>(`
        const sel = document.querySelector(${JSON.stringify(M4_SELECTORS.modelSelect)});
        if (!sel) return '';
        sel.value = ${JSON.stringify(v51.id)};
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        const ctrl = document.querySelector(${JSON.stringify(M4_SELECTORS.modelControls)});
        if (!ctrl) return '';
        return Array.from(ctrl.querySelectorAll('input, select')).map((el, idx) => (el.name || el.id || idx) + '=' + el.value).join('|');
      `)
      expect(beforeControls.length).toBeGreaterThan(0)

      const ok = await app.evalExpr<boolean>(`
        const targetInput = document.querySelector(${JSON.stringify(M4_SELECTORS.autosightTarget)});
        const btn = document.querySelector(${JSON.stringify(M4_SELECTORS.autosightBtn)})
          || Array.from(document.querySelectorAll('button')).find((b) => /auto-?sight|calibrate/i.test(b.textContent || ''));
        if (!targetInput || !btn) return false;
        targetInput.value = '3.5';
        targetInput.dispatchEvent(new Event('input', { bubbles: true }));
        targetInput.dispatchEvent(new Event('change', { bubbles: true }));
        btn.click();
        return true;
      `)
      expect(ok).toBe(true)

      await app.waitForFunction(`
        (() => {
          const ctrl = document.querySelector(${JSON.stringify(M4_SELECTORS.modelControls)});
          if (!ctrl) return false;
          const now = Array.from(ctrl.querySelectorAll('input, select')).map((el, idx) => (el.name || el.id || idx) + '=' + el.value).join('|');
          return now.length > 0 && now !== ${JSON.stringify(beforeControls)};
        })()
      `, 10_000)

      const preLaunchMetrics = await app.evalExpr<string>(
        `return (document.querySelector('#metrics')?.textContent || '') + ' ' + (document.querySelector('#hud')?.textContent || '');`
      )
      const launchClicked = await app.evalExpr<boolean>(`
        const btn = document.querySelector(${JSON.stringify(M4_SELECTORS.launchBtn)})
          || Array.from(document.querySelectorAll('button')).find((b) => /^\\s*(launch|fire|simulate)\\b/i.test(b.textContent || ''));
        if (!btn) return false;
        btn.click();
        return true;
      `)
      expect(launchClicked).toBe(true)

      await app.waitForFunction(`
        (() => {
          const txt = (document.querySelector('#metrics')?.textContent || '') + ' ' + (document.querySelector('#hud')?.textContent || '');
          return txt !== ${JSON.stringify(preLaunchMetrics)} && /total\\s*distance[^0-9.-]*(-?\\d+(?:\\.\\d+)?)\\s*m/i.test(txt);
        })()
      `, 10_000)
      const afterMetrics = await app.evalExpr<string>(
        `return (document.querySelector('#metrics')?.textContent || '') + ' ' + (document.querySelector('#hud')?.textContent || '');`
      )
      expect(afterMetrics).not.toMatch(/\b(NaN|Infinity|undefined)\b/i)
      const match = afterMetrics.match(/total\s*distance[^0-9.-]*(-?\d+(?:\.\d+)?)\s*m/i)
      expect(match).not.toBeNull()
      const totalM = assertFinite(Number(match![1]), 'autosightTotalM')
      expect(Math.abs(totalM - 3.5)).toBeLessThan(0.5)
      expect(app.getPageErrors()).toEqual([])
      expect(app.getConsoleErrors()).toEqual([])
    })
  })
})

describe('Tier 1 — F14: Monte Carlo Shootout & CEP', () => {
  it('F14-T1.1: runMonteCarlo executes N=500 trials per design with full summary metrics', async () => {
    const modelsMod = await loadModelsModule()
    const mcMod = await loadMonteCarloModule()
    const runMC = resolveMonteCarloFn(mcMod)
    const v51 = findModel(modelsMod, 'cord_horn')
    const direct = findModel(modelsMod, 'direct_rail')

    const summaries = runMC({
      jobId: 'mc-500-t1',
      models: [v51, direct],
      adjustmentsByModel: {
        [v51.id]: defaultAdjustmentsForModel(v51),
        [direct.id]: defaultAdjustmentsForModel(direct),
      },
      env: createNominalEnv({ energyVarianceJ: 0.1 }),
      rubricConfig: { task: 'day1_distance', timeWindowS: 210, fieldHalfWidthM: 3 },
      trialsPerModel: 500,
      baseSeed: 5001,
    })
    expect(summaries).toHaveLength(2)
    for (const s of summaries) {
      expect(s.landings).toHaveLength(500)
      assertFinite(s.meanScore, 'meanScore')
      assertFinite(s.medianScore, 'medianScore')
      assertFinite(s.p10Score, 'p10Score')
      assertFinite(s.p90Score, 'p90Score')
      assertFinite(s.carryToRollRatio, 'carryToRollRatio')
      assertFinite(s.shotsInWindow, 'shotsInWindow')
      expect(s.missRate).toBeGreaterThanOrEqual(0)
      expect(s.missRate).toBeLessThanOrEqual(1)
      expect(s.oobRate).toBeGreaterThanOrEqual(0)
      expect(s.oobRate).toBeLessThanOrEqual(1)
    }
  })

  it('F14-T1.2: cep95Ellipse encloses ~95% (90%-99%) of 500 simulated landing points', async () => {
    const modelsMod = await loadModelsModule()
    const mcMod = await loadMonteCarloModule()
    const runMC = resolveMonteCarloFn(mcMod)
    const v51 = findModel(modelsMod, 'cord_horn')

    const [summary] = runMC({
      jobId: 'mc-cep-95',
      models: [v51],
      adjustmentsByModel: { [v51.id]: adjustKeys(v51, { notch: 6, stop: 42 }) },
      env: createNominalEnv({ energyVarianceJ: 0.1, energyDistribution: 'gaussian' }),
      rubricConfig: { task: 'day1_distance', timeWindowS: 210 },
      trialsPerModel: 500,
      baseSeed: 888,
    })
    const { centerX, centerY, semiMajorM, semiMinorM, angleRad } = summary.cep95Ellipse
    expect(semiMajorM).toBeGreaterThan(0)
    expect(semiMinorM).toBeGreaterThan(0)
    const cosA = Math.cos(angleRad)
    const sinA = Math.sin(angleRad)
    let inside = 0
    for (const p of summary.landings) {
      const dx = p.restX - centerX
      const dy = p.restY - centerY
      const u = dx * cosA + dy * sinA
      const v = -dx * sinA + dy * cosA
      if ((u / semiMajorM) ** 2 + (v / semiMinorM) ** 2 <= 1.0001) {
        inside++
      }
    }
    const frac = inside / summary.landings.length
    expect(frac).toBeGreaterThanOrEqual(0.88)
    expect(frac).toBeLessThanOrEqual(0.995)
  })

  it('F14-T1.3: leaderboard differentiates timed shotsInWindow and meanScore across fast vs slow models', async () => {
    const modelsMod = await loadModelsModule()
    const mcMod = await loadMonteCarloModule()
    const runMC = resolveMonteCarloFn(mcMod)
    const v51 = findModel(modelsMod, 'cord_horn')
    const fast: LauncherModel = {
      ...v51,
      id: 'fast_rig',
      cycleTiming: { cockPerTrapS: 3, loadS: 3, aimAdjustS: 2, humanSigmaS: 0.5 },
    }
    const slow: LauncherModel = {
      ...v51,
      id: 'slow_rig',
      cycleTiming: { cockPerTrapS: 12, loadS: 10, aimAdjustS: 12, humanSigmaS: 0.5 },
    }
    const results = runMC({
      jobId: 'mc-timed-compare',
      models: [fast, slow],
      adjustmentsByModel: {
        [fast.id]: defaultAdjustmentsForModel(fast),
        [slow.id]: defaultAdjustmentsForModel(slow),
      },
      env: createNominalEnv({ energyVarianceJ: 0.08 }),
      rubricConfig: { task: 'day2_accuracy', target: { x: 4.0, y: 0 }, targetRadiusM: 0.5, timeWindowS: 180 },
      trialsPerModel: 50,
      baseSeed: 321,
    })
    const fastRes = results.find((r: any) => r.modelId === 'fast_rig')!
    const slowRes = results.find((r: any) => r.modelId === 'slow_rig')!
    expect(fastRes.shotsInWindow).toBeGreaterThan(slowRes.shotsInWindow)
  })

  it('F14-T1.4: browser Overhead Target Map mode displays 95% CEP overlay after shootout', async () => {
    await withBrowserApp(async (app) => {
      await app.selectOption('#camera', 'overhead')
      const triggered = await app.evalExpr<boolean>(`
        const btn = document.querySelector(${JSON.stringify(M4_SELECTORS.runShootoutBtn)})
          || Array.from(document.querySelectorAll('button')).find((b) => /shootout|monte\\s*carlo/i.test(b.textContent || ''));
        if (!btn) return false;
        btn.click();
        return true;
      `)
      expect(triggered).toBe(true)
      await app.waitForFunction(`
        document.querySelectorAll(${JSON.stringify(M4_SELECTORS.shootoutRows)}).length >= 1
      `, 20_000)
      const hasCepMarker = await app.evalExpr<boolean>(`
        return Array.from(document.querySelectorAll('#field .field-label')).some((el) => /cep|95%/i.test(el.textContent || ''))
          || Boolean(document.querySelector('[data-cep-rendered="true"], .cep-legend'));
      `)
      expect(hasCepMarker).toBe(true)
    })
  })

  it('F14-T1.5: shootout leaderboard DOM table shows Mean, Median, P10/P90, Carry/Roll, Shots, Miss/OOB columns', async () => {
    await withBrowserApp(async (app) => {
      const triggered = await app.evalExpr<boolean>(`
        const btn = document.querySelector(${JSON.stringify(M4_SELECTORS.runShootoutBtn)})
          || Array.from(document.querySelectorAll('button')).find((b) => /shootout|monte\\s*carlo/i.test(b.textContent || ''));
        if (!btn) return false;
        btn.click();
        return true;
      `)
      expect(triggered).toBe(true)
      await app.waitForFunction(`
        document.querySelectorAll(${JSON.stringify(M4_SELECTORS.shootoutRows)}).length >= 1
      `, 20_000)
      const headerText = await app.evalExpr<string>(`
        const tbl = document.querySelector(${JSON.stringify(M4_SELECTORS.shootoutTable)});
        return tbl ? (tbl.textContent || '') : '';
      `)
      expect(headerText).toMatch(/mean/i)
      expect(headerText).toMatch(/median/i)
      expect(headerText).toMatch(/p10|p90/i)
      expect(headerText).toMatch(/carry|roll/i)
      expect(headerText).toMatch(/shots?/i)
      expect(headerText).toMatch(/miss|oob/i)
    })
  })
})

describe('Tier 1 — F15: Course Scorecard & Practice Replay', () => {
  it('F15-T1.1: evaluateRubric computes 110-pt base + equipment bonus + group shares + late penalty', async () => {
    const rubric = await loadRubricModule()
    const baseInput = createRubricInput()
    const resBall = rubric.evaluateRubric({ ...baseInput, equipment: 'ball', groupShares: [2, 2, 2], lateDays: 0 })
    expect(resBall.base.earned).toBe(110)
    expect(resBall.base.complete).toBe(true)
    expect(resBall.equipmentBonus).toBe(4)
    expect(resBall.individualTotals).toEqual([116, 116, 116])

    const resTreb = rubric.evaluateRubric({ ...baseInput, equipment: 'both', groupShares: [3, 3], lateDays: 1 })
    expect(resTreb.equipmentBonus).toBe(8)
    expect(resTreb.lateAdjustment).toBe(-10)
    expect(resTreb.individualTotals).toEqual([111, 111])

    const resNone = rubric.evaluateRubric({ ...baseInput, equipment: 'none', groupShares: [0, 6], lateDays: 0 })
    expect(resNone.individualTotals).toEqual([110, 116])
  })

  it('F15-T1.2: importing public/example.json in browser populates #metrics and enables scorecard trace buttons', async () => {
    await withBrowserApp(async (app) => {
      await app.uploadFile('#file', path.join(ROOT, 'public', 'example.json'))
      await app.waitForFunction(`document.querySelector('#source')?.textContent?.trim() === 'example.json'`, 5000)
      const metricsText = await app.getText('#metrics')
      expect(metricsText).toContain('4.72 m')
      expect(metricsText).toContain('3.52 m')
      expect(metricsText).toContain('1.21 m')
      expect(metricsText).toContain('0.77 m')
      const buttonsEnabled = await app.evalExpr<boolean>(`
        return !document.querySelector('#score-use-carry').disabled && !document.querySelector('#score-use-total').disabled;
      `)
      expect(buttonsEnabled).toBe(true)
      expect(await app.isHidden('#error')).toBe(true)
    })
  })

  it('F15-T1.3: replay controls scrub and play smoothly across positionAt timestamps', async () => {
    const replay = await loadReplayModule()
    const telemetry = await loadTelemetryModule()
    const exampleJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'example.json'), 'utf8'))
    const m = telemetry.measure(exampleJson.samples, exampleJson.target)
    expect(m.total).toBeCloseTo(4.7215, 3)
    const mid = replay.positionAt(exampleJson.samples, 0.35)
    expect(mid.z).toBeGreaterThan(0.7)

    await withBrowserApp(async (app) => {
      await app.selectOption('#replay-speed', '0.5')
      await app.setInput('#replay-time', '0.90')
      const clock = await app.getText('#replay-clock')
      expect(clock).toBe('0.90 / 1.80 s')
      const transform = await app.evalExpr<string>(`
        return document.querySelector('#field .field-ball')?.style.transform || '';
      `)
      expect(transform).toContain('translate3d(')
      await app.click('#replay-play')
      await app.waitForFunction(
        `(document.querySelector('#replay-clock')?.textContent || '').trim() !== '0.90 / 1.80 s'`,
        5_000
      )
      const clockAfter = await app.getText('#replay-clock')
      expect(clockAfter).not.toBe('0.90 / 1.80 s')
    })
  })

  it('F15-T1.4: practice form evaluates circle & rectangle targets across contact and rest endpoints', async () => {
    const practice = await loadPracticeModule()
    const exampleJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'example.json'), 'utf8'))
    const hitRest = practice.evaluatePractice(exampleJson.samples, { x: 4.7, y: 0.45, shape: 'circle', radius: 0.05 }, 'rest')
    expect(hitRest.hit).toBe(true)

    await withBrowserApp(async (app) => {
      await app.evalExpr(`document.querySelector('#practice').open = true`)
      await app.setInput('#practice-form input[name="x"]', '3.50')
      await app.setInput('#practice-form input[name="y"]', '0.33')
      await app.selectOption('#practice-form select[name="shape"]', 'circle')
      await app.setInput('#practice-form input[name="radius"]', '0.10')
      await app.selectOption('#practice-form select[name="endpoint"]', 'contact')
      await app.submitForm('#practice-form')
      expect(await app.isHidden('#practice-report')).toBe(false)
      expect(await app.getText('#practice-results tbody')).toContain('Hit')

      await app.selectOption('#practice-form select[name="shape"]', 'rectangle')
      await app.setInput('#practice-form input[name="length"]', '0.20')
      await app.setInput('#practice-form input[name="width"]', '0.20')
      await app.selectOption('#practice-form select[name="endpoint"]', 'rest')
      await app.submitForm('#practice-form')
      expect(await app.getText('#practice-results tbody')).toContain('Miss')
    })
  })

  it('F15-T1.5: scorecard grading updates competition, base, adjusted, and individual totals live', async () => {
    const rubric = await loadRubricModule()
    await withBrowserApp(async (app) => {
      await app.evalExpr(`document.querySelector('.score-full').open = true`)
      await app.click('#score-use-total')
      await app.selectOption('#grading select[name="hit1"]', 'hit')
      await app.selectOption('#grading select[name="hit2"]', 'miss')
      expect(await app.getText('#competition-points')).toBe('13 / 20')
      await app.selectOption('#grading select[name="hit2"]', 'hit')
      expect(await app.getText('#competition-points')).toBe('18 / 20')

      for (const sec of rubric.manualSections) {
        for (const c of sec.criteria) {
          await app.setInput(`#grading input[name="${c.id}"]`, String(sec.points))
        }
      }
      await app.selectOption('#grading select[name="equipment"]', 'ball')
      await app.setInput('#grading input[name="late"]', '0')
      await app.selectOption('#grading select[name="group"]', '3')
      await app.setInput('#grading input[name="share0"]', '2')
      await app.setInput('#grading input[name="share1"]', '2')
      await app.setInput('#grading input[name="share2"]', '2')

      expect(await app.getText('#base-points')).toBe('108 / 110')
      expect(await app.getText('#adjusted-points')).toBe('By member')
      const individuals = await app.getText('#score-individuals')
      expect(individuals).toContain('Member 1 · +2 group bonus · 114 pts total')
      expect(individuals).toContain('Member 3 · +2 group bonus · 114 pts total')
    })
  })
})
