import {
  REGULATION_GOLF_BALL,
  validateAndClampAdjustments,
  type AdjustmentValues,
  type LauncherModel,
  type ProjectileSpec,
} from '../models'
import {
  buildAeroParams,
  copyAeroState,
  createAeroWorkspace,
  MAX_FLIGHT_TIME_S,
  solveGroundImpactFromPrev,
  stepAeroRk4InPlace,
  type AeroParams,
  type AeroState,
  type AeroWorkspace,
} from './aero'
import {
  MAX_DT_S,
  solveLaunch,
  validateDt,
  type EnvConfig,
} from './launch_solver'
import { distancePoints } from './rubric'
import { createSeededRng } from './simulate'
import type { Target } from './telemetry'
import { validateTurfParams } from './turf'

const CHI2_2_95 = 5.991464547107979
const MAX_BOUNCES = 32
const MAX_ROLL_TIME_S = 60
const V_BOUNCE_MIN_MPS = 0.12
const V_CAPTURE_MPS = 0.03

export interface Cep95Ellipse {
  centerX: number
  centerY: number
  semiMajorM: number
  semiMinorM: number
  angleRad: number
}

export interface MonteCarloRequest {
  jobId: string
  models: readonly LauncherModel[]
  adjustmentsByModel: Record<string, AdjustmentValues>
  env: EnvConfig
  rubricConfig: {
    task: 'day1_distance' | 'day2_accuracy'
    target?: Target
    targets?: readonly [Target, Target]
    targetRadiusM?: number
    timeWindowS?: number
    fieldHalfWidthM?: number
  }
  trialsPerModel: number
  baseSeed: number
}

export interface MonteCarloLanding {
  restX: number
  restY: number
  carryM: number
  totalM: number
  score: number
}

export interface MonteCarloDesignSummary {
  modelId: string
  meanScore: number
  medianScore: number
  p10Score: number
  p90Score: number
  carryToRollRatio: number
  shotsInWindow: number
  missRate: number
  oobRate: number
  cep95Ellipse: Cep95Ellipse
  landings: MonteCarloLanding[]
}

export interface MonteCarloResponse {
  jobId: string
  type: 'progress' | 'done' | 'error'
  completed: number
  total: number
  results?: MonteCarloDesignSummary[]
  error?: string
}

export function deriveTrialSeed(
  baseSeed: number,
  modelIdx: number,
  trialIdx: number
): number {
  let h = (baseSeed >>> 0) ^ Math.imul((modelIdx + 1) >>> 0, 0x9e3779b9)
  h = (h + Math.imul((trialIdx + 1) >>> 0, 0x85ebca6b)) >>> 0
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b) >>> 0
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35) >>> 0
  h ^= h >>> 16
  return h >>> 0
}

function assertValidTarget(t: Target, label: string): void {
  if (!t || typeof t !== 'object') {
    throw new TypeError(`${label} must be an object with finite x and y.`)
  }
  if (!Number.isFinite(t.x) || !Number.isFinite(t.y)) {
    throw new RangeError(`${label}.x and ${label}.y must be finite numbers.`)
  }
}

