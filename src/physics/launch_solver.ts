import {
  validateAndClampAdjustments,
  type AdjustmentValues,
  type LauncherModel,
} from '../models'
import {
  bailSide,
  buildCordLinkageTable,
  computeDirectCupConfig,
  computeDirectRailConfig,
  computeInclinedRampConfig,
  computeTiltedCradleConfig,
  computeTrebuchetConfig,
} from './linkage'
import {
  createTorsionSpringSpec,
  instantaneousSpringTorque,
  sampleSpringBankEnergy,
  springTorque,
  springWork,
  type TorsionSpringSpec,
} from './spring'

const DEG_TO_RAD = Math.PI / 180
const RAD_TO_DEG = 180 / Math.PI
export const DEFAULT_DT_S = 0.00025
export const MAX_DT_S = 0.0005
const MAX_SIM_TIME_S = 0.5

export interface EnvConfig {
  nominalEnergyJ: number
  energyVarianceJ: number
  energyDistribution?: 'uniform' | 'gaussian'
  turfEn: number
  turfMuR: number
  turfScatterSigmaRad?: number
  windVecMps: [number, number, number]
  airDensityKgM3: number
  projectile: 'golf_ball' | 'smooth_ball'
  cdOverride?: number
  gravityMps2: number
  dtS?: number
  deterministic?: boolean
}

export interface EnergyBudget {
  springInitialJ: number
  keTransBallJ: number
  keRotBallJ: number
  keRotArmBailsJ: number
  peGravityDeltaJ: number
  frictionLossJ: number
}

export interface ArmTraceSample {
  t: number
  psiDeg: number
  thDeg: number
  omegaArm: number
}

export interface LaunchReleaseState {
  tReleaseS: number
  posM: [number, number, number]
  velMps: [number, number, number]
  omegaBallRadps: [number, number, number]
  energyBudget: EnergyBudget
  wastedStopKeJ: number
  leftCradle: boolean
  launchSpeedMps: number
  launchAngleDeg: number
  armTraceSamples: ArmTraceSample[]
  cycleTimeS: number
  cockedBallBottomHeightM: number
  cordSlackAtDeg?: number | null
  peakCordTensionN?: number
  reachable?: boolean
  springTotalStoredJ?: number
  springResidualPeJ?: number
}

export interface SolveLaunchOptions {
  includeBallRotInertiaInCup?: boolean
  deterministic?: boolean
}

