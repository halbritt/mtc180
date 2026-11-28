import { REGULATION_GOLF_BALL, type ProjectileSpec } from '../models'
import {
  buildAeroParams,
  copyAeroState,
  createAeroWorkspace,
  solveGroundImpactFromPrev,
  stepAeroRk4InPlace,
  type AeroState,
} from './aero'
import { DEFAULT_DT_S, validateDt, type EnvConfig } from './launch_solver'
import type { Sample } from './telemetry'

const MAX_BOUNCES = 32
const MAX_ROLL_TIME_S = 60
const V_BOUNCE_MIN_MPS = 0.12
const V_CAPTURE_MPS = 0.03

export interface TurfParamsInput {
  en: number
  muR: number
  scatterSigmaRad?: number
}

export interface TurfInput {
  posM: [number, number, number]
  velMps: [number, number, number]
  omegaBallRadps: [number, number, number]
  tStartS: number
}

export interface TurfResult {
  samples: Sample[]
  bouncePoints: Array<{ t: number; x: number; y: number; z: number }>
  rollDistanceM: number
  restPosM: [number, number, number]
  tRestS: number
  postBounceVelMps: [number, number, number]
  postBounceOmegaRadps: [number, number, number]
  tangentialSpeedLossRatio: number
}

function assertFiniteNum(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite, got ${String(value)}.`)
  }
  return value
}

function assertVec3Finite(vec: readonly [number, number, number], label: string): void {
  if (!Array.isArray(vec) || vec.length !== 3) {
    throw new TypeError(`${label} must be a 3-element vector.`)
  }
  assertFiniteNum(vec[0], `${label}[0]`)
  assertFiniteNum(vec[1], `${label}[1]`)
  assertFiniteNum(vec[2], `${label}[2]`)
}

export function validateTurfParams(params: TurfParamsInput): void {
  assertFiniteNum(params.en, 'turfEn')
  assertFiniteNum(params.muR, 'turfMuR')
  if (params.en < 0 || params.en > 1) {
    throw new RangeError(`turfEn must be in [0, 1], got ${params.en}.`)
  }
  if (params.muR <= 0) {
    throw new RangeError(`turfMuR must be > 0, got ${params.muR}.`)
  }
  if (params.scatterSigmaRad !== undefined) {
    assertFiniteNum(params.scatterSigmaRad, 'turfScatterSigmaRad')
    if (params.scatterSigmaRad < 0) {
      throw new RangeError(
        `turfScatterSigmaRad must be >= 0, got ${params.scatterSigmaRad}.`
      )
    }
  }
}

function sampleNormal(rng: () => number, sigma: number): number {
  if (sigma <= 0) return 0
  const u1 = Math.max(1e-12, Math.min(1 - 1e-12, rng()))
  const u2 = rng()
  return sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

function applyTurfImpact(
  s: AeroState,
  turfEn: number,
  turfMuR: number,
  massKg: number,
  radiusM: number,
  inertiaKgM2: number
): number {
  const vxBefore = s.vx
  const vyBefore = s.vy
  const vtBefore = Math.hypot(vxBefore, vyBefore)
  const vn = -s.vz

  if (vn <= 0) {
    s.vz = 0
    s.z = 0
    return 0
  }

  const impactAngle = Math.atan2(vn, vtBefore)
  const enEff =
    turfEn <= 0 || vn <= V_BOUNCE_MIN_MPS
      ? 0
      : turfEn *
        (1 - 0.12 * Math.min(1, vn / 12)) *
        (0.85 + 0.15 * Math.cos(impactAngle))

  const vzPost = enEff > 0 ? enEff * vn : 0

  // Rigid-sphere Coulomb tangential impulse coupling velocity and spin at contact (0, 0, -R)
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

  // Angle- and softness-dependent turf crater bite damping
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

  const vtAfter = Math.hypot(vxPost, vyPost)
  if (vtBefore <= 1e-9) return 0
  return Math.max(0, Math.min(1, 1 - vtAfter / vtBefore))
}

function stepRollRk4InPlace(
  s: AeroState,
  aRoll: number,
  dt: number
): number {
  const vx0 = s.vx
  const vy0 = s.vy
  const v0 = Math.hypot(vx0, vy0)
  if (v0 <= 1e-12) return 0

  const k1x = vx0
  const k1y = vy0
  const k1vx = (-aRoll * vx0) / v0
  const k1vy = (-aRoll * vy0) / v0

  const halfDt = 0.5 * dt
  const vx2 = vx0 + halfDt * k1vx
  const vy2 = vy0 + halfDt * k1vy
  const v2 = Math.hypot(vx2, vy2)
  const k2x = vx2
  const k2y = vy2
  const k2vx = v2 > 1e-12 ? (-aRoll * vx2) / v2 : 0
  const k2vy = v2 > 1e-12 ? (-aRoll * vy2) / v2 : 0

  const vx3 = vx0 + halfDt * k2vx
  const vy3 = vy0 + halfDt * k2vy
  const v3 = Math.hypot(vx3, vy3)
  const k3x = vx3
  const k3y = vy3
  const k3vx = v3 > 1e-12 ? (-aRoll * vx3) / v3 : 0
  const k3vy = v3 > 1e-12 ? (-aRoll * vy3) / v3 : 0

  const vx4 = vx0 + dt * k3vx
  const vy4 = vy0 + dt * k3vy
  const v4 = Math.hypot(vx4, vy4)
  const k4x = vx4
  const k4y = vy4
  const k4vx = v4 > 1e-12 ? (-aRoll * vx4) / v4 : 0
  const k4vy = v4 > 1e-12 ? (-aRoll * vy4) / v4 : 0

  const dt6 = dt / 6
  const dx = dt6 * (k1x + 2 * k2x + 2 * k3x + k4x)
  const dy = dt6 * (k1y + 2 * k2y + 2 * k3y + k4y)
  s.x += dx
  s.y += dy
  s.vx = vx0 + dt6 * (k1vx + 2 * k2vx + 2 * k3vx + k4vx)
  s.vy = vy0 + dt6 * (k1vy + 2 * k2vy + 2 * k3vy + k4vy)
  return Math.hypot(dx, dy)
}

export function simulateTurf(
  input: TurfInput,
  env: EnvConfig,
  rng?: () => number,
  projectile: ProjectileSpec = REGULATION_GOLF_BALL
): TurfResult {
  assertVec3Finite(input.posM, 'input.posM')
  assertVec3Finite(input.velMps, 'input.velMps')
  assertVec3Finite(input.omegaBallRadps, 'input.omegaBallRadps')
  assertFiniteNum(input.tStartS, 'input.tStartS')

  validateTurfParams({
    en: env.turfEn,
    muR: env.turfMuR,
    scatterSigmaRad: env.turfScatterSigmaRad,
  })
  const dtS = env.dtS !== undefined ? validateDt(env.dtS) : DEFAULT_DT_S
  const aeroParams = buildAeroParams(env, projectile)
  const ws = createAeroWorkspace()

  const state: AeroState = {
    x: input.posM[0],
    y: input.posM[1],
    z: input.posM[2],
    vx: input.velMps[0],
    vy: input.velMps[1],
    vz: input.velMps[2],
    wx: input.omegaBallRadps[0],
    wy: input.omegaBallRadps[1],
    wz: input.omegaBallRadps[2],
  }

  const prev: AeroState = { ...state }
  const hitState: AeroState = { ...state }
  const samples: Sample[] = []
  const bouncePoints: Array<{ t: number; x: number; y: number; z: number }> = []

  let t = input.tStartS
  let elapsed = 0
  let nextSampleElapsed = 0.005

  // If invoked above ground (posM[2] > 0), integrate down to z = 0 first
  if (state.z > 1e-6) {
    samples.push({ t, x: state.x, y: state.y, z: state.z })
    const maxDropSteps = Math.ceil(60 / dtS)
    for (let step = 0; step < maxDropSteps; step++) {
      copyAeroState(prev, state)
      const tPrev = t
      stepAeroRk4InPlace(state, aeroParams, dtS, ws)
      t += dtS
      elapsed += dtS
      if (state.z <= 0) {
        const alpha = solveGroundImpactFromPrev(
          prev,
          state.z,
          dtS,
          aeroParams,
          ws,
          hitState
        )
        copyAeroState(state, hitState)
        t = Math.max(samples[samples.length - 1].t + 1e-9, tPrev + alpha * dtS)
        break
      }
      if (elapsed >= nextSampleElapsed) {
        samples.push({ t, x: state.x, y: state.y, z: state.z })
        nextSampleElapsed = elapsed + (elapsed > 15 ? 0.02 : 0.005)
      }
    }
    state.z = 0
  }

  // First ground impact at z = 0
  const contactT =
    samples.length > 0 ? Math.max(t, samples[samples.length - 1].t + 1e-9) : t
  t = contactT
  samples.push({ t, x: state.x, y: state.y, z: 0, event: 'contact' })
  bouncePoints.push({ t, x: state.x, y: state.y, z: 0 })

  const tangentialSpeedLossRatio = applyTurfImpact(
    state,
    env.turfEn,
    env.turfMuR,
    projectile.massKg,
    projectile.radiusM,
    projectile.inertiaKgM2
  )
  const postBounceVelMps: [number, number, number] = [state.vx, state.vy, state.vz]
  const postBounceOmegaRadps: [number, number, number] = [
    state.wx,
    state.wy,
    state.wz,
  ]

  // Multi-bounce aerial hops
  let bounceCount = 1
  nextSampleElapsed = elapsed + 0.005
  while (state.vz > 0 && bounceCount < MAX_BOUNCES) {
    const maxHopSteps = Math.ceil(30 / dtS)
    let landed = false
    for (let step = 0; step < maxHopSteps; step++) {
      copyAeroState(prev, state)
      const tPrev = t
      stepAeroRk4InPlace(state, aeroParams, dtS, ws)
      t += dtS
      elapsed += dtS

      if (state.z <= 0 && (step > 0 || state.vz < 0)) {
        const alpha = solveGroundImpactFromPrev(
          prev,
          state.z,
          dtS,
          aeroParams,
          ws,
          hitState
        )
        copyAeroState(state, hitState)
        const lastT = samples[samples.length - 1].t
        t = Math.max(lastT + 1e-9, tPrev + alpha * dtS)
        samples.push({ t, x: state.x, y: state.y, z: 0, event: 'contact' })
        bouncePoints.push({ t, x: state.x, y: state.y, z: 0 })
        applyTurfImpact(
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
        samples.push({ t, x: state.x, y: state.y, z: state.z })
        nextSampleElapsed = elapsed + (elapsed > 15 ? 0.02 : 0.005)
      }
    }
    if (!landed) break
  }

  // Transition to grass rollout on z = 0
  state.z = 0
  state.vz = 0
  const aRoll = env.turfMuR * aeroParams.g
  const scatterSigma = env.turfScatterSigmaRad ?? 0
  const useScatter =
    scatterSigma > 0 && !env.deterministic && typeof rng === 'function'

  let dsSinceScatter = 0
  let reachedRest = false
  const maxRollSteps = Math.ceil(MAX_ROLL_TIME_S / dtS)

  for (let step = 0; step < maxRollSteps; step++) {
    const vh = Math.hypot(state.vx, state.vy)
    if (vh <= V_CAPTURE_MPS || vh - aRoll * dtS <= V_CAPTURE_MPS) {
      let dtStop = 1e-5
      if (vh > 1e-9) {
        const dtExact = vh / aRoll
        const distStop = 0.5 * vh * dtExact
        state.x += (state.vx / vh) * distStop
        state.y += (state.vy / vh) * distStop
        dtStop = Math.max(1e-5, dtExact)
      }
      const lastT = samples[samples.length - 1].t
      t = Math.max(lastT + 1e-6, t + dtStop)
      state.vx = 0
      state.vy = 0
      state.vz = 0
      state.wx = 0
      state.wy = 0
      state.wz = 0
      samples.push({ t, x: state.x, y: state.y, z: 0, event: 'rest' })
      reachedRest = true
      break
    }

    const ds = stepRollRk4InPlace(state, aRoll, dtS)
    t += dtS
    elapsed += dtS
    dsSinceScatter += ds

    if (useScatter && dsSinceScatter >= 0.1) {
      const sigmaStep = scatterSigma * Math.sqrt(dsSinceScatter / 0.25)
      const rawTheta = sampleNormal(rng!, sigmaStep)
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
      samples.push({ t, x: state.x, y: state.y, z: 0 })
      nextSampleElapsed = elapsed + (elapsed > 15 ? 0.02 : 0.005)
    }
  }

  if (!reachedRest) {
    const lastT = samples[samples.length - 1].t
    t = Math.max(lastT + 1e-6, t + dtS)
    state.vx = 0
    state.vy = 0
    state.vz = 0
    state.wx = 0
    state.wy = 0
    state.wz = 0
    samples.push({ t, x: state.x, y: state.y, z: 0, event: 'rest' })
  }

  let rollDistanceM = 0
  let seenContact = false
  for (let i = 0; i < samples.length; i++) {
    if (seenContact && i > 0) {
      rollDistanceM += Math.hypot(
        samples[i].x - samples[i - 1].x,
        samples[i].y - samples[i - 1].y
      )
    }
    if (samples[i].event === 'contact') seenContact = true
  }

  return {
    samples,
    bouncePoints,
    rollDistanceM,
    restPosM: [state.x, state.y, 0],
    tRestS: t,
    postBounceVelMps,
    postBounceOmegaRadps,
    tangentialSpeedLossRatio,
  }
}
