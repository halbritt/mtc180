import { REGULATION_GOLF_BALL, type ProjectileSpec } from '../models'
import { DEFAULT_DT_S, validateDt, type EnvConfig } from './launch_solver'
import type { Sample } from './telemetry'

export const MAX_FLIGHT_TIME_S = 60

export interface FlightInput {
  posM: [number, number, number]
  velMps: [number, number, number]
  omegaBallRadps: [number, number, number]
  tStartS?: number
}

export interface FlightResult {
  samples: Sample[]
  impactPosM: [number, number, number]
  impactVelMps: [number, number, number]
  omegaAtImpactRadps: [number, number, number]
  tImpactS: number
  carryDistanceM: number
  apexM: number
}

export interface AeroState {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  wx: number
  wy: number
  wz: number
}

export interface AeroParams {
  massKg: number
  radiusM: number
  areaM2: number
  cd: number
  clFactor: number
  spinDecayPerS: number
  rho: number
  g: number
  windX: number
  windY: number
  windZ: number
}

export interface AeroWorkspace {
  k1x: number
  k1y: number
  k1z: number
  k1vx: number
  k1vy: number
  k1vz: number
  k1wx: number
  k1wy: number
  k1wz: number
  k2x: number
  k2y: number
  k2z: number
  k2vx: number
  k2vy: number
  k2vz: number
  k2wx: number
  k2wy: number
  k2wz: number
  k3x: number
  k3y: number
  k3z: number
  k3vx: number
  k3vy: number
  k3vz: number
  k3wx: number
  k3wy: number
  k3wz: number
  k4x: number
  k4y: number
  k4z: number
  k4vx: number
  k4vy: number
  k4vz: number
  k4wx: number
  k4wy: number
  k4wz: number
  dx: number
  dy: number
  dz: number
  dvx: number
  dvy: number
  dvz: number
  dwx: number
  dwy: number
  dwz: number
}

