import { type AdjustmentValues, type LauncherModel } from '../models'
import { buildAeroParams } from './aero'
import { validateDt, type EnvConfig } from './launch_solver'
import { simulateShot, type FullSimulationResult } from './simulate'
import type { Target } from './telemetry'
import { validateTurfParams } from './turf'

const MAX_SEQUENCE_SHOTS = 10_000

export interface SequenceOptions {
  windowS: number
  target?: Target
  targets?: readonly [Target, Target]
  targetAdjustments?: readonly AdjustmentValues[]
  targetRadiusM?: number
  seed: number
}

export interface SequenceResult {
  windowS: number
  shotsAttempted: number
  shotsCompleted: number
  totalElapsedS: number
  elapsedS: number
  shots: FullSimulationResult[]
  target1Hits: number
  target2Hits: number
}

export function simulateSequence(
  model: LauncherModel,
  adjustments: AdjustmentValues,
  env: EnvConfig,
  options: SequenceOptions
): SequenceResult {
  if (
    typeof options.windowS !== 'number' ||
    !Number.isFinite(options.windowS) ||
    options.windowS < 0
  ) {
    throw new RangeError(
      `options.windowS must be a finite non-negative number, got ${String(options.windowS)}.`
    )
  }
  if (typeof options.seed !== 'number' || !Number.isFinite(options.seed)) {
    throw new RangeError(
      `options.seed must be a finite number, got ${String(options.seed)}.`
    )
  }
  const targetRadiusM = options.targetRadiusM ?? 0.5
  if (
    typeof targetRadiusM !== 'number' ||
    !Number.isFinite(targetRadiusM) ||
    targetRadiusM <= 0
  ) {
    throw new RangeError(
      `options.targetRadiusM must be finite and > 0, got ${String(targetRadiusM)}.`
    )
  }

  validateTurfParams({
    en: env.turfEn,
    muR: env.turfMuR,
    scatterSigmaRad: env.turfScatterSigmaRad,
  })
  buildAeroParams(env, model.projectile)
  if (env.dtS !== undefined) {
    validateDt(env.dtS)
  }

  if (options.windowS === 0) {
    return {
      windowS: 0,
      shotsAttempted: 0,
      shotsCompleted: 0,
      totalElapsedS: 0,
      elapsedS: 0,
      shots: [],
      target1Hits: 0,
      target2Hits: 0,
    }
  }

  const shots: FullSimulationResult[] = []
  let totalElapsedS = 0
  let shotsAttempted = 0
  let shotsCompleted = 0
  let target1Hits = 0
  let target2Hits = 0

  const baseSeed = options.seed >>> 0

  for (let shotIdx = 0; shotIdx < MAX_SEQUENCE_SHOTS; shotIdx++) {
    if (totalElapsedS >= options.windowS - 1e-9) break

    const targetIdx = options.targets ? shotIdx % 2 : 0
    const activeTarget: Target = options.targets
      ? options.targets[targetIdx]
      : options.target ?? { x: 4.0, y: 0 }
    const activeAdj = options.targetAdjustments?.[targetIdx] ?? adjustments

    const shotSeed =
      (Math.imul(baseSeed, 1664525) + Math.imul(shotIdx + 1, 1013904223)) >>> 0
    const shot = simulateShot(model, activeAdj, env, activeTarget, shotSeed)

    shotsAttempted++
    if (totalElapsedS + shot.cycleTimeS > options.windowS + 1e-9) {
      break
    }

    totalElapsedS += shot.cycleTimeS
    shotsCompleted++
    shots.push(shot)

    if (shot.release.leftCradle && shot.release.reachable !== false) {
      const rest = shot.trace[shot.trace.length - 1]
      const radialErr = Math.hypot(
        rest.x - activeTarget.x,
        rest.y - activeTarget.y
      )
      if (radialErr <= targetRadiusM) {
        if (targetIdx === 0) target1Hits++
        else target2Hits++
      }
    }
  }

  return {
    windowS: options.windowS,
    shotsAttempted,
    shotsCompleted,
    totalElapsedS,
    elapsedS: totalElapsedS,
    shots,
    target1Hits,
    target2Hits,
  }
}
