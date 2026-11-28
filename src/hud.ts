import type { LauncherModel } from './models'
import type { PracticeTarget } from './physics/practice'
import type { FullSimulationResult } from './physics/simulate'
import type { measure } from './physics/telemetry'

export interface TelemetryHudInput {
  measurements: ReturnType<typeof measure>
  practiceTarget?: PracticeTarget
  sim?: FullSimulationResult
  model?: LauncherModel
}

function fmtMeters(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return value.toFixed(2) + ' m'
}

export function renderTelemetryHud(
  metricsEl: HTMLDListElement,
  hudEl: HTMLElement | null,
  input: TelemetryHudInput
): void {
  const { measurements: m, practiceTarget, sim, model } = input

  let targetDist: number | null = m.targetDistance
  let radialErr: number | null = m.radialError
  let lateralErr: number | null = m.lateralError
  if (practiceTarget && sim) {
    const rest = sim.trace[sim.trace.length - 1]
    const rel = sim.trace[0]
    targetDist = Math.hypot(practiceTarget.x, practiceTarget.y)
    radialErr = Math.hypot(
      rest.x - rel.x - practiceTarget.x,
      rest.y - rel.y - practiceTarget.y
    )
    lateralErr = rest.y - rel.y - practiceTarget.y
  } else if (practiceTarget) {
    targetDist = Math.hypot(practiceTarget.x, practiceTarget.y)
  }

  const launchSpeedStr = sim
    ? `${sim.release.launchSpeedMps.toFixed(2)} m/s`
    : '—'
  const launchAngleStr = sim
    ? `${sim.release.launchAngleDeg.toFixed(1)}°`
    : '—'
  const efficiencyStr = sim
    ? `${sim.energyEfficiencyPct.toFixed(1)}%`
    : '—'
  const cycleTimeStr = sim ? `${sim.cycleTimeS.toFixed(1)} s` : '—'
  const rubricScoreStr = sim
    ? `${sim.rubricTotalProjectedPts} pts (D:${sim.rubricDistancePts} A:${sim.rubricAccuracyPts})`
    : '—'

  const readings: Array<[string, string]> = [
    ['Total distance', fmtMeters(m.total)],
    ['Carry', fmtMeters(m.carry)],
    ['Bounce / rollout', fmtMeters(m.rollout)],
    ['Apex altitude', fmtMeters(m.apex)],
    [
      'Rest (x, y)',
      `(${m.restX.toFixed(2)}, ${m.restY.toFixed(2)}) m`,
    ],
    ['Target distance', fmtMeters(targetDist)],
    ['Rest radial error', fmtMeters(radialErr)],
    ['Rest lateral error', fmtMeters(lateralErr)],
    ['Launch speed', launchSpeedStr],
    ['Launch angle', launchAngleStr],
    ['Energy efficiency', efficiencyStr],
    ['Cycle / reload time', cycleTimeStr],
    ['Rubric score', rubricScoreStr],
  ]

  metricsEl.replaceChildren(
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

  if (hudEl) {
    const items: Array<[string, string]> = [
      ['Launcher', model ? model.name : 'Imported trace'],
      ['Speed', launchSpeedStr],
      ['Angle', launchAngleStr],
      ['Efficiency', efficiencyStr],
      ['Cycle', cycleTimeStr],
      ['Rubric', sim ? `${sim.rubricTotalProjectedPts} pts` : '—'],
    ]
    hudEl.replaceChildren(
      ...items.map(([label, val]) => {
        const pill = document.createElement('div')
        pill.className = 'hud-pill'
        const k = document.createElement('span')
        k.className = 'hud-key'
        k.textContent = label
        const v = document.createElement('strong')
        v.className = 'hud-val'
        v.textContent = val
        pill.append(k, v)
        return pill
      })
    )
  }
}
