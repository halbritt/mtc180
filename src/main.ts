import { createField } from './field'
import { renderTelemetryHud } from './hud'
import { mountModelControls } from './model-controls'
import { listLauncherModels, type AdjustmentValues, type LauncherModel } from './models'
import { autoSight } from './physics/autosight'
import { evaluatePractice, type PracticeTarget } from './physics/practice'
import {
  createNominalEnv,
  simulateShot,
  type FullSimulationResult,
} from './physics/simulate'
import { measure, type Sample, type Target } from './physics/telemetry'
import { mountPractice } from './practice-controls'
import { mountReplay } from './replay-controls'
import { mountScorecard, updateScorecardTrace } from './scorecard'
import { mountShootoutPanel } from './shootout-panel'

const fieldHost = document.querySelector<HTMLElement>('#field')!
const metrics = document.querySelector<HTMLDListElement>('#metrics')!
const hud = document.querySelector<HTMLElement>('#hud')
const source = document.querySelector<HTMLElement>('#source')!
const errorBox = document.querySelector<HTMLElement>('#error')!
const file = document.querySelector<HTMLInputElement>('#file')!
const camera = document.querySelector<HTMLSelectElement>('#camera')!
const replaySpeed = document.querySelector<HTMLSelectElement>('#replay-speed')!
const simControlsHost = document.querySelector<HTMLElement>('#simulator-controls')!
const shootoutHost = document.querySelector<HTMLElement>('#shootout-panel')!

let field: ReturnType<typeof createField> | undefined
try {
  field = createField(fieldHost)
} catch (error) {
  console.error('Field renderer failed to initialize', error)
  const message = document.createElement('p')
  message.textContent =
    'The 3D view requires WebGL. Trace measurements are available below.'
  fieldHost.replaceChildren(message)
  camera.disabled = true
}

const loadReplay = field
  ? mountReplay(field.setCursor, (playing) => {
      if (playing) field?.playArmAnimation()
      else field?.stopArmAnimation()
    })
  : undefined
replaySpeed.addEventListener('change', () => {
  field?.setReplaySpeed(Number(replaySpeed.value))
})

type TraceState = {
  samples: Sample[]
  measurements: ReturnType<typeof measure>
  sim?: FullSimulationResult
  model?: LauncherModel
  target?: Target
}
let current: TraceState | undefined
let shotSeedCounter = 0
let currentRequest = 0

const practice = mountPractice((target) => {
  if (current) {
    renderTelemetryHud(metrics, hud, {
      measurements: current.measurements,
      practiceTarget: target,
      sim: current.sim,
      model: current.model,
    })
  }
  field?.setPractice(target)
})

const models = listLauncherModels()
const modelNames: Record<string, string> = Object.fromEntries(
  models.map((m) => [m.id, m.name])
)

function displaySimulatedShot(
  shot: FullSimulationResult,
  model: LauncherModel,
  adj: AdjustmentValues,
  animateArm: boolean,
  target: Target,
  trialName: string
) {
  currentRequest++
  const measurements = measure(shot.trace, target)
  const traceState: TraceState = {
    samples: shot.trace,
    measurements,
    sim: shot,
    model,
    target,
  }
  if (practice.active) evaluatePractice(shot.trace, practice.active, 'contact')
  renderTelemetryHud(metrics, hud, {
    measurements,
    practiceTarget: practice.active,
    sim: shot,
    model,
  })
  field?.show(shot.trace, target, practice.active)
  field?.setLauncher(model, adj, {
    releasePosM: shot.release.posM,
    armFrames: shot.armFrames,
    animate: animateArm,
  })
  loadReplay?.(shot.trace)
  current = traceState
  const settingLabel = model.adjustments
    .map((d) => `${d.id}=${adj[d.id]}`)
    .join(', ')
  practice.record(
    {
      name: trialName,
      design: model.name,
      setting: settingLabel,
      samples: shot.trace,
    },
    false
  )
  updateScorecardTrace(measurements.carry, measurements.total)
  source.textContent = `${model.name} (${settingLabel})`
  errorBox.hidden = true
}

const initialEnv = createNominalEnv({
  energyVarianceJ: 0.05,
  turfScatterSigmaRad: 0.01,
})