function validateRequest(request: MonteCarloRequest): {
  dtS: number
  fieldHalfWidthM: number
  targetRadiusM: number
  timeWindowS: number
  activeTarget: Target
  mcEnv: EnvConfig
} {
  if (!request || typeof request !== 'object') {
    throw new TypeError('MonteCarloRequest must be an object.')
  }
  if (typeof request.jobId !== 'string' || request.jobId.trim().length === 0) {
    throw new RangeError('request.jobId must be a non-empty string.')
  }
  if (!Array.isArray(request.models) || request.models.length === 0) {
    throw new RangeError('request.models must be a non-empty array.')
  }
  if (!request.adjustmentsByModel || typeof request.adjustmentsByModel !== 'object') {
    throw new TypeError('request.adjustmentsByModel must be an object.')
  }
  if (!Number.isSafeInteger(request.trialsPerModel) || request.trialsPerModel <= 0) {
    throw new RangeError(
      `request.trialsPerModel must be a positive safe integer, got ${String(request.trialsPerModel)}.`
    )
  }
  if (typeof request.baseSeed !== 'number' || !Number.isFinite(request.baseSeed)) {
    throw new RangeError(
      `request.baseSeed must be a finite number, got ${String(request.baseSeed)}.`
    )
  }
  if (!request.env || typeof request.env !== 'object') {
    throw new TypeError('request.env must be an object.')
  }

  validateTurfParams({
    en: request.env.turfEn,
    muR: request.env.turfMuR,
    scatterSigmaRad: request.env.turfScatterSigmaRad,
  })
  const dtS =
    request.env.dtS !== undefined ? validateDt(request.env.dtS) : MAX_DT_S

  const rc = request.rubricConfig
  if (!rc || typeof rc !== 'object') {
    throw new TypeError('request.rubricConfig must be an object.')
  }
  if (rc.task !== 'day1_distance' && rc.task !== 'day2_accuracy') {
    throw new RangeError(
      `rubricConfig.task must be 'day1_distance' or 'day2_accuracy', got ${String(rc.task)}.`
    )
  }
  const fieldHalfWidthM = rc.fieldHalfWidthM ?? 3.0
  if (
    typeof fieldHalfWidthM !== 'number' ||
    !Number.isFinite(fieldHalfWidthM) ||
    fieldHalfWidthM <= 0
  ) {
    throw new RangeError(
      `rubricConfig.fieldHalfWidthM must be > 0, got ${String(fieldHalfWidthM)}.`
    )
  }
  const targetRadiusM = rc.targetRadiusM ?? 0.5
  if (
    typeof targetRadiusM !== 'number' ||
    !Number.isFinite(targetRadiusM) ||
    targetRadiusM <= 0
  ) {
    throw new RangeError(
      `rubricConfig.targetRadiusM must be > 0, got ${String(targetRadiusM)}.`
    )
  }
  const timeWindowS = rc.timeWindowS ?? 210
  if (
    typeof timeWindowS !== 'number' ||
    !Number.isFinite(timeWindowS) ||
    timeWindowS < 0
  ) {
    throw new RangeError(
      `rubricConfig.timeWindowS must be >= 0, got ${String(timeWindowS)}.`
    )
  }

  if (rc.target !== undefined) {
    assertValidTarget(rc.target, 'rubricConfig.target')
  }
  if (rc.targets !== undefined) {
    if (!Array.isArray(rc.targets) || rc.targets.length !== 2) {
      throw new RangeError('rubricConfig.targets must contain 2 targets.')
    }
    assertValidTarget(rc.targets[0], 'rubricConfig.targets[0]')
    assertValidTarget(rc.targets[1], 'rubricConfig.targets[1]')
  }

  const activeTarget: Target =
    rc.target ??
    rc.targets?.[0] ??
    (rc.task === 'day1_distance' ? { x: 5.0, y: 0 } : { x: 4.0, y: 0 })

  const mcEnv: EnvConfig = { ...request.env, dtS }
  for (const model of request.models) {
    if (!model || typeof model !== 'object' || typeof model.id !== 'string') {
      throw new TypeError('Every entry in request.models must be a valid LauncherModel.')
    }
    buildAeroParams(mcEnv, model.projectile)
  }

  return {
    dtS,
    fieldHalfWidthM,
    targetRadiusM,
    timeWindowS,
    activeTarget,
    mcEnv,
  }
}

