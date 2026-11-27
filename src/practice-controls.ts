import { evaluatePractice, type PracticeTarget } from './physics/practice'
import type { Sample } from './physics/telemetry'

type Endpoint = 'contact' | 'rest'
interface Trial {
  name: string
  design?: string
  setting?: string
  samples: readonly Sample[]
}

export function mountPractice(change: (target?: PracticeTarget) => void) {
  const form = document.querySelector<HTMLFormElement>('#practice-form')!
  const clear = document.querySelector<HTMLButtonElement>('#clear-practice')!
  const report = document.querySelector<HTMLElement>('#practice-report')!
  const summary = document.querySelector<HTMLElement>('#practice-summary')!
  const rows = document.querySelector<HTMLTableSectionElement>(
    '#practice-results tbody'
  )!
  const error = document.querySelector<HTMLElement>('#practice-error')!
  const trials = new Map<string, Trial>()
  const number = (name: string) =>
    form.elements.namedItem(name) as HTMLInputElement
  const shape = form.elements.namedItem('shape') as HTMLSelectElement
  const when = form.elements.namedItem('endpoint') as HTMLSelectElement
  let active: PracticeTarget | undefined
  let endpoint: Endpoint = 'contact'
  let latestWasExample = false

  function refresh() {
    report.hidden = !active
    clear.disabled = !active
    if (!active) return
    const target = active
    const size =
      target.shape === 'circle'
        ? `radius ${target.radius} m`
        : `${target.length} × ${target.width} m`
    const phase = endpoint === 'contact' ? 'First contact' : 'Final rest'
    summary.textContent = `${phase} · ${target.shape}, ${size} · centre (${target.x}, ${target.y}) m from release`
    const updated = Array.from(trials.values(), (trial) => {
      const result = evaluatePractice(trial.samples, target, endpoint)
      const row = document.createElement('tr')
      for (const value of [
        trial.name,
        trial.design ?? '—',
        trial.setting ?? '—',
        result.hit ? 'Hit' : 'Miss',
        result.radialError.toFixed(2) + ' m',
      ]) {
        const cell = row.insertCell()
        cell.textContent = value
      }
      return row
    })
    rows.replaceChildren(...updated)
  }

  shape.addEventListener('change', () => {
    for (const name of ['radius', 'length', 'width']) {
      const input = number(name)
      input.disabled = (name === 'radius') !== (shape.value === 'circle')
      input.closest('label')!.hidden = input.disabled
    }
  })
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const centre = {
      x: number('x').valueAsNumber,
      y: number('y').valueAsNumber,
    }
    const proposed: PracticeTarget =
      shape.value === 'circle'
        ? { ...centre, shape: 'circle', radius: number('radius').valueAsNumber }
        : {
            ...centre,
            shape: 'rectangle',
            length: number('length').valueAsNumber,
            width: number('width').valueAsNumber,
          }
    const proposedEndpoint: Endpoint =
      when.value === 'contact' ? 'contact' : 'rest'
    try {
      for (const trial of trials.values())
        evaluatePractice(trial.samples, proposed, proposedEndpoint)
      if (!trials.size)
        throw new Error('Load a trace before applying a target.')
    } catch (e) {
      error.textContent = e instanceof Error ? e.message : String(e)
      error.hidden = false
      return
    }
    error.hidden = true
    active = proposed
    endpoint = proposedEndpoint
    refresh()
    change(active)
  })
  clear.addEventListener('click', () => {
    active = undefined
    error.hidden = true
    refresh()
    change()
  })
  return {
    get active() {
      return active
    },
    record(trial: Trial, example: boolean) {
      // Keep only the observed positions needed to assess both endpoints across imports.
      const contact = trial.samples.find(
        (sample) => sample.event === 'contact'
      )!
      const observations = Array.from(
        new Set([
          trial.samples[0],
          contact,
          trial.samples[trial.samples.length - 1],
        ])
      )
      if (latestWasExample) trials.clear()
      latestWasExample = example
      trials.set(trial.name, { ...trial, samples: observations })
      refresh()
    },
  }
}
