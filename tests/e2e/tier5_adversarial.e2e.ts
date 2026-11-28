import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { launchApp, type BrowserAppSession } from './helpers/browser_cdp'
import {
  M4_SELECTORS,
  type LauncherModel,
  type MonteCarloRequest,
  loadModelsModule,
} from './helpers/contracts'
import { createNominalEnv, defaultAdjustmentsForModel } from './helpers/fixtures'
import { runWorkerJob } from './helpers/worker_harness'

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

async function withTempJsonFile<T>(
  content: string,
  filename: string,
  fn: (filePath: string) => Promise<T>
): Promise<T> {
  const cacheBase = path.join(os.homedir(), '.cache')
  fs.mkdirSync(cacheBase, { recursive: true })
  const dir = fs.mkdtempSync(path.join(cacheBase, 'mtc180-e2e-t5-'))
  const filePath = path.join(dir, filename)
  fs.writeFileSync(filePath, content)
  try {
    return await fn(filePath)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

const SAMPLE_CANVAS_HASH_EXPR = `
  return await new Promise((resolve) => {
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
      resolve({ hash, distinctColors: colors.size });
    });
  });
`

describe('Tier 5 — Adversarial Hardening & Regression E2E (T5-01..T5-04)', () => {
  it('T5-01: async load() resolution cannot overwrite user Launch or slider preview', async () => {
    const staleJson = JSON.stringify({
      design: 'stale-import',
      samples: [
        { t: 0, x: 0, y: 0, z: 0.2 },
        { t: 0.5, x: 2.0, y: 0, z: 0, event: 'contact' },
        { t: 1.0, x: 2.5, y: 0, z: 0, event: 'rest' },
      ],
      target: { x: 2.5, y: 0 },
    })

    await withTempJsonFile(staleJson, 'slow-import.json', async (fp) => {
      await withBrowserApp(async (app) => {
        await app.evalExpr(`
          const origText = File.prototype.text;
          window.__pendingReads = [];
          File.prototype.text = function() {
            const p = origText.call(this);
            return new Promise((resolve, reject) => {
              window.__pendingReads.push(() => p.then(resolve, reject));
            });
          };
        `)

        await app.uploadFile('#file', fp)
        await app.waitForFunction('window.__pendingReads.length === 1', 5_000)

        await app.click(M4_SELECTORS.launchBtn)
        await app.waitForFunction(
          `/MTC-180/i.test(document.querySelector('#source')?.textContent || '')`,
          5_000
        )
        const sourceAfterLaunch = await app.getText('#source')
        const hudAfterLaunch = await app.getText('#hud')
        expect(hudAfterLaunch).toMatch(/speed/i)
        expect(hudAfterLaunch).not.toContain('—')

        // Resolve the stale async file import after the user launched
        await app.evalExpr(`
          const fn = window.__pendingReads.shift();
          if (fn) fn();
          await new Promise((r) => setTimeout(r, 80));
        `)

        expect(await app.getText('#source')).toBe(sourceAfterLaunch)
        expect(await app.getText('#hud')).toBe(hudAfterLaunch)

        // Repeat race with a slider adjustment preview
        await app.uploadFile('#file', fp)
        await app.waitForFunction('window.__pendingReads.length === 1', 5_000)
        const previewOk = await app.evalExpr<boolean>(`
          const sel = document.querySelector('#model-controls select, #model-controls input[type="range"]');
          if (!sel) return false;
          if (sel.tagName === 'SELECT') {
            sel.selectedIndex = sel.selectedIndex === 0 && sel.options.length > 1 ? 1 : 0;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            sel.value = sel.value === sel.min ? sel.max : sel.min;
            sel.dispatchEvent(new Event('input', { bubbles: true }));
            sel.dispatchEvent(new Event('change', { bubbles: true }));
          }
          return true;
        `)
        expect(previewOk).toBe(true)
        const sourceAfterPreview = await app.getText('#source')
        expect(sourceAfterPreview).toContain('MTC-180')

        await app.evalExpr(`
          const fn = window.__pendingReads.shift();
          if (fn) fn();
          await new Promise((r) => setTimeout(r, 80));
        `)
        expect(await app.getText('#source')).toBe(sourceAfterPreview)
        expect(app.getPageErrors()).toEqual([])
        expect(app.getConsoleErrors()).toEqual([])
      })
    })
  })

  it('T5-02: scrubbing #replay-time and visibilitychange stop both ball clock and 3D arm animation', async () => {
    await withBrowserApp(async (app) => {
      await app.click(M4_SELECTORS.launchBtn)
      await app.waitForFunction(`!document.querySelector('#replay').hidden`, 10_000)
      await app.selectOption('#replay-speed', '0.25')

      // Start replay and wait for clock to advance
      await app.click('#replay-play')
      await app.waitForFunction(
        `(document.querySelector('#replay-clock')?.textContent || '').trim() !== '' && !/^(0\\.00)\\s*\\//.test((document.querySelector('#replay-clock')?.textContent || '').trim())`,
        5_000
      )

      // Scrub #replay-time -> must reset toggle to Play and cancel arm animation RAF
      await app.setInput('#replay-time', '0.50')
      expect((await app.getText('#replay-play')).trim()).toBe('Play')
      const clockAtScrub = await app.getText('#replay-clock')
      await app.evalExpr(`return await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`)
      const hashAfterScrub = await app.evalExpr<{ hash: number; distinctColors: number }>(SAMPLE_CANVAS_HASH_EXPR)
      await app.evalExpr(`return await new Promise((r) => setTimeout(r, 250))`)
      const hashAfterScrubWait = await app.evalExpr<{ hash: number; distinctColors: number }>(SAMPLE_CANVAS_HASH_EXPR)
      const clockAfterScrubWait = await app.getText('#replay-clock')

      expect(hashAfterScrub.distinctColors).toBeGreaterThan(1)
      expect(clockAfterScrubWait).toBe(clockAtScrub)
      expect(hashAfterScrubWait.hash).toBe(hashAfterScrub.hash)

      // Play again, then simulate tab becoming hidden via visibilitychange
      await app.click('#replay-play')
      await app.waitForFunction(
        `(document.querySelector('#replay-clock')?.textContent || '').trim() !== ${JSON.stringify(clockAfterScrubWait)}`,
        5_000
      )
      await app.evalExpr(`
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
      `)
      expect((await app.getText('#replay-play')).trim()).toBe('Play')
      const clockAtHide = await app.getText('#replay-clock')
      await app.evalExpr(`return await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`)
      const hashAtHide = await app.evalExpr<{ hash: number; distinctColors: number }>(SAMPLE_CANVAS_HASH_EXPR)
      await app.evalExpr(`return await new Promise((r) => setTimeout(r, 250))`)
      const hashAfterHideWait = await app.evalExpr<{ hash: number; distinctColors: number }>(SAMPLE_CANVAS_HASH_EXPR)
      expect(await app.getText('#replay-clock')).toBe(clockAtHide)
      expect(hashAfterHideWait.hash).toBe(hashAtHide.hash)
      expect(app.getPageErrors()).toEqual([])
      expect(app.getConsoleErrors()).toEqual([])
    })
  })

  it('T5-03: shootout recovers cleanly after worker.onerror, handles edge inputs, and worker survives null messages', async () => {
    // 1. Node worker_harness resilience on malformed null payload followed by valid job
    const modelsMod = await loadModelsModule()
    const v51 = (modelsMod.listLauncherModels() as LauncherModel[]).find(
      (m) => m.id === 'v51_cord_horn'
    )!
    const nullOutcome = await runWorkerJob(null as unknown as MonteCarloRequest)
    expect(nullOutcome.error).toBeDefined()
    expect(nullOutcome.error!.type).toBe('error')
    expect(nullOutcome.error!.jobId).toBe('')

    const validAfterNull = await runWorkerJob({
      jobId: 'after-null',
      models: [v51],
      adjustmentsByModel: { [v51.id]: defaultAdjustmentsForModel(v51) },
      env: createNominalEnv(),
      rubricConfig: { task: 'day1_distance' },
      trialsPerModel: 5,
      baseSeed: 101,
    })
    expect(validAfterNull.error).toBeUndefined()
    expect(validAfterNull.done?.results).toHaveLength(1)

    // 2. Browser worker.onerror recovery + edge inputs + real browser Worker null payload
    await withBrowserApp(async (app) => {
      // Real browser Worker null-message resilience check
      const workerNullRes = await app.evalExpr<{ errType: string; errJobId: string; okType: string }>(`
        const w = new Worker('/src/workers/montecarlo.worker.ts', { type: 'module' });
        const nextMsg = () => new Promise((resolve, reject) => {
          w.onmessage = (ev) => resolve(ev.data);
          w.onerror = (err) => reject(new Error(err.message || 'worker error'));
        });
        const p1 = nextMsg();
        w.postMessage(null);
        const m1 = await p1;
        const p2 = nextMsg();
        w.postMessage('malformed');
        const m2 = await p2;
        w.terminate();
        return { errType: m1.type, errJobId: m1.jobId, okType: m2.type };
      `)
      expect(workerNullRes.errType).toBe('error')
      expect(workerNullRes.errJobId).toBe('')
      expect(workerNullRes.okType).toBe('error')

      // Wrap window.Worker so the 1st Worker created by shootout-panel triggers onerror
      await app.evalExpr(`
        const RealWorker = window.Worker;
        let workerCalls = 0;
        window.Worker = function(url, opts) {
          workerCalls++;
          if (workerCalls === 1) {
            const fake = {
              onmessage: null,
              onerror: null,
              terminate() {},
              postMessage() {
                setTimeout(() => {
                  if (typeof fake.onerror === 'function') {
                    fake.onerror({ message: 'Simulated worker crash' });
                  }
                }, 10);
              },
            };
            return fake;
          }
          return new RealWorker(url, opts);
        };
      `)

      await app.setInput('#shootout-trials', '10')
      await app.click(M4_SELECTORS.runShootoutBtn)
      await app.waitForFunction(
        `!document.querySelector('#shootout-error').hidden && document.querySelector('#shootout-status')?.textContent === 'Error'`,
        5_000
      )
      expect(await app.getText('#shootout-error')).toContain('Simulated worker crash')
      expect(await app.evalExpr<boolean>(`return document.querySelector('#run-shootout').disabled`)).toBe(false)

      // Retry click must spawn a fresh real Worker and complete cleanly
      await app.click(M4_SELECTORS.runShootoutBtn)
      await app.waitForFunction(
        `document.querySelectorAll(${JSON.stringify(M4_SELECTORS.shootoutRows)}).length >= 2 && document.querySelector('#shootout-error').hidden`,
        15_000
      )
      const tableText = await app.getText(M4_SELECTORS.shootoutTable)
      expect(tableText).not.toMatch(/\bNaN\b/)

      // Edge input: 0 models selected -> explicit error message
      await app.evalExpr(`
        document.querySelectorAll('.shootout-models input[type="checkbox"]').forEach((cb) => {
          cb.checked = false;
        });
      `)
      await app.click(M4_SELECTORS.runShootoutBtn)
      await app.waitForFunction(`!document.querySelector('#shootout-error').hidden`, 2_000)
      expect(await app.getText('#shootout-error')).toMatch(/at least one/i)

      // Edge input: trials = 0, window = 0 -> clamps trials >= 1 and window === 0 (0 shots in window)
      await app.evalExpr(`
        const firstCb = document.querySelector('.shootout-models input[type="checkbox"]');
        if (firstCb) firstCb.checked = true;
      `)
      await app.setInput('#shootout-trials', '0')
      await app.setInput('#shootout-window', '0')
      await app.click(M4_SELECTORS.runShootoutBtn)
      await app.waitForFunction(
        `document.querySelectorAll(${JSON.stringify(M4_SELECTORS.shootoutRows)}).length === 1 && /Completed 1 trials/i.test(document.querySelector('#shootout-status')?.textContent || '')`,
        10_000
      )
      const shotsCell = await app.evalExpr<string>(
        `return document.querySelector('#shootout-results tbody tr td:nth-child(6)')?.textContent?.trim() || '';`
      )
      expect(shotsCell).toBe('0')
      expect(app.getPageErrors()).toEqual([])
      expect(app.getConsoleErrors()).toEqual([])
    })
  })

  it('T5-04: all 9 models pass interactive select/adjust/autosight/launch matrix and 15 launches show zero DOM/canvas leaks', async () => {
    await withBrowserApp(async (app) => {
      const modelIds = await app.evalExpr<string[]>(
        `return Array.from(document.querySelectorAll('#model-select option')).map((o) => o.value);`
      )
      expect(modelIds).toHaveLength(9)

      const runInteractiveModel = async (modelId: string, idx: number) => {
        await app.selectOption('#model-select', modelId)
        await app.evalExpr(`
          const ctrl = document.querySelector('#model-controls input[type="range"], #model-controls select');
          if (ctrl) {
            if (ctrl.tagName === 'SELECT') {
              ctrl.selectedIndex = ctrl.options.length > 1 ? 1 : 0;
              ctrl.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
              ctrl.value = ctrl.min;
              ctrl.dispatchEvent(new Event('input', { bubbles: true }));
              ctrl.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
        `)
        await app.setInput(M4_SELECTORS.autosightTarget, idx < 9 ? '2.50' : '3.50')
        await app.click(M4_SELECTORS.autosightBtn)
        await app.waitForFunction(
          `(document.querySelector(${JSON.stringify(M4_SELECTORS.autosightStatus)})?.textContent || '').trim().length > 0`,
          5_000
        )

        await app.evalExpr(`document.querySelector('#source').textContent = '__waiting_' + ${idx}`)
        await app.click(M4_SELECTORS.launchBtn)
        await app.waitForFunction(
          `!document.querySelector('#source')?.textContent?.startsWith('__waiting_') && (document.querySelector('#source')?.textContent || '').trim().length > 0`,
          10_000
        )
        const metricsText = await app.getText('#metrics')
        const hudText = await app.getText('#hud')
        expect(metricsText).not.toMatch(/\b(NaN|Infinity|undefined)\b/i)
        expect(hudText).not.toMatch(/\b(NaN|Infinity|undefined)\b/i)
        expect(hudText).toMatch(/speed/i)
      }

      // Exercise all 9 models first, then 6 more launches = 15 total sequential launches
      for (let i = 0; i < 15; i++) {
        await runInteractiveModel(modelIds[i % modelIds.length], i)
      }

      await app.evalExpr(
        `return await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`
      )
      const leakStats = await app.evalExpr<{ canvasCount: number; labelCount: number }>(`
        return {
          canvasCount: document.querySelectorAll('#field canvas').length,
          labelCount: document.querySelectorAll('#field .field-label').length,
        };
      `)
      expect(leakStats.canvasCount).toBe(1)
      expect(leakStats.labelCount).toBeGreaterThanOrEqual(2)
      expect(leakStats.labelCount).toBeLessThanOrEqual(20)
      expect(app.getPageErrors()).toEqual([])
      expect(app.getConsoleErrors()).toEqual([])
    })
  })
})
