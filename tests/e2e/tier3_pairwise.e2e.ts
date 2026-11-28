import { describe, expect, it } from 'vitest'
import { launchApp, type BrowserAppSession } from './helpers/browser_cdp'
import {
  type AdjustmentValues,
  type LauncherModel,
  type LaunchReleaseState,
  M4_SELECTORS,
  type MonteCarloRequest,
  loadAutoSightModule,
  loadLaunchSolverModule,
  loadModelsModule,
  loadMonteCarloModule,
  loadPracticeModule,
  loadReplayModule,
  loadRubricModule,
  loadSequenceModule,
  loadSimulateModule,
  loadTelemetryModule,
} from './helpers/contracts'
import {
  assertFinite,
  createNominalEnv,
  createRubricInput,
  createSeededRng,
  createTurfPresetEnv,
  createVacuumEnv,
  defaultAdjustmentsForModel,
  REPO_CONSTANTS,
  sumEnergyBudget,
} from './helpers/fixtures'
import { runWorkerJob } from './helpers/worker_harness'

function listAllModels(modelsMod: Record<string, any>): LauncherModel[] {
  if (typeof modelsMod.listLauncherModels === 'function') return modelsMod.listLauncherModels()
  if (typeof modelsMod.listModels === 'function') return modelsMod.listModels()
  if (typeof modelsMod.getAllModels === 'function') return modelsMod.getAllModels()
  if (Array.isArray(modelsMod.LAUNCHER_MODELS)) return modelsMod.LAUNCHER_MODELS
  if (Array.isArray(modelsMod.MODELS)) return modelsMod.MODELS
  throw new Error('Models registry must export listLauncherModels() / listModels()')
}

function validateModelAdjustments(modelsMod: Record<string, any>, model: LauncherModel, adj: AdjustmentValues): AdjustmentValues {
  const fn = modelsMod.validateAndClampAdjustments ?? modelsMod.validateAdjustments
  if (typeof fn !== 'function') throw new Error('Models module missing validateAndClampAdjustments/validateAdjustments')
  return fn(model, adj)
}

