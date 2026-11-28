import {
  defaultAdjustments,
  type AdjustmentValues,
  type LauncherModel,
} from './models'
import type { EnvConfig } from './physics/launch_solver'

export interface ModelControlsOptions {
  host: HTMLElement
  models: readonly LauncherModel[]
  initialEnv: EnvConfig
  onModelChange: (model: LauncherModel, adj: AdjustmentValues) => void
  onAdjustmentPreview: (model: LauncherModel, adj: AdjustmentValues) => void
  onEnvChange: (env: EnvConfig) => void
  onAutoSight: (model: LauncherModel, targetDistanceM: number) => void
  onLaunch: (model: LauncherModel, adj: AdjustmentValues) => void
}

export interface ModelControlsHandle {
  getActiveModel: () => LauncherModel
  getAdjustments: (modelId?: string) => AdjustmentValues
  getAllAdjustments: () => Record<string, AdjustmentValues>
  getEnv: () => EnvConfig
  getTargetDistanceM: () => number
  setAdjustmentValues: (adj: AdjustmentValues) => void
  setAutoSightStatus: (message: string, reachable: boolean) => void
}

export function mountModelControls(
  opts: ModelControlsOptions
): ModelControlsHandle {
  const { host, models } = opts
  const adjByModel: Record<string, AdjustmentValues> = {}
  for (const m of models) {
    adjByModel[m.id] = defaultAdjustments(m)
  }
  let activeModel = models[0]
  let env: EnvConfig = {
    ...opts.initialEnv,
    windVecMps: [...opts.initialEnv.windVecMps] as [number, number, number],
  }

  host.innerHTML = `
    <div class="sim-panel-grid">
      <section class="sim-card" aria-label="Launcher & adjustments">
        <div class="sim-card-head">
          <h2>Launcher rig</h2>
          <label class="inline-field">
            Model
            <select id="model-select" name="model" data-testid="model-select"></select>
          </label>
        </div>
        <p id="model-desc" class="muted-note"></p>
        <div id="model-controls" class="model-controls" data-testid="model-controls"></div>
        <div class="autosight-bar">
          <label class="inline-field">
            Target (m)
            <input id="autosight-target" name="targetDistanceM" data-testid="autosight-target" type="number" min="0" step="0.05" value="4.80" />
          </label>
          <button type="button" id="autosight-btn" data-testid="autosight-btn" data-action="autosight">Auto-Sight / Calibrate</button>
          <button type="button" id="launch-btn" class="primary-btn" data-testid="launch" data-action="launch">Launch</button>
        </div>
        <p id="autosight-status" class="status-note" role="status" hidden></p>
      </section>
      <section class="sim-card" aria-label="Environment & turf">
        <h2>Environment &amp; turf</h2>
        <div class="env-grid">
          <label>Spring energy (J)
            <input id="env-energy" name="nominalEnergyJ" data-env="nominalEnergyJ" type="number" min="0.1" max="10" step="0.02" value="${env.nominalEnergyJ}" />
          </label>
          <label>Energy variance (±J)
            <input id="env-energy-variance" name="energyVarianceJ" type="number" min="0" max="1" step="0.01" value="${env.energyVarianceJ}" />
          </label>
          <label>Turf firmness (e_n)
            <input id="env-turf-en" name="turfEn" type="number" min="0" max="1" step="0.01" value="${env.turfEn}" />
          </label>
          <label>Grass resistance (μ_r)
            <input id="env-turf-mur" name="turfMuR" type="number" min="0.02" max="0.5" step="0.01" value="${env.turfMuR}" />
          </label>
          <label>Head/tail wind (m/s)
            <input id="env-wind-x" name="windX" type="number" min="-15" max="15" step="0.5" value="${env.windVecMps[0]}" />
          </label>
          <label>Crosswind (m/s)
            <input id="env-wind-y" name="windY" type="number" min="-15" max="15" step="0.5" value="${env.windVecMps[1]}" />
          </label>
          <label>Projectile
            <select id="env-projectile" name="projectile">
              <option value="golf_ball"${env.projectile === 'golf_ball' ? ' selected' : ''}>Dimpled golf ball</option>
              <option value="smooth_ball"${env.projectile === 'smooth_ball' ? ' selected' : ''}>Smooth sphere</option>
            </select>
          </label>
        </div>
      </section>
    </div>
  `

  const modelSelect = host.querySelector<HTMLSelectElement>('#model-select')!
  const modelDesc = host.querySelector<HTMLElement>('#model-desc')!
  const controlsBox = host.querySelector<HTMLElement>('#model-controls')!
  const targetInput = host.querySelector<HTMLInputElement>('#autosight-target')!
  const autosightBtn = host.querySelector<HTMLButtonElement>('#autosight-btn')!
  const launchBtn = host.querySelector<HTMLButtonElement>('#launch-btn')!
  const statusBox = host.querySelector<HTMLElement>('#autosight-status')!

  for (const m of models) {
    modelSelect.append(new Option(m.name, m.id))
  }
  modelSelect.value = activeModel.id

  const controlRefs = new Map<
    string,
    { el: HTMLInputElement | HTMLSelectElement; readout?: HTMLElement; unit: string }
  >()

  function renderModelDofs() {
    controlRefs.clear()
    modelDesc.textContent = `${activeModel.description} (${activeModel.rubricCompliance.notes})`
    const adj = adjByModel[activeModel.id]
    const nodes: HTMLElement[] = []

    for (const def of activeModel.adjustments) {
      const wrap = document.createElement('label')
      wrap.className = 'dof-row'
      const title = document.createElement('span')
      title.className = 'dof-label'
      title.textContent = def.label

      if (def.kind === 'discrete' && def.options && def.options.length > 0) {
        const sel = document.createElement('select')
        sel.name = def.id
        sel.dataset.adjId = def.id
        def.options.forEach((opt, i) => {
          const text = def.optionLabels?.[i] ?? `${opt}${def.unit ? ' ' + def.unit : ''}`
          sel.append(new Option(text, String(opt)))
        })
        sel.value = String(adj[def.id] ?? def.defaultValue)
        sel.addEventListener('change', () => {
          adjByModel[activeModel.id][def.id] = Number(sel.value)
          opts.onAdjustmentPreview(activeModel, { ...adjByModel[activeModel.id] })
        })
        wrap.append(title, sel)
        controlRefs.set(def.id, { el: sel, unit: def.unit })
      } else {
        const sliderWrap = document.createElement('div')
        sliderWrap.className = 'dof-slider-wrap'
        const range = document.createElement('input')
        range.type = 'range'
        range.name = def.id
        range.dataset.adjId = def.id
        range.min = String(def.min)
        range.max = String(def.max)
        range.step = String(def.step)
        const val = adj[def.id] ?? def.defaultValue
        range.value = String(val)
        const readout = document.createElement('span')
        readout.className = 'dof-readout'
        readout.textContent = `${val}${def.unit ? ' ' + def.unit : ''}`

        const handleSlider = () => {
          const num = Number(range.value)
          adjByModel[activeModel.id][def.id] = num
          readout.textContent = `${num}${def.unit ? ' ' + def.unit : ''}`
          opts.onAdjustmentPreview(activeModel, { ...adjByModel[activeModel.id] })
        }
        range.addEventListener('input', handleSlider)
        range.addEventListener('change', handleSlider)
        sliderWrap.append(range, readout)
        wrap.append(title, sliderWrap)
        controlRefs.set(def.id, { el: range, readout, unit: def.unit })
      }
      nodes.push(wrap)
    }

    controlsBox.replaceChildren(...nodes)
  }

  function setAdjustmentValues(adj: AdjustmentValues) {
    adjByModel[activeModel.id] = { ...adjByModel[activeModel.id], ...adj }
    for (const [id, ref] of controlRefs) {
      if (id in adj) {
        const v = adj[id]
        ref.el.value = String(v)
        if (ref.readout) {
          ref.readout.textContent = `${v}${ref.unit ? ' ' + ref.unit : ''}`
        }
      }
    }
  }

  function setAutoSightStatus(message: string, reachable: boolean) {
    statusBox.textContent = message
    statusBox.setAttribute('role', reachable ? 'status' : 'alert')
    statusBox.className = reachable ? 'status-note' : 'status-note status-warn'
    statusBox.hidden = !message
  }

  modelSelect.addEventListener('change', () => {
    const found = models.find((m) => m.id === modelSelect.value)
    if (!found) return
    activeModel = found
    renderModelDofs()
    setAutoSightStatus('', true)
    opts.onModelChange(activeModel, { ...adjByModel[activeModel.id] })
  })

  const energyIn = host.querySelector<HTMLInputElement>('#env-energy')!
  const varIn = host.querySelector<HTMLInputElement>('#env-energy-variance')!
  const enIn = host.querySelector<HTMLInputElement>('#env-turf-en')!
  const murIn = host.querySelector<HTMLInputElement>('#env-turf-mur')!
  const wxIn = host.querySelector<HTMLInputElement>('#env-wind-x')!
  const wyIn = host.querySelector<HTMLInputElement>('#env-wind-y')!
  const projSel = host.querySelector<HTMLSelectElement>('#env-projectile')!

  const syncEnv = () => {
    const numOr = (el: HTMLInputElement, fallback: number, minVal: number) => {
      const v = el.valueAsNumber
      return Number.isFinite(v) && v >= minVal ? v : fallback
    }
    env = {
      ...env,
      nominalEnergyJ: numOr(energyIn, env.nominalEnergyJ, 0),
      energyVarianceJ: numOr(varIn, env.energyVarianceJ, 0),
      turfEn: Math.min(1, Math.max(0, numOr(enIn, env.turfEn, 0))),
      turfMuR: Math.max(1e-3, numOr(murIn, env.turfMuR, 1e-3)),
      windVecMps: [
        Number.isFinite(wxIn.valueAsNumber) ? wxIn.valueAsNumber : 0,
        Number.isFinite(wyIn.valueAsNumber) ? wyIn.valueAsNumber : 0,
        0,
      ],
      projectile: projSel.value === 'smooth_ball' ? 'smooth_ball' : 'golf_ball',
    }
    opts.onEnvChange({ ...env, windVecMps: [...env.windVecMps] })
  }

  for (const el of [energyIn, varIn, enIn, murIn, wxIn, wyIn, projSel]) {
    el.addEventListener('input', syncEnv)
    el.addEventListener('change', syncEnv)
  }

  autosightBtn.addEventListener('click', () => {
    const dist = targetInput.valueAsNumber
    opts.onAutoSight(activeModel, dist)
  })

  launchBtn.addEventListener('click', () => {
    opts.onLaunch(activeModel, { ...adjByModel[activeModel.id] })
  })

  renderModelDofs()

  return {
    getActiveModel: () => activeModel,
    getAdjustments: (id?: string) => ({ ...(adjByModel[id ?? activeModel.id] ?? {}) }),
    getAllAdjustments: () => {
      const copy: Record<string, AdjustmentValues> = {}
      for (const m of models) copy[m.id] = { ...adjByModel[m.id] }
      return copy
    },
    getEnv: () => ({ ...env, windVecMps: [...env.windVecMps] }),
    getTargetDistanceM: () =>
      Number.isFinite(targetInput.valueAsNumber) ? targetInput.valueAsNumber : 4.8,
    setAdjustmentValues,
    setAutoSightStatus,
  }
}