export function createAeroWorkspace(): AeroWorkspace {
  return {
    k1x: 0, k1y: 0, k1z: 0, k1vx: 0, k1vy: 0, k1vz: 0, k1wx: 0, k1wy: 0, k1wz: 0,
    k2x: 0, k2y: 0, k2z: 0, k2vx: 0, k2vy: 0, k2vz: 0, k2wx: 0, k2wy: 0, k2wz: 0,
    k3x: 0, k3y: 0, k3z: 0, k3vx: 0, k3vy: 0, k3vz: 0, k3wx: 0, k3wy: 0, k3wz: 0,
    k4x: 0, k4y: 0, k4z: 0, k4vx: 0, k4vy: 0, k4vz: 0, k4wx: 0, k4wy: 0, k4wz: 0,
    dx: 0, dy: 0, dz: 0, dvx: 0, dvy: 0, dvz: 0, dwx: 0, dwy: 0, dwz: 0,
  }
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

export function buildAeroParams(env: EnvConfig, projectile: ProjectileSpec = REGULATION_GOLF_BALL): AeroParams {
  assertFiniteNum(env.airDensityKgM3, 'env.airDensityKgM3')
  assertFiniteNum(env.gravityMps2, 'env.gravityMps2')
  assertVec3Finite(env.windVecMps, 'env.windVecMps')
  if (env.airDensityKgM3 < 0) {
    throw new RangeError(`env.airDensityKgM3 must be >= 0, got ${env.airDensityKgM3}.`)
  }
  if (env.gravityMps2 <= 0) {
    throw new RangeError(`env.gravityMps2 must be > 0, got ${env.gravityMps2}.`)
  }
  if (env.cdOverride !== undefined) {
    assertFiniteNum(env.cdOverride, 'env.cdOverride')
    if (env.cdOverride < 0) {
      throw new RangeError(`env.cdOverride must be >= 0, got ${env.cdOverride}.`)
    }
  }

  assertFiniteNum(projectile.massKg, 'projectile.massKg')
  assertFiniteNum(projectile.radiusM, 'projectile.radiusM')
  assertFiniteNum(projectile.cd, 'projectile.cd')
  assertFiniteNum(projectile.clFactor, 'projectile.clFactor')
  assertFiniteNum(projectile.spinDecayPerS, 'projectile.spinDecayPerS')
  if (projectile.massKg <= 0) throw new RangeError('projectile.massKg must be > 0.')
  if (projectile.radiusM <= 0) throw new RangeError('projectile.radiusM must be > 0.')
  if (projectile.cd < 0) throw new RangeError('projectile.cd must be >= 0.')
  if (projectile.clFactor < 0) throw new RangeError('projectile.clFactor must be >= 0.')
  if (projectile.spinDecayPerS < 0) throw new RangeError('projectile.spinDecayPerS must be >= 0.')

  const cd =
    env.cdOverride !== undefined
      ? env.cdOverride
      : env.projectile === 'smooth_ball'
        ? 0.47
        : projectile.cd

  return {
    massKg: projectile.massKg,
    radiusM: projectile.radiusM,
    areaM2: Math.PI * projectile.radiusM * projectile.radiusM,
    cd,
    clFactor: projectile.clFactor,
    spinDecayPerS: projectile.spinDecayPerS,
    rho: env.airDensityKgM3,
    g: env.gravityMps2,
    windX: env.windVecMps[0],
    windY: env.windVecMps[1],
    windZ: env.windVecMps[2],
  }
}

function evalAeroDeriv(
  vx: number,
  vy: number,
  vz: number,
  wx: number,
  wy: number,
  wz: number,
  p: AeroParams,
  ws: AeroWorkspace
): void {
  ws.dx = vx
  ws.dy = vy
  ws.dz = vz

  const vrx = vx - p.windX
  const vry = vy - p.windY
  const vrz = vz - p.windZ
  const vRelSq = vrx * vrx + vry * vry + vrz * vrz
  const vRel = Math.sqrt(vRelSq)

  // Quadratic drag without 0/0 division
  const dragScale = (-0.5 * p.rho * p.areaM2 * p.cd * vRel) / p.massKg
  let ax = dragScale * vrx
  let ay = dragScale * vry
  let az = dragScale * vrz - p.g

  // Singularity-free Magnus force: F_M = 0.5 * rho * A * R * C_eff * (omega x v_rel)
  if (vRel > 1e-9 && p.rho > 0 && p.clFactor > 0) {
    const cx = wy * vrz - wz * vry
    const cy = wz * vrx - wx * vrz
    const cz = wx * vry - wy * vrx
    const cMag = Math.sqrt(cx * cx + cy * cy + cz * cz)
    const spinRatio = (cMag * p.radiusM) / vRelSq
    const clEff = p.clFactor / (1 + 0.35 * spinRatio)
    const magnusScale = (0.5 * p.rho * p.areaM2 * p.radiusM * clEff) / p.massKg
    ax += magnusScale * cx
    ay += magnusScale * cy
    az += magnusScale * cz
  }

  ws.dvx = ax
  ws.dvy = ay
  ws.dvz = az

  const decayRate = p.spinDecayPerS * (p.rho / 1.225)
  ws.dwx = -decayRate * wx
  ws.dwy = -decayRate * wy
  ws.dwz = -decayRate * wz
}

export function stepAeroRk4InPlace(
  s: AeroState,
  p: AeroParams,
  dt: number,
  ws: AeroWorkspace
): void {
  const halfDt = 0.5 * dt

  evalAeroDeriv(s.vx, s.vy, s.vz, s.wx, s.wy, s.wz, p, ws)
  ws.k1x = ws.dx
  ws.k1y = ws.dy
  ws.k1z = ws.dz
  ws.k1vx = ws.dvx
  ws.k1vy = ws.dvy
  ws.k1vz = ws.dvz
  ws.k1wx = ws.dwx
  ws.k1wy = ws.dwy
  ws.k1wz = ws.dwz

  evalAeroDeriv(
    s.vx + halfDt * ws.k1vx,
    s.vy + halfDt * ws.k1vy,
    s.vz + halfDt * ws.k1vz,
    s.wx + halfDt * ws.k1wx,
    s.wy + halfDt * ws.k1wy,
    s.wz + halfDt * ws.k1wz,
    p,
    ws
  )
  ws.k2x = ws.dx
  ws.k2y = ws.dy
  ws.k2z = ws.dz
  ws.k2vx = ws.dvx
  ws.k2vy = ws.dvy
  ws.k2vz = ws.dvz
  ws.k2wx = ws.dwx
  ws.k2wy = ws.dwy
  ws.k2wz = ws.dwz

  evalAeroDeriv(
    s.vx + halfDt * ws.k2vx,
    s.vy + halfDt * ws.k2vy,
    s.vz + halfDt * ws.k2vz,
    s.wx + halfDt * ws.k2wx,
    s.wy + halfDt * ws.k2wy,
    s.wz + halfDt * ws.k2wz,
    p,
    ws
  )
  ws.k3x = ws.dx
  ws.k3y = ws.dy
  ws.k3z = ws.dz
  ws.k3vx = ws.dvx
  ws.k3vy = ws.dvy
  ws.k3vz = ws.dvz
  ws.k3wx = ws.dwx
  ws.k3wy = ws.dwy
  ws.k3wz = ws.dwz

  evalAeroDeriv(
    s.vx + dt * ws.k3vx,
    s.vy + dt * ws.k3vy,
    s.vz + dt * ws.k3vz,
    s.wx + dt * ws.k3wx,
    s.wy + dt * ws.k3wy,
    s.wz + dt * ws.k3wz,
    p,
    ws
  )
  ws.k4x = ws.dx
  ws.k4y = ws.dy
  ws.k4z = ws.dz
  ws.k4vx = ws.dvx
  ws.k4vy = ws.dvy
  ws.k4vz = ws.dvz
  ws.k4wx = ws.dwx
  ws.k4wy = ws.dwy
  ws.k4wz = ws.dwz

  const dt6 = dt / 6
  s.x += dt6 * (ws.k1x + 2 * ws.k2x + 2 * ws.k3x + ws.k4x)
  s.y += dt6 * (ws.k1y + 2 * ws.k2y + 2 * ws.k3y + ws.k4y)
  s.z += dt6 * (ws.k1z + 2 * ws.k2z + 2 * ws.k3z + ws.k4z)
  s.vx += dt6 * (ws.k1vx + 2 * ws.k2vx + 2 * ws.k3vx + ws.k4vx)
  s.vy += dt6 * (ws.k1vy + 2 * ws.k2vy + 2 * ws.k3vy + ws.k4vy)
  s.vz += dt6 * (ws.k1vz + 2 * ws.k2vz + 2 * ws.k3vz + ws.k4vz)
  s.wx += dt6 * (ws.k1wx + 2 * ws.k2wx + 2 * ws.k3wx + ws.k4wx)
  s.wy += dt6 * (ws.k1wy + 2 * ws.k2wy + 2 * ws.k3wy + ws.k4wy)
  s.wz += dt6 * (ws.k1wz + 2 * ws.k2wz + 2 * ws.k3wz + ws.k4wz)
}

export function copyAeroState(dst: AeroState, src: AeroState): void {
  dst.x = src.x
  dst.y = src.y
  dst.z = src.z
  dst.vx = src.vx
  dst.vy = src.vy
  dst.vz = src.vz
  dst.wx = src.wx
  dst.wy = src.wy
  dst.wz = src.wz
}

export function solveGroundImpactFromPrev(
  prev: AeroState,
  curZ: number,
  dt: number,
  params: AeroParams,
  ws: AeroWorkspace,
  outState: AeroState
): number {
  const dz = prev.z - curZ
  let alpha = dz > 1e-12 ? prev.z / dz : 1
  if (alpha < 0) alpha = 0
  if (alpha > 1) alpha = 1

  copyAeroState(outState, prev)
  if (alpha > 0) {
    stepAeroRk4InPlace(outState, params, alpha * dt, ws)
  }

  for (let iter = 0; iter < 2; iter++) {
    if (Math.abs(outState.z) <= 1e-9 || Math.abs(outState.vz) <= 1e-9) break
    alpha -= outState.z / (outState.vz * dt)
    if (alpha < 0) alpha = 0
    if (alpha > 1) alpha = 1
    copyAeroState(outState, prev)
    if (alpha > 0) {
      stepAeroRk4InPlace(outState, params, alpha * dt, ws)
    }
  }

  outState.z = 0
  return alpha
}

export function simulateFlight(
  input: FlightInput,
  env: EnvConfig,
  projectile: ProjectileSpec = REGULATION_GOLF_BALL
): FlightResult {
  assertVec3Finite(input.posM, 'input.posM')
  assertVec3Finite(input.velMps, 'input.velMps')
  assertVec3Finite(input.omegaBallRadps, 'input.omegaBallRadps')
  const tStartS = input.tStartS ?? 0
  assertFiniteNum(tStartS, 'input.tStartS')

  const dtS = env.dtS !== undefined ? validateDt(env.dtS) : DEFAULT_DT_S
  const params = buildAeroParams(env, projectile)
  const ws = createAeroWorkspace()

  const x0 = input.posM[0]
  const y0 = input.posM[1]
  const z0 = input.posM[2]

  const state: AeroState = {
    x: x0,
    y: y0,
    z: z0,
    vx: input.velMps[0],
    vy: input.velMps[1],
    vz: input.velMps[2],
    wx: input.omegaBallRadps[0],
    wy: input.omegaBallRadps[1],
    wz: input.omegaBallRadps[2],
  }

  const samples: Sample[] = [{ t: tStartS, x: x0, y: y0, z: z0 }]
  let apexM = Math.max(0, z0)

  if (z0 <= 0 && state.vz <= 0) {
    const tImpactS = tStartS + 1e-6
    samples.push({ t: tImpactS, x: x0, y: y0, z: 0, event: 'contact' })
    return {
      samples,
      impactPosM: [x0, y0, 0],
      impactVelMps: [state.vx, state.vy, state.vz],
      omegaAtImpactRadps: [state.wx, state.wy, state.wz],
      tImpactS,
      carryDistanceM: 0,
      apexM,
    }
  }

  const prev: AeroState = { ...state }
  const hitState: AeroState = { ...state }
  const midState: AeroState = { ...state }

  let elapsedS = 0
  let nextSampleElapsedS = 0.005
  const maxSteps = Math.ceil(MAX_FLIGHT_TIME_S / dtS)

  for (let step = 0; step < maxSteps; step++) {
    copyAeroState(prev, state)
    const tPrev = tStartS + elapsedS
    stepAeroRk4InPlace(state, params, dtS, ws)
    elapsedS += dtS

    if (prev.vz > 0 && state.vz <= 0) {
      copyAeroState(midState, prev)
      const alphaApex = prev.vz / (prev.vz - state.vz)
      stepAeroRk4InPlace(midState, params, alphaApex * dtS, ws)
      if (midState.z > apexM) apexM = midState.z
    }
    if (state.z > apexM) apexM = state.z

    if (state.z <= 0 && (step > 0 || state.vz < 0)) {
      const alpha = solveGroundImpactFromPrev(prev, state.z, dtS, params, ws, hitState)
      const rawImpactT = tPrev + alpha * dtS
      const lastSampleT = samples[samples.length - 1].t
      const tImpactS = rawImpactT > lastSampleT + 1e-12 ? rawImpactT : lastSampleT + 1e-9
      samples.push({
        t: tImpactS,
        x: hitState.x,
        y: hitState.y,
        z: 0,
        event: 'contact',
      })
      return {
        samples,
        impactPosM: [hitState.x, hitState.y, 0],
        impactVelMps: [hitState.vx, hitState.vy, hitState.vz],
        omegaAtImpactRadps: [hitState.wx, hitState.wy, hitState.wz],
        tImpactS,
        carryDistanceM: Math.hypot(hitState.x - x0, hitState.y - y0),
        apexM,
      }
    }

    if (elapsedS >= nextSampleElapsedS) {
      samples.push({
        t: tStartS + elapsedS,
        x: state.x,
        y: state.y,
        z: state.z,
      })
      const cadence = elapsedS > 15 ? 0.02 : 0.005
      nextSampleElapsedS = elapsedS + cadence
    }
  }

  const tCap = tStartS + Math.min(elapsedS, MAX_FLIGHT_TIME_S)
  const lastT = samples[samples.length - 1].t
  const tImpactS = tCap > lastT + 1e-12 ? tCap : lastT + 1e-9
  const clampedZ = Math.max(0, state.z)
  samples.push({
    t: tImpactS,
    x: state.x,
    y: state.y,
    z: clampedZ,
    event: 'contact',
  })
  return {
    samples,
    impactPosM: [state.x, state.y, clampedZ],
    impactVelMps: [state.vx, state.vy, state.vz],
    omegaAtImpactRadps: [state.wx, state.wy, state.wz],
    tImpactS,
    carryDistanceM: Math.hypot(state.x - x0, state.y - y0),
    apexM,
  }
}