function sampleNormal(rng: () => number, sigma: number): number {
  if (sigma <= 0) return 0
  const u1 = Math.max(1e-12, Math.min(1 - 1e-12, rng()))
  const u2 = rng()
  return sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

function applyTurfImpactInPlace(
  s: AeroState,
  turfEn: number,
  turfMuR: number,
  massKg: number,
  radiusM: number,
  inertiaKgM2: number
): void {
  const vxBefore = s.vx
  const vyBefore = s.vy
  const vtBefore = Math.hypot(vxBefore, vyBefore)
  const vn = -s.vz

  if (vn <= 0) {
    s.vz = 0
    s.z = 0
    return
  }

  const impactAngle = Math.atan2(vn, vtBefore)
  const enEff =
    turfEn <= 0 || vn <= V_BOUNCE_MIN_MPS
      ? 0
      : turfEn *
        (1 - 0.12 * Math.min(1, vn / 12)) *
        (0.85 + 0.15 * Math.cos(impactAngle))

  const vzPost = enEff > 0 ? enEff * vn : 0

  const jn = massKg * (1 + enEff) * vn
  const muImp = 0.35 + 0.6 * turfMuR + 0.25 * (1 - enEff)
  const vSlipX = vxBefore - s.wy * radiusM
  const vSlipY = vyBefore + s.wx * radiusM
  const vSlipMag = Math.hypot(vSlipX, vSlipY)

  let vxPost = vxBefore
  let vyPost = vyBefore
  let wxPost = s.wx
  let wyPost = s.wy

  if (vSlipMag > 1e-12) {
    const jStick = (2 / 7) * massKg * vSlipMag
    const jSlide = muImp * jn
    const jMag = jStick < jSlide ? jStick : jSlide
    const jtx = -(vSlipX / vSlipMag) * jMag
    const jty = -(vSlipY / vSlipMag) * jMag
    vxPost += jtx / massKg
    vyPost += jty / massKg
    wxPost += (radiusM * jty) / inertiaKgM2
    wyPost -= (radiusM * jtx) / inertiaKgM2
  }

  const biteLoss = Math.min(
    0.65,
    (0.42 * Math.sin(impactAngle) + 0.08) * (1 - 0.45 * enEff)
  )
  const biteScale = 1 - biteLoss
  vxPost *= biteScale
  vyPost *= biteScale

  s.z = 0
  s.vx = vxPost
  s.vy = vyPost
  s.vz = vzPost
  s.wx = wxPost
  s.wy = wyPost
  s.wz *= 1 - Math.min(0.8, 0.3 * muImp)
}

function stepRollRk4InPlace(s: AeroState, aRoll: number, dt: number): number {
  const vx0 = s.vx
  const vy0 = s.vy
  const v0 = Math.hypot(vx0, vy0)
  if (v0 <= 1e-12) return 0

  const k1vx = (-aRoll * vx0) / v0
  const k1vy = (-aRoll * vy0) / v0

  const halfDt = 0.5 * dt
  const vx2 = vx0 + halfDt * k1vx
  const vy2 = vy0 + halfDt * k1vy
  const v2 = Math.hypot(vx2, vy2)
  const k2vx = v2 > 1e-12 ? (-aRoll * vx2) / v2 : 0
  const k2vy = v2 > 1e-12 ? (-aRoll * vy2) / v2 : 0

  const vx3 = vx0 + halfDt * k2vx
  const vy3 = vy0 + halfDt * k2vy
  const v3 = Math.hypot(vx3, vy3)
  const k3vx = v3 > 1e-12 ? (-aRoll * vx3) / v3 : 0
  const k3vy = v3 > 1e-12 ? (-aRoll * vy3) / v3 : 0

  const vx4 = vx0 + dt * k3vx
  const vy4 = vy0 + dt * k3vy
  const v4 = Math.hypot(vx4, vy4)
  const k4vx = v4 > 1e-12 ? (-aRoll * vx4) / v4 : 0
  const k4vy = v4 > 1e-12 ? (-aRoll * vy4) / v4 : 0

  const dt6 = dt / 6
  const dx = dt6 * (vx0 + 2 * vx2 + 2 * vx3 + vx4)
  const dy = dt6 * (vy0 + 2 * vy2 + 2 * vy3 + vy4)
  s.x += dx
  s.y += dy
  s.vx = vx0 + dt6 * (k1vx + 2 * k2vx + 2 * k3vx + k4vx)
  s.vy = vy0 + dt6 * (k1vy + 2 * k2vy + 2 * k3vy + k4vy)
  return Math.hypot(dx, dy)
}

interface LeanWorkspace {
  state: AeroState
  prev: AeroState
  hitState: AeroState
  aeroWs: AeroWorkspace
}

function createLeanWorkspace(): LeanWorkspace {
  const mkState = (): AeroState => ({
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    wx: 0,
    wy: 0,
    wz: 0,
  })
  return {
    state: mkState(),
    prev: mkState(),
    hitState: mkState(),
    aeroWs: createAeroWorkspace(),
  }
}

function simulateFlightAndTurfLean(
  posM: readonly [number, number, number],
  velMps: readonly [number, number, number],
  omegaMps: readonly [number, number, number],
  tStartS: number,
  env: EnvConfig,
  dtS: number,
  aeroParams: AeroParams,
  projectile: ProjectileSpec,
  rng: () => number,
  lws: LeanWorkspace
): {
  restX: number
  restY: number
  carryM: number
  rollM: number
  totalM: number
} {
  const { state, prev, hitState, aeroWs } = lws
  const x0 = posM[0]
  const y0 = posM[1]
  const z0 = posM[2]

  state.x = x0
  state.y = y0
  state.z = z0
  state.vx = velMps[0]
  state.vy = velMps[1]
  state.vz = velMps[2]
  state.wx = omegaMps[0]
  state.wy = omegaMps[1]
  state.wz = omegaMps[2]

  let lastSampleT = tStartS
  let tImpactS = tStartS

  if (z0 <= 0 && state.vz <= 0) {
    state.z = 0
    tImpactS = tStartS + 1e-6
  } else {
    let elapsedS = 0
    let nextSampleElapsedS = 0.005
    const maxSteps = Math.ceil(MAX_FLIGHT_TIME_S / dtS)
    let impacted = false

    for (let step = 0; step < maxSteps; step++) {
      copyAeroState(prev, state)
      const tPrev = tStartS + elapsedS
      stepAeroRk4InPlace(state, aeroParams, dtS, aeroWs)
      elapsedS += dtS

      if (state.z <= 0 && (step > 0 || state.vz < 0)) {
        const alpha = solveGroundImpactFromPrev(
          prev,
          state.z,
          dtS,
          aeroParams,
          aeroWs,
          hitState
        )
        const rawImpactT = tPrev + alpha * dtS
        tImpactS =
          rawImpactT > lastSampleT + 1e-12 ? rawImpactT : lastSampleT + 1e-9
        copyAeroState(state, hitState)
        state.z = 0
        impacted = true
        break
      }

      if (elapsedS >= nextSampleElapsedS) {
        lastSampleT = tStartS + elapsedS
        nextSampleElapsedS = elapsedS + (elapsedS > 15 ? 0.02 : 0.005)
      }
    }

    if (!impacted) {
      const tCap = tStartS + Math.min(elapsedS, MAX_FLIGHT_TIME_S)
      tImpactS = tCap > lastSampleT + 1e-12 ? tCap : lastSampleT + 1e-9
      state.z = Math.max(0, state.z)
    }
  }

  const carryM = Math.hypot(state.x - x0, state.y - y0)

  // Turf impact + bounces + rollout (identical to simulateTurf without Sample[] allocation)
  let t = tImpactS
  let elapsed = 0
  let nextSampleElapsed = 0.005
  lastSampleT = t
  let lastRollSampleX = state.x
  let lastRollSampleY = state.y
  let rollout = 0

  applyTurfImpactInPlace(
    state,
    env.turfEn,
    env.turfMuR,
    projectile.massKg,
    projectile.radiusM,
    projectile.inertiaKgM2
  )

  let bounceCount = 1
  const maxHopSteps = Math.ceil(30 / dtS)
  while (state.vz > 0 && bounceCount < MAX_BOUNCES) {
    let landed = false
    for (let step = 0; step < maxHopSteps; step++) {
      copyAeroState(prev, state)
      const tPrev = t
      stepAeroRk4InPlace(state, aeroParams, dtS, aeroWs)
      t += dtS
      elapsed += dtS

      if (state.z <= 0 && (step > 0 || state.vz < 0)) {
        const alpha = solveGroundImpactFromPrev(
          prev,
          state.z,
          dtS,
          aeroParams,
          aeroWs,
          hitState
        )
        copyAeroState(state, hitState)
        t = Math.max(lastSampleT + 1e-9, tPrev + alpha * dtS)
        rollout += Math.hypot(
          state.x - lastRollSampleX,
          state.y - lastRollSampleY
        )
        lastRollSampleX = state.x
        lastRollSampleY = state.y
        lastSampleT = t
        applyTurfImpactInPlace(
          state,
          env.turfEn,
          env.turfMuR,
          projectile.massKg,
          projectile.radiusM,
          projectile.inertiaKgM2
        )
        bounceCount++
        nextSampleElapsed = elapsed + (elapsed > 15 ? 0.02 : 0.005)
        landed = true
        break
      }

      if (elapsed >= nextSampleElapsed) {
        rollout += Math.hypot(
          state.x - lastRollSampleX,
          state.y - lastRollSampleY
        )
        lastRollSampleX = state.x
        lastRollSampleY = state.y
        lastSampleT = t
        nextSampleElapsed = elapsed + (elapsed > 15 ? 0.02 : 0.005)
      }
    }
    if (!landed) break
  }

  state.z = 0
  state.vz = 0
  const aRoll = env.turfMuR * aeroParams.g
  const scatterSigma = env.turfScatterSigmaRad ?? 0
  const useScatter = scatterSigma > 0 && !env.deterministic

  let dsSinceScatter = 0
  let reachedRest = false
  const maxRollSteps = Math.ceil(MAX_ROLL_TIME_S / dtS)

  for (let step = 0; step < maxRollSteps; step++) {
    const vh = Math.hypot(state.vx, state.vy)
    if (vh <= V_CAPTURE_MPS || vh - aRoll * dtS <= V_CAPTURE_MPS) {
      if (vh > 1e-9) {
        const dtExact = vh / aRoll
        const distStop = 0.5 * vh * dtExact
        state.x += (state.vx / vh) * distStop
        state.y += (state.vy / vh) * distStop
      }
      rollout += Math.hypot(
        state.x - lastRollSampleX,
        state.y - lastRollSampleY
      )
      reachedRest = true
      break
    }

    const ds = stepRollRk4InPlace(state, aRoll, dtS)
    t += dtS
    elapsed += dtS
    dsSinceScatter += ds

    if (useScatter && dsSinceScatter >= 0.1) {
      const sigmaStep = scatterSigma * Math.sqrt(dsSinceScatter / 0.25)
      const rawTheta = sampleNormal(rng, sigmaStep)
      const dTheta = Math.max(-0.35, Math.min(0.35, rawTheta))
      const c = Math.cos(dTheta)
      const sn = Math.sin(dTheta)
      const nvx = state.vx * c - state.vy * sn
      const nvy = state.vx * sn + state.vy * c
      state.vx = nvx
      state.vy = nvy
      dsSinceScatter = 0
    }

    state.wy = state.vx / projectile.radiusM
    state.wx = -state.vy / projectile.radiusM
    state.wz *= Math.max(0, 1 - 3 * env.turfMuR * dtS)

    if (elapsed >= nextSampleElapsed) {
      rollout += Math.hypot(
        state.x - lastRollSampleX,
        state.y - lastRollSampleY
      )
      lastRollSampleX = state.x
      lastRollSampleY = state.y
      lastSampleT = t
      nextSampleElapsed = elapsed + (elapsed > 15 ? 0.02 : 0.005)
    }
  }

  if (!reachedRest) {
    rollout += Math.hypot(state.x - lastRollSampleX, state.y - lastRollSampleY)
  }

  const totalM = Math.hypot(state.x - x0, state.y - y0)
  return {
    restX: state.x,
    restY: state.y,
    carryM,
    rollM: rollout,
    totalM,
  }
}

function quantile(sorted: readonly number[], q: number): number {
  const n = sorted.length
  if (n === 0) return 0
  if (n === 1) return sorted[0]
  const pos = q * (n - 1)
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  const frac = pos - lo
  return sorted[lo] * (1 - frac) + sorted[hi] * frac
}

function computeCep95Ellipse(landings: readonly MonteCarloLanding[]): Cep95Ellipse {
  const n = landings.length
  if (n === 0) {
    return { centerX: 0, centerY: 0, semiMajorM: 0, semiMinorM: 0, angleRad: 0 }
  }
  let sumX = 0
  let sumY = 0
  for (let i = 0; i < n; i++) {
    sumX += landings[i].restX
    sumY += landings[i].restY
  }
  const centerX = sumX / n
  const centerY = sumY / n
  if (n === 1) {
    return { centerX, centerY, semiMajorM: 0, semiMinorM: 0, angleRad: 0 }
  }

  let sxx = 0
  let syy = 0
  let sxy = 0
  for (let i = 0; i < n; i++) {
    const dx = landings[i].restX - centerX
    const dy = landings[i].restY - centerY
    sxx += dx * dx
    syy += dy * dy
    sxy += dx * dy
  }
  const denom = n - 1
  const cxx = sxx / denom
  const cyy = syy / denom
  const cxy = sxy / denom

  const trace = cxx + cyy
  const diff = cxx - cyy
  const disc = Math.hypot(diff, 2 * cxy)
  const lambda1 = Math.max(0, 0.5 * (trace + disc))
  const lambda2 = Math.max(0, 0.5 * (trace - disc))

  const semiMajorM = Math.sqrt(CHI2_2_95 * lambda1)
  const semiMinorM = Math.sqrt(CHI2_2_95 * lambda2)
  const angleRad =
    Math.abs(cxy) <= 1e-18 && Math.abs(diff) <= 1e-18
      ? 0
      : 0.5 * Math.atan2(2 * cxy, diff)

  return {
    centerX,
    centerY,
    semiMajorM,
    semiMinorM,
    angleRad,
  }
}

export function runMonteCarlo(
  request: MonteCarloRequest,
  onProgress?: (completed: number, total: number) => void
): MonteCarloDesignSummary[] {
  const {
    dtS,
    fieldHalfWidthM,
    targetRadiusM,
    timeWindowS,
    activeTarget,
    mcEnv,
  } = validateRequest(request)

  const { models, adjustmentsByModel, rubricConfig, trialsPerModel, baseSeed } =
    request
  const total = models.length * trialsPerModel
  const progressStride = Math.max(1, Math.floor(total / 20))
  const lws = createLeanWorkspace()
  const summaries: MonteCarloDesignSummary[] = []
  let completed = 0

  for (let mIdx = 0; mIdx < models.length; mIdx++) {
    const model = models[mIdx]
    const rawAdj = adjustmentsByModel[model.id] ?? {}
    const adjustments = validateAndClampAdjustments(model, rawAdj)
    const projectile = model.projectile ?? REGULATION_GOLF_BALL
    const aeroParams = buildAeroParams(mcEnv, projectile)

    const landings: MonteCarloLanding[] = new Array(trialsPerModel)
    const scores: number[] = new Array(trialsPerModel)

    let sumScore = 0
    let sumCarry = 0
    let sumRoll = 0
    let sumCycleS = 0
    let missCount = 0
    let oobCount = 0

    for (let tIdx = 0; tIdx < trialsPerModel; tIdx++) {
      const trialSeed = deriveTrialSeed(baseSeed, mIdx, tIdx)
      const rng = createSeededRng(trialSeed)
      const release = solveLaunch(model, adjustments, mcEnv, rng)
      const cycleTimeS = Math.max(1e-3, release.cycleTimeS)
      sumCycleS += cycleTimeS

      const isEjected = release.leftCradle && release.reachable !== false
      let restX = release.posM[0]
      let restY = release.posM[1]
      let carryM = 0
      let rollM = 0
      let totalM = 0

      if (isEjected) {
        const res = simulateFlightAndTurfLean(
          release.posM,
          release.velMps,
          release.omegaBallRadps,
          release.tReleaseS,
          mcEnv,
          dtS,
          aeroParams,
          projectile,
          rng,
          lws
        )
        restX = res.restX
        restY = res.restY
        carryM = res.carryM
        rollM = res.rollM
        totalM = res.totalM
      }

      const isOob = Math.abs(restY) > fieldHalfWidthM
      if (isOob) oobCount++

      let score = 0
      let isMiss = false
      if (rubricConfig.task === 'day1_distance') {
        if (!isEjected || isOob) {
          score = 0
          isMiss = true
        } else {
          score = distancePoints(totalM)
        }
      } else {
        const radialErr = Math.hypot(
          restX - activeTarget.x,
          restY - activeTarget.y
        )
        const isHit = isEjected && !isOob && radialErr <= targetRadiusM
        score = isHit ? 5 : 0
        isMiss = !isHit
      }

      if (isMiss) missCount++
      sumScore += score
      sumCarry += carryM
      sumRoll += rollM

      landings[tIdx] = { restX, restY, carryM, totalM, score }
      scores[tIdx] = score

      completed++
      if (
        onProgress &&
        (completed % progressStride === 0 || completed === total)
      ) {
        onProgress(completed, total)
      }
    }

    scores.sort((a, b) => a - b)
    const meanScore = sumScore / trialsPerModel
    const medianScore = quantile(scores, 0.5)
    const p10Score = quantile(scores, 0.1)
    const p90Score = quantile(scores, 0.9)
    const meanCarry = sumCarry / trialsPerModel
    const meanRoll = sumRoll / trialsPerModel
    const carryToRollRatio =
      meanCarry === 0 && meanRoll === 0
        ? 0
        : meanCarry / Math.max(1e-4, meanRoll)
    const meanCycleTimeS = sumCycleS / trialsPerModel
    const shotsInWindow =
      timeWindowS <= 0 || meanCycleTimeS <= 0
        ? 0
        : Math.floor((timeWindowS + 1e-9) / meanCycleTimeS)
    const missRate = missCount / trialsPerModel
    const oobRate = oobCount / trialsPerModel
    const cep95Ellipse = computeCep95Ellipse(landings)

    summaries.push({
      modelId: model.id,
      meanScore,
      medianScore,
      p10Score,
      p90Score,
      carryToRollRatio,
      shotsInWindow,
      missRate,
      oobRate,
      cep95Ellipse,
      landings,
    })
  }

  return summaries
}
