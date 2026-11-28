import {
  defaultAdjustments,
  validateAndClampAdjustments,
  type AdjustmentDef,
  type AdjustmentValues,
  type LauncherModel,
} from '../models'
import { buildAeroParams } from './aero'
import { validateDt, type EnvConfig } from './launch_solver'
import { simulateShot, type FullSimulationResult } from './simulate'
import { validateTurfParams } from './turf'

export interface AutoSightResult {
  reachable: boolean
  adjustments: AdjustmentValues
  predictedDistanceM: number
  errorM: number
  message: string
  statusMessage: string
}

interface CandidateEval {
  adj: AdjustmentValues
  shot: FullSimulationResult
  loss: number
}

function buildSampleValues(def: AdjustmentDef, count: number): number[] {
  if (def.kind === 'discrete' && def.options && def.options.length > 0) {
    return [...def.options]
  }
  const vals = new Set<number>()
  vals.add(def.defaultValue)
  if (count <= 1 || def.max <= def.min) {
    vals.add(def.min)
    vals.add(def.max)
    return [...vals]
  }
  for (let i = 0; i < count; i++) {
    const raw = def.min + ((def.max - def.min) * i) / (count - 1)
    const steps = Math.round((raw - def.min) / def.step)
    const snapped = Math.min(def.max, Math.max(def.min, def.min + steps * def.step))
    vals.add(Number(snapped.toPrecision(12)))
  }
  return [...vals]
}

function buildDiscreteCombos(
  discreteDefs: readonly AdjustmentDef[],
  base: AdjustmentValues
): AdjustmentValues[] {
  if (discreteDefs.length === 0) return [{ ...base }]
  let combos: AdjustmentValues[] = [{ ...base }]
  for (const def of discreteDefs) {
    const opts = def.options && def.options.length > 0 ? def.options : [def.defaultValue]
    const next: AdjustmentValues[] = []
    for (const c of combos) {
      for (const opt of opts) {
        next.push({ ...c, [def.id]: opt })
      }
    }
    combos = next
  }
  return combos
}

function buildContinuousCombos(
  continuousDefs: readonly AdjustmentDef[],
  base: AdjustmentValues
): AdjustmentValues[] {
  if (continuousDefs.length === 0) return [{ ...base }]

  const k = continuousDefs.length
  if (k === 1) {
    const def = continuousDefs[0]
    return buildSampleValues(def, 15).map((v) => ({ ...base, [def.id]: v }))
  }
  if (k === 2) {
    const v0 = buildSampleValues(continuousDefs[0], 5)
    const v1 = buildSampleValues(continuousDefs[1], 5)
    const out: AdjustmentValues[] = [{ ...base }]
    for (const a of v0) {
      for (const b of v1) {
        out.push({
          ...base,
          [continuousDefs[0].id]: a,
          [continuousDefs[1].id]: b,
        })
      }
    }
    return out
  }

  // k >= 3: 2^k corner grid + 5-point 1D coordinate slices around default
  const out: AdjustmentValues[] = [{ ...base }]
  let grid: AdjustmentValues[] = [{ ...base }]
  for (const def of continuousDefs) {
    const pts = buildSampleValues(def, 2)
    const next: AdjustmentValues[] = []
    for (const g of grid) {
      for (const p of pts) {
        next.push({ ...g, [def.id]: p })
      }
    }
    grid = next
  }
  out.push(...grid)
  for (const def of continuousDefs) {
    for (const v of buildSampleValues(def, 5)) {
      out.push({ ...base, [def.id]: v })
    }
  }
  return out
}