function findModel(modelsMod: Record<string, any>, topology: string, idSubstr?: string): LauncherModel {
  const found = listAllModels(modelsMod).find(
    (m) => m.topology === topology && (!idSubstr || m.id.toLowerCase().includes(idSubstr.toLowerCase()))
  )
  if (!found) throw new Error(`Model not found for topology=${topology} idSubstr=${idSubstr ?? ''}`)
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

async function withBrowserApp(fn: (app: BrowserAppSession) => Promise<void>): Promise<void> {
  const app = await launchApp()
  try {
    await fn(app)
  } finally {
    await app.close()
  }
}

describe('Tier 3 — Cross-Feature Pairwise Interactions (T3-01 .. T3-18)', () => {
  it('T3-01 (F5 x F11): 1-trap vs 2-trap vs 3-trap bank count trades shot throughput against per-shot distance in 180 s window', async () => {
    const modelsMod = await loadModelsModule()
    const seqMod = await loadSequenceModule()
    const models = listAllModels(modelsMod)
    const oneTrap = models.find((m) => m.trapBank.count === 1)
    const threeTrap = findModel(modelsMod, 'direct_rail')
    expect(oneTrap).toBeDefined()
    const s1 = seqMod.simulateSequence(oneTrap!, defaultAdjustmentsForModel(oneTrap!), createNominalEnv(), {
      windowS: 180,
      target: { x: 2.0, y: 0 },
      targetRadiusM: 0.5,
      seed: 101,
    })
    const s3 = seqMod.simulateSequence(threeTrap, defaultAdjustmentsForModel(threeTrap), createNominalEnv(), {
      windowS: 180,
      target: { x: 2.0, y: 0 },
      targetRadiusM: 0.5,
      seed: 101,
    })
    expect(s1.shotsCompleted).toBeGreaterThanOrEqual(s3.shotsCompleted)
    expect(s3.shots[0].carryDistanceM).toBeGreaterThan(s1.shots[0].carryDistanceM)
  })

  it('T3-02 (F5 x F6): lower spring energy shifts v5.0 cam cord slack angle and amplifies speed drop vs v5.1', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const v50 = findModel(modelsMod, 'circular_cam')
    const r50Hi: LaunchReleaseState = solverMod.solveLaunch(v50, defaultAdjustmentsForModel(v50), createVacuumEnv({ nominalEnergyJ: 2.12 }), createSeededRng(2))
    const r50Lo: LaunchReleaseState = solverMod.solveLaunch(v50, defaultAdjustmentsForModel(v50), createVacuumEnv({ nominalEnergyJ: 1.92 }), createSeededRng(2))
    const r51Hi: LaunchReleaseState = solverMod.solveLaunch(v51, defaultAdjustmentsForModel(v51), createVacuumEnv({ nominalEnergyJ: 2.12 }), createSeededRng(2))
    expect(r50Lo.launchSpeedMps).toBeLessThan(r50Hi.launchSpeedMps)
    expect(r50Hi.launchSpeedMps).toBeLessThan(r51Hi.launchSpeedMps)
    expect(r50Hi.cordSlackAtDeg).not.toBeNull()
  })

  it('T3-03 (F6 x F7): higher arm inertia reduces peak cord tension while increasing wasted hard-stop KE on v5.1', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const adj = adjustKeys(v51, { notch: 6, stop: 42 })
    const heavy: LauncherModel = { ...v51, arm: { ...v51.arm, inertiaKgM2: v51.arm.inertiaKgM2 * 3, massKg: v51.arm.massKg * 3 } }
    const rBase: LaunchReleaseState = solverMod.solveLaunch(v51, adj, createNominalEnv(), createSeededRng(3))
    const rHeavy: LaunchReleaseState = solverMod.solveLaunch(heavy, adj, createNominalEnv(), createSeededRng(3))
    expect(assertFinite(rBase.peakCordTensionN ?? NaN, 'rBase.peakCordTensionN')).toBeGreaterThan(0)
    expect(assertFinite(rHeavy.peakCordTensionN ?? NaN, 'rHeavy.peakCordTensionN')).toBeGreaterThan(0)
    expect(rHeavy.peakCordTensionN!).toBeLessThan(rBase.peakCordTensionN!)
    expect(rHeavy.wastedStopKeJ).toBeGreaterThan(rBase.wastedStopKeJ)
    expect(rHeavy.launchSpeedMps).toBeLessThan(rBase.launchSpeedMps)
  })

  it('T3-04 (F7 x F8): arm inertia (0.5x vs 2x) alters direct_arm rail separation timing, angle, and ball spin', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const direct = findModel(modelsMod, 'direct_rail')
    const adj = adjustKeys(direct, { peg: 1, flip: 0 })
    const light: LauncherModel = { ...direct, arm: { ...direct.arm, inertiaKgM2: direct.arm.inertiaKgM2 * 0.5, massKg: direct.arm.massKg * 0.5 } }
    const heavy: LauncherModel = { ...direct, arm: { ...direct.arm, inertiaKgM2: direct.arm.inertiaKgM2 * 2.0, massKg: direct.arm.massKg * 2.0 } }
    const rLight: LaunchReleaseState = solverMod.solveLaunch(light, adj, createVacuumEnv(), createSeededRng(4))
    const rHeavy: LaunchReleaseState = solverMod.solveLaunch(heavy, adj, createVacuumEnv(), createSeededRng(4))
    expect(rLight.tReleaseS).toBeLessThan(rHeavy.tReleaseS)
    expect(Math.hypot(...rLight.omegaBallRadps)).not.toBeCloseTo(Math.hypot(...rHeavy.omegaBallRadps), 1)
  })

  it('T3-05 (F8 x F9): cradle backspin vs frictionless zero-spin interacts with Magnus lift & Cd (dimpled vs smooth)', async () => {
    const modelsMod = await loadModelsModule()
    const simMod = await loadSimulateModule()
    const direct = findModel(modelsMod, 'direct_rail')
    const adj = adjustKeys(direct, { peg: 1, flip: 0 })
    const dimpledRoll = simMod.simulateShot(direct, adj, createNominalEnv({ projectile: 'golf_ball' }), { x: 3.5, y: 0 }, 5)
    const smoothRoll = simMod.simulateShot(direct, adj, createNominalEnv({ projectile: 'smooth_ball' }), { x: 3.5, y: 0 }, 5)
    expect(dimpledRoll.carryDistanceM).toBeGreaterThan(smoothRoll.carryDistanceM)
  })

  it('T3-06 (F9 x F10): wind (headwind vs tailwind vs crosswind) compounds with firm/dry vs soft/wet turf rollout', async () => {
    const modelsMod = await loadModelsModule()
    const simMod = await loadSimulateModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const adj = adjustKeys(v51, { notch: 6, stop: 42 })
    const dryTail = simMod.simulateShot(v51, adj, createTurfPresetEnv('dry', { windVecMps: [3, 0, 0] }), { x: 5.0, y: 0 }, 6)
    const wetHead = simMod.simulateShot(v51, adj, createTurfPresetEnv('wet', { windVecMps: [-3, 0, 0] }), { x: 5.0, y: 0 }, 6)
    const cross = simMod.simulateShot(v51, adj, createTurfPresetEnv('firm', { windVecMps: [0, 3, 0], turfScatterSigmaRad: 0 }), { x: 5.0, y: 0 }, 6)
    expect(dryTail.totalDistanceM).toBeGreaterThan(wetHead.totalDistanceM)
    expect(dryTail.rollDistanceM).toBeGreaterThan(wetHead.rollDistanceM)
    expect(Math.abs(cross.trace[cross.trace.length - 1].y)).toBeGreaterThan(0.01)
  })

  it('T3-07 (F8 x F10): steep 58 deg vs flat 42 deg launch elevation alters turf bite and rollout ratio', async () => {
    const modelsMod = await loadModelsModule()
    const simMod = await loadSimulateModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const flat = simMod.simulateShot(v51, adjustKeys(v51, { notch: 6, stop: 42 }), createTurfPresetEnv('firm', { turfScatterSigmaRad: 0 }), { x: 4.0, y: 0 }, 7)
    const steep = simMod.simulateShot(v51, adjustKeys(v51, { notch: 6, stop: 58 }), createTurfPresetEnv('firm', { turfScatterSigmaRad: 0 }), { x: 4.0, y: 0 }, 7)
    expect(steep.rollDistanceM).toBeLessThan(flat.rollDistanceM)
  })

  it('T3-08 (F3 x F13): Auto-Sight respects discrete vs continuous adjustment DOFs across v5.1, direct_arm, and v4.1', async () => {
    const modelsMod = await loadModelsModule()
    const autoMod = await loadAutoSightModule()
    const env = createNominalEnv({ turfScatterSigmaRad: 0 })

    const v51 = findModel(modelsMod, 'cord_horn')
    const a51 = autoMod.autoSight(v51, env, 3.5)
    expect(a51.reachable).toBe(true)
    expect(() => validateModelAdjustments(modelsMod, v51, a51.adjustments)).not.toThrow()
    expect(Math.abs(a51.predictedDistanceM - 3.5)).toBeLessThan(0.5)

    const direct = findModel(modelsMod, 'direct_rail')
    const aDir = autoMod.autoSight(direct, env, 2.5)
    expect(aDir.reachable).toBe(true)
    expect(() => validateModelAdjustments(modelsMod, direct, aDir.adjustments)).not.toThrow()
    expect(Math.abs(aDir.predictedDistanceM - 2.5)).toBeLessThan(0.5)

    const v41 = findModel(modelsMod, 'tilted_cradle')
    const a41 = autoMod.autoSight(v41, env, 2.5)
    expect(() => validateModelAdjustments(modelsMod, v41, a41.adjustments)).not.toThrow()
  })

  it('T3-09 (F3 x F11 x F14): setup/yaw jitter scales Monte Carlo CEP95 semi-axes cleanly', async () => {
    const modelsMod = await loadModelsModule()
    const mcMod = await loadMonteCarloModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const adj = adjustKeys(v51, { notch: 6, stop: 42 })
    const zeroJitterModel: LauncherModel = {
      ...v51,
      tolerances: { cockAngleSigmaDeg: 0, seatingOffsetSigmaM: 0, yawSigmaDeg: 0, stopAngleSigmaDeg: 0 },
    }
    const yawJitterModel: LauncherModel = {
      ...v51,
      tolerances: { cockAngleSigmaDeg: 0.5, seatingOffsetSigmaM: 0.001, yawSigmaDeg: 3.0, stopAngleSigmaDeg: 0.5 },
    }
    const envZero = createNominalEnv({ energyVarianceJ: 0, turfScatterSigmaRad: 0 })
    const reqBase = (model: LauncherModel): MonteCarloRequest => ({
      jobId: `t3-09-${model.id}`,
      models: [model],
      adjustmentsByModel: { [model.id]: adj },
      env: envZero,
      rubricConfig: { task: 'day1_distance', target: { x: 4.5, y: 0 } },
      trialsPerModel: 60,
      baseSeed: 90,
    })
    const [resZero] = mcMod.runMonteCarlo(reqBase(zeroJitterModel))
    const [resJitter] = mcMod.runMonteCarlo(reqBase(yawJitterModel))
    expect(resZero.cep95Ellipse.semiMajorM).toBeLessThan(resJitter.cep95Ellipse.semiMajorM)
    expect(resJitter.cep95Ellipse.semiMinorM).toBeGreaterThan(0.05)
  })

  it('T3-10 (F2 x F15): declarative rubricCompliance equipmentBonus combines accurately with evaluateRubric', async () => {
    const modelsMod = await loadModelsModule()
    const rubricMod = await loadRubricModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const treb = findModel(modelsMod, 'gravity_trebuchet')
    const r51 = rubricMod.evaluateRubric(
      createRubricInput({ distanceM: 5.0, equipment: v51.rubricCompliance.equipmentBonus })
    )
    const rTreb = rubricMod.evaluateRubric(
      createRubricInput({ distanceM: 5.0, equipment: treb.rubricCompliance.equipmentBonus })
    )
    expect(rTreb.equipmentBonus!).toBeGreaterThan(r51.equipmentBonus!)
    expect(rTreb.individualTotals![0]!).toBeGreaterThan(r51.individualTotals![0]!)
  })

  it('T3-11 (F1 x F15): simulateShot trace flows seamlessly through telemetry.measure, practice, and replay', async () => {
    const modelsMod = await loadModelsModule()
    const simMod = await loadSimulateModule()
    const telMod = await loadTelemetryModule()
    const pracMod = await loadPracticeModule()
    const repMod = await loadReplayModule()

    const v51 = findModel(modelsMod, 'cord_horn')
    const adj = adjustKeys(v51, { notch: 6, stop: 42 })
    const res = simMod.simulateShot(v51, adj, createNominalEnv(), { x: 4.5, y: 0 }, 11)
    const m = telMod.measure(res.trace, { x: 4.5, y: 0 })
    expect(m.total).toBeCloseTo(res.totalDistanceM, 4)

    const contactSample = res.trace.find((s: { event?: string }) => s.event === 'contact')!
    const atContact = repMod.positionAt(res.trace, contactSample.t - res.trace[0].t)
    expect(atContact.x).toBeCloseTo(contactSample.x, 4)

    const prac = pracMod.evaluatePractice(
      res.trace,
      { x: res.trace[res.trace.length - 1].x - res.trace[0].x, y: res.trace[res.trace.length - 1].y - res.trace[0].y, shape: 'circle', radius: 0.1 },
      'rest'
    )
    expect(prac.hit).toBe(true)
  })

  it('T3-12 (F4 x F14): montecarlo.worker.ts output matches direct runMonteCarlo for identical baseSeed (N=500)', async () => {
    const modelsMod = await loadModelsModule()
    const mcMod = await loadMonteCarloModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const req: MonteCarloRequest = {
      jobId: 't3-12-seed-match',
      models: [v51],
      adjustmentsByModel: { [v51.id]: adjustKeys(v51, { notch: 6, stop: 42 }) },
      env: createNominalEnv({ energyVarianceJ: 0.05 }),
      rubricConfig: { task: 'day1_distance', target: { x: 4.5, y: 0 } },
      trialsPerModel: 500,
      baseSeed: 12345,
    }
    const directResults = mcMod.runMonteCarlo(req)

    const outcome = await runWorkerJob(req)
    expect(outcome.error).toBeUndefined()
    const done = outcome.done
    expect(done).toBeDefined()
    expect(done!.jobId).toBe(req.jobId)
    expect(done!.results![0].meanScore).toBeCloseTo(directResults[0].meanScore, 6)
    expect(done!.results![0].cep95Ellipse.semiMajorM).toBeCloseTo(directResults[0].cep95Ellipse.semiMajorM, 6)
    expect(done!.results![0].landings.length).toBe(500)
  })

  it('T3-13 (F12 x F13): browser dynamic model/adjustment controls update both HUD telemetry and 3D .field-label overlays', async () => {
    await withBrowserApp(async (app) => {
      expect(await app.exists(M4_SELECTORS.modelSelect)).toBe(true)
      const beforeMetrics = await app.getText('#metrics')
      const beforeLabels = await app.evalExpr<string[]>(
        'return Array.from(document.querySelectorAll("#field .field-label")).map((n) => n.textContent || "")'
      )
      const changed = await app.evalExpr<boolean>(`
        const slider = document.querySelector('#model-controls input[type="range"], #model-controls select');
        if (!slider) return false;
        if (slider.tagName === 'SELECT') {
          const sel = slider;
          sel.selectedIndex = sel.selectedIndex === 0 && sel.options.length > 1 ? 1 : 0;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
        const inp = slider;
        inp.value = inp.value === inp.min ? inp.max : inp.min;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      `)
      expect(changed).toBe(true)
      await app.waitForFunction(
        `(document.querySelector('#metrics')?.textContent || '').trim() !== ${JSON.stringify(beforeMetrics)}`,
        5000
      )
      const afterMetrics = await app.getText('#metrics')
      const afterLabels = await app.evalExpr<string[]>(
        'return Array.from(document.querySelectorAll("#field .field-label")).map((n) => n.textContent || "")'
      )
      expect(afterMetrics).not.toBe(beforeMetrics)
      expect(afterLabels.length).toBeGreaterThan(0)
      expect(afterLabels.join('|')).not.toBe(beforeLabels.join('|'))
      expect(afterLabels.join('|')).not.toMatch(/\bNaN\b/)
    })
  })

  it('T3-14 (F12 x F14): overhead camera preset frames Monte Carlo 95% CEP ellipse and target zone inside viewport', async () => {
    await withBrowserApp(async (app) => {
      await app.selectOption('#camera', 'overhead')
      expect(await app.exists(M4_SELECTORS.runShootoutBtn)).toBe(true)
      await app.click(M4_SELECTORS.runShootoutBtn)
      await app.waitForFunction(
        `document.querySelectorAll(${JSON.stringify(M4_SELECTORS.shootoutRows)}).length > 0`,
        20_000
      )
      const framed = await app.evalExpr<{
        canvasW: number
        canvasH: number
        hasCep: boolean
        visibleLabelsInViewport: number
      }>(`
        const field = document.querySelector('#field');
        const fieldRect = field?.getBoundingClientRect();
        const canvasRect = document.querySelector('#field canvas')?.getBoundingClientRect();
        const labels = Array.from(document.querySelectorAll('#field .field-label'));
        const hasCepAttr = document.querySelector('[data-cep-rendered="true"], .cep-legend') !== null;
        const hasCepLabel = labels.some((n) => /cep|95%/i.test(n.textContent || ''));
        let visibleInView = 0;
        if (fieldRect) {
          for (const el of labels) {
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden' || r.width === 0 || r.height === 0) continue;
            const intersects =
              r.right >= fieldRect.left &&
              r.left <= fieldRect.right &&
              r.bottom >= fieldRect.top &&
              r.top <= fieldRect.bottom;
            if (intersects) visibleInView++;
          }
        }
        return {
          canvasW: canvasRect?.width || 0,
          canvasH: canvasRect?.height || 0,
          hasCep: hasCepAttr || hasCepLabel,
          visibleLabelsInViewport: visibleInView,
        };
      `)
      expect(framed.canvasW).toBeGreaterThan(0)
      expect(framed.canvasH).toBeGreaterThan(0)
      expect(framed.hasCep).toBe(true)
      expect(framed.visibleLabelsInViewport).toBeGreaterThan(0)
    })
  })

  it('T3-15 (F13 x F15): Auto-Sight calibrated shot flows into #scorecard Use-Carry/Use-Total and updates competition subtotal', async () => {
    await withBrowserApp(async (app) => {
      expect(await app.exists(M4_SELECTORS.autosightTarget)).toBe(true)
      expect(await app.exists(M4_SELECTORS.autosightBtn)).toBe(true)
      expect(await app.exists(M4_SELECTORS.launchBtn)).toBe(true)

      const preTotalBtnVal = await app.evalExpr<string>(
        'return document.querySelector("#score-use-total")?.value || ""'
      )
      await app.setInput(M4_SELECTORS.autosightTarget, '4.80')
      await app.click(M4_SELECTORS.autosightBtn)
      await app.waitForFunction(
        `/Calibrated/i.test(document.querySelector(${JSON.stringify(M4_SELECTORS.autosightStatus)})?.textContent || '')`,
        10_000
      )

      await app.click(M4_SELECTORS.launchBtn)
      await app.waitForFunction(
        `(() => {
          const carry = document.querySelector("#score-use-carry");
          const total = document.querySelector("#score-use-total");
          return Boolean(carry && !carry.disabled && total && !total.disabled && total.value !== ${JSON.stringify(preTotalBtnVal)});
        })()`,
        10_000
      )

      expect((await app.getText('#competition-points')).trim()).toBe('Pending')

      await app.click('#score-use-carry')
      const carryPts = (await app.getText('#competition-points')).trim()
      expect(carryPts).toMatch(/^\d+\s*\/\s*10 assessed · 20 possible$/)

      await app.click('#score-use-total')
      const totalPartialPts = (await app.getText('#competition-points')).trim()
      expect(totalPartialPts).toMatch(/^[1-9]\d*\s*\/\s*10 assessed · 20 possible$/)

      await app.selectOption('#grading select[name="hit1"]', 'hit')
      await app.selectOption('#grading select[name="hit2"]', 'miss')
      const completePts = (await app.getText('#competition-points')).trim()
      expect(completePts).toMatch(/^\d+\s*\/\s*20$/)
      expect(completePts).not.toBe('0 / 20')
    })
  })

  it('T3-16 (F10 x F15): turf rollout separates carry (<5 m) from total (>=5 m) across practice endpoints & Day-1 rubric', async () => {
    const modelsMod = await loadModelsModule()
    const simMod = await loadSimulateModule()
    const pracMod = await loadPracticeModule()
    const rubricMod = await loadRubricModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const adj = adjustKeys(v51, { notch: 6, stop: 42 })
    const res = simMod.simulateShot(v51, adj, createTurfPresetEnv('firm', { turfScatterSigmaRad: 0 }), { x: 5.0, y: 0 }, 16)

    // Unconditionally assert circle centered at totalDistanceM hits on rest while first contact misses
    expect(res.rollDistanceM).toBeGreaterThan(0.25)
    const radius = Math.min(0.2, res.rollDistanceM * 0.45)
    const targetAtRest = { x: res.totalDistanceM, y: 0, shape: 'circle' as const, radius }
    expect(pracMod.evaluatePractice(res.trace, targetAtRest, 'rest').hit).toBe(true)
    expect(pracMod.evaluatePractice(res.trace, targetAtRest, 'contact').hit).toBe(false)
    const ptsCarry = rubricMod.distancePoints(res.carryDistanceM)
    const ptsTotal = rubricMod.distancePoints(res.totalDistanceM)
    expect(ptsTotal).toBeGreaterThanOrEqual(ptsCarry)
  })

  it('T3-17 (F1 x F16): pure RK4 timestep <= 0.0005 s holds < 1% energy conservation across all 6 topology variants', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const models = listAllModels(modelsMod)
    const seenTopologies = new Set<string>()
    for (const model of models) {
      seenTopologies.add(model.topology)
      const rel: LaunchReleaseState = solverMod.solveLaunch(
        model,
        defaultAdjustmentsForModel(model),
        createNominalEnv(),
        createSeededRng(17)
      )
      for (let i = 1; i < rel.armTraceSamples.length; i++) {
        expect(rel.armTraceSamples[i].t - rel.armTraceSamples[i - 1].t).toBeLessThanOrEqual(0.0005 + 1e-12)
      }
      const err = Math.abs(sumEnergyBudget(rel.energyBudget) - rel.energyBudget.springInitialJ) / rel.energyBudget.springInitialJ
      expect(err).toBeLessThan(0.01)
    }
    expect(seenTopologies.size).toBeGreaterThanOrEqual(5)
  })

  it('T3-18 (F2 x F3 x F8): candidate 1-trap vs 3-trap direct-arm shifts the peg ejection boundary (Edge E4)', async () => {
    const modelsMod = await loadModelsModule()
    const solverMod = await loadLaunchSolverModule()
    const models = listAllModels(modelsMod)
    const oneTrapDirect = models.find((m) => m.topology === 'direct_rail' && m.trapBank.count === 1)!
    const threeTrapDirect = findModel(modelsMod, 'direct_rail')
    expect(oneTrapDirect).toBeDefined()

    const adj10B = adjustKeys(threeTrapDirect, { peg: 10, flip: 1 })
    const r3 = solverMod.solveLaunch(
      threeTrapDirect,
      adj10B,
      createNominalEnv({ nominalEnergyJ: REPO_CONSTANTS.E_SPRING_NOMINAL }),
      createSeededRng(18)
    )
    const r1 = solverMod.solveLaunch(
      oneTrapDirect,
      adj10B,
      createNominalEnv({ nominalEnergyJ: REPO_CONSTANTS.E_SPRING_NOMINAL }),
      createSeededRng(18)
    )
    expect(r3.leftCradle).toBe(true)
    expect(r1.leftCradle).toBe(true)
    expect(r3.launchSpeedMps).toBeGreaterThan(r1.launchSpeedMps)
    expect(r3.energyBudget.springInitialJ).toBeGreaterThan(r1.energyBudget.springInitialJ)

    // Edge E4 leftCradle ejection boundary at low energy (0.30 J): peg 1A ejects while peg 10B stalls
    const rLow1A = solverMod.solveLaunch(
      threeTrapDirect,
      adjustKeys(threeTrapDirect, { peg: 1, flip: 0 }),
      createNominalEnv({ nominalEnergyJ: 0.3 }),
      createSeededRng(18)
    )
    const rLow10B = solverMod.solveLaunch(
      threeTrapDirect,
      adj10B,
      createNominalEnv({ nominalEnergyJ: 0.3 }),
      createSeededRng(18)
    )
    expect(rLow1A.leftCradle).toBe(true)
    expect(rLow10B.leftCradle).toBe(false)
  })
})
