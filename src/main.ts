import { createField } from './field'
import { mountPractice } from './practice-controls'
import { evaluatePractice, type PracticeTarget } from './physics/practice'
import { mountReplay } from './replay-controls'
import { mountScorecard, updateScorecardTrace } from './scorecard'
import { measure, type Sample, type Target } from './physics/telemetry'

const fieldHost = document.querySelector<HTMLElement>('#field')!
const metrics = document.querySelector<HTMLDListElement>('#metrics')!
const source = document.querySelector<HTMLElement>('#source')!
const errorBox = document.querySelector<HTMLElement>('#error')!
const file = document.querySelector<HTMLInputElement>('#file')!
const camera = document.querySelector<HTMLSelectElement>('#camera')!
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

const loadReplay = field ? mountReplay(field.setCursor) : undefined

type Trace = { samples: Sample[]; measurements: ReturnType<typeof measure> }
let current: Trace | undefined
const practice = mountPractice((target) => {
  if (current) renderMeasurements(current, target)
  field?.setPractice(target)
})

function renderMeasurements(trace: Trace, practiceTarget?: PracticeTarget) {
  const m = trace.measurements
  const restError =
    practiceTarget && evaluatePractice(trace.samples, practiceTarget, 'rest')
  const distance = (value: number | null) =>
    value === null ? '—' : value.toFixed(2) + ' m'
  const readings = [
    ['Total distance', distance(m.total)],
    ['Carry', distance(m.carry)],
    ['Bounce / rollout', distance(m.rollout)],
    ['Apex altitude', distance(m.apex)],
    [
      'Rest (x, y)',
      '(' + m.restX.toFixed(2) + ', ' + m.restY.toFixed(2) + ') m',
    ],
    [
      'Target distance',
      distance(
        practiceTarget
          ? Math.hypot(practiceTarget.x, practiceTarget.y)
          : m.targetDistance
      ),
    ],
    ['Rest radial error', distance(restError?.radialError ?? m.radialError)],
    ['Rest lateral error', distance(restError?.dy ?? m.lateralError)],
  ]
  metrics.replaceChildren(
    ...readings.map(([key, value]) => {
      const row = document.createElement('div')
      row.className = 'row'
      const term = document.createElement('dt')
      const readout = document.createElement('dd')
      term.textContent = key
      readout.textContent = value
      row.append(term, readout)
      return row
    })
  )
}

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
  const trace = { samples, measurements }
  if (practice.active) evaluatePractice(samples, practice.active, 'contact')
  renderMeasurements(trace, practice.active)
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

let currentRequest = 0
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
    const response = await fetch(import.meta.env.BASE_URL + 'example.json')
    if (!response.ok) throw new Error('Example data could not be retrieved.')
    return response.text()
  },
  'Synthetic example trace',
  true
)
