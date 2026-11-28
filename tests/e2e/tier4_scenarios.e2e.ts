import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  type AdjustmentValues,
  type LauncherModel,
  type MonteCarloDesignSummary,
  M4_SELECTORS,
  loadAutoSightModule,
  loadModelsModule,
  loadMonteCarloModule,
  loadRubricModule,
  loadSequenceModule,
  loadSimulateModule,
} from './helpers/contracts'
import {
  assertFinite,
  createNominalEnv,
  createRubricInput,
  defaultAdjustmentsForModel,
  REPO_CONSTANTS,
} from './helpers/fixtures'
import { launchApp, type BrowserAppSession } from './helpers/browser_cdp'

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

async function withBrowserApp<T>(fn: (app: BrowserAppSession) => Promise<T>): Promise<T> {
  const app = await launchApp()
  try {
    return await fn(app)
  } finally {
    await app.close()
  }
}

async function withTempJsonFile<T>(content: string, filename: string, fn: (filePath: string) => Promise<T>): Promise<T> {
  const cacheBase = path.join(os.homedir(), '.cache')
  fs.mkdirSync(cacheBase, { recursive: true })
  const dir = fs.mkdtempSync(path.join(cacheBase, 'mtc180-e2e-t4-'))
  const filePath = path.join(dir, filename)
  fs.writeFileSync(filePath, content)
  try {
    return await fn(filePath)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
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

describe('Tier 4 — Real-World Competition Scenarios (T4-01..T4-10)', () => {
  it('T4-01: Day-1 Max Distance Shootout across 5 topologies (N=500, firm turf)', async () => {
    const modelsMod = await loadModelsModule()
    const mcMod = await loadMonteCarloModule()
    const runMC = resolveMonteCarloFn(mcMod)

    const v51 = findModel(modelsMod, 'cord_horn')
    const direct = findModel(modelsMod, 'direct_rail')
    const v50 = findModel(modelsMod, 'circular_cam')
    const v41 = findModel(modelsMod, 'tilted_cradle')
    const treb = findModel(modelsMod, 'gravity_trebuchet')

    const results: MonteCarloDesignSummary[] = runMC({
      jobId: 't4-01-day1',
      models: [v51, direct, v50, v41, treb],
      adjustmentsByModel: {
        [v51.id]: adjustKeys(v51, { notch: 6, stop: 42 }),
        [direct.id]: adjustKeys(direct, { peg: 1 }),
        [v50.id]: defaultAdjustmentsForModel(v50),
        [v41.id]: adjustKeys(v41, { launchDeg: 48 }),
        [treb.id]: defaultAdjustmentsForModel(treb),
      },
      env: createNominalEnv({ turfEn: 0.35, turfMuR: 0.1, energyVarianceJ: 0.1 }),
      rubricConfig: { task: 'day1_distance', timeWindowS: 210, fieldHalfWidthM: 3 },
      trialsPerModel: 500,
      baseSeed: 4010,
    })

    expect(results).toHaveLength(5)
    const rV51 = results.find((r) => r.modelId === v51.id)!
    const rV50 = results.find((r) => r.modelId === v50.id)!
    const meanCarryV51 = rV51.landings.reduce((acc, l) => acc + l.carryM, 0) / rV51.landings.length
    const meanTotalV51 = rV51.landings.reduce((acc, l) => acc + l.totalM, 0) / rV51.landings.length
    const meanCarryV50 = rV50.landings.reduce((acc, l) => acc + l.carryM, 0) / rV50.landings.length

    expect(meanCarryV51).toBeGreaterThan(4.0)
    expect(meanTotalV51).toBeGreaterThanOrEqual(meanCarryV51)
    expect(meanCarryV51).toBeGreaterThan(meanCarryV50)
    expect(rV51.meanScore).toBeGreaterThanOrEqual(8)
    for (const r of results) {
      expect(r.meanScore).toBeLessThanOrEqual(10)
      expect(r.p90Score).toBeLessThanOrEqual(10)
      expect(r.landings.every((l) => l.score <= 10)).toBe(true)
    }
  })

  it('T4-02: Day-2 Dual-Target Timed Accuracy Shootout (210s, 6-8 shots, Target 1 & 2)', async () => {
    const modelsMod = await loadModelsModule()
    const autoMod = await loadAutoSightModule()
    const seqMod = await loadSequenceModule()
    const autoSight = resolveAutoSightFn(autoMod)
    const simSeq = resolveSequenceFn(seqMod)

    const v51 = findModel(modelsMod, 'cord_horn')
    const direct = findModel(modelsMod, 'direct_rail')
    const env = createNominalEnv({ energyVarianceJ: 0.08 })

    const fastDirect: LauncherModel = {
      ...direct,
      cycleTiming: { cockPerTrapS: 4, loadS: 5, aimAdjustS: 4, humanSigmaS: 0.5 },
    }
    const slowerV51: LauncherModel = {
      ...v51,
      cycleTiming: { cockPerTrapS: 6, loadS: 6, aimAdjustS: 6, humanSigmaS: 0.5 },
    }

    const autoV1 = autoSight(slowerV51, env, 2.2)
    const autoV2 = autoSight(slowerV51, env, 4.1)
    expect(autoV1.reachable).toBe(true)
    expect(autoV2.reachable).toBe(true)
    const seqV51 = simSeq(slowerV51, autoV1.adjustments, env, {
      windowS: 210,
      targets: [
        { x: 2.2, y: 0 },
        { x: 4.1, y: 0 },
      ],
      targetAdjustments: [autoV1.adjustments, autoV2.adjustments],
      targetRadiusM: 0.55,
      seed: 4020,
    })

    const autoD1 = autoSight(fastDirect, env, 2.2)
    const autoD2 = autoSight(fastDirect, env, 4.1)
    expect(autoD1.reachable).toBe(true)
    expect(autoD2.reachable).toBe(true)
    const seqDirect = simSeq(fastDirect, autoD1.adjustments, env, {
      windowS: 210,
      targets: [
        { x: 2.2, y: 0 },
        { x: 4.1, y: 0 },
      ],
      targetAdjustments: [autoD1.adjustments, autoD2.adjustments],
      targetRadiusM: 0.55,
      seed: 4020,
    })

    expect(seqV51.shotsCompleted).toBeGreaterThanOrEqual(6)
    expect(seqV51.shotsCompleted).toBeLessThanOrEqual(8)
    expect(seqDirect.shotsCompleted).toBeGreaterThan(seqV51.shotsCompleted)
    expect(seqV51.totalElapsedS).toBeLessThanOrEqual(210 + 1e-6)
    expect(seqV51.target1Hits).toBeGreaterThan(0)
    expect(seqV51.target2Hits).toBeGreaterThan(0)
    expect(seqDirect.target1Hits).toBeGreaterThan(0)
    expect(seqDirect.target2Hits).toBeGreaterThan(0)
    expect(seqV51.target1Hits + seqV51.target2Hits).toBeLessThanOrEqual(seqV51.shotsCompleted)
    expect(seqDirect.target1Hits + seqDirect.target2Hits).toBeLessThanOrEqual(seqDirect.shotsCompleted)
  })

  it('T4-03: Wet vs Firm Turf Shootout (mu_r=0.20, e_n=0.25 vs 0.08, 0.40)', async () => {
    const modelsMod = await loadModelsModule()
    const mcMod = await loadMonteCarloModule()
    const runMC = resolveMonteCarloFn(mcMod)
    const v51 = findModel(modelsMod, 'cord_horn')
    const adj = adjustKeys(v51, { notch: 6, stop: 42 })

    const [wet] = runMC({
      jobId: 't4-03-wet',
      models: [v51],
      adjustmentsByModel: { [v51.id]: adj },
      env: createNominalEnv({ turfEn: 0.25, turfMuR: 0.2, energyVarianceJ: 0.08 }),
      rubricConfig: { task: 'day1_distance' },
      trialsPerModel: 200,
      baseSeed: 4030,
    })
    const [firm] = runMC({
      jobId: 't4-03-firm',
      models: [v51],
      adjustmentsByModel: { [v51.id]: adj },
      env: createNominalEnv({ turfEn: 0.4, turfMuR: 0.08, energyVarianceJ: 0.08 }),
      rubricConfig: { task: 'day1_distance' },
      trialsPerModel: 200,
      baseSeed: 4030,
    })

    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length
    const wetCarry = avg(wet.landings.map((l) => l.carryM))
    const firmCarry = avg(firm.landings.map((l) => l.carryM))
    const wetRoll = avg(wet.landings.map((l) => l.totalM - l.carryM))
    const firmRoll = avg(firm.landings.map((l) => l.totalM - l.carryM))

    expect(Math.abs(wetCarry - firmCarry)).toBeLessThan(0.25)
    expect(wetRoll).toBeLessThan(firmRoll * 0.7)
    expect(wet.carryToRollRatio).toBeGreaterThan(firm.carryToRollRatio)
  })

  it('T4-04: Dimpled Real Golf Ball (+4 bonus) vs Smooth Ball in 3 m/s crosswind (N=500)', async () => {
    const modelsMod = await loadModelsModule()
    const mcMod = await loadMonteCarloModule()
    const rubric = await loadRubricModule()
    const runMC = resolveMonteCarloFn(mcMod)
    const v51 = findModel(modelsMod, 'cord_horn')
    const adj = adjustKeys(v51, { notch: 6, stop: 42 })

    const [golf] = runMC({
      jobId: 't4-04-golf',
      models: [v51],
      adjustmentsByModel: { [v51.id]: adj },
      env: createNominalEnv({ projectile: 'golf_ball', windVecMps: [0, 3, 0], energyVarianceJ: 0.08 }),
      rubricConfig: { task: 'day1_distance' },
      trialsPerModel: 500,
      baseSeed: 4040,
    })
    const [smooth] = runMC({
      jobId: 't4-04-smooth',
      models: [v51],
      adjustmentsByModel: { [v51.id]: adj },
      env: createNominalEnv({ projectile: 'smooth_ball', windVecMps: [0, 3, 0], energyVarianceJ: 0.08 }),
      rubricConfig: { task: 'day1_distance' },
      trialsPerModel: 500,
      baseSeed: 4040,
    })

    const meanCarry = (s: MonteCarloDesignSummary) => s.landings.reduce((a, l) => a + l.carryM, 0) / s.landings.length
    expect(meanCarry(golf)).toBeGreaterThan(meanCarry(smooth))

    const golfGrade = rubric.evaluateRubric(createRubricInput({ distanceM: meanCarry(golf), equipment: 'ball' }))
    const smoothGrade = rubric.evaluateRubric(createRubricInput({ distanceM: meanCarry(smooth), equipment: 'none' }))
    expect(golfGrade.individualTotals![0]).toBeGreaterThanOrEqual(smoothGrade.individualTotals![0]! + 4)
  })

  it('T4-05: 3-Inch Ground Clearance Audit across v5.1 Notches #1-#6 x Stop Angles', async () => {
    const modelsMod = await loadModelsModule()
    const simMod = await loadSimulateModule()
    const v51 = findModel(modelsMod, 'cord_horn')
    const v51Deterministic: LauncherModel = {
      ...v51,
      tolerances: {
        cockAngleSigmaDeg: 0,
        seatingOffsetSigmaM: 0,
        yawSigmaDeg: 0,
        stopAngleSigmaDeg: 0,
      },
    }
    if (typeof modelsMod.validateLauncherModel === 'function') {
      modelsMod.validateLauncherModel(v51Deterministic)
    }
    const direct = findModel(modelsMod, 'direct_rail')
    const env = createNominalEnv({ turfScatterSigmaRad: 0 })
    const threeInMm = REPO_CONSTANTS.THREE_INCHES_M * 1000

    const notchClearancesMm: number[] = []
    for (let notch = 1; notch <= 6; notch++) {
      const res = simMod.simulateShot(
        v51Deterministic,
        adjustKeys(v51Deterministic, { notch, stop: 42 }),
        env,
        { x: 4, y: 0 },
        1
      )
      expect(res.release.armTraceSamples.length).toBeGreaterThan(0)
      expect(assertFinite(res.trace[0].z, `n${notch}.releaseZ`)).toBeGreaterThan(0.15)
      const cockPsiDeg = assertFinite(res.release.armTraceSamples[0].psiDeg, `n${notch}.cockPsiDeg`)
      const ballPos = modelsMod.computeV51NotchBallPos(
        cockPsiDeg,
        v51Deterministic.arm.pivotPosMm,
        v51Deterministic.arm.ballOffsetArmMm,
        REPO_CONSTANTS.R_BALL * 1000
      )
      notchClearancesMm.push(assertFinite(ballPos.zBotMm, `n${notch}.zBotMm`))
    }
    // Cocked pre-release ball bottom: Notches #4-#6 < 3 in (76.2 mm); Notches #1-#3 >= 76.2 mm
    expect(notchClearancesMm[3]).toBeGreaterThan(0)
    expect(notchClearancesMm[3]).toBeLessThan(threeInMm)
    expect(notchClearancesMm[4]).toBeGreaterThan(0)
    expect(notchClearancesMm[4]).toBeLessThan(threeInMm)
    expect(notchClearancesMm[5]).toBeGreaterThan(0)
    expect(notchClearancesMm[5]).toBeLessThan(threeInMm)
    expect(notchClearancesMm[0]).toBeGreaterThanOrEqual(threeInMm)
    expect(notchClearancesMm[1]).toBeGreaterThanOrEqual(threeInMm)
    expect(notchClearancesMm[2]).toBeGreaterThanOrEqual(threeInMm)

    const pegs = modelsMod.computeDirectArmPegPositions(direct.cradle.railGeometry)
    expect(pegs).toHaveLength(20)
    for (const p of pegs) {
      expect(p.zBotMm).toBeGreaterThan(0)
      expect(p.zBotMm).toBeLessThan(threeInMm)
    }

    const compliantRanges: number[] = []
    for (const notch of [4, 5, 6]) {
      for (const stop of [42, 50, 58]) {
        const shot = simMod.simulateShot(v51, adjustKeys(v51, { notch, stop }), env, { x: 4, y: 0 }, 1)
        compliantRanges.push(assertFinite(shot.totalDistanceM, `n${notch}-s${stop}`))
      }
    }
    expect(Math.min(...compliantRanges)).toBeLessThan(2.5)
    expect(Math.max(...compliantRanges)).toBeGreaterThan(4.5)
  })

  it('T4-06: Trebuchet (+8 bonus) vs v5.1 (+4 bonus) 110-Pt Rubric Timed Tradeoff (180s)', async () => {
    const modelsMod = await loadModelsModule()
    const seqMod = await loadSequenceModule()
    const rubric = await loadRubricModule()
    const simSeq = resolveSequenceFn(seqMod)

    const v51 = findModel(modelsMod, 'cord_horn')
    const treb = findModel(modelsMod, 'gravity_trebuchet')
    const env = createNominalEnv({ energyVarianceJ: 0.08 })

    const seqV51 = simSeq(v51, defaultAdjustmentsForModel(v51), env, {
      windowS: 180,
      target: { x: 4.0, y: 0 },
      targetRadiusM: 0.6,
      seed: 4060,
    })
    const seqTreb = simSeq(treb, defaultAdjustmentsForModel(treb), env, {
      windowS: 180,
      target: { x: 4.0, y: 0 },
      targetRadiusM: 0.6,
      seed: 4060,
    })

    expect(seqV51.shotsCompleted).toBeGreaterThanOrEqual(seqTreb.shotsCompleted)

    const maxTreb = rubric.evaluateRubric(createRubricInput({ equipment: 'both', groupShares: [2, 2, 2] }))
    const maxV51 = rubric.evaluateRubric(createRubricInput({ equipment: 'ball', groupShares: [2, 2, 2] }))
    expect(maxTreb.individualTotals![0]).toBe(120) // 110 + 8 + 2
    expect(maxV51.individualTotals![0]).toBe(116) // 110 + 4 + 2
    const trebNoShare = rubric.evaluateRubric(createRubricInput({ equipment: 'both', groupShares: [0, 0] }))
    const v51NoShare = rubric.evaluateRubric(createRubricInput({ equipment: 'ball', groupShares: [0, 0] }))
    expect(trebNoShare.individualTotals![0]).toBe(118)
    expect(v51NoShare.individualTotals![0]).toBe(114)
  })

  it('T4-07: Complete Browser End-to-End Interactive Workflow (Chromium CDP)', async () => {
    await withBrowserApp(async (app) => {
      // 1. Default example trace loaded
      expect(await app.getText('#metrics')).toContain('4.72 m')

      // 2. Select v5.1 model & run Auto-Sight for 3.50m
      const modelsMod = await loadModelsModule()
      const v51 = findModel(modelsMod, 'cord_horn')
      const autoOk = await app.evalExpr<boolean>(`
        const sel = document.querySelector(${JSON.stringify(M4_SELECTORS.modelSelect)});
        const inp = document.querySelector(${JSON.stringify(M4_SELECTORS.autosightTarget)});
        const autoBtn = document.querySelector(${JSON.stringify(M4_SELECTORS.autosightBtn)})
          || Array.from(document.querySelectorAll('button')).find((b) => /auto-?sight|calibrate/i.test(b.textContent || ''));
        if (!sel || !inp || !autoBtn) return false;
        sel.value = ${JSON.stringify(v51.id)};
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        inp.value = '3.5';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        autoBtn.click();
        return true;
      `)
      expect(autoOk).toBe(true)

      // 3. Launch & replay across speeds
      const preLaunchMetrics = await app.evalExpr<string>(
        `return (document.querySelector('#metrics')?.textContent || '') + ' ' + (document.querySelector('#hud')?.textContent || '');`
      )
      const launchOk = await app.evalExpr<boolean>(`
        const btn = document.querySelector(${JSON.stringify(M4_SELECTORS.launchBtn)})
          || Array.from(document.querySelectorAll('button')).find((b) => /^\\s*(launch|fire|simulate)\\b/i.test(b.textContent || ''));
        if (!btn) return false;
        btn.click();
        return true;
      `)
      expect(launchOk).toBe(true)
      await app.waitForFunction(`
        (() => {
          const txt = (document.querySelector('#metrics')?.textContent || '') + ' ' + (document.querySelector('#hud')?.textContent || '');
          return txt !== ${JSON.stringify(preLaunchMetrics)} && /total\\s*distance[^0-9.-]*(-?\\d+(?:\\.\\d+)?)\\s*m/i.test(txt);
        })()
      `, 10_000)
      const launchedMetrics = await app.evalExpr<string>(
        `return (document.querySelector('#metrics')?.textContent || '') + ' ' + (document.querySelector('#hud')?.textContent || '');`
      )
      expect(launchedMetrics).not.toMatch(/\b(NaN|Infinity|undefined)\b/i)
      const totalMatch = launchedMetrics.match(/total\s*distance[^0-9.-]*(-?\d+(?:\.\d+)?)\s*m/i)
      expect(totalMatch).not.toBeNull()
      const totalM = assertFinite(Number(totalMatch![1]), 't4-07-totalM')
      expect(Math.abs(totalM - 3.5)).toBeLessThan(0.5)

      await app.waitForFunction(`!document.querySelector('#replay').hidden`, 10_000)
      await app.selectOption('#replay-speed', '0.5')
      const beforeReplayClock = await app.getText('#replay-clock')
      await app.click('#replay-play')
      await app.waitForFunction(
        `(document.querySelector('#replay-clock')?.textContent || '').trim() !== ${JSON.stringify(beforeReplayClock)}`,
        5_000
      )

      // 4. Switch camera through all 4 presets
      for (const preset of ['orbit', 'side', 'overhead', 'downrange']) {
        await app.selectOption('#camera', preset)
        await app.evalExpr(
          `return await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`
        )
        await app.waitForFunction(
          `Array.from(document.querySelectorAll('#field .field-label span')).some((el) => {
            const r = el.getBoundingClientRect();
            return getComputedStyle(el).visibility === 'visible' && r.width > 0 && r.height > 0;
          })`,
          5_000
        )
      }

      // 5. Run N=500 Monte Carlo Shootout in Overhead map mode
      await app.selectOption('#camera', 'overhead')
      const mcOk = await app.evalExpr<boolean>(`
        const btn = document.querySelector(${JSON.stringify(M4_SELECTORS.runShootoutBtn)})
          || Array.from(document.querySelectorAll('button')).find((b) => /shootout|monte\\s*carlo/i.test(b.textContent || ''));
        if (!btn) return false;
        btn.click();
        return true;
      `)
      expect(mcOk).toBe(true)
      await app.waitForFunction(`
        document.querySelectorAll(${JSON.stringify(M4_SELECTORS.shootoutRows)}).length >= 1
      `, 20_000)

      const labelsCount = await app.evalExpr<number>(`return document.querySelectorAll('#field .field-label').length`)
      expect(labelsCount).toBeGreaterThanOrEqual(3)
      expect(app.getPageErrors()).toEqual([])
      expect(app.getConsoleErrors()).toEqual([])
    })
  })

  it('T4-08: Browser Trace Import, Practice Circle/Rectangle & 110-Pt Scorecard Grading', async () => {
    const rubric = await loadRubricModule()
    const customTrace = JSON.stringify({
      design: 'v5.1',
      setting: 'Notch 6 / 42 deg',
      samples: [
        { t: 0, x: 0, y: 0, z: 0.03 },
        { t: 0.35, x: 1.9, y: 0, z: 0.95 },
        { t: 0.72, x: 3.8, y: 0, z: 0, event: 'contact' },
        { t: 1.05, x: 4.55, y: 0.04, z: 0, event: 'contact' },
        { t: 1.65, x: 5.05, y: 0.05, z: 0, event: 'rest' },
      ],
      target: { x: 5.0, y: 0 },
    })

    await withTempJsonFile(customTrace, 'v51-trial.json', async (fp) => {
      await withBrowserApp(async (app) => {
        await app.uploadFile('#file', fp)
        await app.waitForFunction(`document.querySelector('#source')?.textContent?.trim() === 'v51-trial.json'`, 5000)
        expect(await app.getText('#metrics')).toContain('5.05 m')

        await app.evalExpr(`document.querySelector('#practice').open = true`)
        await app.setInput('#practice-form input[name="x"]', '3.80')
        await app.setInput('#practice-form input[name="y"]', '0')
        await app.selectOption('#practice-form select[name="shape"]', 'circle')
        await app.setInput('#practice-form input[name="radius"]', '0.15')
        await app.selectOption('#practice-form select[name="endpoint"]', 'contact')
        await app.submitForm('#practice-form')
        expect(await app.getText('#practice-results tbody')).toContain('Hit')

        await app.selectOption('#practice-form select[name="shape"]', 'rectangle')
        await app.setInput('#practice-form input[name="x"]', '5.05')
        await app.setInput('#practice-form input[name="y"]', '0.05')
        await app.setInput('#practice-form input[name="length"]', '0.20')
        await app.setInput('#practice-form input[name="width"]', '0.20')
        await app.selectOption('#practice-form select[name="endpoint"]', 'rest')
        await app.submitForm('#practice-form')
        expect(await app.getText('#practice-results tbody')).toContain('v5.1')
        expect(await app.getText('#practice-results tbody')).toContain('Hit')

        await app.evalExpr(`document.querySelector('.score-full').open = true`)
        await app.click('#score-use-total')
        await app.selectOption('#grading select[name="hit1"]', 'hit')
        await app.selectOption('#grading select[name="hit2"]', 'hit')
        expect(await app.getText('#competition-points')).toBe('20 / 20')

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
        expect(await app.getText('#base-points')).toBe('110 / 110')
        expect(await app.getText('#score-individuals')).toContain('Member 1 · +2 group bonus · 116 pts total')

        await app.setInput('#grading input[name="share2"]', '1')
        expect(await app.getText('#score-individuals')).toContain('Member 1 · +0 group bonus · 114 pts total')
        expect(app.getPageErrors()).toEqual([])
      })
    })
  })

  it('T4-09: 1-Trap vs 2-Trap vs 3-Trap Direct-Arm Timed Tradeoff (120s tight window)', async () => {
    const modelsMod = await loadModelsModule()
    const mcMod = await loadMonteCarloModule()
    const runMC = resolveMonteCarloFn(mcMod)
    const models = listAllModels(modelsMod)
    const direct3 = findModel(modelsMod, 'direct_rail')
    const direct1 = models.find((m) => m.trapBank.count === 1) ?? {
      ...direct3,
      id: `${direct3.id}_1trap`,
      trapBank: { ...direct3.trapBank, count: 1 },
    }
    const direct2 = models.find((m) => m.trapBank.count === 2) ?? {
      ...direct3,
      id: `${direct3.id}_2trap`,
      trapBank: { ...direct3.trapBank, count: 2 },
    }
    const withSharedTiming = (m: LauncherModel): LauncherModel => ({
      ...m,
      cycleTiming: { cockPerTrapS: 8, loadS: 4, aimAdjustS: 2, humanSigmaS: 0.3 },
    })

    const m1 = withSharedTiming(direct1)
    const m2 = withSharedTiming(direct2)
    const m3 = withSharedTiming(direct3)
    const results: MonteCarloDesignSummary[] = runMC({
      jobId: 't4-09-traps',
      models: [m1, m2, m3],
      adjustmentsByModel: {
        [m1.id]: adjustKeys(m1, { peg: 1 }),
        [m2.id]: adjustKeys(m2, { peg: 1 }),
        [m3.id]: adjustKeys(m3, { peg: 1 }),
      },
      env: createNominalEnv({
        nominalEnergyJ: REPO_CONSTANTS.E_SPRING_NOMINAL,
        energyVarianceJ: 0.05,
      }),
      rubricConfig: { task: 'day1_distance', timeWindowS: 120 },
      trialsPerModel: 200,
      baseSeed: 4090,
    })

    const r1 = results.find((r) => r.modelId === m1.id)!
    const r2 = results.find((r) => r.modelId === m2.id)!
    const r3 = results.find((r) => r.modelId === m3.id)!
    expect(r1.shotsInWindow).toBeGreaterThan(r2.shotsInWindow)
    expect(r2.shotsInWindow).toBeGreaterThan(r3.shotsInWindow)

    const meanTotal = (s: MonteCarloDesignSummary) => s.landings.reduce((a, l) => a + l.totalM, 0) / s.landings.length
    expect(meanTotal(r3)).toBeGreaterThan(meanTotal(r1))
  })

  it('T4-10: High-Loft (58 deg) vs Low-Angle (42 deg) Target Hold on Firm Bounce Court', async () => {
    const modelsMod = await loadModelsModule()
    const mcMod = await loadMonteCarloModule()
    const runMC = resolveMonteCarloFn(mcMod)
    const v51 = findModel(modelsMod, 'cord_horn')

    const firmCourt = createNominalEnv({ turfEn: 0.4, turfMuR: 0.08, energyVarianceJ: 0.1 })
    const [highLoft] = runMC({
      jobId: 't4-10-58',
      models: [v51],
      adjustmentsByModel: { [v51.id]: adjustKeys(v51, { notch: 5, stop: 58 }) },
      env: firmCourt,
      rubricConfig: { task: 'day2_accuracy', target: { x: 3.0, y: 0 }, targetRadiusM: 0.4 },
      trialsPerModel: 200,
      baseSeed: 4100,
    })
    const [lowAngle] = runMC({
      jobId: 't4-10-42',
      models: [v51],
      adjustmentsByModel: { [v51.id]: adjustKeys(v51, { notch: 5, stop: 42 }) },
      env: firmCourt,
      rubricConfig: { task: 'day2_accuracy', target: { x: 3.0, y: 0 }, targetRadiusM: 0.4 },
      trialsPerModel: 200,
      baseSeed: 4100,
    })

    const avgRoll = (s: MonteCarloDesignSummary) =>
      s.landings.reduce((a, l) => a + (l.totalM - l.carryM), 0) / s.landings.length
    expect(avgRoll(highLoft)).toBeLessThan(avgRoll(lowAngle))
    expect(highLoft.carryToRollRatio).toBeGreaterThan(lowAngle.carryToRollRatio)
  })
})