const simControls = mountModelControls({
  host: simControlsHost,
  models,
  initialEnv,
  onModelChange(model, adj) {
    field?.setLauncher(model, adj)
  },
  onAdjustmentPreview(model, adj) {
    currentRequest++
    const target = { x: simControls.getTargetDistanceM(), y: 0 }
    const previewEnv = {
      ...simControls.getEnv(),
      energyVarianceJ: 0,
      turfScatterSigmaRad: 0,
      deterministic: true,
    }
    try {
      const shot = simulateShot(model, adj, previewEnv, target, 1)
      displaySimulatedShot(
        shot,
        model,
        adj,
        false,
        target,
        `${model.id} preview`
      )
    } catch (err) {
      errorBox.textContent =
        'Preview failed. ' + (err instanceof Error ? err.message : String(err))
      errorBox.hidden = false
    }
  },
  onEnvChange() {
    // Environment edits take effect on subsequent Launch / Auto-Sight / Shootout runs.
  },
  onAutoSight(model, targetDistanceM) {
    if (!Number.isFinite(targetDistanceM) || targetDistanceM < 0) {
      simControls.setAutoSightStatus(
        'Target distance must be a finite non-negative number.',
        false
      )
      return
    }
    try {
      const res = autoSight(model, simControls.getEnv(), targetDistanceM)
      simControls.setAdjustmentValues(res.adjustments)
      simControls.setAutoSightStatus(res.statusMessage, res.reachable)
      field?.setLauncher(model, res.adjustments)
    } catch (err) {
      simControls.setAutoSightStatus(
        err instanceof Error ? err.message : String(err),
        false
      )
    }
  },
  onLaunch(model, adj) {
    currentRequest++
    shotSeedCounter++
    const target = { x: simControls.getTargetDistanceM(), y: 0 }
    try {
      const shot = simulateShot(
        model,
        adj,
        simControls.getEnv(),
        target,
        1000 + shotSeedCounter
      )
      displaySimulatedShot(
        shot,
        model,
        adj,
        true,
        target,
        `${model.id} #${shotSeedCounter}`
      )
    } catch (err) {
      errorBox.textContent =
        'Launch failed. ' + (err instanceof Error ? err.message : String(err))
      errorBox.hidden = false
    }
  },
})

field?.setLauncher(simControls.getActiveModel(), simControls.getAdjustments())

mountShootoutPanel({
  host: shootoutHost,
  models,
  getEnv: () => simControls.getEnv(),
  getAdjustmentsByModel: () => simControls.getAllAdjustments(),
  onResults(summaries) {
    field?.setCepOverlays(summaries, modelNames, true)
  },
  onToggleCep(visible) {
    field?.setCepVisible(visible)
  },
})

function display(input: unknown, name: string, example: boolean) {
  if (
    !input ||
    typeof input !== 'object' ||
    !('samples' in input) ||
    !Array.isArray(input.samples)
  ) {
    throw new Error('Supply a JSON object containing a samples array.')
  }
  const samples: Sample[] = input.samples
  const target = 'target' in input ? (input.target as Target) : undefined
  const design = 'design' in input ? input.design : undefined
  const setting = 'setting' in input ? input.setting : undefined
  if (
    (design !== undefined && typeof design !== 'string') ||
    (setting !== undefined && typeof setting !== 'string')
  ) {
    throw new Error('Use text for the optional design and setting labels.')
  }
  const measurements = measure(samples, target)
  const trace: TraceState = { samples, measurements, target }
  if (practice.active) evaluatePractice(samples, practice.active, 'contact')
  renderTelemetryHud(metrics, hud, {
    measurements,
    practiceTarget: practice.active,
  })
  field?.show(samples, target, practice.active)
  loadReplay?.(samples)
  current = trace
  practice.record({ name, design, setting, samples }, example)
  updateScorecardTrace(measurements.carry, measurements.total)
  source.textContent = name
  errorBox.hidden = true
}

camera.addEventListener('change', () => {
  field?.view(
    camera.value as Parameters<ReturnType<typeof createField>['view']>[0]
  )
})

mountScorecard()

async function load(
  read: () => Promise<string>,
  name: string,
  example = false
) {
  const request = ++currentRequest
  try {
    const content = await read()
    if (request === currentRequest) display(JSON.parse(content), name, example)
  } catch (error) {
    if (request !== currentRequest) return
    errorBox.textContent =
      'Could not load trace. ' +
      (error instanceof Error ? error.message : String(error))
    errorBox.hidden = false
  }
}

file.addEventListener('change', () => {
  const selected = file.files?.[0]
  if (selected) void load(() => selected.text(), selected.name)
  file.value = ''
})

void load(
  async () => {
    const response = await fetch('./example.json')
    if (!response.ok) throw new Error('Example data could not be retrieved.')
    return response.text()
  },
  'Synthetic example trace',
  true
)
