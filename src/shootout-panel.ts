import type { AdjustmentValues, LauncherModel } from './models'
import type { EnvConfig } from './physics/launch_solver'
import type {
  MonteCarloDesignSummary,
  MonteCarloRequest,
  MonteCarloResponse,
} from './physics/montecarlo'

export interface ShootoutPanelOptions {
  host: HTMLElement
  models: readonly LauncherModel[]
  getEnv: () => EnvConfig
  getAdjustmentsByModel: () => Record<string, AdjustmentValues>
  onResults: (summaries: readonly MonteCarloDesignSummary[]) => void
  onToggleCep: (visible: boolean) => void
}

const DEFAULT_SHOOTOUT_IDS = new Set([
  'v51_cord_horn',
  'direct_arm_rail',
  'v41_tilted_cradle',
])

export function mountShootoutPanel(opts: ShootoutPanelOptions) {
  const { host, models } = opts

  host.innerHTML = `
    <div class="shootout-head">
      <div>
        <h2>Monte Carlo Design Shootout</h2>
        <p class="muted-note">Runs stochastic trials in a background Web Worker across selected launcher rigs and renders 95% CEP dispersion ellipses on the field.</p>
      </div>
      <div class="shootout-actions">
        <button type="button" id="run-shootout" class="primary-btn" data-testid="run-shootout" data-action="shootout">Run Shootout (N=500)</button>
      </div>
    </div>
    <div class="shootout-config">
      <label>Rubric task
        <select id="shootout-task" name="task">
          <option value="day1_distance">Day 1 · Distance (max 10 pts)</option>
          <option value="day2_accuracy">Day 2 · Accuracy (5 pts / hit)</option>
        </select>
      </label>
      <label>Target X (m)
        <input id="shootout-target-x" type="number" step="0.1" value="4.0" />
      </label>
      <label>Target radius (m)
        <input id="shootout-radius" type="number" min="0.05" step="0.05" value="0.5" />
      </label>
      <label>Time window (s)
        <input id="shootout-window" type="number" min="10" step="10" value="210" />
      </label>
      <label>Trials / model
        <input id="shootout-trials" type="number" min="1" max="2000" step="50" value="500" />
      </label>
      <label class="cep-toggle">
        <input id="shootout-cep-toggle" type="checkbox" checked />
        Show 95% CEP ellipses
      </label>
    </div>
    <div class="shootout-models" aria-label="Models included in shootout"></div>
    <div class="shootout-progress-row">
      <progress id="shootout-progress" value="0" max="100" hidden></progress>
      <span id="shootout-status" class="muted-note">Ready</span>
      <span class="cep-legend" data-cep-rendered="false">95% CEP overlay inactive</span>
    </div>
    <p id="shootout-error" role="alert" hidden></p>
    <div class="practice-results-wrap">
      <table id="shootout-results" class="shootout-table" data-testid="shootout-table">
        <thead>
          <tr>
            <th>Design</th>
            <th>Mean Score</th>
            <th>Median Score</th>
            <th>P10 / P90</th>
            <th>Carry / Roll</th>
            <th>Shots (Window)</th>
            <th>Miss / OOB Rate</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    </div>
  `

  const modelsBox = host.querySelector<HTMLElement>('.shootout-models')!
  const runBtn = host.querySelector<HTMLButtonElement>('#run-shootout')!
  const taskSel = host.querySelector<HTMLSelectElement>('#shootout-task')!
  const targetXIn = host.querySelector<HTMLInputElement>('#shootout-target-x')!
  const radiusIn = host.querySelector<HTMLInputElement>('#shootout-radius')!
  const windowIn = host.querySelector<HTMLInputElement>('#shootout-window')!
  const trialsIn = host.querySelector<HTMLInputElement>('#shootout-trials')!
  const cepToggle = host.querySelector<HTMLInputElement>('#shootout-cep-toggle')!
  const progressBar = host.querySelector<HTMLProgressElement>('#shootout-progress')!
  const statusEl = host.querySelector<HTMLElement>('#shootout-status')!
  const cepLegend = host.querySelector<HTMLElement>('.cep-legend')!
  const errEl = host.querySelector<HTMLElement>('#shootout-error')!
  const tbody = host.querySelector<HTMLTableSectionElement>('#shootout-results tbody')!

  const checkboxes = new Map<string, HTMLInputElement>()
  for (const m of models) {
    const lbl = document.createElement('label')
    lbl.className = 'model-chip'
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.value = m.id
    cb.checked = DEFAULT_SHOOTOUT_IDS.has(m.id)
    checkboxes.set(m.id, cb)
    lbl.append(cb, document.createTextNode(m.name))
    modelsBox.append(lbl)
  }

  let worker: Worker | undefined
  let activeJobId = ''
  let jobSeq = 0

  function getWorker(): Worker {
    if (!worker) {
      worker = new Worker(
        new URL('./workers/montecarlo.worker.ts', import.meta.url),
        { type: 'module' }
      )
      worker.onmessage = (event: MessageEvent<MonteCarloResponse>) => {
        const msg = event.data
        if (!msg || msg.jobId !== activeJobId) return
        if (msg.type === 'progress') {
          progressBar.hidden = false
          progressBar.max = Math.max(1, msg.total)
          progressBar.value = msg.completed
          statusEl.textContent = `Running ${msg.completed} / ${msg.total} trials...`
        } else if (msg.type === 'done') {
          progressBar.hidden = true
          runBtn.disabled = false
          const results = msg.results ?? []
          statusEl.textContent = `Completed ${msg.total} trials across ${results.length} designs.`
          renderTable(results)
          cepLegend.dataset.cepRendered = results.length > 0 && cepToggle.checked ? 'true' : 'false'
          cepLegend.textContent =
            results.length > 0 && cepToggle.checked
              ? `95% CEP active (${results.length} ellipses)`
              : '95% CEP overlay hidden'
          opts.onResults(results)
        } else if (msg.type === 'error') {
          progressBar.hidden = true
          runBtn.disabled = false
          errEl.textContent = msg.error ?? 'Monte Carlo worker failed.'
          errEl.hidden = false
          statusEl.textContent = 'Error'
        }
      }
      worker.onerror = (err) => {
        progressBar.hidden = true
        runBtn.disabled = false
        errEl.textContent = err.message || 'Monte Carlo worker crashed.'
        errEl.hidden = false
        statusEl.textContent = 'Error'
      }
    }
    return worker
  }

  function renderTable(results: readonly MonteCarloDesignSummary[]) {
    const modelById = new Map(models.map((m) => [m.id, m]))
    const rows = results
      .slice()
      .sort((a, b) => b.meanScore - a.meanScore)
      .map((s) => {
        const tr = document.createElement('tr')
        tr.dataset.testid = 'shootout-row'
        const name = modelById.get(s.modelId)?.name ?? s.modelId
        const cells = [
          name,
          s.meanScore.toFixed(2),
          s.medianScore.toFixed(2),
          `${s.p10Score.toFixed(1)} / ${s.p90Score.toFixed(1)}`,
          s.carryToRollRatio.toFixed(2),
          String(s.shotsInWindow),
          `${(s.missRate * 100).toFixed(1)}% / ${(s.oobRate * 100).toFixed(1)}%`,
        ]
        for (const text of cells) {
          const td = tr.insertCell()
          td.textContent = text
        }
        return tr
      })
    tbody.replaceChildren(...rows)
  }

  cepToggle.addEventListener('change', () => {
    const vis = cepToggle.checked
    cepLegend.dataset.cepRendered = vis && tbody.children.length > 0 ? 'true' : 'false'
    cepLegend.textContent =
      vis && tbody.children.length > 0
        ? `95% CEP active (${tbody.children.length} ellipses)`
        : '95% CEP overlay hidden'
    opts.onToggleCep(vis)
  })

  runBtn.addEventListener('click', () => {
    errEl.hidden = true
    const selectedModels = models.filter((m) => checkboxes.get(m.id)?.checked)
    if (selectedModels.length === 0) {
      errEl.textContent = 'Select at least one launcher model to run the shootout.'
      errEl.hidden = false
      return
    }
    const trials = Math.max(1, Math.round(trialsIn.valueAsNumber || 500))
    const task =
      taskSel.value === 'day2_accuracy' ? 'day2_accuracy' : 'day1_distance'
    const targetX = Number.isFinite(targetXIn.valueAsNumber)
      ? targetXIn.valueAsNumber
      : 4.0
    const targetRadiusM = Math.max(0.05, radiusIn.valueAsNumber || 0.5)
    const timeWindowS = Math.max(0, windowIn.valueAsNumber || 210)
    const env = opts.getEnv()
    const envForMc: EnvConfig = {
      ...env,
      energyVarianceJ: env.energyVarianceJ > 0 ? env.energyVarianceJ : 0.1,
    }

    jobSeq++
    activeJobId = `shootout-${jobSeq}-${Date.now()}`
    runBtn.disabled = true
    progressBar.hidden = false
    progressBar.value = 0
    progressBar.max = selectedModels.length * trials
    statusEl.textContent = `Starting ${selectedModels.length * trials} trials...`

    const req: MonteCarloRequest = {
      jobId: activeJobId,
      models: selectedModels.map((m) => structuredClone(m)),
      adjustmentsByModel: opts.getAdjustmentsByModel(),
      env: envForMc,
      rubricConfig: {
        task,
        target: { x: targetX, y: 0 },
        targetRadiusM,
        timeWindowS,
        fieldHalfWidthM: 3.0,
      },
      trialsPerModel: trials,
      baseSeed: 2026 + jobSeq,
    }
    getWorker().postMessage(req)
  })
}