function assertFinite(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite, got ${String(value)}.`)
  }
  return value
}

export function validateDt(dtS: number): number {
  assertFinite(dtS, 'dtS')
  if (dtS <= 0 || dtS > MAX_DT_S) {
    throw new RangeError(
      `dtS must be in (0, ${MAX_DT_S}] s for RK4 stability, got ${dtS}.`
    )
  }
  return dtS
}

function sampleNormal(rng: () => number, sigma: number): number {
  if (sigma <= 0) return 0
  const u1 = Math.max(1e-12, Math.min(1 - 1e-12, rng()))
  const u2 = rng()
  return sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

function computeCycleTimeS(
  model: LauncherModel,
  rng: () => number,
  deterministic: boolean
): number {
  const ct = model.cycleTiming
  const base =
    ct.cockPerTrapS * model.trapBank.count + ct.loadS + ct.aimAdjustS
  if (deterministic || ct.humanSigmaS <= 0) return Math.max(0, base)
  return Math.max(0, base + sampleNormal(rng, ct.humanSigmaS))
}

function rotateSagittalToWorld(
  xSag: number,
  zSag: number,
  yawRad: number
): [number, number, number] {
  const c = Math.cos(yawRad)
  const s = Math.sin(yawRad)
  return [xSag * c, xSag * s, zSag]
}

function rotateSpinToWorld(
  wySag: number,
  yawRad: number
): [number, number, number] {
  const c = Math.cos(yawRad)
  const s = Math.sin(yawRad)
  return [-wySag * s, wySag * c, 0]
}

function computeLaunchAngleDeg(velMps: readonly [number, number, number]): number {
  const vHoriz = Math.hypot(velMps[0], velMps[1])
  const vz = velMps[2]
  if (vHoriz === 0 && vz === 0) return 0
  return Math.atan2(vz, vHoriz) * RAD_TO_DEG
}

function getEffectiveBearingFrictionNm(model: LauncherModel): number {
  const lk = model.linkage as { bearingFrictionCoeff?: number }
  if (typeof lk.bearingFrictionCoeff === 'number') {
    assertFinite(lk.bearingFrictionCoeff, 'linkage.bearingFrictionCoeff')
    if (lk.bearingFrictionCoeff < 0) {
      throw new RangeError('linkage.bearingFrictionCoeff must be >= 0.')
    }
    return lk.bearingFrictionCoeff
  }
  return model.trapBank.bearingFrictionNm
}

function validateModelAndEnv(
  model: LauncherModel,
  env: EnvConfig,
  rng: () => number
): number {
  if (typeof rng !== 'function') {
    throw new TypeError('rng must be a function returning [0, 1).')
  }
  assertFinite(env.nominalEnergyJ, 'env.nominalEnergyJ')
  assertFinite(env.energyVarianceJ, 'env.energyVarianceJ')
  assertFinite(env.gravityMps2, 'env.gravityMps2')
  assertFinite(env.airDensityKgM3, 'env.airDensityKgM3')
  if (env.nominalEnergyJ < 0) throw new RangeError('env.nominalEnergyJ >= 0 required.')
  if (env.energyVarianceJ < 0) throw new RangeError('env.energyVarianceJ >= 0 required.')
  if (env.gravityMps2 <= 0) throw new RangeError('env.gravityMps2 > 0 required.')
  if (env.airDensityKgM3 < 0) throw new RangeError('env.airDensityKgM3 >= 0 required.')

  const dtS = env.dtS !== undefined ? validateDt(env.dtS) : DEFAULT_DT_S

  assertFinite(model.arm.massKg, 'model.arm.massKg')
  assertFinite(model.arm.inertiaKgM2, 'model.arm.inertiaKgM2')
  assertFinite(model.arm.lengthBallM, 'model.arm.lengthBallM')
  assertFinite(model.projectile.massKg, 'model.projectile.massKg')
  assertFinite(model.projectile.radiusM, 'model.projectile.radiusM')
  assertFinite(model.projectile.inertiaKgM2, 'model.projectile.inertiaKgM2')
  assertFinite(model.trapBank.bailInertiaKgM2, 'model.trapBank.bailInertiaKgM2')
  assertFinite(model.trapBank.torqueRatio, 'model.trapBank.torqueRatio')

  if (model.arm.massKg <= 0) throw new RangeError('model.arm.massKg must be > 0.')
  if (model.arm.inertiaKgM2 <= 0) throw new RangeError('model.arm.inertiaKgM2 must be > 0.')
  if (model.arm.lengthBallM <= 0) throw new RangeError('model.arm.lengthBallM must be > 0.')
  if (model.projectile.massKg <= 0) throw new RangeError('model.projectile.massKg must be > 0.')
  if (model.projectile.radiusM <= 0) throw new RangeError('model.projectile.radiusM must be > 0.')
  if (model.projectile.inertiaKgM2 <= 0) throw new RangeError('model.projectile.inertiaKgM2 must be > 0.')
  if (!Number.isSafeInteger(model.trapBank.count) || model.trapBank.count < 0) {
    throw new RangeError('model.trapBank.count must be a non-negative integer.')
  }
  if (model.trapBank.bailInertiaKgM2 < 0) {
    throw new RangeError('model.trapBank.bailInertiaKgM2 must be >= 0.')
  }
  if (model.trapBank.count > 0 && model.trapBank.bailInertiaKgM2 <= 0) {
    throw new RangeError('model.trapBank.bailInertiaKgM2 must be > 0 when count > 0.')
  }
  if (model.trapBank.torqueRatio < 0 || model.trapBank.torqueRatio > 1) {
    throw new RangeError('model.trapBank.torqueRatio must be in [0, 1].')
  }

  return dtS
}

function solveCordLinkageLaunch(
  model: LauncherModel,
  adj: AdjustmentValues,
  spring: TorsionSpringSpec,
  env: EnvConfig,
  dtS: number,
  cycleTimeS: number,
  cockJitterDeg: number,
  seatingJitterM: number,
  yawRad: number,
  stopJitterDeg: number,
  includeBallRot: boolean
): LaunchReleaseState {
  const lk = model.linkage
  if (lk.kind !== 'cord_horn' && lk.kind !== 'circular_cam') {
    throw new Error('Expected cord_horn or circular_cam linkage.')
  }
  const g = env.gravityMps2
  const mBall = model.projectile.massKg
  const iBallRot = includeBallRot ? model.projectile.inertiaKgM2 : 0
  const mArm = model.arm.massKg
  const iBail = model.trapBank.bailInertiaKgM2
  const bailMx = model.trapBank.bailMassXKgM
  const tauBearing = getEffectiveBearingFrictionNm(model)
  const thRestDeg = model.trapBank.thRestDeg

  const oxNomM = model.arm.ballOffsetArmMm[0] * 1e-3
  const ozNomM = model.arm.ballOffsetArmMm[1] * 1e-3
  const rNom = Math.hypot(oxNomM, ozNomM)
  const rBallM = Math.max(0.03, rNom + seatingJitterM)
  const scale = rNom > 0 ? rBallM / rNom : 1
  const oxM = oxNomM * scale
  const ozM = ozNomM * scale
  const cgxM = model.arm.cgArmMm[0] * 1e-3
  const cgzM = model.arm.cgArmMm[1] * 1e-3
  const pxM = model.arm.pivotPosMm[0] * 1e-3
  const pzM = model.arm.pivotPosMm[1] * 1e-3

  const iArmBall = model.arm.inertiaKgM2 + mBall * rBallM * rBallM + iBallRot

  const notchIdx = Math.max(
    0,
    Math.min(lk.notchPsisDeg.length - 1, Math.round(adj.notch ?? lk.notchPsisDeg.length) - 1)
  )
  const psiNominalCock = lk.notchPsisDeg[notchIdx]
  const launchDeg = adj.launchDeg ?? 42
  const psiStopDeg = 90 - launchDeg + stopJitterDeg

  // Apply cocking jitter while keeping cord cockable if nominal notch was reachable
  let psiCockDeg = psiNominalCock + cockJitterDeg
  let table = buildCordLinkageTable(model, psiCockDeg, psiStopDeg)
  if (!table.reachable && cockJitterDeg !== 0) {
    const nomTable = buildCordLinkageTable(model, psiNominalCock, psiStopDeg)
    if (nomTable.reachable) {
      psiCockDeg = psiNominalCock
      table = nomTable
    }
  }

  const cockedBallPos = (psiDeg: number) => {
    const rad = psiDeg * DEG_TO_RAD
    const c = Math.cos(rad)
    const s = Math.sin(rad)
    return {
      x: pxM + oxM * c + ozM * s,
      z: pzM - oxM * s + ozM * c,
    }
  }
  const initBallPos = cockedBallPos(psiCockDeg)
  const cockedBallBottomHeightM = initBallPos.z - model.projectile.radiusM

  if (!table.reachable || table.psisDeg.length < 2 || psiStopDeg <= psiCockDeg) {
    const blockedByStop = table.reachable && psiStopDeg <= psiCockDeg
    return {
      tReleaseS: 0,
      posM: rotateSagittalToWorld(initBallPos.x, initBallPos.z, yawRad),
      velMps: [0, 0, 0],
      omegaBallRadps: [0, 0, 0],
      energyBudget: {
        springInitialJ: 0,
        keTransBallJ: 0,
        keRotBallJ: 0,
        keRotArmBailsJ: 0,
        peGravityDeltaJ: 0,
        frictionLossJ: 0,
      },
      wastedStopKeJ: 0,
      leftCradle: false,
      launchSpeedMps: 0,
      launchAngleDeg: blockedByStop ? launchDeg : 0,
      armTraceSamples: [
        {
          t: 0,
          psiDeg: psiCockDeg,
          thDeg: blockedByStop ? table.thCockDeg : model.trapBank.thCockMaxDeg,
          omegaArm: 0,
        },
      ],
      cycleTimeS,
      cockedBallBottomHeightM,
      cordSlackAtDeg: null,
      peakCordTensionN: 0,
      reachable: false,
      springTotalStoredJ: 0,
      springResidualPeJ: 0,
    }
  }

  const gravArmTorque = (psiDeg: number) => {
    const rad = psiDeg * DEG_TO_RAD
    const c = Math.cos(rad)
    const s = Math.sin(rad)
    return (
      g *
      (mBall * (-oxM * c - ozM * s) + mArm * (-cgxM * c - cgzM * s))
    )
  }

  const zArmCg = (psiDeg: number) => {
    const rad = psiDeg * DEG_TO_RAD
    return pzM - cgxM * Math.sin(rad) + cgzM * Math.cos(rad)
  }

  const totalPe = (psiDeg: number, thDeg: number) => {
    const bp = cockedBallPos(psiDeg)
    return (
      mBall * g * bp.z +
      mArm * g * zArmCg(psiDeg) +
      bailMx * g * Math.sin(thDeg * DEG_TO_RAD)
    )
  }

  const peStart = totalPe(psiCockDeg, table.thCockDeg)
  const thCockDeg = table.thCockDeg
  let psi = psiCockDeg
  let w = 0
  let th = thCockDeg
  let wb = 0
  let t = 0
  let taut = true
  let cordSlackAtDeg: number | null = null
  let peakCordTensionN = 0
  let frictionLossJ = 0
  let leftCradle = false
  let stalled = false

  const samples: ArmTraceSample[] = [{ t: 0, psiDeg: psi, thDeg: th, omegaArm: 0 }]

  const evalTautRhs = (psiVal: number, wVal: number) => {
    const ev = table.evalAtPsi(psiVal)
    const h1 = ev.inRange ? ev.h1 : table.h1[table.h1.length - 1]
    const h2 = ev.inRange ? ev.h2 : table.h2[table.h2.length - 1]
    const thVal = ev.inRange ? ev.thDeg : thRestDeg
    const tq = instantaneousSpringTorque(spring, thVal)
    const bailGrav = bailMx * g * Math.cos(thVal * DEG_TO_RAD)
    // Net driving torque on psi before friction
    const tauDrive =
      tq * -h1 -
      gravArmTorque(psiVal) +
      bailGrav * -h1 -
      iBail * h1 * h2 * wVal * wVal
    const fricMag = tauBearing * (1 + Math.abs(h1))
    const iEff = iArmBall + iBail * h1 * h1
    let acc: number
    let pFric: number
    if (Math.abs(wVal) < 1e-9 && tauDrive <= fricMag) {
      acc = 0
      pFric = 0
    } else {
      const sgn = wVal >= 0 ? 1 : -1
      acc = (tauDrive - fricMag * sgn) / iEff
      pFric = fricMag * Math.abs(wVal)
    }
    return { acc, pFric, h1, h2, thVal, levBMm: ev.levBMm, tq, bailGrav }
  }

  const maxSteps = Math.ceil(MAX_SIM_TIME_S / dtS) + 2
  for (let step = 0; step < maxSteps; step++) {
    if (psi >= psiStopDeg) break

    const psiPrev = psi
    const wPrev = w
    const thPrev = th
    const wbPrev = wb
    const tPrev = t
    const fricPrev = frictionLossJ

    let slackStepArmFric = 0
    let slackStepBailFric = 0
    let slackBailHitAlpha = 2
    let slackBailImpactLoss = 0
    let usedSlackStep = false
    let stepBailAtFrac: ((frac: number) => { th1: number; wb1: number; dFricB: number }) | null = null

    if (taut && psi < table.psiEndDeg && th > thRestDeg) {
      const r0 = evalTautRhs(psi, w)
      // Check static stall at start
      if (w === 0 && r0.acc <= 0) {
        stalled = true
        break
      }
      // Check slack condition (cord would have to push)
      const grav0 = gravArmTorque(psi)
      const fricArm0 = tauBearing * (w >= 0 ? 1 : -1)
      if (iArmBall * r0.acc + grav0 + fricArm0 <= 0 && w > 1.0) {
        taut = false
        if (cordSlackAtDeg === null) cordSlackAtDeg = th
        continue
      }
      const levBM = Math.max(1e-4, r0.levBMm * 1e-3)
      const tension =
        (r0.tq +
          r0.bailGrav +
          iBail * (r0.h1 * r0.acc + r0.h2 * w * w) -
          tauBearing * (w >= 0 ? 1 : -1)) /
        levBM
      if (tension > peakCordTensionN) peakCordTensionN = tension

      // Normal-force drop-off check on zero-lip V-cup
      const psiRad0 = psi * DEG_TO_RAD
      const etZ0 = (-oxM * Math.cos(psiRad0) - ozM * Math.sin(psiRad0)) / rBallM
      const normalForce0 = mBall * (rBallM * r0.acc + g * etZ0)
      if (w > 1.0 && normalForce0 < 0) {
        leftCradle = true
        break
      }

      // RK4 step on (psi, w)
      const k1p = w * RAD_TO_DEG
      const k1w = r0.acc
      const k1f = r0.pFric

      const p2 = psi + 0.5 * dtS * k1p
      const w2 = w + 0.5 * dtS * k1w
      const r2 = evalTautRhs(p2, w2)
      const k2p = w2 * RAD_TO_DEG
      const k2w = r2.acc
      const k2f = r2.pFric

      const p3 = psi + 0.5 * dtS * k2p
      const w3 = w + 0.5 * dtS * k2w
      const r3 = evalTautRhs(p3, w3)
      const k3p = w3 * RAD_TO_DEG
      const k3w = r3.acc
      const k3f = r3.pFric

      const p4 = psi + dtS * k3p
      const w4 = w + dtS * k3w
      const r4 = evalTautRhs(p4, w4)
      const k4p = w4 * RAD_TO_DEG
      const k4w = r4.acc
      const k4f = r4.pFric

      psi += (dtS / 6) * (k1p + 2 * k2p + 2 * k3p + k4p)
      w += (dtS / 6) * (k1w + 2 * k2w + 2 * k3w + k4w)
      frictionLossJ += (dtS / 6) * (k1f + 2 * k2f + 2 * k3f + k4f)
      t += dtS

      const evNext = table.evalAtPsi(psi)
      if (evNext.inRange) {
        th = evNext.thDeg
        wb = evNext.h1 * w
      } else {
        taut = false
        if (cordSlackAtDeg === null) cordSlackAtDeg = thPrev
        const h1End = table.h1[table.h1.length - 1]
        th = Math.max(thRestDeg, table.thOfPsiDeg[table.thOfPsiDeg.length - 1])
        wb = h1End * w
        if (th <= thRestDeg) {
          th = thRestDeg
          frictionLossJ += 0.5 * iBail * wb * wb
          wb = 0
        }
      }
    } else {
      usedSlackStep = true
      if (taut) {
        taut = false
        if (cordSlackAtDeg === null) cordSlackAtDeg = th
      }
      const evalArmSlackRhs = (pVal: number, wVal: number) => {
        const gravA = gravArmTorque(pVal)
        const fricA = Math.abs(wVal) > 1e-9 ? tauBearing * (wVal >= 0 ? 1 : -1) : 0
        const accA = (-gravA - fricA) / iArmBall
        const pFricA = Math.abs(wVal) > 1e-9 ? tauBearing * Math.abs(wVal) : 0
        return { accA, pFricA }
      }
      const evalBailSlackRhs = (tVal: number, wbVal: number) => {
        const tq =
          spring.count > 0 && spring.totalEnergyJ > 0
            ? springTorque(
                tVal,
                spring.totalEnergyJ,
                spring.torqueRatio,
                spring.springZeroOffsetDeg
              )
            : 0
        const gravB = bailMx * g * Math.cos(tVal * DEG_TO_RAD)
        const tauBailDrive = -tq - gravB
        if (Math.abs(wbVal) < 1e-9 && Math.abs(tauBailDrive) <= tauBearing) {
          return { accB: 0, pFricB: 0 }
        }
        const fricB = tauBearing * (wbVal >= 0 ? 1 : -1)
        const accB = (tauBailDrive - fricB) / iBail
        const pFricB = Math.abs(wbVal) > 1e-9 ? tauBearing * Math.abs(wbVal) : 0
        return { accB, pFricB }
      }

      const rA1 = evalArmSlackRhs(psi, w)
      const psiRad0 = psi * DEG_TO_RAD
      const etZ0 = (-oxM * Math.cos(psiRad0) - ozM * Math.sin(psiRad0)) / rBallM
      if (w > 1.0 && mBall * (rBallM * rA1.accA + g * etZ0) < 0) {
        leftCradle = true
        break
      }

      const k1p = w * RAD_TO_DEG
      const k1w = rA1.accA
      const k1f = rA1.pFricA

      const rA2 = evalArmSlackRhs(psi + 0.5 * dtS * k1p, w + 0.5 * dtS * k1w)
      const k2p = (w + 0.5 * dtS * k1w) * RAD_TO_DEG
      const k2w = rA2.accA
      const k2f = rA2.pFricA

      const rA3 = evalArmSlackRhs(psi + 0.5 * dtS * k2p, w + 0.5 * dtS * k2w)
      const k3p = (w + 0.5 * dtS * k2w) * RAD_TO_DEG
      const k3w = rA3.accA
      const k3f = rA3.pFricA

      const rA4 = evalArmSlackRhs(psi + dtS * k3p, w + dtS * k3w)
      const k4p = (w + dtS * k3w) * RAD_TO_DEG
      const k4w = rA4.accA
      const k4f = rA4.pFricA

      psi += (dtS / 6) * (k1p + 2 * k2p + 2 * k3p + k4p)
      w += (dtS / 6) * (k1w + 2 * k2w + 2 * k3w + k4w)
      slackStepArmFric = (dtS / 6) * (k1f + 2 * k2f + 2 * k3f + k4f)

      stepBailAtFrac = (frac: number) => {
        const h = frac * dtS
        if (h <= 0 || thPrev <= thRestDeg) {
          return { th1: thPrev, wb1: wbPrev, dFricB: 0 }
        }
        const b1 = evalBailSlackRhs(thPrev, wbPrev)
        const b1t = wbPrev * RAD_TO_DEG
        const b1w = b1.accB
        const b1f = b1.pFricB

        const th2 = thPrev + 0.5 * h * b1t
        const wb2 = wbPrev + 0.5 * h * b1w
        const b2 = evalBailSlackRhs(th2, wb2)
        const b2t = wb2 * RAD_TO_DEG
        const b2w = b2.accB
        const b2f = b2.pFricB

        const th3 = thPrev + 0.5 * h * b2t
        const wb3 = wbPrev + 0.5 * h * b2w
        const b3 = evalBailSlackRhs(th3, wb3)
        const b3t = wb3 * RAD_TO_DEG
        const b3w = b3.accB
        const b3f = b3.pFricB

        const th4 = thPrev + h * b3t
        const wb4 = wbPrev + h * b3w
        const b4 = evalBailSlackRhs(th4, wb4)
        const b4t = wb4 * RAD_TO_DEG
        const b4w = b4.accB
        const b4f = b4.pFricB

        return {
          th1: thPrev + (h / 6) * (b1t + 2 * b2t + 2 * b3t + b4t),
          wb1: wbPrev + (h / 6) * (b1w + 2 * b2w + 2 * b3w + b4w),
          dFricB: (h / 6) * (b1f + 2 * b2f + 2 * b3f + b4f),
        }
      }

      if (thPrev > thRestDeg) {
        const bailFull = stepBailAtFrac(1)
        if (bailFull.th1 > thRestDeg) {
          th = bailFull.th1
          wb = bailFull.wb1
          slackStepBailFric = bailFull.dFricB
        } else {
          const denomTh = thPrev - bailFull.th1
          let fracHit = denomTh > 1e-12 ? (thPrev - thRestDeg) / denomTh : 1
          fracHit = Math.max(0, Math.min(1, fracHit))
          let bailHit = stepBailAtFrac(fracHit)
          if (Math.abs(bailHit.th1 - thRestDeg) > 1e-7 && Math.abs(bailHit.wb1) > 1e-6) {
            fracHit = Math.max(
              0,
              Math.min(1, fracHit - (bailHit.th1 - thRestDeg) / (bailHit.wb1 * RAD_TO_DEG * dtS))
            )
            bailHit = stepBailAtFrac(fracHit)
          }
          slackBailHitAlpha = fracHit
          slackStepBailFric = bailHit.dFricB
          slackBailImpactLoss = 0.5 * iBail * bailHit.wb1 * bailHit.wb1
          th = thRestDeg
          wb = 0
        }
      }

      frictionLossJ = fricPrev + slackStepArmFric + slackStepBailFric + slackBailImpactLoss
      t += dtS

      // Check snap-taut overrun
      if (psi < table.psiEndDeg && th > thRestDeg) {
        const evSnap = table.evalAtPsi(psi)
        if (evSnap.inRange && th < evSnap.thDeg && wb < evSnap.h1 * w) {
          const h1 = evSnap.h1
          const denom = iArmBall + iBail * h1 * h1
          const wNew = (iArmBall * w + iBail * h1 * wb) / denom
          const relV = wb - h1 * w
          const snapLoss = 0.5 * ((iArmBall * iBail) / denom) * relV * relV
          frictionLossJ += snapLoss
          w = wNew
          wb = h1 * wNew
          th = evSnap.thDeg
          taut = true
        }
      }
    }

    // Clamp negative arm rate (stall) cleanly without negative-velocity oscillation
    if (w <= 0) {
      const alpha = wPrev > 0 && w < 0 ? wPrev / (wPrev - w) : 1
      if (wPrev > 0 && w < 0) {
        psi = psiPrev + alpha * (psi - psiPrev)
        t = tPrev + alpha * (t - tPrev)
        if (usedSlackStep) {
          if (stepBailAtFrac && thPrev > thRestDeg && alpha < slackBailHitAlpha) {
            const bailAtStop = stepBailAtFrac(alpha)
            th = bailAtStop.th1
            wb = bailAtStop.wb1
            frictionLossJ = fricPrev + alpha * slackStepArmFric + bailAtStop.dFricB
          } else {
            frictionLossJ =
              fricPrev + alpha * slackStepArmFric + slackStepBailFric + slackBailImpactLoss
          }
        } else {
          th = thPrev + alpha * (th - thPrev)
          wb = th <= thRestDeg ? 0 : wbPrev + alpha * (wb - wbPrev)
          frictionLossJ = fricPrev + alpha * (frictionLossJ - fricPrev)
        }
      }
      w = 0
      if (!usedSlackStep || th <= thRestDeg) {
        wb = 0
      }
      stalled = true
      if (t > samples[samples.length - 1].t + 1e-12) {
        samples.push({ t, psiDeg: psi, thDeg: th, omegaArm: 0 })
      }
      break
    }

    // Interpolate exact crossing of psiStopDeg
    if (psi >= psiStopDeg) {
      const denom = psi - psiPrev
      const alpha = denom > 1e-12 ? (psiStopDeg - psiPrev) / denom : 1
      psi = psiStopDeg
      w = wPrev + alpha * (w - wPrev)
      t = tPrev + alpha * (t - tPrev)
      if (usedSlackStep) {
        if (stepBailAtFrac && thPrev > thRestDeg && alpha < slackBailHitAlpha) {
          const bailAtStop = stepBailAtFrac(alpha)
          th = bailAtStop.th1
          wb = bailAtStop.wb1
          frictionLossJ = fricPrev + alpha * slackStepArmFric + bailAtStop.dFricB
        } else {
          frictionLossJ =
            fricPrev + alpha * slackStepArmFric + slackStepBailFric + slackBailImpactLoss
        }
      } else {
        th = thPrev + alpha * (th - thPrev)
        wb = wbPrev + alpha * (wb - wbPrev)
        frictionLossJ = fricPrev + alpha * (frictionLossJ - fricPrev)
      }
      leftCradle = true
      if (t > samples[samples.length - 1].t + 1e-12) {
        samples.push({ t, psiDeg: psi, thDeg: th, omegaArm: w })
      }
      if (taut && psi <= table.psiEndDeg && th > thRestDeg) {
        const rEnd = evalTautRhs(psi, w)
        const levBM = Math.max(1e-4, rEnd.levBMm * 1e-3)
        const tEnd =
          (rEnd.tq +
            rEnd.bailGrav +
            iBail * (rEnd.h1 * rEnd.acc + rEnd.h2 * w * w) -
            tauBearing * (w >= 0 ? 1 : -1)) /
          levBM
        if (tEnd > peakCordTensionN) peakCordTensionN = tEnd
      }
      break
    }

    samples.push({ t, psiDeg: psi, thDeg: th, omegaArm: w })
  }

  if (!leftCradle && !stalled && psi >= psiStopDeg) {
    leftCradle = true
  }

  const ballPos = cockedBallPos(psi)
  const psiRad = psi * DEG_TO_RAD
  const vxSag = leftCradle ? w * (-oxM * Math.sin(psiRad) + ozM * Math.cos(psiRad)) : 0
  const vzSag = leftCradle ? w * (-oxM * Math.cos(psiRad) - ozM * Math.sin(psiRad)) : 0
  const velMps = rotateSagittalToWorld(vxSag, vzSag, yawRad)
  const omegaBallRadps = leftCradle
    ? rotateSpinToWorld(w, yawRad)
    : ([0, 0, 0] as [number, number, number])

  const keTransBallJ = 0.5 * mBall * (vxSag * vxSag + vzSag * vzSag)
  const keRotBallJ = leftCradle ? 0.5 * iBallRot * w * w : 0
  const keArmBailJ =
    0.5 * (model.arm.inertiaKgM2 + (leftCradle ? 0 : mBall * rBallM * rBallM + iBallRot)) * w * w +
    0.5 * iBail * wb * wb
  const peGravityDeltaJ = totalPe(psi, th) - peStart
  const springInitialJ = springWork(
    thCockDeg,
    th,
    spring.totalEnergyJ,
    spring.torqueRatio,
    spring.springZeroOffsetDeg
  )
  const springTotalStoredJ = springWork(
    thCockDeg,
    thRestDeg,
    spring.totalEnergyJ,
    spring.torqueRatio,
    spring.springZeroOffsetDeg
  )

  return {
    tReleaseS: t,
    posM: rotateSagittalToWorld(ballPos.x, ballPos.z, yawRad),
    velMps,
    omegaBallRadps,
    energyBudget: {
      springInitialJ,
      keTransBallJ,
      keRotBallJ,
      keRotArmBailsJ: keArmBailJ,
      peGravityDeltaJ,
      frictionLossJ,
    },
    wastedStopKeJ: keArmBailJ,
    leftCradle,
    launchSpeedMps: Math.hypot(...velMps),
    launchAngleDeg: computeLaunchAngleDeg(velMps),
    armTraceSamples: samples,
    cycleTimeS,
    cockedBallBottomHeightM,
    cordSlackAtDeg,
    peakCordTensionN,
    reachable: true,
    springTotalStoredJ,
    springResidualPeJ: Math.max(0, springTotalStoredJ - springInitialJ),
  }
}

function solveDirectRailLaunch(
  model: LauncherModel,
  adj: AdjustmentValues,
  spring: TorsionSpringSpec,
  env: EnvConfig,
  dtS: number,
  cycleTimeS: number,
  cockJitterDeg: number,
  seatingJitterM: number,
  yawRad: number,
  stopJitterDeg: number
): LaunchReleaseState {
  const cfg = computeDirectRailConfig(
    model,
    adj,
    seatingJitterM,
    cockJitterDeg,
    stopJitterDeg
  )
  const g = env.gravityMps2
  const mBall = model.projectile.massKg
  const ib = cfg.rolling ? model.projectile.inertiaKgM2 : 0
  const ae = cfg.rideHM
  const cg = Math.cos(cfg.gammaRad)
  const sg = Math.sin(cfg.gammaRad)
  const ms = mBall + ib / (ae * ae)
  const thCockRad = cfg.thCockDeg * DEG_TO_RAD
  const tauBearing = getEffectiveBearingFrictionNm(model)

  const ballPos2D = (thRad: number, s: number) => {
    const x = cfg.x0M + s * cg
    const yy = cfg.y0M - s * sg
    const c = Math.cos(thRad)
    const si = Math.sin(thRad)
    return {
      x: x * c + yy * si,
      z: cfg.zHingeM + x * si - yy * c,
    }
  }

  const totalPe = (thRad: number, s: number) => {
    const bp = ballPos2D(thRad, s)
    return mBall * g * bp.z + cfg.mxBaseKgM * g * Math.sin(thRad)
  }

  const peStart = totalPe(thCockRad, 0)
  let phi = 0
  let s = 0
  let phid = 0
  let sd = 0
  let t = 0
  let frictionLossJ = 0
  let leftCradle = false

  const samples: ArmTraceSample[] = [
    { t: 0, psiDeg: 90 - cfg.thCockDeg, thDeg: cfg.thCockDeg, omegaArm: 0 },
  ]

  const evalRhs = (pVal: number, sVal: number, pdVal: number, sdVal: number) => {
    const th = thCockRad - pVal
    const thDeg = th * RAD_TO_DEG
    const x = cfg.x0M + sVal * cg
    const yy = cfg.y0M - sVal * sg
    const a_ = x * x + yy * yy
    const as_ = 2 * (x * cg - yy * sg)
    const b_ = -x * sg - yy * cg
    const c = mBall * b_ - ib / ae
    const m11 = cfg.inertiaBaseKgM2 + mBall * a_ + ib
    const tq = instantaneousSpringTorque(spring, thDeg)
    const gravPhi =
      mBall * g * (x * Math.cos(th) + yy * Math.sin(th)) +
      cfg.mxBaseKgM * g * Math.cos(th)
    const tauDrive = tq + gravPhi - mBall * as_ * sdVal * pdVal
    const fric = Math.abs(pdVal) < 1e-9 && tauDrive <= tauBearing ? tauDrive : tauBearing * (pdVal >= 0 ? 1 : -1)
    const qp = tauDrive - fric
    const qs = -mBall * g * (cg * Math.sin(th) + sg * Math.cos(th))
    const rhs1 = qp
    const rhs2 = qs + 0.5 * mBall * as_ * pdVal * pdVal
    const det = m11 * ms - c * c
    const accPhiFree = (ms * rhs1 - c * rhs2) / det
    const accSFree = (-c * rhs1 + m11 * rhs2) / det
    const pFric = Math.abs(pdVal) > 1e-9 ? tauBearing * Math.abs(pdVal) : 0

    if (sVal <= 1e-9 && sdVal <= 0 && accSFree <= 0) {
      const accPhiLocked = qp / m11
      return { dphi: pdVal, ds: 0, dpd: accPhiLocked, dsd: 0, pFric }
    }
    return { dphi: pdVal, ds: sdVal, dpd: accPhiFree, dsd: accSFree, pFric }
  }

  const maxSteps = Math.ceil(MAX_SIM_TIME_S / dtS) + 2
  for (let step = 0; step < maxSteps; step++) {
    const thDegNow = (thCockRad - phi) * RAD_TO_DEG
    if (s >= cfg.sEndM) {
      leftCradle = true
      break
    }
    if (thDegNow <= cfg.thStopDeg) {
      leftCradle = false
      break
    }

    const phiPrev = phi
    const sPrev = s
    const pdPrev = phid
    const sdPrev = sd
    const tPrev = t
    const fricPrev = frictionLossJ

    const k1 = evalRhs(phi, s, phid, sd)
    if (phid === 0 && k1.dpd <= 0) {
      break
    }
    const k2 = evalRhs(
      phi + 0.5 * dtS * k1.dphi,
      Math.max(0, s + 0.5 * dtS * k1.ds),
      phid + 0.5 * dtS * k1.dpd,
      sd + 0.5 * dtS * k1.dsd
    )
    const k3 = evalRhs(
      phi + 0.5 * dtS * k2.dphi,
      Math.max(0, s + 0.5 * dtS * k2.ds),
      phid + 0.5 * dtS * k2.dpd,
      sd + 0.5 * dtS * k2.dsd
    )
    const k4 = evalRhs(
      phi + dtS * k3.dphi,
      Math.max(0, s + dtS * k3.ds),
      phid + dtS * k3.dpd,
      sd + dtS * k3.dsd
    )

    phi += (dtS / 6) * (k1.dphi + 2 * k2.dphi + 2 * k3.dphi + k4.dphi)
    s += (dtS / 6) * (k1.ds + 2 * k2.ds + 2 * k3.ds + k4.ds)
    phid += (dtS / 6) * (k1.dpd + 2 * k2.dpd + 2 * k3.dpd + k4.dpd)
    sd += (dtS / 6) * (k1.dsd + 2 * k2.dsd + 2 * k3.dsd + k4.dsd)
    frictionLossJ += (dtS / 6) * (k1.pFric + 2 * k2.pFric + 2 * k3.pFric + k4.pFric)
    t += dtS

    if (s <= 0) {
      if (sd < 0) {
        const x = cfg.x0M
        const yy = cfg.y0M
        const a_ = x * x + yy * yy
        const b_ = -x * sg - yy * cg
        const c_ = mBall * b_ - ib / ae
        const m11 = cfg.inertiaBaseKgM2 + mBall * a_ + ib
        const det = m11 * ms - c_ * c_
        frictionLossJ += 0.5 * (det / m11) * sd * sd
        phid += (c_ / m11) * sd
        sd = 0
      }
      s = 0
    }

    if (phid <= 0) {
      if (pdPrev > 0 && phid < 0) {
        const a = pdPrev / (pdPrev - phid)
        phi = phiPrev + a * (phi - phiPrev)
        s = Math.max(0, sPrev + a * (s - sPrev))
        sd = s <= 1e-9 ? Math.max(0, sdPrev + a * (sd - sdPrev)) : sdPrev + a * (sd - sdPrev)
        t = tPrev + a * (t - tPrev)
        frictionLossJ = fricPrev + a * (frictionLossJ - fricPrev)
      }
      phid = 0
      if (s <= 1e-9 && sd < 0) {
        sd = 0
      }
      leftCradle = false
      if (t > samples[samples.length - 1].t + 1e-12) {
        const thD = (thCockRad - phi) * RAD_TO_DEG
        samples.push({ t, psiDeg: 90 - thD, thDeg: thD, omegaArm: 0 })
      }
      break
    }

    if (s >= cfg.sEndM) {
      const denom = s - sPrev
      const a = denom > 1e-12 ? (cfg.sEndM - sPrev) / denom : 1
      s = cfg.sEndM
      phi = phiPrev + a * (phi - phiPrev)
      phid = pdPrev + a * (phid - pdPrev)
      sd = sdPrev + a * (sd - sdPrev)
      t = tPrev + a * (t - tPrev)
      frictionLossJ = fricPrev + a * (frictionLossJ - fricPrev)
      leftCradle = true
      if (t > samples[samples.length - 1].t + 1e-12) {
        const thD = (thCockRad - phi) * RAD_TO_DEG
        samples.push({ t, psiDeg: 90 - thD, thDeg: thD, omegaArm: phid })
      }
      break
    }

    const thNextDeg = (thCockRad - phi) * RAD_TO_DEG
    if (thNextDeg <= cfg.thStopDeg) {
      const thPrevDeg = (thCockRad - phiPrev) * RAD_TO_DEG
      const denom = thPrevDeg - thNextDeg
      const a = denom > 1e-12 ? (thPrevDeg - cfg.thStopDeg) / denom : 1
      phi = thCockRad - cfg.thStopDeg * DEG_TO_RAD
      s = Math.max(0, sPrev + a * (s - sPrev))
      phid = pdPrev + a * (phid - pdPrev)
      sd = sdPrev + a * (sd - sdPrev)
      t = tPrev + a * (t - tPrev)
      frictionLossJ = fricPrev + a * (frictionLossJ - fricPrev)
      leftCradle = false
      if (t > samples[samples.length - 1].t + 1e-12) {
        samples.push({ t, psiDeg: 90 - cfg.thStopDeg, thDeg: cfg.thStopDeg, omegaArm: phid })
      }
      break
    }

    samples.push({ t, psiDeg: 90 - thNextDeg, thDeg: thNextDeg, omegaArm: phid })
  }

  const thRelRad = thCockRad - phi
  const thRelDeg = thRelRad * RAD_TO_DEG
  const x = cfg.x0M + s * cg
  const yy = cfg.y0M - s * sg
  const erX = Math.cos(thRelRad)
  const erZ = Math.sin(thRelRad)
  const etX = Math.sin(thRelRad)
  const etZ = -Math.cos(thRelRad)
  const posSagX = x * erX + yy * etX
  const posSagZ = cfg.zHingeM + x * erZ + yy * etZ

  const vr = sd * cg - phid * yy
  const vt = -sd * sg + phid * x
  const vxSag = leftCradle ? vr * erX + vt * etX : 0
  const vzSag = leftCradle ? vr * erZ + vt * etZ : 0
  const omegaYSag = leftCradle && cfg.rolling ? phid - sd / ae : 0

  const velMps = rotateSagittalToWorld(vxSag, vzSag, yawRad)
  const omegaBallRadps = rotateSpinToWorld(omegaYSag, yawRad)

  const keTransBallJ = 0.5 * mBall * (vxSag * vxSag + vzSag * vzSag)
  const keRotBallJ = 0.5 * ib * omegaYSag * omegaYSag
  let keArmBailJ: number
  if (leftCradle) {
    keArmBailJ = 0.5 * cfg.inertiaBaseKgM2 * phid * phid
  } else {
    const a_ = x * x + yy * yy
    const b_ = -x * sg - yy * cg
    const c_ = mBall * b_ - ib / ae
    const m11 = cfg.inertiaBaseKgM2 + mBall * a_ + ib
    keArmBailJ = 0.5 * (m11 * phid * phid + 2 * c_ * phid * sd + ms * sd * sd)
  }
  const peGravityDeltaJ = totalPe(thRelRad, s) - peStart
  const springInitialJ = springWork(
    cfg.thCockDeg,
    thRelDeg,
    spring.totalEnergyJ,
    spring.torqueRatio,
    spring.springZeroOffsetDeg
  )
  const springTotalStoredJ = springWork(
    cfg.thCockDeg,
    model.trapBank.thRestDeg,
    spring.totalEnergyJ,
    spring.torqueRatio,
    spring.springZeroOffsetDeg
  )

  return {
    tReleaseS: t,
    posM: rotateSagittalToWorld(posSagX, posSagZ, yawRad),
    velMps,
    omegaBallRadps,
    energyBudget: {
      springInitialJ,
      keTransBallJ,
      keRotBallJ,
      keRotArmBailsJ: keArmBailJ,
      peGravityDeltaJ,
      frictionLossJ,
    },
    wastedStopKeJ: keArmBailJ,
    leftCradle,
    launchSpeedMps: Math.hypot(...velMps),
    launchAngleDeg: computeLaunchAngleDeg(velMps),
    armTraceSamples: samples,
    cycleTimeS,
    cockedBallBottomHeightM: cfg.cockedBallBottomHeightM,
    cordSlackAtDeg: null,
    reachable: true,
    springTotalStoredJ,
    springResidualPeJ: Math.max(0, springTotalStoredJ - springInitialJ),
  }
}

function solveCoaxialCupOrTiltedLaunch(
  model: LauncherModel,
  adj: AdjustmentValues,
  spring: TorsionSpringSpec,
  env: EnvConfig,
  dtS: number,
  cycleTimeS: number,
  cockJitterDeg: number,
  seatingJitterM: number,
  yawRad: number,
  stopJitterDeg: number,
  includeBallRot: boolean
): LaunchReleaseState {
  const isTilted = model.linkage.kind === 'tilted_cradle'
  const g = env.gravityMps2
  const mBall = model.projectile.massKg
  const iBallRot = includeBallRot ? model.projectile.inertiaKgM2 : 0
  const mArm = model.arm.massKg
  const iBail = model.trapBank.bailInertiaKgM2
  const bailMx = model.trapBank.bailMassXKgM
  const tauBearing = getEffectiveBearingFrictionNm(model)

  const tiltedCfg = isTilted
    ? computeTiltedCradleConfig(model, adj, seatingJitterM, cockJitterDeg, stopJitterDeg)
    : null
  const cupCfg = !isTilted
    ? computeDirectCupConfig(model, adj, seatingJitterM, cockJitterDeg, stopJitterDeg)
    : null

  const oxM = tiltedCfg ? tiltedCfg.oxM : cupCfg!.oxM
  const ozM = tiltedCfg ? tiltedCfg.ozM : cupCfg!.ozM
  const rBallM = tiltedCfg ? tiltedCfg.rBallM : cupCfg!.rBallM
  const cgxM = model.arm.cgArmMm[0] * 1e-3
  const cgzM = model.arm.cgArmMm[1] * 1e-3
  const pxM = isTilted ? 0 : cupCfg!.pivotPosM[0]
  const pzM = isTilted ? tiltedCfg!.zPivotM : cupCfg!.pivotPosM[1]
  const thCockDeg = tiltedCfg ? tiltedCfg.thCockDeg : cupCfg!.thCockDeg
  const thStopDeg = tiltedCfg ? tiltedCfg.thStopDeg : cupCfg!.thStopDeg
  const cockedBallBottomHeightM = tiltedCfg
    ? tiltedCfg.cockedBallBottomHeightM
    : cupCfg!.cockedBallBottomHeightM

  const iTotal =
    model.arm.inertiaKgM2 + iBail + mBall * rBallM * rBallM + iBallRot

  const worldAngleRad = (thDeg: number) =>
    (isTilted ? tiltedCfg!.alphaTrapFrontDeg + thDeg : thDeg) * DEG_TO_RAD

  const ballPos = (thDeg: number) => {
    const a = worldAngleRad(thDeg)
    const c = Math.cos(a)
    const s = Math.sin(a)
    return {
      x: pxM + oxM * c + ozM * s,
      z: pzM + oxM * s - ozM * c,
    }
  }

  const totalPe = (thDeg: number) => {
    const a = worldAngleRad(thDeg)
    const bp = ballPos(thDeg)
    const zCg = pzM + cgxM * Math.sin(a) - cgzM * Math.cos(a)
    const zBail = bailMx * Math.sin(a)
    return mBall * g * bp.z + mArm * g * zCg + g * zBail
  }

  // Generalized gravity torque opposing -dth/dt (positive reduces acceleration)
  const gravTorque = (thDeg: number) => {
    const a = worldAngleRad(thDeg)
    const c = Math.cos(a)
    const s = Math.sin(a)
    const dZBall = -oxM * c - ozM * s
    const dZCg = -cgxM * c - cgzM * s
    const dZBail = -bailMx * c
    return g * (mBall * dZBall + mArm * dZCg + dZBail)
  }

  const peStart = totalPe(thCockDeg)
  let th = thCockDeg
  let w = 0
  let t = 0
  let frictionLossJ = 0
  let leftCradle = false

  const samples: ArmTraceSample[] = [
    {
      t: 0,
      psiDeg: isTilted ? tiltedCfg!.alphaTrapFrontDeg + th : 90 - th,
      thDeg: th,
      omegaArm: 0,
    },
  ]

  const evalRhs = (thVal: number, wVal: number) => {
    const tq = instantaneousSpringTorque(spring, thVal)
    const tauDrive = tq - gravTorque(thVal)
    let acc: number
    let pFric: number
    if (Math.abs(wVal) < 1e-9 && tauDrive <= tauBearing) {
      acc = 0
      pFric = 0
    } else {
      const sgn = wVal >= 0 ? 1 : -1
      acc = (tauDrive - tauBearing * sgn) / iTotal
      pFric = tauBearing * Math.abs(wVal)
    }
    return { acc, pFric }
  }

  const maxSteps = Math.ceil(MAX_SIM_TIME_S / dtS) + 2
  for (let step = 0; step < maxSteps; step++) {
    if (th <= thStopDeg) {
      leftCradle = true
      break
    }

    const r0 = evalRhs(th, w)
    if (w === 0 && r0.acc <= 0) break

    // Normal-force drop-off check
    const a0 = worldAngleRad(th)
    const etZ0 = (-oxM * Math.cos(a0) - ozM * Math.sin(a0)) / rBallM
    const nt0 = mBall * (rBallM * r0.acc + g * etZ0)
    if (w > 1.0 && nt0 < -model.cradle.retentionForceN) {
      leftCradle = true
      break
    }

    const thPrev = th
    const wPrev = w
    const tPrev = t
    const fricPrev = frictionLossJ

    const k1t = -w * RAD_TO_DEG
    const k1w = r0.acc
    const k1f = r0.pFric

    const r2 = evalRhs(th + 0.5 * dtS * k1t, w + 0.5 * dtS * k1w)
    const k2t = -(w + 0.5 * dtS * k1w) * RAD_TO_DEG
    const k2w = r2.acc
    const k2f = r2.pFric

    const r3 = evalRhs(th + 0.5 * dtS * k2t, w + 0.5 * dtS * k2w)
    const k3t = -(w + 0.5 * dtS * k2w) * RAD_TO_DEG
    const k3w = r3.acc
    const k3f = r3.pFric

    const r4 = evalRhs(th + dtS * k3t, w + dtS * k3w)
    const k4t = -(w + dtS * k3w) * RAD_TO_DEG
    const k4w = r4.acc
    const k4f = r4.pFric

    th += (dtS / 6) * (k1t + 2 * k2t + 2 * k3t + k4t)
    w += (dtS / 6) * (k1w + 2 * k2w + 2 * k3w + k4w)
    frictionLossJ += (dtS / 6) * (k1f + 2 * k2f + 2 * k3f + k4f)
    t += dtS

    if (w <= 0) {
      if (wPrev > 0 && w < 0) {
        const a = wPrev / (wPrev - w)
        th = thPrev + a * (th - thPrev)
        t = tPrev + a * (t - tPrev)
        frictionLossJ = fricPrev + a * (frictionLossJ - fricPrev)
      }
      w = 0
      leftCradle = false
      if (t > samples[samples.length - 1].t + 1e-12) {
        samples.push({
          t,
          psiDeg: isTilted ? tiltedCfg!.alphaTrapFrontDeg + th : 90 - th,
          thDeg: th,
          omegaArm: 0,
        })
      }
      break
    }

    if (th <= thStopDeg) {
      const denom = thPrev - th
      const a = denom > 1e-12 ? (thPrev - thStopDeg) / denom : 1
      th = thStopDeg
      w = wPrev + a * (w - wPrev)
      t = tPrev + a * (t - tPrev)
      frictionLossJ = fricPrev + a * (frictionLossJ - fricPrev)
      leftCradle = true
      if (t > samples[samples.length - 1].t + 1e-12) {
        samples.push({
          t,
          psiDeg: isTilted ? tiltedCfg!.alphaTrapFrontDeg + th : 90 - th,
          thDeg: th,
          omegaArm: w,
        })
      }
      break
    }

    samples.push({
      t,
      psiDeg: isTilted ? tiltedCfg!.alphaTrapFrontDeg + th : 90 - th,
      thDeg: th,
      omegaArm: w,
    })
  }

  const bp = ballPos(th)
  const aRel = worldAngleRad(th)
  let vxSag = leftCradle ? w * (oxM * Math.sin(aRel) - ozM * Math.cos(aRel)) : 0
  let vzSag = leftCradle ? w * (-oxM * Math.cos(aRel) - ozM * Math.sin(aRel)) : 0
  let speedPre = Math.hypot(vxSag, vzSag)
  let keTransBallJ = 0.5 * mBall * speedPre * speedPre
  let keRotBallJ = leftCradle ? 0.5 * iBallRot * w * w : 0
  let omegaYSag = leftCradle ? w : 0

  // Handle pocketed_petals retention & snap energy
  if (leftCradle && model.cradle.type === 'pocketed_petals') {
    const fRet = model.cradle.retentionForceN
    const dPetal = 0.025 / 3.5
    const barrierJ =
      fRet <= 0
        ? 0
        : Math.abs(fRet - 3.5) < 1e-6
          ? model.cradle.snapEnergyJ
          : fRet * dPetal
    if (keTransBallJ <= barrierJ) {
      vxSag = 0
      vzSag = 0
      speedPre = 0
      keTransBallJ = 0
      keRotBallJ = 0
      omegaYSag = 0
      leftCradle = false
    } else if (barrierJ > 0) {
      const kePost = keTransBallJ - barrierJ
      const scaleV = Math.sqrt(kePost / keTransBallJ)
      vxSag *= scaleV
      vzSag *= scaleV
      keTransBallJ = kePost
      frictionLossJ += barrierJ
    }
  }

  const velMps = rotateSagittalToWorld(vxSag, vzSag, yawRad)
  const omegaBallRadps = rotateSpinToWorld(omegaYSag, yawRad)
  const keArmBailJ =
    0.5 *
    (model.arm.inertiaKgM2 + iBail + (leftCradle ? 0 : mBall * rBallM * rBallM + iBallRot)) *
    w *
    w
  const peGravityDeltaJ = totalPe(th) - peStart
  const springInitialJ = springWork(
    thCockDeg,
    th,
    spring.totalEnergyJ,
    spring.torqueRatio,
    spring.springZeroOffsetDeg
  )
  const springTotalStoredJ = springWork(
    thCockDeg,
    model.trapBank.thRestDeg,
    spring.totalEnergyJ,
    spring.torqueRatio,
    spring.springZeroOffsetDeg
  )

  return {
    tReleaseS: t,
    posM: rotateSagittalToWorld(bp.x, bp.z, yawRad),
    velMps,
    omegaBallRadps,
    energyBudget: {
      springInitialJ,
      keTransBallJ,
      keRotBallJ,
      keRotArmBailsJ: keArmBailJ,
      peGravityDeltaJ,
      frictionLossJ,
    },
    wastedStopKeJ: keArmBailJ,
    leftCradle,
    launchSpeedMps: Math.hypot(...velMps),
    launchAngleDeg: computeLaunchAngleDeg(velMps),
    armTraceSamples: samples,
    cycleTimeS,
    cockedBallBottomHeightM,
    cordSlackAtDeg: null,
    reachable: true,
    springTotalStoredJ,
    springResidualPeJ: Math.max(0, springTotalStoredJ - springInitialJ),
  }
}

function solveInclinedRampLaunch(
  model: LauncherModel,
  adj: AdjustmentValues,
  spring: TorsionSpringSpec,
  env: EnvConfig,
  dtS: number,
  cycleTimeS: number,
  cockJitterDeg: number,
  seatingJitterM: number,
  yawRad: number
): LaunchReleaseState {
  const cfg = computeInclinedRampConfig(model, adj, cockJitterDeg)
  const g = env.gravityMps2
  const mBall = model.projectile.massKg
  const mSled = model.arm.massKg
  const mTot = mSled + mBall
  const iBail = model.trapBank.bailInertiaKgM2
  const bailMx = model.trapBank.bailMassXKgM
  const tauBearing = getEffectiveBearingFrictionNm(model)
  const beta = cfg.rampAngleRad
  const sinB = Math.sin(beta)
  const cosB = Math.cos(beta)
  const rampLengthM = Math.max(0.05, cfg.rampLengthM - seatingJitterM)

  const bailLevM = (thDeg: number) =>
    bailSide(
      thDeg,
      cfg.hingePosMm,
      cfg.rollerPosMm,
      cfg.rPullMm,
      cfg.rRollEffMm
    ).leverArmMm * 1e-3

  const dBailLevM = (thDeg: number) => {
    const dDeg = 0.02
    const l1 = bailLevM(thDeg + dDeg)
    const l0 = bailLevM(thDeg - dDeg)
    return -(l1 - l0) / (2 * dDeg * DEG_TO_RAD)
  }

  let th = cfg.thCockDeg
  let wb = 0
  let s = 0
  let sSled = 0
  let vBall = 0
  let t = 0
  let taut = true
  let cordSlackAtDeg: number | null = null
  let peakCordTensionN = 0
  let frictionLossJ = 0
  let keArmBailStopJ = 0
  let leftCradle = false

  const samples: ArmTraceSample[] = [
    { t: 0, psiDeg: cfg.rampAngleDeg, thDeg: th, omegaArm: 0 },
  ]

  const evalTautRhs = (thVal: number, wbVal: number) => {
    const k = Math.max(1e-4, bailLevM(thVal))
    const dk = dBailLevM(thVal)
    const iEff = iBail + mTot * k * k
    const fChuteGrav = mTot * g * sinB
    const fChuteFric = mTot * g * cfg.muChute * cosB
    const tq = instantaneousSpringTorque(spring, thVal)
    const tauGravBail = bailMx * g * Math.cos(thVal * DEG_TO_RAD)
    const tauDrive = tq + tauGravBail - fChuteGrav * k - mTot * k * dk * wbVal * wbVal
    const fricTot = tauBearing + fChuteFric * k
    let acc: number
    let pFric: number
    if (Math.abs(wbVal) < 1e-9 && tauDrive <= fricTot) {
      acc = 0
      pFric = 0
    } else {
      const sgn = wbVal >= 0 ? 1 : -1
      acc = (tauDrive - fricTot * sgn) / iEff
      pFric = fricTot * Math.abs(wbVal)
    }
    const tension = mTot * (k * acc + dk * wbVal * wbVal) + fChuteGrav + fChuteFric * (wbVal >= 0 ? 1 : -1)
    return { acc, pFric, k, tension }
  }

  const maxSteps = Math.ceil(MAX_SIM_TIME_S / dtS) + 2
  for (let step = 0; step < maxSteps; step++) {
    if (s >= rampLengthM) {
      leftCradle = vBall > 0
      break
    }

    const thPrev = th
    const wbPrev = wb
    const sPrev = s
    const vPrev = vBall
    const tPrev = t
    const fricPrev = frictionLossJ

    if (taut && th > cfg.thRestDeg) {
      const r0 = evalTautRhs(th, wb)
      if (wb === 0 && r0.acc <= 0) {
        leftCradle = false
        break
      }
      if (r0.tension > peakCordTensionN) peakCordTensionN = r0.tension
      if (r0.tension <= 0 && wb > 1.0) {
        taut = false
        if (cordSlackAtDeg === null) cordSlackAtDeg = th
        keArmBailStopJ = 0.5 * (iBail + mSled * r0.k * r0.k) * wb * wb
        sSled = s
        vBall = r0.k * wb
        continue
      }

      const k1t = -wb * RAD_TO_DEG
      const k1w = r0.acc
      const k1s = r0.k * wb
      const k1f = r0.pFric

      const r2 = evalTautRhs(th + 0.5 * dtS * k1t, wb + 0.5 * dtS * k1w)
      const w2 = wb + 0.5 * dtS * k1w
      const k2t = -w2 * RAD_TO_DEG
      const k2w = r2.acc
      const k2s = r2.k * w2
      const k2f = r2.pFric

      const r3 = evalTautRhs(th + 0.5 * dtS * k2t, wb + 0.5 * dtS * k2w)
      const w3 = wb + 0.5 * dtS * k2w
      const k3t = -w3 * RAD_TO_DEG
      const k3w = r3.acc
      const k3s = r3.k * w3
      const k3f = r3.pFric

      const r4 = evalTautRhs(th + dtS * k3t, wb + dtS * k3w)
      const w4 = wb + dtS * k3w
      const k4t = -w4 * RAD_TO_DEG
      const k4w = r4.acc
      const k4s = r4.k * w4
      const k4f = r4.pFric

      th += (dtS / 6) * (k1t + 2 * k2t + 2 * k3t + k4t)
      wb += (dtS / 6) * (k1w + 2 * k2w + 2 * k3w + k4w)
      s += (dtS / 6) * (k1s + 2 * k2s + 2 * k3s + k4s)
      frictionLossJ += (dtS / 6) * (k1f + 2 * k2f + 2 * k3f + k4f)
      t += dtS

      const kEnd = bailLevM(th)
      vBall = kEnd * wb
      sSled = s

      if (wb <= 0) {
        wb = 0
        vBall = 0
        leftCradle = false
        break
      }

      if (s >= rampLengthM) {
        const denom = s - sPrev
        const a = denom > 1e-12 ? (rampLengthM - sPrev) / denom : 1
        s = rampLengthM
        sSled = s
        th = thPrev + a * (th - thPrev)
        wb = wbPrev + a * (wb - wbPrev)
        vBall = bailLevM(th) * wb
        t = tPrev + a * (t - tPrev)
        frictionLossJ = fricPrev + a * (frictionLossJ - fricPrev)
        keArmBailStopJ = 0.5 * (iBail + mSled * Math.pow(bailLevM(th), 2)) * wb * wb
        leftCradle = true
        if (t > samples[samples.length - 1].t + 1e-12) {
          samples.push({ t, psiDeg: cfg.rampAngleDeg, thDeg: th, omegaArm: wb })
        }
        break
      }

      if (th <= cfg.thRestDeg) {
        const denom = thPrev - th
        const a = denom > 1e-12 ? (thPrev - cfg.thRestDeg) / denom : 1
        th = cfg.thRestDeg
        wb = wbPrev + a * (wb - wbPrev)
        s = sPrev + a * (s - sPrev)
        sSled = s
        t = tPrev + a * (t - tPrev)
        frictionLossJ = fricPrev + a * (frictionLossJ - fricPrev)
        const kStop = bailLevM(th)
        vBall = kStop * wb
        keArmBailStopJ = 0.5 * (iBail + mSled * kStop * kStop) * wb * wb
        taut = false
      }
      samples.push({ t, psiDeg: cfg.rampAngleDeg, thDeg: th, omegaArm: wb })
    } else {
      // Ball coasting up ramp after sled stopped
      const decel = g * (sinB + cfg.muChute * cosB)
      const pFricCoast = (vVal: number) => mBall * g * cfg.muChute * cosB * Math.max(0, vVal)

      const k1s = vBall
      const k1v = -decel
      const k1f = pFricCoast(vBall)
      const k2s = vBall + 0.5 * dtS * k1v
      const k2v = -decel
      const k2f = pFricCoast(k2s)
      const k3s = vBall + 0.5 * dtS * k2v
      const k3v = -decel
      const k3f = pFricCoast(k3s)
      const k4s = vBall + dtS * k3v
      const k4v = -decel
      const k4f = pFricCoast(k4s)

      s += (dtS / 6) * (k1s + 2 * k2s + 2 * k3s + k4s)
      vBall += (dtS / 6) * (k1v + 2 * k2v + 2 * k3v + k4v)
      frictionLossJ += (dtS / 6) * (k1f + 2 * k2f + 2 * k3f + k4f)
      t += dtS

      if (vBall <= 0) {
        if (vPrev > 0) {
          const a = vPrev / (vPrev - vBall)
          s = sPrev + a * (s - sPrev)
          t = tPrev + a * (t - tPrev)
          frictionLossJ = fricPrev + a * (frictionLossJ - fricPrev)
        }
        vBall = 0
        leftCradle = false
        if (t > samples[samples.length - 1].t + 1e-12) {
          samples.push({ t, psiDeg: cfg.rampAngleDeg, thDeg: th, omegaArm: 0 })
        }
        break
      }

      if (s >= rampLengthM) {
        const denom = s - sPrev
        const a = denom > 1e-12 ? (rampLengthM - sPrev) / denom : 1
        s = rampLengthM
        vBall = vPrev + a * (vBall - vPrev)
        t = tPrev + a * (t - tPrev)
        frictionLossJ = fricPrev + a * (frictionLossJ - fricPrev)
        leftCradle = true
        if (t > samples[samples.length - 1].t + 1e-12) {
          samples.push({ t, psiDeg: cfg.rampAngleDeg, thDeg: th, omegaArm: 0 })
        }
        break
      }

      samples.push({ t, psiDeg: cfg.rampAngleDeg, thDeg: th, omegaArm: 0 })
    }
  }

  const xStartM = -0.12
  const posSagX = xStartM + s * cosB
  const posSagZ = cfg.rampStartZM + model.projectile.radiusM + s * sinB
  const vxSag = leftCradle ? vBall * cosB : 0
  const vzSag = leftCradle ? vBall * sinB : 0
  const velMps = rotateSagittalToWorld(vxSag, vzSag, yawRad)

  const keTransBallJ = 0.5 * mBall * (vxSag * vxSag + vzSag * vzSag)
  if (!leftCradle && vBall > 0) {
    if (taut) {
      keArmBailStopJ = 0.5 * (iBail + mTot * Math.pow(bailLevM(th), 2)) * wb * wb
    } else {
      keArmBailStopJ += 0.5 * mBall * vBall * vBall
    }
  }
  const peGravityDeltaJ =
    mSled * g * sSled * sinB +
    mBall * g * s * sinB +
    bailMx * g * (Math.sin(th * DEG_TO_RAD) - Math.sin(cfg.thCockDeg * DEG_TO_RAD))

  const springInitialJ = springWork(
    cfg.thCockDeg,
    th,
    spring.totalEnergyJ,
    spring.torqueRatio,
    spring.springZeroOffsetDeg
  )
  const springTotalStoredJ = springWork(
    cfg.thCockDeg,
    cfg.thRestDeg,
    spring.totalEnergyJ,
    spring.torqueRatio,
    spring.springZeroOffsetDeg
  )

  return {
    tReleaseS: t,
    posM: rotateSagittalToWorld(posSagX, posSagZ, yawRad),
    velMps,
    omegaBallRadps: [0, 0, 0],
    energyBudget: {
      springInitialJ,
      keTransBallJ,
      keRotBallJ: 0,
      keRotArmBailsJ: keArmBailStopJ,
      peGravityDeltaJ,
      frictionLossJ,
    },
    wastedStopKeJ: keArmBailStopJ,
    leftCradle,
    launchSpeedMps: Math.hypot(...velMps),
    launchAngleDeg: leftCradle ? cfg.rampAngleDeg : 0,
    armTraceSamples: samples,
    cycleTimeS,
    cockedBallBottomHeightM: cfg.cockedBallBottomHeightM,
    cordSlackAtDeg,
    peakCordTensionN,
    reachable: true,
    springTotalStoredJ,
    springResidualPeJ: Math.max(0, springTotalStoredJ - springInitialJ),
  }
}

function solveTrebuchetLaunch(
  model: LauncherModel,
  adj: AdjustmentValues,
  env: EnvConfig,
  dtS: number,
  cycleTimeS: number,
  cockJitterDeg: number,
  seatingJitterM: number,
  yawRad: number,
  stopJitterDeg: number
): LaunchReleaseState {
  const cfg = computeTrebuchetConfig(model, adj, cockJitterDeg, stopJitterDeg)
  const g = env.gravityMps2
  const mBall = model.projectile.massKg
  const mPouch = cfg.pouchMassKg
  const mEff = mBall + mPouch
  const mCw = cfg.counterweightMassKg
  const mArm = model.arm.massKg
  const iArm = model.arm.inertiaKgM2
  const cgArm = model.arm.cgArmMm[0] * 1e-3
  const la = cfg.throwingArmM
  const ls = Math.max(0.1, cfg.slingLengthM + seatingJitterM)
  const tauBearing = getEffectiveBearingFrictionNm(model)
  const targetLeadDeg = -(90 - cfg.pinAngleDeg)

  let th = cfg.th0Rad
  let thd = 0
  let beta = cfg.beta0Rad
  let betad = 0
  let t = 0
  let inTrough = true
  let frictionLossJ = 0
  let leftCradle = false

  const zArm0 = cfg.pivotHeightM + cgArm * Math.sin(cfg.th0Rad)
  const peBallArm0 = mEff * g * cfg.troughCenterZM + mArm * g * zArm0

  const samples: ArmTraceSample[] = [
    {
      t: 0,
      psiDeg: beta * RAD_TO_DEG,
      thDeg: th * RAD_TO_DEG,
      omegaArm: 0,
    },
  ]

  const evalRhs = (
    thV: number,
    thdV: number,
    bV: number,
    bdV: number,
    constrained: boolean
  ) => {
    const cwActive = thV < Math.PI * 0.5
    const kc = cwActive ? cfg.kCwM * Math.cos(thV) : 0
    const dkc = cwActive ? -cfg.kCwM * Math.sin(thV) : 0
    const sTh = Math.sin(thV)
    const cTh = Math.cos(thV)
    const cB = Math.cos(bV)
    const sDiff = Math.sin(thV - bV)
    const cDiff = Math.cos(thV - bV)

    const m11 = iArm + mCw * kc * kc + mEff * la * la
    const m12 = -mEff * la * ls * cDiff
    const m22 = mEff * ls * ls

    const tauCw = mCw * g * kc
    const tauGravArmBall = (mArm * cgArm + mEff * la) * g * cTh
    const rhs1NoFric =
      tauCw -
      tauGravArmBall -
      mCw * kc * dkc * thdV * thdV +
      mEff * la * ls * sDiff * bdV * bdV
    const rhs2 = mEff * g * ls * cB - mEff * la * ls * sDiff * thdV * thdV

    const safeCb = Math.abs(cB) > 1e-4 ? cB : cB >= 0 ? 1e-4 : -1e-4
    const jac = (la * cTh) / (ls * safeCb)
    const jacDot =
      (-la * sTh * thdV * (ls * safeCb) + la * cTh * (ls * Math.sin(bV) * bdV)) /
      (ls * ls * safeCb * safeCb)

    let tauHold = 0
    let tauFric: number
    let pFric: number
    if (Math.abs(thdV) < 1e-9) {
      tauHold = constrained
        ? rhs1NoFric + jac * rhs2 - (m12 + jac * m22) * jacDot * thdV
        : rhs1NoFric - (m12 / m22) * rhs2
      tauFric =
        Math.abs(tauHold) <= tauBearing
          ? tauHold
          : tauBearing * (tauHold >= 0 ? 1 : -1)
      pFric = 0
    } else {
      tauFric = tauBearing * (thdV >= 0 ? 1 : -1)
      pFric = tauBearing * Math.abs(thdV)
    }

    const rhs1 = rhs1NoFric - tauFric
    const det = m11 * m22 - m12 * m12
    const thddFree = (m22 * rhs1 - m12 * rhs2) / det
    const bddFree = (-m12 * rhs1 + m11 * rhs2) / det

    if (!constrained) {
      return { dth: thdV, db: bdV, dthd: thddFree, dbd: bddFree, pFric, freeAz: 1, tauHold }
    }

    const freeAz =
      la * cTh * thddFree -
      la * sTh * thdV * thdV -
      ls * cB * bddFree +
      ls * Math.sin(bV) * bdV * bdV
    if (freeAz > 0) {
      return { dth: thdV, db: bdV, dthd: thddFree, dbd: bddFree, pFric, freeAz, tauHold }
    }

    const mEffC = m11 + 2 * jac * m12 + jac * jac * m22
    const thddC = (rhs1 + jac * rhs2 - (m12 + jac * m22) * jacDot * thdV) / mEffC
    const bddC = jac * thddC + jacDot * thdV
    return { dth: thdV, db: bdV, dthd: thddC, dbd: bddC, pFric, freeAz, tauHold }
  }

  const maxSteps = Math.ceil(1.0 / dtS) + 2
  for (let step = 0; step < maxSteps; step++) {
    const thPrev = th
    const thdPrev = thd
    const bPrev = beta
    const bdPrev = betad
    const tPrev = t
    const fricPrev = frictionLossJ

    const k1 = evalRhs(th, thd, beta, betad, inTrough)
    if (step === 0 && Math.abs(thd) < 1e-9 && k1.dthd <= 0) {
      thd = 0
      betad = 0
      leftCradle = false
      break
    }
    if (inTrough && k1.freeAz > 0) {
      inTrough = false
    }
    const k2 = evalRhs(
      th + 0.5 * dtS * k1.dth,
      thd + 0.5 * dtS * k1.dthd,
      beta + 0.5 * dtS * k1.db,
      betad + 0.5 * dtS * k1.dbd,
      inTrough
    )
    const k3 = evalRhs(
      th + 0.5 * dtS * k2.dth,
      thd + 0.5 * dtS * k2.dthd,
      beta + 0.5 * dtS * k2.db,
      betad + 0.5 * dtS * k2.dbd,
      inTrough
    )
    const k4 = evalRhs(
      th + dtS * k3.dth,
      thd + dtS * k3.dthd,
      beta + dtS * k3.db,
      betad + dtS * k3.dbd,
      inTrough
    )

    th += (dtS / 6) * (k1.dth + 2 * k2.dth + 2 * k3.dth + k4.dth)
    thd += (dtS / 6) * (k1.dthd + 2 * k2.dthd + 2 * k3.dthd + k4.dthd)
    beta += (dtS / 6) * (k1.db + 2 * k2.db + 2 * k3.db + k4.db)
    betad += (dtS / 6) * (k1.dbd + 2 * k2.dbd + 2 * k3.dbd + k4.dbd)
    frictionLossJ += (dtS / 6) * (k1.pFric + 2 * k2.pFric + 2 * k3.pFric + k4.pFric)
    t += dtS

    if (inTrough) {
      const sinB = Math.max(
        -0.999,
        Math.min(0.999, (cfg.pivotHeightM + la * Math.sin(th) - cfg.troughCenterZM) / ls)
      )
      beta = Math.PI - Math.asin(sinB)
      const cB = Math.cos(beta)
      betad = Math.abs(cB) > 1e-4 ? ((la * Math.cos(th)) / (ls * cB)) * thd : 0
    }

    if ((thdPrev > 0 && thd <= 0) || (thdPrev < 0 && thd >= 0)) {
      const a = thdPrev / (thdPrev - thd)
      const thZ = thPrev + a * (th - thPrev)
      const bZ = bPrev + a * (beta - bPrev)
      const bdZ = bdPrev + a * (betad - bdPrev)
      const rZ = evalRhs(thZ, 0, bZ, bdZ, inTrough)
      if (Math.abs(rZ.tauHold) <= tauBearing) {
        th = thZ
        thd = 0
        beta = bZ
        betad = inTrough ? 0 : bdZ
        t = tPrev + a * (t - tPrev)
        frictionLossJ = fricPrev + a * (frictionLossJ - fricPrev)
        leftCradle = false
        if (t > samples[samples.length - 1].t + 1e-12) {
          samples.push({
            t,
            psiDeg: beta * RAD_TO_DEG,
            thDeg: th * RAD_TO_DEG,
            omegaArm: 0,
          })
        }
        break
      }
    }

    const leadPrev = (bPrev - thPrev) * RAD_TO_DEG - 180
    const leadNow = (beta - th) * RAD_TO_DEG - 180
    const vxNow = la * Math.sin(th) * thd - ls * Math.sin(beta) * betad

    if (!inTrough && th > 0.2 && leadNow >= targetLeadDeg && vxNow > 0) {
      const denom = leadNow - leadPrev
      const a = denom > 1e-12 ? Math.max(0, Math.min(1, (targetLeadDeg - leadPrev) / denom)) : 1
      th = thPrev + a * (th - thPrev)
      thd = thdPrev + a * (thd - thdPrev)
      beta = bPrev + a * (beta - bPrev)
      betad = bdPrev + a * (betad - bdPrev)
      t = tPrev + a * (t - tPrev)
      frictionLossJ = fricPrev + a * (frictionLossJ - fricPrev)
      leftCradle = true
      if (t > samples[samples.length - 1].t + 1e-12) {
        samples.push({
          t,
          psiDeg: beta * RAD_TO_DEG,
          thDeg: th * RAD_TO_DEG,
          omegaArm: thd,
        })
      }
      break
    }

    samples.push({
      t,
      psiDeg: beta * RAD_TO_DEG,
      thDeg: th * RAD_TO_DEG,
      omegaArm: thd,
    })
  }

  const xSag = -la * Math.cos(th) + ls * Math.cos(beta)
  const zSag = Math.max(0, cfg.pivotHeightM + la * Math.sin(th) - ls * Math.sin(beta))
  const vxPouchSag = la * Math.sin(th) * thd - ls * Math.sin(beta) * betad
  const vzPouchSag = la * Math.cos(th) * thd - ls * Math.cos(beta) * betad
  const vPouchSq = vxPouchSag * vxPouchSag + vzPouchSag * vzPouchSag
  const vxSag = leftCradle ? vxPouchSag : 0
  const vzSag = leftCradle ? vzPouchSag : 0

  const cwActive = th < Math.PI * 0.5
  const kcEnd = cwActive ? cfg.kCwM * Math.cos(th) : 0
  const zDrop = cwActive
    ? cfg.dropHeightM * ((Math.sin(th) - Math.sin(cfg.th0Rad)) / (1 - Math.sin(cfg.th0Rad)))
    : cfg.dropHeightM

  const velMps = rotateSagittalToWorld(vxSag, vzSag, yawRad)
  const keTransBallJ = leftCradle ? 0.5 * mBall * vPouchSq : 0
  const keArmBailCwPouchJ =
    0.5 * iArm * thd * thd +
    0.5 * mCw * (kcEnd * thd) * (kcEnd * thd) +
    0.5 * (mPouch + (leftCradle ? 0 : mBall)) * vPouchSq
  const peBallArmEnd =
    mEff * g * (cfg.pivotHeightM + la * Math.sin(th) - ls * Math.sin(beta)) +
    mArm * g * (cfg.pivotHeightM + cgArm * Math.sin(th))
  const peGravityDeltaJ = peBallArmEnd - peBallArm0
  const cwDropPeJ = mCw * g * zDrop
  const totalCwPeJ = mCw * g * cfg.dropHeightM

  return {
    tReleaseS: t,
    posM: rotateSagittalToWorld(xSag, zSag, yawRad),
    velMps,
    omegaBallRadps: [0, 0, 0],
    energyBudget: {
      springInitialJ: cwDropPeJ,
      keTransBallJ,
      keRotBallJ: 0,
      keRotArmBailsJ: keArmBailCwPouchJ,
      peGravityDeltaJ,
      frictionLossJ,
    },
    wastedStopKeJ: keArmBailCwPouchJ,
    leftCradle,
    launchSpeedMps: Math.hypot(...velMps),
    launchAngleDeg: computeLaunchAngleDeg(velMps),
    armTraceSamples: samples,
    cycleTimeS,
    cockedBallBottomHeightM: cfg.cockedBallBottomHeightM,
    cordSlackAtDeg: null,
    reachable: true,
    springTotalStoredJ: totalCwPeJ,
    springResidualPeJ: Math.max(0, totalCwPeJ - cwDropPeJ),
  }
}

export function solveLaunch(
  model: LauncherModel,
  adjustments: AdjustmentValues,
  env: EnvConfig,
  rng: () => number,
  options: SolveLaunchOptions = {}
): LaunchReleaseState {
  const dtS = validateModelAndEnv(model, env, rng)
  const adj = validateAndClampAdjustments(model, adjustments)
  const deterministic = options.deterministic ?? env.deterministic ?? false
  const includeBallRot = options.includeBallRotInertiaInCup ?? true

  const cycleTimeS = computeCycleTimeS(model, rng, deterministic)
  const cockJitterDeg = deterministic
    ? 0
    : sampleNormal(rng, model.tolerances.cockAngleSigmaDeg)
  const seatingJitterM = deterministic
    ? 0
    : sampleNormal(rng, model.tolerances.seatingOffsetSigmaM)
  const yawJitterDeg = deterministic
    ? 0
    : sampleNormal(rng, model.tolerances.yawSigmaDeg)
  const stopJitterDeg = deterministic
    ? 0
    : sampleNormal(rng, model.tolerances.stopAngleSigmaDeg)
  const yawRad = ((adj.yawDeg ?? 0) + yawJitterDeg) * DEG_TO_RAD

  if (model.topology === 'gravity_trebuchet') {
    return solveTrebuchetLaunch(
      model,
      adj,
      env,
      dtS,
      cycleTimeS,
      cockJitterDeg,
      seatingJitterM,
      yawRad,
      stopJitterDeg
    )
  }

  const bankEnergyJ =
    model.trapBank.count <= 0
      ? 0
      : deterministic
        ? sampleSpringBankEnergy(model, { ...env, energyVarianceJ: 0 }, rng)
        : sampleSpringBankEnergy(model, env, rng)
  const spring = createTorsionSpringSpec(model, bankEnergyJ)

  switch (model.topology) {
    case 'cord_horn':
    case 'circular_cam':
      return solveCordLinkageLaunch(
        model,
        adj,
        spring,
        env,
        dtS,
        cycleTimeS,
        cockJitterDeg,
        seatingJitterM,
        yawRad,
        stopJitterDeg,
        includeBallRot
      )
    case 'direct_rail':
      return solveDirectRailLaunch(
        model,
        adj,
        spring,
        env,
        dtS,
        cycleTimeS,
        cockJitterDeg,
        seatingJitterM,
        yawRad,
        stopJitterDeg
      )
    case 'direct_cup':
    case 'tilted_cradle':
      return solveCoaxialCupOrTiltedLaunch(
        model,
        adj,
        spring,
        env,
        dtS,
        cycleTimeS,
        cockJitterDeg,
        seatingJitterM,
        yawRad,
        stopJitterDeg,
        includeBallRot
      )
    case 'inclined_ramp':
      return solveInclinedRampLaunch(
        model,
        adj,
        spring,
        env,
        dtS,
        cycleTimeS,
        cockJitterDeg,
        seatingJitterM,
        yawRad
      )
  }
}