export function autoSight(
  model: LauncherModel,
  env: EnvConfig,
  targetDistanceM: number
): AutoSightResult {
  if (
    typeof targetDistanceM !== 'number' ||
    !Number.isFinite(targetDistanceM) ||
    targetDistanceM < 0
  ) {
    throw new RangeError(
      `targetDistanceM must be a finite non-negative number, got ${String(targetDistanceM)}.`
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

  const nomEnv: EnvConfig = {
    ...env,
    energyVarianceJ: 0,
    turfScatterSigmaRad: 0,
    deterministic: true,
  }
  const searchEnv: EnvConfig = {
    ...nomEnv,
    dtS: env.dtS ?? 0.0005,
  }
  const cleanModel: LauncherModel = {
    ...model,
    cycleTiming: { ...model.cycleTiming, humanSigmaS: 0 },
    tolerances: {
      cockAngleSigmaDeg: 0,
      seatingOffsetSigmaM: 0,
      yawSigmaDeg: 0,
      stopAngleSigmaDeg: 0,
    },
  }

  const target = { x: targetDistanceM, y: 0 }
  const defaults = defaultAdjustments(cleanModel)
  const yawDef = cleanModel.adjustments.find((a) => a.id === 'yawDeg')
  const discreteDefs = cleanModel.adjustments.filter((a) => a.kind === 'discrete')
  const continuousDefs = cleanModel.adjustments.filter(
    (a) => a.kind === 'continuous' && a.id !== 'yawDeg'
  )

  const seenKeys = new Set<string>()
  const evaluate = (rawAdj: AdjustmentValues, useRadial = false): CandidateEval => {
    const adj = validateAndClampAdjustments(cleanModel, rawAdj)
    const shot = simulateShot(cleanModel, adj, searchEnv, target, 1)
    if (!shot.release.leftCradle || shot.release.reachable === false) {
      return { adj, shot, loss: 1e6 + targetDistanceM }
    }
    const rest = shot.trace[shot.trace.length - 1]
    const rel = shot.trace[0]
    const dx = rest.x - rel.x
    const dy = rest.y - rel.y
    let loss: number
    if (useRadial) {
      loss = Math.hypot(dx - targetDistanceM, dy)
    } else {
      loss = Math.abs(dx - targetDistanceM)
    }
    if (adj.rolling === 0) loss += 1e-5
    return { adj, shot, loss }
  }

  const cacheEval = new Map<string, CandidateEval>()
  const evalCached = (rawAdj: AdjustmentValues): CandidateEval => {
    const adj = validateAndClampAdjustments(cleanModel, rawAdj)
    const key = cleanModel.adjustments.map((d) => `${d.id}=${adj[d.id]}`).join('|')
    const hit = cacheEval.get(key)
    if (hit) return hit
    const res = evaluate(adj, false)
    cacheEval.set(key, res)
    return res
  }

  const baseWithZeroYaw = yawDef ? { ...defaults, [yawDef.id]: 0 } : { ...defaults }
  const discreteCombos = buildDiscreteCombos(discreteDefs, baseWithZeroYaw)

  const allEvaluated: CandidateEval[] = []
  if (continuousDefs.length === 0) {
    for (const c of discreteCombos) {
      allEvaluated.push(evalCached(c))
    }
  } else if (discreteDefs.length === 0) {
    const continuousCombos = buildContinuousCombos(continuousDefs, baseWithZeroYaw)
    for (const c of continuousCombos) {
      const key = cleanModel.adjustments.map((d) => `${d.id}=${c[d.id]}`).join('|')
      if (seenKeys.has(key)) continue
      seenKeys.add(key)
      allEvaluated.push(evalCached(c))
    }
  } else {
    for (const d of discreteCombos) {
      allEvaluated.push(evalCached(d))
    }
    allEvaluated.sort((a, b) => a.loss - b.loss)
    const bestDisc = allEvaluated[0].adj
    const continuousCombos = buildContinuousCombos(continuousDefs, bestDisc)
    for (const c of continuousCombos) {
      allEvaluated.push(evalCached(c))
    }
  }

  allEvaluated.sort((a, b) => a.loss - b.loss)
  let best = allEvaluated[0]

  // Local coordinate refinement for continuous distance DOFs
  if (continuousDefs.length > 0 && best.loss > 0.01) {
    const starts = allEvaluated.slice(0, Math.min(2, allEvaluated.length))
    for (const start of starts) {
      let cur = start
      for (const mult of [8, 4, 2, 1]) {
        if (cur.loss <= 0.01) break
        let improved = true
        let guard = 0
        while (improved && guard < 24 && cur.loss > 0.01) {
          improved = false
          guard++
          for (const def of continuousDefs) {
            const delta = def.step * mult
            for (const dir of [-1, 1]) {
              const cand = evalCached({
                ...cur.adj,
                [def.id]: cur.adj[def.id] + dir * delta,
              })
              if (cand.loss + 1e-9 < cur.loss) {
                cur = cand
                improved = true
              }
            }
          }
        }
      }
      if (cur.loss < best.loss) best = cur
      if (best.loss <= 0.01) break
    }
  }

  // Optional yaw wind compensation when crosswind pushes ball off-axis
  if (yawDef) {
    const rest = best.shot.trace[best.shot.trace.length - 1]
    const rel = best.shot.trace[0]
    const dy = rest.y - rel.y
    const dx = rest.x - rel.x
    if (Math.abs(dy) > 0.01 || Math.abs(env.windVecMps[1]) > 0.05) {
      const yawGuessDeg =
        dx > 0.05 ? (-Math.atan2(dy, dx) * 180) / Math.PI : 0
      let yawBest = evaluate({ ...best.adj, [yawDef.id]: yawGuessDeg }, true)
      const zeroYawEval = evaluate(best.adj, true)
      if (zeroYawEval.loss < yawBest.loss) yawBest = zeroYawEval

      for (const mult of [8, 4, 2, 1]) {
        let improved = true
        let guard = 0
        while (improved && guard < 16) {
          improved = false
          guard++
          const delta = yawDef.step * mult
          for (const dir of [-1, 1]) {
            const cand = evaluate(
              { ...yawBest.adj, [yawDef.id]: yawBest.adj[yawDef.id] + dir * delta },
              true
            )
            if (cand.loss + 1e-9 < yawBest.loss) {
              yawBest = cand
              improved = true
            }
          }
        }
      }
      best = yawBest
    }
  }

  const finalAdj = validateAndClampAdjustments(cleanModel, best.adj)
  const finalShot = simulateShot(cleanModel, finalAdj, nomEnv, target, 1)
  const finalRest = finalShot.trace[finalShot.trace.length - 1]
  const finalRel = finalShot.trace[0]
  const dx = finalRest.x - finalRel.x
  const dy = finalRest.y - finalRel.y
  const predictedDistanceM = dx
  const errorM = Math.hypot(dx - targetDistanceM, dy)
  const toleranceM = Math.max(0.5, 0.12 * targetDistanceM)
  const reachable =
    finalShot.release.leftCradle &&
    finalShot.release.reachable !== false &&
    errorM <= toleranceM

  const msg = reachable
    ? `Calibrated ${model.name} for ${targetDistanceM.toFixed(2)} m (predicted ${predictedDistanceM.toFixed(2)} m, error ${errorM.toFixed(2)} m).`
    : `Target ${targetDistanceM.toFixed(2)} m is unreachable / out of range for ${model.name} (closest ${predictedDistanceM.toFixed(2)} m, error ${errorM.toFixed(2)} m).`

  return {
    reachable,
    adjustments: finalAdj,
    predictedDistanceM,
    errorM,
    message: msg,
    statusMessage: msg,
  }
}
