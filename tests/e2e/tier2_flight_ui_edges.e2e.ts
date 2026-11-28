import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  type AdjustmentValues,
  type LauncherModel,
  type MonteCarloDesignSummary,
  type MonteCarloRequest,
  type TurfResult,
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
  loadTurfModule,
} from './helpers/contracts'
import {
  assertFinite,
  createNominalEnv,
  createRubricInput,
  defaultAdjustmentsForModel,
  REPO_CONSTANTS,
} from './helpers/fixtures'
import { launchApp, type BrowserAppSession } from './helpers/browser_cdp'
import { runWorkerJob } from './helpers/worker_harness'

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
  if (!found) throw new Error(`Model not found for topology=${topology} idSubstr=${idSubstr ?? ''}`)
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

async function withTempJsonFile<T>(content: string, filename: string, fn: (filePath: string) => Promise<T>): Promise<T> {
  const cacheBase = path.join(os.homedir(), '.cache')
  fs.mkdirSync(cacheBase, { recursive: true })
  const dir = fs.mkdtempSync(path.join(cacheBase, 'mtc180-e2e-trace-'))
  const filePath = path.join(dir, filename)
  fs.writeFileSync(filePath, content)
  try {
    return await fn(filePath)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function resolveFlightFn(aeroMod: Record<string, any>): (...args: any[]) => any {
  const fn = aeroMod.simulateFlight ?? aeroMod.integrateFlight ?? aeroMod.flyProjectile
  if (typeof fn !== 'function') throw new Error('aero module missing simulateFlight/integrateFlight export')
  return fn
}

function resolveAutoSightFn(mod: Record<string, any>): (...args: any[]) => any {
  const fn = mod.autoSight ?? mod.calibrateModel ?? mod.solveAutoSight
  if (typeof fn !== 'function') throw new Error('autosight module missing autoSight export')
  return fn
}

function resolveSequenceFn(mod: Record<string, any>): (...args: any[]) => any {
  const fn = mod.simulateSequence ?? mod.runTimedSequence ?? mod.simulateTimedEvent
  if (typeof fn !== 'function') throw new Error('sequence module missing simulateSequence export')
  return fn
}

function resolveMonteCarloFn(mod: Record<string, any>): (...args: any[]) => MonteCarloDesignSummary[] {
  const fn = mod.runMonteCarlo ?? mod.evaluateMonteCarlo
  if (typeof fn !== 'function') throw new Error('montecarlo module missing runMonteCarlo export')
  return fn
}

describe('Tier 2 — F4 Edges: Web Worker Monte Carlo Boundaries', () => {
  it('F4-T2.1: worker emits error response for invalid request (trialsPerModel <= 0 or empty models)', async () => {
    const modelsMod = await loadModelsModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const outZero = await runWorkerJob({
      jobId: 'err-zero',
      models: [v51],
      adjustmentsByModel: { [v51.id]: defaultAdjustmentsForModel(v51) },
      env: createNominalEnv(),
      rubricConfig: { task: 'day1_distance' },
      trialsPerModel: 0,
      baseSeed: 1,
    })
    expect(outZero.error).toBeDefined()
    expect(outZero.error!.jobId).toBe('err-zero')

    const outEmpty = await runWorkerJob({
      jobId: 'err-empty',
      models: [],
      adjustmentsByModel: {},
      env: createNominalEnv(),
      rubricConfig: { task: 'day1_distance' },
      trialsPerModel: 10,
      baseSeed: 1,
    })
    expect(outEmpty.error).toBeDefined()
  })

  it('F4-T2.2: worker handles trialsPerModel = 1 boundary cleanly without NaN percentiles or CEP', async () => {
    const modelsMod = await loadModelsModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const out = await runWorkerJob({
      jobId: 'one-trial',
      models: [v51],
      adjustmentsByModel: { [v51.id]: defaultAdjustmentsForModel(v51) },
      env: createNominalEnv({ energyVarianceJ: 0 }),
      rubricConfig: { task: 'day1_distance' },
      trialsPerModel: 1,
      baseSeed: 42,
    })
    expect(out.done).toBeDefined()
    const s = out.done!.results![0]
    expect(s.landings).toHaveLength(1)
    expect(s.p10Score).toBe(s.medianScore)
    expect(s.p90Score).toBe(s.meanScore)
    assertFinite(s.cep95Ellipse.semiMajorM, 'semiMajorM')
    assertFinite(s.cep95Ellipse.semiMinorM, 'semiMinorM')
  })

  it('F4-T2.3: worker handles 100%-miss batch cleanly without NaN', async () => {
    const modelsMod = await loadModelsModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const out = await runWorkerJob({
      jobId: 'all-miss',
      models: [v51],
      adjustmentsByModel: { [v51.id]: defaultAdjustmentsForModel(v51) },
      env: createNominalEnv({ energyVarianceJ: 0.05 }),
      rubricConfig: { task: 'day2_accuracy', target: { x: 25, y: 0 }, targetRadiusM: 0.2 },
      trialsPerModel: 20,
      baseSeed: 55,
    })
    const s = out.done!.results![0]
    expect(s.missRate).toBe(1)
    assertFinite(s.meanScore, 'meanScore')
    assertFinite(s.cep95Ellipse.centerX, 'centerX')
  })

  it('F4-T2.4: superseding jobId runs do not leak or corrupt subsequent job results', async () => {
    const modelsMod = await loadModelsModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const reqBase: Omit<MonteCarloRequest, 'jobId' | 'baseSeed'> = {
      models: [v51],
      adjustmentsByModel: { [v51.id]: defaultAdjustmentsForModel(v51) },
      env: createNominalEnv(),
      rubricConfig: { task: 'day1_distance' },
      trialsPerModel: 15,
    }
    const first = await runWorkerJob({ ...reqBase, jobId: 'sup-1', baseSeed: 100 })
    const second = await runWorkerJob({ ...reqBase, jobId: 'sup-2', baseSeed: 200 })
    expect(first.done?.jobId).toBe('sup-1')
    expect(second.done?.jobId).toBe('sup-2')
    expect(second.done?.results?.[0].landings).toHaveLength(15)
  })

  it('F4-T2.5: N=500 across 4 models completes under 15s with monotonic progress counts', async () => {
    const modelsMod = await loadModelsModule()
    const models = listAllModels(modelsMod).slice(0, 4)
    const adjustmentsByModel: Record<string, AdjustmentValues> = {}
    for (const m of models) adjustmentsByModel[m.id] = defaultAdjustmentsForModel(m)

    const start = Date.now()
    const out = await runWorkerJob({
      jobId: 'batch-4x500',
      models,
      adjustmentsByModel,
      env: createNominalEnv({ energyVarianceJ: 0.1 }),
      rubricConfig: { task: 'day1_distance', timeWindowS: 210 },
      trialsPerModel: 500,
      baseSeed: 9001,
    })
    expect(Date.now() - start).toBeLessThan(15_000)
    expect(out.done?.results).toHaveLength(models.length)
    let prev = -1
    for (const p of out.progressMessages) {
      expect(p.completed).toBeGreaterThanOrEqual(prev)
      expect(p.completed).toBeLessThanOrEqual(p.total)
      prev = p.completed
    }
  })
})

describe('Tier 2 — F9 Edges: 3D Flight Aerodynamics Boundaries', () => {
  it('F9-T2.1: zero launch velocity drops straight down without 0/0 drag division-by-zero', async () => {
    const aeroMod = await loadAeroModule()
    const fly = resolveFlightFn(aeroMod)
    const res = fly(
      { posM: [0, 0, 0.5], velMps: [0, 0, 0], omegaBallRadps: [0, 0, 0] },
      createNominalEnv({ windVecMps: [0, 0, 0] })
    )
    const ix = res.impactPosM?.[0] ?? res.samples?.at(-1)?.x
    const iy = res.impactPosM?.[1] ?? res.samples?.at(-1)?.y
    expect(Math.abs(assertFinite(ix, 'impactX'))).toBeLessThan(1e-4)
    expect(Math.abs(assertFinite(iy, 'impactY'))).toBeLessThan(1e-4)
  })

  it('F9-T2.2: extreme 15 m/s crosswind with high spin terminates cleanly at ground impact', async () => {
    const aeroMod = await loadAeroModule()
    const fly = resolveFlightFn(aeroMod)
    const res = fly(
      { posM: [0, 0, 0.25], velMps: [6, 0, 6], omegaBallRadps: [30, -90, 20] },
      createNominalEnv({ windVecMps: [0, 15, 0] })
    )
    const iy = res.impactPosM?.[1] ?? res.samples?.at(-1)?.y
    const iz = res.impactPosM?.[2] ?? res.samples?.at(-1)?.z
    expect(assertFinite(iy, 'impactY')).toBeGreaterThan(0.2)
    expect(assertFinite(iz, 'impactZ')).toBeLessThanOrEqual(REPO_CONSTANTS.R_BALL + 1e-3)
  })

  it('F9-T2.3: negative air density or negative Cd throws explicit validation error', async () => {
    const aeroMod = await loadAeroModule()
    const fly = resolveFlightFn(aeroMod)
    expect(() =>
      fly(
        { posM: [0, 0, 0.2], velMps: [5, 0, 5], omegaBallRadps: [0, 0, 0] },
        createNominalEnv({ airDensityKgM3: -1.2 })
      )
    ).toThrow()
    expect(() =>
      fly(
        { posM: [0, 0, 0.2], velMps: [5, 0, 5], omegaBallRadps: [0, 0, 0] },
        createNominalEnv({ cdOverride: -0.3 })
      )
    ).toThrow()
  })

  it('F9-T2.4: extreme updraft triggers max-flight-time safety cap without infinite loop', async () => {
    const aeroMod = await loadAeroModule()
    const fly = resolveFlightFn(aeroMod)
    const res = fly(
      { posM: [0, 0, 0.5], velMps: [2, 0, 5], omegaBallRadps: [0, 0, 0] },
      createNominalEnv({ windVecMps: [0, 0, 50] })
    )
    const tEnd = res.tImpactS ?? res.samples?.at(-1)?.t
    expect(assertFinite(tEnd, 'tEnd')).toBeGreaterThan(0)
    expect(tEnd).toBeLessThanOrEqual(120)
  })

  it('F9-T2.5: near-zero spin (1e-12 rad/s) avoids NaN in Magnus cross-product', async () => {
    const aeroMod = await loadAeroModule()
    const fly = resolveFlightFn(aeroMod)
    const res = fly(
      { posM: [0, 0, 0.2], velMps: [6, 0, 6], omegaBallRadps: [0, 1e-12, 0] },
      createNominalEnv()
    )
    const ix = res.impactPosM?.[0] ?? res.samples?.at(-1)?.x
    expect(assertFinite(ix, 'impactX')).toBeGreaterThan(1.0)
  })
})

describe('Tier 2 — F10 Edges: Turf Impact, Bounce & Rollout Boundaries', () => {
  it('F10-T2.1: shallow high-speed skid vs steep vertical drop exhibits angle-dependent tangential speed loss ratio, topspin bite, and distinct rollout', async () => {
    const turfMod = await loadTurfModule()
    expect(typeof turfMod.simulateTurf).toBe('function')
    const env = createNominalEnv({ turfEn: 0.32, turfMuR: 0.14, turfScatterSigmaRad: 0 })

    const shallow: TurfResult = turfMod.simulateTurf(
      { posM: [3, 0, 0], velMps: [8.0, 0, -1.0], omegaBallRadps: [0, 0, 0], tStartS: 0.5 },
      env
    )
    const steep: TurfResult = turfMod.simulateTurf(
      { posM: [3, 0, 0], velMps: [1.0, 0, -8.0], omegaBallRadps: [0, 0, 0], tStartS: 0.5 },
      env
    )

    assertFinite(shallow.rollDistanceM, 'shallow.rollDistanceM')
    assertFinite(steep.rollDistanceM, 'steep.rollDistanceM')
    expect(Array.isArray(shallow.postBounceVelMps)).toBe(true)
    expect(Array.isArray(steep.postBounceVelMps)).toBe(true)
    expect(Array.isArray(shallow.postBounceOmegaRadps)).toBe(true)
    expect(shallow.samples.at(-1)?.event).toBe('rest')
    expect(steep.samples.at(-1)?.event).toBe('rest')

    const shallowPostVx = assertFinite(shallow.postBounceVelMps[0], 'shallowPostVx')
    const steepPostVx = assertFinite(steep.postBounceVelMps[0], 'steepPostVx')
    const shallowLossRatio = (8.0 - shallowPostVx) / 8.0
    const steepLossRatio = (1.0 - steepPostVx) / 1.0

    expect(assertFinite(shallow.tangentialSpeedLossRatio, 'shallow.tangentialSpeedLossRatio')).toBeGreaterThan(0)
    expect(shallow.tangentialSpeedLossRatio).toBeLessThan(1)
    expect(assertFinite(steep.tangentialSpeedLossRatio, 'steep.tangentialSpeedLossRatio')).toBeGreaterThan(0)
    expect(steep.tangentialSpeedLossRatio).toBeLessThan(1)

    expect(8.0 - shallowPostVx).toBeGreaterThan(0.05)
    expect(shallowLossRatio).toBeGreaterThan(0)
    expect(shallowLossRatio).toBeLessThan(1)
    expect(steepLossRatio).toBeGreaterThan(0.05)
    expect(steepLossRatio).toBeLessThan(1)
    expect(Math.abs(shallowLossRatio - steepLossRatio)).toBeGreaterThan(0.03)

    expect(assertFinite(shallow.postBounceOmegaRadps[1], 'shallowTopspinY')).toBeGreaterThan(1)

    expect(assertFinite(shallow.postBounceVelMps[2], 'shallowVz')).toBeGreaterThan(0)
    expect(shallow.postBounceVelMps[2]).toBeLessThanOrEqual(env.turfEn * 1.0 + 1e-6)
    expect(assertFinite(steep.postBounceVelMps[2], 'steepVz')).toBeLessThanOrEqual(env.turfEn * 8.0 + 1e-6)

    expect(shallow.rollDistanceM).toBeGreaterThan(0.5)
    expect(shallow.rollDistanceM).toBeGreaterThan(steep.rollDistanceM * 2)
  })

  it('F10-T2.2: turfEn = 0 produces zero/minimal bounce and enters rollout cleanly', async () => {
    const modelsMod = await loadModelsModule()
    const simMod = await loadSimulateModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const res = simMod.simulateShot(
      v51,
      adjustKeys(v51, { notch: 6, stop: 42 }),
      createNominalEnv({ turfEn: 0, turfMuR: 0.18, turfScatterSigmaRad: 0 }),
      { x: 4.8, y: 0 },
      3
    )
    expect(res.bouncePoints.length).toBeLessThanOrEqual(1)
    expect(res.trace[res.trace.length - 1].event).toBe('rest')
  })

  it('F10-T2.3: invalid turfEn (<0 or >1) or turfMuR (<=0) throws validation error', async () => {
    const modelsMod = await loadModelsModule()
    const simMod = await loadSimulateModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const adj = defaultAdjustmentsForModel(v51)
    expect(() => simMod.simulateShot(v51, adj, createNominalEnv({ turfEn: -0.1 }), { x: 4, y: 0 }, 1)).toThrow()
    expect(() => simMod.simulateShot(v51, adj, createNominalEnv({ turfEn: 1.2 }), { x: 4, y: 0 }, 1)).toThrow()
    expect(() => simMod.simulateShot(v51, adj, createNominalEnv({ turfMuR: 0 }), { x: 4, y: 0 }, 1)).toThrow()
  })

  it('F10-T2.4: low vertical velocity micro-bounce transitions cleanly without Zeno hang', async () => {
    const modelsMod = await loadModelsModule()
    const simMod = await loadSimulateModule()
    const direct = findModel(modelsMod, 'direct_rail')
    const res = simMod.simulateShot(
      direct,
      adjustKeys(direct, { peg: 10 }),
      createNominalEnv({ turfEn: 0.35, turfMuR: 0.08 }),
      { x: 1, y: 0 },
      11
    )
    expect(res.trace.length).toBeLessThan(10_000)
    expect(res.trace[res.trace.length - 1].event).toBe('rest')
  })

  it('F10-T2.5: ultra-wet grass (mu_r = 0.25) terminates at rest without backward friction reversal', async () => {
    const modelsMod = await loadModelsModule()
    const simMod = await loadSimulateModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const res = simMod.simulateShot(
      v51,
      adjustKeys(v51, { notch: 4, stop: 58 }),
      createNominalEnv({ turfEn: 0.25, turfMuR: 0.25, turfScatterSigmaRad: 0 }),
      { x: 3, y: 0 },
      7
    )
    const contact = res.trace.find((s: any) => s.event === 'contact')!
    const rest = res.trace[res.trace.length - 1]
    expect(rest.x).toBeGreaterThanOrEqual(contact.x - 1e-6)
  })
})

describe('Tier 2 — F11 Edges: Cycle Timing & Jitter Boundaries', () => {
  it('F11-T2.1: extreme negative human jitter sample clamps cycleTimeS strictly positive', async () => {
    const modelsMod = await loadModelsModule()
    const simMod = await loadSimulateModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const extremeJitter: LauncherModel = {
      ...v51,
      cycleTiming: { cockPerTrapS: 1, loadS: 1, aimAdjustS: 1, humanSigmaS: 100 },
    }
    for (let seed = 1; seed <= 25; seed++) {
      const res = simMod.simulateShot(extremeJitter, defaultAdjustmentsForModel(v51), createNominalEnv(), { x: 4, y: 0 }, seed)
      expect(res.cycleTimeS).toBeGreaterThan(0)
    }
  })

  it('F11-T2.2: zero time window or window shorter than single cycle returns 0 completed shots', async () => {
    const modelsMod = await loadModelsModule()
    const seqMod = await loadSequenceModule()
    const simSeq = resolveSequenceFn(seqMod)
    const v51 = findModel(modelsMod, 'cord_horn')
    const zeroWin = simSeq(v51, defaultAdjustmentsForModel(v51), createNominalEnv(), { windowS: 0, seed: 1 })
    expect(zeroWin.shotsCompleted).toBe(0)
    const shortWin = simSeq(v51, defaultAdjustmentsForModel(v51), createNominalEnv(), { windowS: 0.5, seed: 1 })
    expect(shortWin.shotsCompleted).toBe(0)
  })

  it('F11-T2.3: exact windowS === 6 * t_cycle fires 6 shots while windowS - 0.01 fires 5', async () => {
    const modelsMod = await loadModelsModule()
    const seqMod = await loadSequenceModule()
    const simSeq = resolveSequenceFn(seqMod)
    const v51 = findModel(modelsMod, 'cord_horn')
    const fixed: LauncherModel = {
      ...v51,
      cycleTiming: { cockPerTrapS: 5, loadS: 5, aimAdjustS: 0, humanSigmaS: 0 },
      tolerances: { cockAngleSigmaDeg: 0, seatingOffsetSigmaM: 0, yawSigmaDeg: 0, stopAngleSigmaDeg: 0 },
    }
    // t_cycle = 5*3 + 5 = 20s -> 6 * 20 = 120s
    const exact6 = simSeq(fixed, defaultAdjustmentsForModel(fixed), createNominalEnv(), { windowS: 120, seed: 1 })
    const justUnder = simSeq(fixed, defaultAdjustmentsForModel(fixed), createNominalEnv(), { windowS: 119.99, seed: 1 })
    expect(exact6.shotsCompleted).toBe(6)
    expect(justUnder.shotsCompleted).toBe(5)
  })

  it('F11-T2.4: extreme setup jitter clamps angles cleanly without crashing solver', async () => {
    const modelsMod = await loadModelsModule()
    const simMod = await loadSimulateModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const wild: LauncherModel = {
      ...v51,
      tolerances: {
        cockAngleSigmaDeg: 15,
        seatingOffsetSigmaM: 0.01,
        yawSigmaDeg: 10,
        stopAngleSigmaDeg: 10,
      },
    }
    for (let seed = 1; seed <= 15; seed++) {
      const res = simMod.simulateShot(wild, defaultAdjustmentsForModel(wild), createNominalEnv(), { x: 4, y: 0 }, seed)
      assertFinite(res.totalDistanceM, `wild.total.${seed}`)
    }
  })

  it('F11-T2.5: zero humanSigmaS and zero setup tolerances yield zero variance across seeds', async () => {
    const modelsMod = await loadModelsModule()
    const simMod = await loadSimulateModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const clean: LauncherModel = {
      ...v51,
      cycleTiming: { ...v51.cycleTiming, humanSigmaS: 0 },
      tolerances: { cockAngleSigmaDeg: 0, seatingOffsetSigmaM: 0, yawSigmaDeg: 0, stopAngleSigmaDeg: 0 },
    }
    const env = createNominalEnv({ energyVarianceJ: 0, turfScatterSigmaRad: 0 })
    const a = simMod.simulateShot(clean, defaultAdjustmentsForModel(clean), env, { x: 4, y: 0 }, 1)
    const b = simMod.simulateShot(clean, defaultAdjustmentsForModel(clean), env, { x: 4, y: 0 }, 999)
    expect(a.totalDistanceM).toBe(b.totalDistanceM)
    expect(a.cycleTimeS).toBe(b.cycleTimeS)
  })
})

describe('Tier 2 — F12 Edges: Three.js Scene & Fallback Boundaries (Chromium CDP)', () => {
  it('F12-T2.1: WebGL failure renders fallback text in #field and disables #camera', async () => {
    await withBrowserApp(
      async (app) => {
        const text = await app.getText('#field')
        expect(text).toContain('The 3D view requires WebGL. Trace measurements are available below.')
        const camDisabled = await app.evalExpr<boolean>(`return document.querySelector('#camera').disabled`)
        expect(camDisabled).toBe(true)
        expect(await app.getText('#metrics')).toContain('4.72 m')
        expect(app.getPageErrors()).toEqual([])
      },
      { disableWebGL: true }
    )
  })

  it('F12-T2.2: zero-carry trace (contact at release origin) renders without Line2 NaN or crash', async () => {
    const zeroCarry = JSON.stringify({
      samples: [
        { t: 0, x: 0, y: 0, z: 0.05 },
        { t: 0.1, x: 0, y: 0, z: 0, event: 'contact' },
        { t: 0.2, x: 0, y: 0, z: 0, event: 'rest' },
      ],
    })
    await withTempJsonFile(zeroCarry, 'zero-carry.json', async (fp) => {
      await withBrowserApp(async (app) => {
        await app.uploadFile('#file', fp)
        await app.waitForFunction(`document.querySelector('#source')?.textContent?.trim() === 'zero-carry.json'`, 5000)
        expect(await app.getText('#metrics')).toContain('0.00 m')
        expect(app.getPageErrors()).toEqual([])
        expect(app.getConsoleErrors()).toEqual([])
      })
    })
  })

  it('F12-T2.3: extreme long (>25m) and short (<0.3m) traces frame cleanly across all 4 camera presets', async () => {
    const longTrace = JSON.stringify({
      samples: [
        { t: 0, x: 0, y: 0, z: 0.2 },
        { t: 1.5, x: 26, y: 0.5, z: 0, event: 'contact' },
        { t: 2.5, x: 28.4, y: 0.6, z: 0, event: 'rest' },
      ],
    })
    const shortTrace = JSON.stringify({
      samples: [
        { t: 0, x: 0, y: 0, z: 0.05 },
        { t: 0.2, x: 0.18, y: 0.01, z: 0, event: 'contact' },
        { t: 0.4, x: 0.22, y: 0.01, z: 0, event: 'rest' },
      ],
    })
    await withBrowserApp(async (app) => {
      for (const [name, json] of [
        ['long.json', longTrace],
        ['short.json', shortTrace],
      ] as const) {
        await withTempJsonFile(json, name, async (fp) => {
          await app.uploadFile('#file', fp)
          await app.waitForFunction(`document.querySelector('#source')?.textContent?.trim() === ${JSON.stringify(name)}`, 5000)
          for (const preset of ['orbit', 'side', 'overhead', 'downrange']) {
            await app.selectOption('#camera', preset)
            await new Promise((r) => setTimeout(r, 80))
          }
        })
      }
      expect(app.getPageErrors()).toEqual([])
      expect(app.getConsoleErrors()).toEqual([])
    })
  })

  it('F12-T2.4: rapid trace reloads dispose old CSS2D .field-label elements without orphaned duplicates', async () => {
    const traceA = JSON.stringify({
      samples: [
        { t: 0, x: 0, y: 0, z: 0.2 },
        { t: 0.5, x: 2.0, y: 0, z: 0, event: 'contact' },
        { t: 1.0, x: 2.5, y: 0, z: 0, event: 'rest' },
      ],
    })
    await withTempJsonFile(traceA, 'reload.json', async (fp) => {
      await withBrowserApp(async (app) => {
        for (let i = 0; i < 3; i++) {
          await app.evalExpr(`document.querySelector('#source').textContent = ''`)
          await app.uploadFile('#file', fp)
          await app.waitForFunction(
            `document.querySelector('#source')?.textContent?.trim() === 'reload.json'`,
            5_000
          )
        }
        await app.waitForFunction(
          `Array.from(document.querySelectorAll('#field .field-label')).some((el) => el.getBoundingClientRect().width > 0)`,
          5_000
        )
        const labelCount = await app.evalExpr<number>(`
          return document.querySelectorAll('#field .field-label').length;
        `)
        // Release + Carry + Rest = 3 labels (no target, no bounce)
        expect(labelCount).toBe(3)
        expect(app.getPageErrors()).toEqual([])
      })
    })
  })

  it('F12-T2.5: close-together Carry and Rest labels avoid overlapping bounding boxes', async () => {
    const closeTrace = JSON.stringify({
      samples: [
        { t: 0, x: 0, y: 0, z: 0.2 },
        { t: 0.4, x: 1.8, y: 0, z: 0.9 },
        { t: 0.8, x: 3.5, y: 0, z: 0, event: 'contact' },
        { t: 0.9, x: 3.55, y: 0, z: 0, event: 'rest' },
      ],
    })
    await withTempJsonFile(closeTrace, 'close.json', async (fp) => {
      await withBrowserApp(async (app) => {
        await app.uploadFile('#file', fp)
        await app.waitForFunction(`document.querySelector('#source')?.textContent?.trim() === 'close.json'`, 5000)
        await app.waitForFunction(
          `Array.from(document.querySelectorAll('#field .field-label span')).filter((s) => {
            const r = s.getBoundingClientRect();
            return getComputedStyle(s).visibility === 'visible' && /^(Carry|Rest)/.test(s.textContent || '') && r.width > 0 && r.height > 0;
          }).length === 2`,
          5_000
        )
        const rects = await app.evalExpr<Array<{ text: string; left: number; top: number; right: number; bottom: number }>>(`
          return Array.from(document.querySelectorAll('#field .field-label span'))
            .filter((s) => getComputedStyle(s).visibility === 'visible' && /^(Carry|Rest)/.test(s.textContent || ''))
            .map((s) => {
              const r = s.getBoundingClientRect();
              return { text: s.textContent || '', left: r.left, top: r.top, right: r.right, bottom: r.bottom };
            });
        `)
        expect(rects).toHaveLength(2)
        const [a, b] = rects
        const overlaps = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
        expect(overlaps).toBe(false)
      })
    })
  })

  it('F12-T2.6: replay scrubber clamps negative and post-duration timestamps to release and rest', async () => {
    await withBrowserApp(async (app) => {
      await app.setInput('#replay-time', '-5')
      expect(await app.getText('#replay-clock')).toBe('0.00 / 1.80 s')
      await app.setInput('#replay-time', '99')
      expect(await app.getText('#replay-clock')).toBe('1.80 / 1.80 s')
    })
  })
})

describe('Tier 2 — F13 Edges: Telemetry & Auto-Sight Boundaries', () => {
  it('F13-T2.1: Auto-Sight returns reachable=false for unreachable 20m target and surfaces UI warning', async () => {
    const modelsMod = await loadModelsModule()
    const autoMod = await loadAutoSightModule()
    const autoSight = resolveAutoSightFn(autoMod)
    const v51 = findModel(modelsMod, 'cord_horn')
    const res = autoSight(v51, createNominalEnv(), 20.0)
    expect(res.reachable).toBe(false)

    await withBrowserApp(async (app) => {
      const triggered = await app.evalExpr<boolean>(`
        const inp = document.querySelector(${JSON.stringify(M4_SELECTORS.autosightTarget)});
        const btn = document.querySelector(${JSON.stringify(M4_SELECTORS.autosightBtn)})
          || Array.from(document.querySelectorAll('button')).find((b) => /auto-?sight|calibrate/i.test(b.textContent || ''));
        if (!inp || !btn) return false;
        inp.value = '20';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        btn.click();
        return true;
      `)
      expect(triggered).toBe(true)
      await new Promise((r) => setTimeout(r, 120))
      const warnText = await app.evalExpr<string>(`
        const w = document.querySelector(${JSON.stringify(M4_SELECTORS.autosightStatus)});
        return w ? (w.textContent || '') : '';
      `)
      expect(warnText).toMatch(/unreachable|out of range|cannot reach/i)
    })
  })

  it('F13-T2.2: Auto-Sight rejects negative or NaN target distance cleanly', async () => {
    const modelsMod = await loadModelsModule()
    const autoMod = await loadAutoSightModule()
    const autoSight = resolveAutoSightFn(autoMod)
    const v51 = findModel(modelsMod, 'cord_horn')
    expect(() => autoSight(v51, createNominalEnv(), -1)).toThrow()
    expect(() => autoSight(v51, createNominalEnv(), Number.NaN)).toThrow()
  })

  it('F13-T2.3: Auto-Sight selects outer peg (>= 8) for near-minimum 0.60m target on direct_arm', async () => {
    const modelsMod = await loadModelsModule()
    const autoMod = await loadAutoSightModule()
    const autoSight = resolveAutoSightFn(autoMod)
    const direct = findModel(modelsMod, 'direct_rail')
    const res = autoSight(direct, createNominalEnv({ turfScatterSigmaRad: 0 }), 0.6)
    const pegKey = Object.keys(res.adjustments).find((k) => k.toLowerCase().includes('peg') || k.toLowerCase().includes('station'))
    expect(pegKey).toBeDefined()
    expect(res.adjustments[pegKey!]).toBeGreaterThanOrEqual(8)
  })

  it('F13-T2.4: extreme low-energy + wet turf + headwind simulation yields finite non-NaN telemetry', async () => {
    const modelsMod = await loadModelsModule()
    const simMod = await loadSimulateModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const res = simMod.simulateShot(
      v51,
      adjustKeys(v51, { notch: 4, stop: 58 }),
      createNominalEnv({ nominalEnergyJ: 0.8, turfEn: 0.2, turfMuR: 0.25, windVecMps: [-3, 0, 0] }),
      { x: 2.0, y: 0 },
      19
    )
    assertFinite(res.carryDistanceM, 'carryDistanceM')
    assertFinite(res.rollDistanceM, 'rollDistanceM')
    assertFinite(res.totalDistanceM, 'totalDistanceM')
    assertFinite(res.energyEfficiencyPct, 'energyEfficiencyPct')
  })

  it('F13-T2.5: non-ejection configuration produces finite zero/minimal result without crash', async () => {
    const modelsMod = await loadModelsModule()
    const simMod = await loadSimulateModule()
    const direct = findModel(modelsMod, 'direct_rail')
    const res = simMod.simulateShot(
      direct,
      adjustKeys(direct, { peg: 10 }),
      createNominalEnv({ nominalEnergyJ: 0.2 }),
      { x: 2.0, y: 0 },
      1
    )
    assertFinite(res.totalDistanceM, 'totalDistanceM')
    expect(res.totalDistanceM).toBeGreaterThanOrEqual(0)
  })
})

describe('Tier 2 — F14 Edges: Monte Carlo Shootout & CEP Boundaries', () => {
  it('F14-T2.1: N=500 shootout with 100% misses yields missRate=1 and non-NaN CEP ellipse', async () => {
    const modelsMod = await loadModelsModule()
    const mcMod = await loadMonteCarloModule()
    const runMC = resolveMonteCarloFn(mcMod)
    const v51 = findModel(modelsMod, 'cord_horn')
    const [s] = runMC({
      jobId: 'f14-all-miss',
      models: [v51],
      adjustmentsByModel: { [v51.id]: defaultAdjustmentsForModel(v51) },
      env: createNominalEnv({ energyVarianceJ: 0.08 }),
      rubricConfig: { task: 'day2_accuracy', target: { x: 25, y: 0 }, targetRadiusM: 0.2 },
      trialsPerModel: 500,
      baseSeed: 401,
    })
    expect(s.missRate).toBe(1)
    assertFinite(s.cep95Ellipse.semiMajorM, 'semiMajorM')
    assertFinite(s.cep95Ellipse.semiMinorM, 'semiMinorM')
    assertFinite(s.cep95Ellipse.angleRad, 'angleRad')
  })

  it('F14-T2.2: N=500 shootout with zero variance produces zero-area CEP without NaN eigenvectors', async () => {
    const modelsMod = await loadModelsModule()
    const mcMod = await loadMonteCarloModule()
    const runMC = resolveMonteCarloFn(mcMod)
    const v51 = findModel(modelsMod, 'cord_horn')
    const clean: LauncherModel = {
      ...v51,
      cycleTiming: { ...v51.cycleTiming, humanSigmaS: 0 },
      tolerances: { cockAngleSigmaDeg: 0, seatingOffsetSigmaM: 0, yawSigmaDeg: 0, stopAngleSigmaDeg: 0 },
    }
    const [s] = runMC({
      jobId: 'f14-zero-var',
      models: [clean],
      adjustmentsByModel: { [clean.id]: defaultAdjustmentsForModel(clean) },
      env: createNominalEnv({ energyVarianceJ: 0, turfScatterSigmaRad: 0 }),
      rubricConfig: { task: 'day1_distance' },
      trialsPerModel: 500,
      baseSeed: 402,
    })
    assertFinite(s.cep95Ellipse.centerX, 'centerX')
    assertFinite(s.cep95Ellipse.centerY, 'centerY')
    expect(assertFinite(s.cep95Ellipse.semiMajorM, 'semiMajorM')).toBeLessThan(1e-4)
    expect(assertFinite(s.cep95Ellipse.semiMinorM, 'semiMinorM')).toBeLessThan(1e-4)
    assertFinite(s.cep95Ellipse.angleRad, 'angleRad')
  })

  it('F14-T2.3: narrow court lateral bounds count out-of-bounds shots accurately in oobRate', async () => {
    const modelsMod = await loadModelsModule()
    const mcMod = await loadMonteCarloModule()
    const runMC = resolveMonteCarloFn(mcMod)
    const v51 = findModel(modelsMod, 'cord_horn')
    const yawSpread: LauncherModel = {
      ...v51,
      tolerances: { ...v51.tolerances, yawSigmaDeg: 5 },
    }
    const [s] = runMC({
      jobId: 'f14-oob',
      models: [yawSpread],
      adjustmentsByModel: { [yawSpread.id]: defaultAdjustmentsForModel(yawSpread) },
      env: createNominalEnv({ energyVarianceJ: 0.05 }),
      rubricConfig: { task: 'day1_distance', fieldHalfWidthM: 0.05 },
      trialsPerModel: 100,
      baseSeed: 403,
    })
    expect(s.oobRate).toBeGreaterThan(0)
    expect(s.oobRate).toBeLessThanOrEqual(1)
  })

  it('F14-T2.4: carryToRollRatio remains finite even when rollout approaches 0', async () => {
    const modelsMod = await loadModelsModule()
    const mcMod = await loadMonteCarloModule()
    const runMC = resolveMonteCarloFn(mcMod)
    const v51 = findModel(modelsMod, 'cord_horn')
    const [s] = runMC({
      jobId: 'f14-zero-roll',
      models: [v51],
      adjustmentsByModel: { [v51.id]: adjustKeys(v51, { notch: 4, stop: 58 }) },
      env: createNominalEnv({ turfEn: 0, turfMuR: 0.5, energyVarianceJ: 0 }),
      rubricConfig: { task: 'day1_distance' },
      trialsPerModel: 20,
      baseSeed: 404,
    })
    assertFinite(s.carryToRollRatio, 'carryToRollRatio')
  })

  it('F14-T2.5: switching between Day-1 Distance and Day-2 Accuracy tasks produces distinct task metrics and enforces 5m Day-1 cap', async () => {
    const modelsMod = await loadModelsModule()
    const mcMod = await loadMonteCarloModule()
    const runMC = resolveMonteCarloFn(mcMod)
    const v51 = findModel(modelsMod, 'cord_horn')
    const [d1] = runMC({
      jobId: 'f14-d1',
      models: [v51],
      adjustmentsByModel: { [v51.id]: adjustKeys(v51, { notch: 6, stop: 42 }) },
      env: createNominalEnv({ energyVarianceJ: 0.08 }),
      rubricConfig: { task: 'day1_distance', fieldHalfWidthM: 3 },
      trialsPerModel: 40,
      baseSeed: 405,
    })
    const [d2] = runMC({
      jobId: 'f14-d2',
      models: [v51],
      adjustmentsByModel: { [v51.id]: adjustKeys(v51, { notch: 6, stop: 42 }) },
      env: createNominalEnv({ energyVarianceJ: 0.08 }),
      rubricConfig: { task: 'day2_accuracy', target: { x: 25, y: 0 }, targetRadiusM: 0.3 },
      trialsPerModel: 40,
      baseSeed: 405,
    })
    expect(d1.meanScore).toBeGreaterThan(d2.meanScore)
    expect(d2.missRate).toBe(1)

    for (const l of d1.landings) {
      if (Math.abs(l.restY) <= 3) {
        expect(l.score).toBe(2 * Math.min(5, Math.floor(l.totalM)))
      }
    }

    const [d1Cap] = runMC({
      jobId: 'f14-d1-cap',
      models: [v51],
      adjustmentsByModel: { [v51.id]: adjustKeys(v51, { notch: 6, stop: 42 }) },
      env: createNominalEnv({ nominalEnergyJ: 3.0, energyVarianceJ: 0, turfScatterSigmaRad: 0 }),
      rubricConfig: { task: 'day1_distance', fieldHalfWidthM: 3 },
      trialsPerModel: 20,
      baseSeed: 406,
    })
    const meanTotal = d1Cap.landings.reduce((acc, l) => acc + l.totalM, 0) / d1Cap.landings.length
    expect(meanTotal).toBeGreaterThan(5.5)
    expect(d1Cap.meanScore).toBe(10)
    expect(d1Cap.p90Score).toBe(10)
  })
})

describe('Tier 2 — F15 Edges: Course Scorecard, Practice & Replay Boundaries', () => {
  it('F15-T2.1: Edge E1 distance cap at 5m and RangeError on negative/non-finite distance', async () => {
    const rubric = await loadRubricModule()
    expect(rubric.distancePoints(4.999)).toBe(8)
    expect(rubric.distancePoints(5.0)).toBe(10)
    expect(rubric.distancePoints(50)).toBe(10)
    expect(() => rubric.distancePoints(-1)).toThrow(RangeError)
    expect(() => rubric.distancePoints(Number.NaN)).toThrow(RangeError)
    expect(() => rubric.distancePoints(Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })

  it('F15-T2.2: Edge E2 group bonus voids all shares when sum != 6 and rejects invalid lateDays, marks, and targetHits', async () => {
    const rubric = await loadRubricModule()
    const base = createRubricInput()
    const voided2 = rubric.evaluateRubric({ ...base, groupShares: [2, 3] })
    expect(voided2.groupBonuses).toEqual([0, 0])
    const voided3 = rubric.evaluateRubric({ ...base, groupShares: [2, 3, 3] })
    expect(voided3.groupBonuses).toEqual([0, 0, 0])
    expect(() => rubric.evaluateRubric({ ...base, groupShares: [6] })).toThrow(RangeError)
    expect(() => rubric.evaluateRubric({ ...base, groupShares: [1, 1, 1, 3] })).toThrow(RangeError)

    expect(() => rubric.evaluateRubric({ ...base, lateDays: -1 })).toThrow(RangeError)
    expect(() => rubric.evaluateRubric({ ...base, lateDays: 1.5 })).toThrow(RangeError)
    expect(() => rubric.evaluateRubric({ ...base, marks: { ...base.marks, requirements: 6 } })).toThrow(RangeError)
    expect(() => rubric.evaluateRubric({ ...base, marks: { ...base.marks, requirements: -0.5 } })).toThrow(RangeError)
    expect(() => rubric.evaluateRubric({ ...base, marks: { ...base.marks, respect: 3 } })).toThrow(RangeError)

    const partial = rubric.evaluateRubric({ ...base, targetHits: [true, false] })
    expect(partial.hitPoints).toEqual([5, 0])
    expect(partial.performance.earned).toBe(15)
    expect(partial.performance.complete).toBe(true)

    const pending = rubric.evaluateRubric({ ...base, targetHits: [true, null] })
    expect(pending.hitPoints).toEqual([5, null])
    expect(pending.performance.complete).toBe(false)

    expect(() => rubric.evaluateRubric({ ...base, targetHits: ['hit' as any, 'miss' as any] })).toThrow(TypeError)
  })

  it('F15-T2.3: uploading invalid JSON or trace missing contact/rest shows #error without wiping prior metrics', async () => {
    await withBrowserApp(async (app) => {
      const beforeMetrics = await app.getText('#metrics')
      await withTempJsonFile('{ bad json', 'broken.json', async (fp) => {
        await app.uploadFile('#file', fp)
        await app.waitForFunction(`!document.querySelector('#error').hidden`, 5000)
        expect(await app.getText('#error')).toContain('Could not load trace')
        expect(await app.getText('#metrics')).toBe(beforeMetrics)
      })
      const noRest = JSON.stringify({
        samples: [
          { t: 0, x: 0, y: 0, z: 0.2 },
          { t: 0.5, x: 2, y: 0, z: 0, event: 'contact' },
        ],
      })
      await withTempJsonFile(noRest, 'no-rest.json', async (fp) => {
        await app.uploadFile('#file', fp)
        await app.waitForFunction(`!document.querySelector('#error').hidden`, 5000)
        expect(await app.getText('#error')).toContain('rest')
      })
    })
  })

  it('F15-T2.4: practice zero/negative radius or width shows #practice-error and throws in evaluatePractice', async () => {
    const practice = await loadPracticeModule()
    const sampleTrace = [
      { t: 0, x: 0, y: 0, z: 0.2 },
      { t: 0.5, x: 2, y: 0, z: 0, event: 'contact' as const },
      { t: 1.0, x: 2.5, y: 0, z: 0, event: 'rest' as const },
    ]
    expect(() => practice.evaluatePractice(sampleTrace, { x: 2, y: 0, shape: 'circle', radius: 0 }, 'contact')).toThrow()
    expect(() =>
      practice.evaluatePractice(sampleTrace, { x: 2, y: 0, shape: 'rectangle', length: 1, width: -1 }, 'rest')
    ).toThrow()
    expect(practice.evaluatePractice(sampleTrace, { x: 2.5, y: 0, shape: 'circle', radius: 0.5 }, 'contact').hit).toBe(true)
    expect(
      practice.evaluatePractice(sampleTrace, { x: 2.5 + 1e-6, y: 0, shape: 'circle', radius: 0.5 }, 'contact').hit
    ).toBe(false)
    expect(
      practice.evaluatePractice(sampleTrace, { x: 2.0, y: 0.5, shape: 'rectangle', length: 1.0, width: 1.0 }, 'rest').hit
    ).toBe(true)
    expect(
      practice.evaluatePractice(sampleTrace, { x: 2.0 - 1e-6, y: 0.5, shape: 'rectangle', length: 1.0, width: 1.0 }, 'rest')
        .hit
    ).toBe(false)

    await withBrowserApp(async (app) => {
      await app.evalExpr(`document.querySelector('#practice').open = true`)
      await app.setInput('#practice-form input[name="x"]', '3.5')
      await app.setInput('#practice-form input[name="radius"]', '0')
      await app.submitForm('#practice-form')
      expect(await app.isHidden('#practice-error')).toBe(false)
      expect(await app.getText('#practice-error')).toContain('radius')
    })
  })

  it('F15-T2.5: replay positionAt throws on empty/non-finite inputs and clamps out-of-range elapsed times', async () => {
    const replay = await loadReplayModule()
    const samples = [
      { t: 1.0, x: 0, y: 0, z: 0.2 },
      { t: 2.0, x: 3.0, y: 0.5, z: 0, event: 'contact' as const },
      { t: 3.0, x: 4.0, y: 0.6, z: 0, event: 'rest' as const },
    ]
    expect(() => replay.positionAt([], 0)).toThrow()
    expect(() => replay.positionAt(samples, Number.NaN)).toThrow()
    expect(replay.positionAt(samples, -10)).toEqual({ x: 0, y: 0, z: 0.2 })
    expect(replay.positionAt(samples, 100)).toEqual({ x: 4.0, y: 0.6, z: 0 })
    expect(replay.positionAt(samples, 1.0)).toEqual({ x: 3.0, y: 0.5, z: 0 })
  })
})
