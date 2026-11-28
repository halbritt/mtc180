import {
  validateAndClampAdjustments,
  type AdjustmentValues,
  type LauncherModel,
} from '../models'
import {
  bailSide,
  buildCordLinkageTableInternal,
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
  let table = buildCordLinkageTableInternal(model, psiCockDeg, psiStopDeg)
  if (!table.reachable && cockJitterDeg !== 0) {
    const nomTable = buildCordLinkageTableInternal(
      model,
      psiNominalCock,
      psiStopDeg
    )
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
    const lastIdx = table.h1.length - 1
    const h1 = ev.inRange ? ev.h1 : table.h1[lastIdx]
    const h2 = ev.inRange ? ev.h2 : table.h2[lastIdx]
    const thEnd = Math.max(thRestDeg, table.thOfPsiDeg[lastIdx])
    const thVal = ev.inRange
      ? ev.thDeg
      : psiVal < table.psiCockDeg
        ? table.thCockDeg
        : Math.max(thRestDeg, thEnd + h1 * (psiVal - table.psiEndDeg))
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
    if (wVal <= 1e-9) {
      acc = tauDrive > fricMag ? (tauDrive - fricMag) / iEff : 0
      pFric = 0
    } else {
      acc = (tauDrive - fricMag) / iEff
      pFric = fricMag * wVal
    }
    return { acc, pFric, h1, h2, thVal, levBMm: ev.levBMm, tq, bailGrav }
  }

  const rk4TautStep = (psi0: number, w0: number, h: number) => {
    const r1 = evalTautRhs(psi0, w0)
    const k1p = Math.max(0, w0) * RAD_TO_DEG
    const k1w = r1.acc
    const k1f = r1.pFric

    const p2 = psi0 + 0.5 * h * k1p
    const w2 = w0 + 0.5 * h * k1w
    const r2 = evalTautRhs(p2, w2)
    const k2p = Math.max(0, w2) * RAD_TO_DEG
    const k2w = r2.acc
    const k2f = r2.pFric

    const p3 = psi0 + 0.5 * h * k2p
    const w3 = w0 + 0.5 * h * k2w
    const r3 = evalTautRhs(p3, w3)
    const k3p = Math.max(0, w3) * RAD_TO_DEG
    const k3w = r3.acc
    const k3f = r3.pFric

    const p4 = psi0 + h * k3p
    const w4 = w0 + h * k3w
    const r4 = evalTautRhs(p4, w4)
    const k4p = Math.max(0, w4) * RAD_TO_DEG
    const k4w = r4.acc
    const k4f = r4.pFric

    return {
      psi1: psi0 + (h / 6) * (k1p + 2 * k2p + 2 * k3p + k4p),
      w1: w0 + (h / 6) * (k1w + 2 * k2w + 2 * k3w + k4w),
      dFric: (h / 6) * (k1f + 2 * k2f + 2 * k3f + k4f),
      acc0: r1.acc,
    }
  }

  const evalArmSlackRhs = (pVal: number, wVal: number) => {
    const gravA = gravArmTorque(pVal)
    const tauDriveA = -gravA
    if (wVal <= 1e-9) {
      return {
        accA: tauDriveA > tauBearing ? (tauDriveA - tauBearing) / iArmBall : 0,
        pFricA: 0,
      }
    }
    return {
      accA: (tauDriveA - tauBearing) / iArmBall,
      pFricA: tauBearing * wVal,
    }
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
    if (wbVal >= -1e-9) {
      return {
        accB: tauBailDrive < -tauBearing ? (tauBailDrive + tauBearing) / iBail : 0,
        pFricB: 0,
      }
    }
    return {
      accB: (tauBailDrive + tauBearing) / iBail,
      pFricB: tauBearing * -wbVal,
    }
  }

  const rk4ArmSlackStep = (psi0: number, w0: number, h: number) => {
    const r1 = evalArmSlackRhs(psi0, w0)
    const k1p = Math.max(0, w0) * RAD_TO_DEG
    const k1w = r1.accA
    const k1f = r1.pFricA

    const w2 = w0 + 0.5 * h * k1w
    const r2 = evalArmSlackRhs(psi0 + 0.5 * h * k1p, w2)
    const k2p = Math.max(0, w2) * RAD_TO_DEG
    const k2w = r2.accA
    const k2f = r2.pFricA

    const w3 = w0 + 0.5 * h * k2w
    const r3 = evalArmSlackRhs(psi0 + 0.5 * h * k2p, w3)
    const k3p = Math.max(0, w3) * RAD_TO_DEG
    const k3w = r3.accA
    const k3f = r3.pFricA

    const w4 = w0 + h * k3w
    const r4 = evalArmSlackRhs(psi0 + h * k3p, w4)
    const k4p = Math.max(0, w4) * RAD_TO_DEG
    const k4w = r4.accA
    const k4f = r4.pFricA

    return {
      psi1: psi0 + (h / 6) * (k1p + 2 * k2p + 2 * k3p + k4p),
      w1: w0 + (h / 6) * (k1w + 2 * k2w + 2 * k3w + k4w),
      dFricA: (h / 6) * (k1f + 2 * k2f + 2 * k3f + k4f),
      acc0: r1.accA,
    }
  }

  const rk4BailSlackStep = (th0: number, wb0: number, h: number) => {
    if (h <= 0 || th0 <= thRestDeg) {
      return { th1: th0, wb1: wb0, dFricB: 0, acc0: 0 }
    }
    const b1 = evalBailSlackRhs(th0, wb0)
    const b1t = Math.min(0, wb0) * RAD_TO_DEG
    const b1w = b1.accB
    const b1f = b1.pFricB

    const wb2 = wb0 + 0.5 * h * b1w
    const b2 = evalBailSlackRhs(th0 + 0.5 * h * b1t, wb2)
    const b2t = Math.min(0, wb2) * RAD_TO_DEG
    const b2w = b2.accB
    const b2f = b2.pFricB

    const wb3 = wb0 + 0.5 * h * b2w
    const b3 = evalBailSlackRhs(th0 + 0.5 * h * b2t, wb3)
    const b3t = Math.min(0, wb3) * RAD_TO_DEG
    const b3w = b3.accB
    const b3f = b3.pFricB

    const wb4 = wb0 + h * b3w
    const b4 = evalBailSlackRhs(th0 + h * b3t, wb4)
    const b4t = Math.min(0, wb4) * RAD_TO_DEG
    const b4w = b4.accB
    const b4f = b4.pFricB

    return {
      th1: th0 + (h / 6) * (b1t + 2 * b2t + 2 * b3t + b4t),
      wb1: wb0 + (h / 6) * (b1w + 2 * b2w + 2 * b3w + b4w),
      dFricB: (h / 6) * (b1f + 2 * b2f + 2 * b3f + b4f),
      acc0: b1.accB,
    }
  }

  const advanceSlackStep = (dtStep: number): 'continue' | 'break' => {
    const psiS0 = psi
    const wS0 = w
    const thS0 = th
    const wbS0 = wb
    const tS0 = t
    const fricS0 = frictionLossJ

    const rA0 = evalArmSlackRhs(psiS0, wS0)
    const psiRad0 = psiS0 * DEG_TO_RAD
    const etZ0 = (-oxM * Math.cos(psiRad0) - ozM * Math.sin(psiRad0)) / rBallM
    if (wS0 > 1.0 && mBall * (rBallM * rA0.accA + g * etZ0) < 0) {
      leftCradle = true
      return 'break'
    }

    const armFull = rk4ArmSlackStep(psiS0, wS0, dtStep)
    let bailHitAlpha = 2
    let bailImpactLoss = 0
    let stepBailFric = 0
    let thNext = thS0
    let wbNext = wbS0

    if (thS0 > thRestDeg) {
      const bailFull = rk4BailSlackStep(thS0, wbS0, dtStep)
      if (bailFull.th1 > thRestDeg) {
        if (wbS0 < 0 && bailFull.wb1 >= 0) {
          const fracStop = Math.max(
            0,
            Math.min(
              1,
              bailFull.acc0 > 0
                ? -wbS0 / (bailFull.acc0 * dtStep)
                : -wbS0 / (bailFull.wb1 - wbS0)
            )
          )
          const bailStop = rk4BailSlackStep(thS0, wbS0, fracStop * dtStep)
          bailHitAlpha = fracStop
          thNext = Math.max(thRestDeg, bailStop.th1)
          wbNext = 0
          stepBailFric = bailStop.dFricB
        } else {
          thNext = bailFull.th1
          wbNext = Math.min(0, bailFull.wb1)
          stepBailFric = bailFull.dFricB
        }
      } else {
        const denomTh = thS0 - bailFull.th1
        let fracHit = denomTh > 1e-12 ? (thS0 - thRestDeg) / denomTh : 1
        fracHit = Math.max(0, Math.min(1, fracHit))
        let bailHit = rk4BailSlackStep(thS0, wbS0, fracHit * dtStep)
        if (Math.abs(bailHit.th1 - thRestDeg) > 1e-7 && Math.abs(bailHit.wb1) > 1e-6) {
          fracHit = Math.max(
            0,
            Math.min(1, fracHit - (bailHit.th1 - thRestDeg) / (bailHit.wb1 * RAD_TO_DEG * dtStep))
          )
          bailHit = rk4BailSlackStep(thS0, wbS0, fracHit * dtStep)
        }
        bailHitAlpha = fracHit
        stepBailFric = bailHit.dFricB
        bailImpactLoss = 0.5 * iBail * bailHit.wb1 * bailHit.wb1
        thNext = thRestDeg
        wbNext = 0
      }
    }

    // Order psiStopDeg vs w <= 0 crossing cleanly
    if (armFull.psi1 >= psiStopDeg) {
      const denom = armFull.psi1 - psiS0
      let alphaStop = denom > 1e-12 ? (psiStopDeg - psiS0) / denom : 1
      alphaStop = Math.max(0, Math.min(1, alphaStop))
      let armStop = rk4ArmSlackStep(psiS0, wS0, alphaStop * dtStep)
      if (Math.abs(armStop.psi1 - psiStopDeg) > 1e-7 && Math.abs(armStop.w1) > 1e-6) {
        alphaStop = Math.max(
          0,
          Math.min(1, alphaStop - (armStop.psi1 - psiStopDeg) / (armStop.w1 * RAD_TO_DEG * dtStep))
        )
        armStop = rk4ArmSlackStep(psiS0, wS0, alphaStop * dtStep)
      }
      if (armStop.w1 > 0 || armFull.w1 > 0) {
        psi = psiStopDeg
        w = Math.max(0, armStop.w1)
        t = tS0 + alphaStop * dtStep
        if (thS0 > thRestDeg && alphaStop < bailHitAlpha) {
          const bailAtStop = rk4BailSlackStep(thS0, wbS0, alphaStop * dtStep)
          th = Math.max(thRestDeg, bailAtStop.th1)
          wb = th <= thRestDeg ? 0 : Math.min(0, bailAtStop.wb1)
          frictionLossJ = fricS0 + armStop.dFricA + bailAtStop.dFricB
        } else {
          th = thNext
          wb = wbNext
          frictionLossJ = fricS0 + armStop.dFricA + stepBailFric + bailImpactLoss
        }
        leftCradle = true
        if (t > samples[samples.length - 1].t + 1e-12) {
          samples.push({ t, psiDeg: psi, thDeg: th, omegaArm: w })
        }
        return 'break'
      }
    }

    if (armFull.w1 <= 0) {
      let alpha = 1
      if (wS0 > 0) {
        alpha =
          armFull.acc0 < 0
            ? Math.min(1, wS0 / (-armFull.acc0 * dtStep))
            : Math.max(0, Math.min(1, wS0 / (wS0 - armFull.w1)))
        let armStop = rk4ArmSlackStep(psiS0, wS0, alpha * dtStep)
        if (armFull.acc0 < 0 && Math.abs(armStop.w1) > 1e-7) {
          alpha = Math.max(0, Math.min(1, alpha - armStop.w1 / (armFull.acc0 * dtStep)))
          armStop = rk4ArmSlackStep(psiS0, wS0, alpha * dtStep)
        }
        psi = armStop.psi1
        t = tS0 + alpha * dtStep
        if (thS0 > thRestDeg && alpha < bailHitAlpha) {
          const bailAtStop = rk4BailSlackStep(thS0, wbS0, alpha * dtStep)
          th = Math.max(thRestDeg, bailAtStop.th1)
          wb = th <= thRestDeg ? 0 : Math.min(0, bailAtStop.wb1)
          frictionLossJ = fricS0 + armStop.dFricA + bailAtStop.dFricB
        } else {
          th = thNext
          wb = wbNext
          frictionLossJ = fricS0 + armStop.dFricA + stepBailFric + bailImpactLoss
        }
      } else {
        th = thNext
        wb = wbNext
        frictionLossJ = fricS0 + stepBailFric + bailImpactLoss
      }
      w = 0
      if (th <= thRestDeg) wb = 0
      stalled = true
      if (t > samples[samples.length - 1].t + 1e-12) {
        samples.push({ t, psiDeg: psi, thDeg: th, omegaArm: 0 })
      }
      return 'break'
    }

    psi = armFull.psi1
    w = armFull.w1
    th = thNext
    wb = wbNext
    t = tS0 + dtStep
    frictionLossJ = fricS0 + armFull.dFricA + stepBailFric + bailImpactLoss

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
    return 'continue'
  }

  const maxSteps = Math.ceil(MAX_SIM_TIME_S / dtS) + 2
  for (let step = 0; step < maxSteps; step++) {
    if (psi >= psiStopDeg) break

    const psiPrev = psi
    const wPrev = w
    const tPrev = t
    const fricPrev = frictionLossJ

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

      const stepFull = rk4TautStep(psiPrev, wPrev, dtS)

      // 1) Hard stop reached while still inside taut table range
      if (psiStopDeg <= table.psiEndDeg && stepFull.psi1 >= psiStopDeg) {
        const denom = stepFull.psi1 - psiPrev
        let alphaStop = denom > 1e-12 ? (psiStopDeg - psiPrev) / denom : 1
        alphaStop = Math.max(0, Math.min(1, alphaStop))
        let atStop = rk4TautStep(psiPrev, wPrev, alphaStop * dtS)
        if (Math.abs(atStop.psi1 - psiStopDeg) > 1e-7 && Math.abs(atStop.w1) > 1e-6) {
          alphaStop = Math.max(
            0,
            Math.min(1, alphaStop - (atStop.psi1 - psiStopDeg) / (atStop.w1 * RAD_TO_DEG * dtS))
          )
          atStop = rk4TautStep(psiPrev, wPrev, alphaStop * dtS)
        }
        if (atStop.w1 > 0 || stepFull.w1 > 0) {
          psi = psiStopDeg
          w = Math.max(0, atStop.w1)
          t = tPrev + alphaStop * dtS
          frictionLossJ = fricPrev + atStop.dFric
          const evStop = table.evalAtPsi(psi)
          const h1Stop = evStop.inRange ? evStop.h1 : table.h1[table.h1.length - 1]
          th = evStop.inRange
            ? evStop.thDeg
            : Math.max(thRestDeg, table.thOfPsiDeg[table.thOfPsiDeg.length - 1])
          wb = h1Stop * w
          leftCradle = true
          if (t > samples[samples.length - 1].t + 1e-12) {
            samples.push({ t, psiDeg: psi, thDeg: th, omegaArm: w })
          }
          if (th > thRestDeg) {
            const rEnd = evalTautRhs(psi, w)
            const levBMEnd = Math.max(1e-4, rEnd.levBMm * 1e-3)
            const tEnd =
              (rEnd.tq +
                rEnd.bailGrav +
                iBail * (rEnd.h1 * rEnd.acc + rEnd.h2 * w * w) -
                tauBearing) /
              levBMEnd
            if (tEnd > peakCordTensionN) peakCordTensionN = tEnd
          }
          break
        }
      }

      // 2) Taut-to-slack crossing at psi == table.psiEndDeg: split step cleanly
      if (stepFull.psi1 > table.psiEndDeg) {
        const denom = stepFull.psi1 - psiPrev
        let alphaEnd = denom > 1e-12 ? (table.psiEndDeg - psiPrev) / denom : 1
        alphaEnd = Math.max(0, Math.min(1, alphaEnd))
        let atEnd = rk4TautStep(psiPrev, wPrev, alphaEnd * dtS)
        for (let it = 0; it < 2; it++) {
          const res = atEnd.psi1 - table.psiEndDeg
          if (Math.abs(res) <= 1e-8 || Math.abs(atEnd.w1) <= 1e-6) break
          alphaEnd = Math.max(
            0,
            Math.min(1, alphaEnd - res / (atEnd.w1 * RAD_TO_DEG * dtS))
          )
          atEnd = rk4TautStep(psiPrev, wPrev, alphaEnd * dtS)
        }
        if (atEnd.w1 > 0 || stepFull.w1 > 0) {
          psi = table.psiEndDeg
          w = Math.max(0, atEnd.w1)
          t = tPrev + alphaEnd * dtS
          frictionLossJ = fricPrev + atEnd.dFric
          const h1End = table.h1[table.h1.length - 1]
          th = Math.max(thRestDeg, table.thOfPsiDeg[table.thOfPsiDeg.length - 1])
          wb = h1End * w
          taut = false
          if (cordSlackAtDeg === null) cordSlackAtDeg = th
          if (th <= thRestDeg) {
            th = thRestDeg
            frictionLossJ += 0.5 * iBail * wb * wb
            wb = 0
          }
          if (psi >= psiStopDeg) {
            leftCradle = true
            if (t > samples[samples.length - 1].t + 1e-12) {
              samples.push({ t, psiDeg: psi, thDeg: th, omegaArm: w })
            }
            break
          }
          const remDt = (1 - alphaEnd) * dtS
          if (remDt > 1e-12 && advanceSlackStep(remDt) === 'break') {
            break
          }
          samples.push({ t, psiDeg: psi, thDeg: th, omegaArm: w })
          continue
        }
      }

      // 3) Stall (w <= 0) before reaching psiEndDeg or psiStopDeg
      if (stepFull.w1 <= 0) {
        if (wPrev > 0) {
          let alpha =
            stepFull.acc0 < 0
              ? Math.min(1, wPrev / (-stepFull.acc0 * dtS))
              : Math.max(0, Math.min(1, wPrev / (wPrev - stepFull.w1)))
          let atZero = rk4TautStep(psiPrev, wPrev, alpha * dtS)
          if (stepFull.acc0 < 0 && Math.abs(atZero.w1) > 1e-7) {
            alpha = Math.max(0, Math.min(1, alpha - atZero.w1 / (stepFull.acc0 * dtS)))
            atZero = rk4TautStep(psiPrev, wPrev, alpha * dtS)
          }
          psi = Math.min(table.psiEndDeg, atZero.psi1)
          t = tPrev + alpha * dtS
          frictionLossJ = fricPrev + atZero.dFric
          const evZ = table.evalAtPsi(psi)
          th = evZ.inRange
            ? evZ.thDeg
            : Math.max(thRestDeg, table.thOfPsiDeg[table.thOfPsiDeg.length - 1])
        }
        w = 0
        wb = 0
        stalled = true
        if (t > samples[samples.length - 1].t + 1e-12) {
          samples.push({ t, psiDeg: psi, thDeg: th, omegaArm: 0 })
        }
        break
      }

      psi = stepFull.psi1
      w = stepFull.w1
      frictionLossJ = fricPrev + stepFull.dFric
      t = tPrev + dtS
      const evNext = table.evalAtPsi(psi)
      th = evNext.inRange
        ? evNext.thDeg
        : Math.max(thRestDeg, table.thOfPsiDeg[table.thOfPsiDeg.length - 1])
      wb = (evNext.inRange ? evNext.h1 : table.h1[table.h1.length - 1]) * w
    } else {
      if (taut) {
        taut = false
        if (cordSlackAtDeg === null) cordSlackAtDeg = th
      }
      if (advanceSlackStep(dtS) === 'break') {
        break
      }
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
    const qs = -mBall * g * (cg * Math.sin(th) + sg * Math.cos(th))
    const rhs2 = qs + 0.5 * mBall * as_ * pdVal * pdVal
    const det = m11 * ms - c * c
    const lockedS = sVal <= 1e-9 && sdVal <= 0

    if (pdVal <= 1e-9) {
      const pFric = 0
      const qpDrive = tauDrive - tauBearing
      if (lockedS) {
        const accSCheck = (-c * Math.max(0, qpDrive) + m11 * rhs2) / det
        if (accSCheck <= 0) {
          return {
            dphi: 0,
            ds: 0,
            dpd: qpDrive > 0 ? qpDrive / m11 : 0,
            dsd: 0,
            pFric,
          }
        }
      }
      const tauHold = tauDrive - (c / ms) * rhs2
      if (tauHold <= tauBearing) {
        const dsd = lockedS && rhs2 <= 0 ? 0 : rhs2 / ms
        return {
          dphi: 0,
          ds: lockedS && dsd <= 0 ? 0 : sdVal,
          dpd: 0,
          dsd,
          pFric,
        }
      }
      const accPhiFree = (ms * qpDrive - c * rhs2) / det
      const accSFree = (-c * qpDrive + m11 * rhs2) / det
      if (lockedS && accSFree <= 0) {
        return { dphi: 0, ds: 0, dpd: qpDrive / m11, dsd: 0, pFric }
      }
      return { dphi: 0, ds: sdVal, dpd: accPhiFree, dsd: accSFree, pFric }
    }

    const qp = tauDrive - tauBearing
    const accPhiFree = (ms * qp - c * rhs2) / det
    const accSFree = (-c * qp + m11 * rhs2) / det
    const pFric = tauBearing * pdVal

    if (lockedS && accSFree <= 0) {
      return { dphi: pdVal, ds: 0, dpd: qp / m11, dsd: 0, pFric }
    }
    return { dphi: pdVal, ds: sdVal, dpd: accPhiFree, dsd: accSFree, pFric }
  }

  const rk4RailStep = (
    p0: number,
    s0: number,
    pd0: number,
    sd0: number,
    h: number
  ) => {
    const k1 = evalRhs(p0, s0, pd0, sd0)
    const k2 = evalRhs(
      p0 + 0.5 * h * k1.dphi,
      Math.max(0, s0 + 0.5 * h * k1.ds),
      pd0 + 0.5 * h * k1.dpd,
      sd0 + 0.5 * h * k1.dsd
    )
    const k3 = evalRhs(
      p0 + 0.5 * h * k2.dphi,
      Math.max(0, s0 + 0.5 * h * k2.ds),
      pd0 + 0.5 * h * k2.dpd,
      sd0 + 0.5 * h * k2.dsd
    )
    const k4 = evalRhs(
      p0 + h * k3.dphi,
      Math.max(0, s0 + h * k3.ds),
      pd0 + h * k3.dpd,
      sd0 + h * k3.dsd
    )
    return {
      phi1: p0 + (h / 6) * (k1.dphi + 2 * k2.dphi + 2 * k3.dphi + k4.dphi),
      s1: s0 + (h / 6) * (k1.ds + 2 * k2.ds + 2 * k3.ds + k4.ds),
      pd1: pd0 + (h / 6) * (k1.dpd + 2 * k2.dpd + 2 * k3.dpd + k4.dpd),
      sd1: sd0 + (h / 6) * (k1.dsd + 2 * k2.dsd + 2 * k3.dsd + k4.dsd),
      dFric: (h / 6) * (k1.pFric + 2 * k2.pFric + 2 * k3.pFric + k4.pFric),
      k1,
    }
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

    const stepFull = rk4RailStep(phiPrev, sPrev, pdPrev, sdPrev, dtS)
    if (phid === 0 && stepFull.k1.dpd <= 0) {
      break
    }

    phi = stepFull.phi1
    s = stepFull.s1
    phid = stepFull.pd1
    sd = stepFull.sd1
    frictionLossJ = fricPrev + stepFull.dFric
    t = tPrev + dtS

    let hitBackstop = false
    if (s <= 0) {
      if (sd < 0) {
        hitBackstop = true
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
        if (!hitBackstop && stepFull.k1.dpd < 0) {
          let a = Math.max(0, Math.min(1, pdPrev / (-stepFull.k1.dpd * dtS)))
          let atZ = rk4RailStep(phiPrev, sPrev, pdPrev, sdPrev, a * dtS)
          if (Math.abs(atZ.pd1) > 1e-7) {
            a = Math.max(0, Math.min(1, a - atZ.pd1 / (stepFull.k1.dpd * dtS)))
            atZ = rk4RailStep(phiPrev, sPrev, pdPrev, sdPrev, a * dtS)
          }
          phi = atZ.phi1
          s = Math.max(0, atZ.s1)
          sd = s <= 1e-9 ? Math.max(0, atZ.sd1) : atZ.sd1
          t = tPrev + a * dtS
          frictionLossJ = fricPrev + atZ.dFric
        } else {
          const a = pdPrev / (pdPrev - phid)
          phi = phiPrev + a * (phi - phiPrev)
          s = Math.max(0, sPrev + a * (s - sPrev))
          sd = s <= 1e-9 ? Math.max(0, sdPrev + a * (sd - sdPrev)) : sdPrev + a * (sd - sdPrev)
          t = tPrev + a * (t - tPrev)
          frictionLossJ = fricPrev + a * (frictionLossJ - fricPrev)
        }
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

  if (thCockDeg <= thStopDeg) {
    const bpBlocked = ballPos(thCockDeg)
    return {
      tReleaseS: 0,
      posM: rotateSagittalToWorld(bpBlocked.x, bpBlocked.z, yawRad),
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
      launchAngleDeg: 0,
      armTraceSamples: [
        {
          t: 0,
          psiDeg: isTilted ? tiltedCfg!.alphaTrapFrontDeg + thCockDeg : 90 - thCockDeg,
          thDeg: thCockDeg,
          omegaArm: 0,
        },
      ],
      cycleTimeS,
      cockedBallBottomHeightM,
      cordSlackAtDeg: null,
      reachable: false,
      springTotalStoredJ: 0,
      springResidualPeJ: 0,
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
    if (wVal <= 1e-9) {
      return {
        acc: tauDrive > tauBearing ? (tauDrive - tauBearing) / iTotal : 0,
        pFric: 0,
      }
    }
    return {
      acc: (tauDrive - tauBearing) / iTotal,
      pFric: tauBearing * wVal,
    }
  }

  const rk4CupStep = (th0: number, w0: number, h: number) => {
    const r1 = evalRhs(th0, w0)
    const k1t = -Math.max(0, w0) * RAD_TO_DEG
    const k1w = r1.acc
    const k1f = r1.pFric

    const w2 = w0 + 0.5 * h * k1w
    const r2 = evalRhs(th0 + 0.5 * h * k1t, w2)
    const k2t = -Math.max(0, w2) * RAD_TO_DEG
    const k2w = r2.acc
    const k2f = r2.pFric

    const w3 = w0 + 0.5 * h * k2w
    const r3 = evalRhs(th0 + 0.5 * h * k2t, w3)
    const k3t = -Math.max(0, w3) * RAD_TO_DEG
    const k3w = r3.acc
    const k3f = r3.pFric

    const w4 = w0 + h * k3w
    const r4 = evalRhs(th0 + h * k3t, w4)
    const k4t = -Math.max(0, w4) * RAD_TO_DEG
    const k4w = r4.acc
    const k4f = r4.pFric

    return {
      th1: th0 + (h / 6) * (k1t + 2 * k2t + 2 * k3t + k4t),
      w1: w0 + (h / 6) * (k1w + 2 * k2w + 2 * k3w + k4w),
      dFric: (h / 6) * (k1f + 2 * k2f + 2 * k3f + k4f),
      acc0: r1.acc,
    }
  }

  const maxSteps = Math.ceil(MAX_SIM_TIME_S / dtS) + 2
  for (let step = 0; step < maxSteps; step++) {
    if (th <= thStopDeg) {
      leftCradle = w > 0
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

    const stepFull = rk4CupStep(thPrev, wPrev, dtS)
    th = stepFull.th1
    w = stepFull.w1
    frictionLossJ = fricPrev + stepFull.dFric
    t = tPrev + dtS

    if (th <= thStopDeg) {
      const denom = thPrev - th
      const a = denom > 1e-12 ? Math.max(0, Math.min(1, (thPrev - thStopDeg) / denom)) : 1
      const atStop = rk4CupStep(thPrev, wPrev, a * dtS)
      if (atStop.w1 > 0 || w > 0) {
        th = thStopDeg
        w = Math.max(0, atStop.w1)
        t = tPrev + a * dtS
        frictionLossJ = fricPrev + atStop.dFric
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
    }

    if (w <= 0) {
      if (wPrev > 0) {
        let a =
          stepFull.acc0 < 0
            ? Math.min(1, wPrev / (-stepFull.acc0 * dtS))
            : Math.max(0, Math.min(1, wPrev / (wPrev - w)))
        let atZero = rk4CupStep(thPrev, wPrev, a * dtS)
        if (stepFull.acc0 < 0 && Math.abs(atZero.w1) > 1e-7) {
          a = Math.max(0, Math.min(1, a - atZero.w1 / (stepFull.acc0 * dtS)))
          atZero = rk4CupStep(thPrev, wPrev, a * dtS)
        }
        th = atZero.th1
        t = tPrev + a * dtS
        frictionLossJ = fricPrev + atZero.dFric
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
    if (wbVal <= 1e-9) {
      acc = tauDrive > fricTot ? (tauDrive - fricTot) / iEff : 0
      pFric = 0
    } else {
      acc = (tauDrive - fricTot) / iEff
      pFric = fricTot * wbVal
    }
    const tension =
      mTot * (k * acc + dk * wbVal * wbVal) +
      fChuteGrav +
      (wbVal > 1e-9 ? fChuteFric : 0)
    return { acc, pFric, k, tension }
  }

  const rk4RampTautStep = (th0: number, wb0: number, s0: number, h: number) => {
    const r1 = evalTautRhs(th0, wb0)
    const w1Pos = Math.max(0, wb0)
    const k1t = -w1Pos * RAD_TO_DEG
    const k1w = r1.acc
    const k1s = r1.k * w1Pos
    const k1f = r1.pFric

    const w2 = wb0 + 0.5 * h * k1w
    const r2 = evalTautRhs(th0 + 0.5 * h * k1t, w2)
    const w2Pos = Math.max(0, w2)
    const k2t = -w2Pos * RAD_TO_DEG
    const k2w = r2.acc
    const k2s = r2.k * w2Pos
    const k2f = r2.pFric

    const w3 = wb0 + 0.5 * h * k2w
    const r3 = evalTautRhs(th0 + 0.5 * h * k2t, w3)
    const w3Pos = Math.max(0, w3)
    const k3t = -w3Pos * RAD_TO_DEG
    const k3w = r3.acc
    const k3s = r3.k * w3Pos
    const k3f = r3.pFric

    const w4 = wb0 + h * k3w
    const r4 = evalTautRhs(th0 + h * k3t, w4)
    const w4Pos = Math.max(0, w4)
    const k4t = -w4Pos * RAD_TO_DEG
    const k4w = r4.acc
    const k4s = r4.k * w4Pos
    const k4f = r4.pFric

    return {
      th1: th0 + (h / 6) * (k1t + 2 * k2t + 2 * k3t + k4t),
      wb1: wb0 + (h / 6) * (k1w + 2 * k2w + 2 * k3w + k4w),
      s1: s0 + (h / 6) * (k1s + 2 * k2s + 2 * k3s + k4s),
      dFric: (h / 6) * (k1f + 2 * k2f + 2 * k3f + k4f),
      acc0: r1.acc,
    }
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

      const stepFull = rk4RampTautStep(thPrev, wbPrev, sPrev, dtS)
      th = stepFull.th1
      wb = stepFull.wb1
      s = stepFull.s1
      frictionLossJ = fricPrev + stepFull.dFric
      t = tPrev + dtS

      const kEnd = bailLevM(th)
      vBall = kEnd * wb
      sSled = s

      if (s >= rampLengthM && wb > 0) {
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

      if (wb <= 0) {
        if (wbPrev > 0) {
          let a =
            stepFull.acc0 < 0
              ? Math.min(1, wbPrev / (-stepFull.acc0 * dtS))
              : Math.max(0, Math.min(1, wbPrev / (wbPrev - wb)))
          let atZero = rk4RampTautStep(thPrev, wbPrev, sPrev, a * dtS)
          if (stepFull.acc0 < 0 && Math.abs(atZero.wb1) > 1e-7) {
            a = Math.max(0, Math.min(1, a - atZero.wb1 / (stepFull.acc0 * dtS)))
            atZero = rk4RampTautStep(thPrev, wbPrev, sPrev, a * dtS)
          }
          th = atZero.th1
          s = atZero.s1
          sSled = s
          t = tPrev + a * dtS
          frictionLossJ = fricPrev + atZero.dFric
        }
        wb = 0
        vBall = 0
        leftCradle = false
        if (t > samples[samples.length - 1].t + 1e-12) {
          samples.push({ t, psiDeg: cfg.rampAngleDeg, thDeg: th, omegaArm: 0 })
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
      const sNext = sPrev + vPrev * dtS - 0.5 * decel * dtS * dtS
      const vNext = vPrev - decel * dtS

      if (sNext >= rampLengthM) {
        const disc = Math.max(0, vPrev * vPrev - 2 * decel * (rampLengthM - sPrev))
        const vExit = Math.sqrt(disc)
        const tHit = decel > 1e-12 ? (vPrev - vExit) / decel : (rampLengthM - sPrev) / Math.max(1e-12, vPrev)
        s = rampLengthM
        vBall = vExit
        t = tPrev + Math.max(0, Math.min(dtS, tHit))
        frictionLossJ = fricPrev + mBall * g * cfg.muChute * cosB * (rampLengthM - sPrev)
        leftCradle = true
        if (t > samples[samples.length - 1].t + 1e-12) {
          samples.push({ t, psiDeg: cfg.rampAngleDeg, thDeg: th, omegaArm: 0 })
        }
        break
      }

      if (vNext <= 0) {
        const tStop = decel > 1e-12 ? Math.max(0, Math.min(dtS, vPrev / decel)) : 0
        const dsStop = 0.5 * vPrev * tStop
        s = sPrev + dsStop
        vBall = 0
        t = tPrev + tStop
        frictionLossJ = fricPrev + mBall * g * cfg.muChute * cosB * dsStop
        leftCradle = false
        if (t > samples[samples.length - 1].t + 1e-12) {
          samples.push({ t, psiDeg: cfg.rampAngleDeg, thDeg: th, omegaArm: 0 })
        }
        break
      }

      s = sNext
      vBall = vNext
      frictionLossJ = fricPrev + mBall * g * cfg.muChute * cosB * (s - sPrev)
      t = tPrev + dtS

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
  const sinB0Raw =
    (cfg.pivotHeightM + la * Math.sin(cfg.th0Rad) - cfg.troughCenterZM) / ls
  let beta =
    seatingJitterM === 0
      ? cfg.beta0Rad
      : Math.PI - Math.asin(Math.max(-0.99, Math.min(0.99, sinB0Raw)))
  let betad = 0
  let t = 0
  let inTrough = cfg.startsInTrough && sinB0Raw >= -0.99 && sinB0Raw <= 0.99
  let frictionLossJ = 0
  let leftCradle = false

  const zArm0 = cfg.pivotHeightM + cgArm * Math.sin(cfg.th0Rad)
  const zBall0M =
    seatingJitterM === 0 && cfg.startsInTrough
      ? cfg.zBall0M
      : cfg.pivotHeightM + la * Math.sin(cfg.th0Rad) - ls * Math.sin(beta)
  const peBallArm0 = mEff * g * zBall0M + mArm * g * zArm0

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
    constrained: boolean,
    thdDir = 0
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
    const crossedZero =
      Math.abs(thdV) < 1e-9 ||
      (thdDir > 0 && thdV <= 1e-9) ||
      (thdDir < 0 && thdV >= -1e-9)
    if (crossedZero) {
      tauHold = constrained
        ? rhs1NoFric + jac * rhs2 - (m12 + jac * m22) * jacDot * thdV
        : rhs1NoFric - (m12 / m22) * rhs2
      if (Math.abs(tauHold) <= tauBearing) {
        tauFric = tauHold
        pFric = 0
      } else {
        tauFric = tauBearing * (tauHold >= 0 ? 1 : -1)
        pFric = Math.abs(thdV) < 1e-9 ? 0 : tauBearing * Math.abs(thdV)
      }
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

    const thdDir = thdPrev > 1e-9 ? 1 : thdPrev < -1e-9 ? -1 : 0
    const k1 = evalRhs(th, thd, beta, betad, inTrough, 0)
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
      inTrough,
      thdDir
    )
    const k3 = evalRhs(
      th + 0.5 * dtS * k2.dth,
      thd + 0.5 * dtS * k2.dthd,
      beta + 0.5 * dtS * k2.db,
      betad + 0.5 * dtS * k2.dbd,
      inTrough,
      thdDir
    )
    const k4 = evalRhs(
      th + dtS * k3.dth,
      thd + dtS * k3.dthd,
      beta + dtS * k3.db,
      betad + dtS * k3.dbd,
      inTrough,
      thdDir
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
