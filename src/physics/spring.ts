import { NOMINAL_ENERGY_PER_TRAP_J, type LauncherModel } from '../models'

const DEG_TO_RAD = Math.PI / 180
const BASELINE_3TRAP_ENERGY_J = 3 * NOMINAL_ENERGY_PER_TRAP_J

export interface TorsionSpringSpec {
  readonly count: number
  readonly totalEnergyJ: number
  readonly torqueRatio: number
  readonly thCockMaxDeg: number
  readonly thRestDeg: number
  readonly springZeroOffsetDeg: number
  readonly tauRestNm: number
  readonly tauCock180Nm: number
}

export interface SpringEnvParams {
  readonly nominalEnergyJ: number
  readonly energyVarianceJ: number
  readonly energyDistribution?: 'uniform' | 'gaussian'
}

function assertFiniteNumber(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RangeError(`${label} must be a finite number, got ${String(value)}.`)
  }
  return value
}

export function validateSpringParams(
  totalEnergyJ: number,
  torqueRatio: number
): void {
  assertFiniteNumber(totalEnergyJ, 'totalEnergyJ')
  if (totalEnergyJ < 0) {
    throw new RangeError(`totalEnergyJ must be >= 0, got ${totalEnergyJ}.`)
  }
  assertFiniteNumber(torqueRatio, 'torqueRatio')
  if (torqueRatio < 0 || torqueRatio > 1) {
    throw new RangeError(`torqueRatio must be in [0, 1], got ${torqueRatio}.`)
  }
}

/**
 * Linear torsion spring torque tau(theta) in N*m:
 *   tau(theta_eff) = tc * (r + (1 - r) * max(0, theta_eff) / 180)
 * where theta_eff = thetaDeg + springZeroOffsetDeg (unclamped above 180 deg),
 * and tc = totalEnergyJ / (pi * (1 + r) / 2) normalizes int_0^180 tau(th) dth_rad == totalEnergyJ.
 */
export function springTorque(
  thetaDeg: number,
  totalEnergyJ: number,
  torqueRatio: number,
  springZeroOffsetDeg = 0
): number {
  assertFiniteNumber(thetaDeg, 'thetaDeg')
  assertFiniteNumber(springZeroOffsetDeg, 'springZeroOffsetDeg')
  validateSpringParams(totalEnergyJ, torqueRatio)
  if (totalEnergyJ === 0) return 0

  const tc = totalEnergyJ / (Math.PI * (1 + torqueRatio) * 0.5)
  const thetaEffDeg = Math.max(0, thetaDeg + springZeroOffsetDeg)
  return tc * (torqueRatio + (1 - torqueRatio) * (thetaEffDeg / 180))
}

/**
 * Exact analytical mechanical work (in J) released as the bail unwinds from
 * `thFromDeg` down to `thToDeg` (positive when thFromDeg > thToDeg).
 */
export function springWork(
  thFromDeg: number,
  thToDeg: number,
  totalEnergyJ: number,
  torqueRatio: number,
  springZeroOffsetDeg = 0
): number {
  assertFiniteNumber(thFromDeg, 'thFromDeg')
  assertFiniteNumber(thToDeg, 'thToDeg')
  assertFiniteNumber(springZeroOffsetDeg, 'springZeroOffsetDeg')
  validateSpringParams(totalEnergyJ, torqueRatio)
  if (totalEnergyJ === 0 || thFromDeg === thToDeg) return 0

  const sign = thFromDeg >= thToDeg ? 1 : -1
  const hiEff = Math.max(0, Math.max(thFromDeg, thToDeg) + springZeroOffsetDeg)
  const loEff = Math.max(0, Math.min(thFromDeg, thToDeg) + springZeroOffsetDeg)
  if (hiEff <= loEff) return 0

  const tauHi = springTorque(hiEff, totalEnergyJ, torqueRatio, 0)
  const tauLo = springTorque(loEff, totalEnergyJ, torqueRatio, 0)
  return sign * 0.5 * (tauHi + tauLo) * ((hiEff - loEff) * DEG_TO_RAD)
}

/**
 * Numerical composite trapezoidal quadrature of int_{thToDeg}^{thFromDeg} tau(th) dth_rad.
 */
export function integrateSpringWork(
  thFromDeg: number,
  thToDeg: number,
  totalEnergyJ: number,
  torqueRatio: number,
  steps = 1000,
  springZeroOffsetDeg = 0
): number {
  assertFiniteNumber(thFromDeg, 'thFromDeg')
  assertFiniteNumber(thToDeg, 'thToDeg')
  assertFiniteNumber(springZeroOffsetDeg, 'springZeroOffsetDeg')
  validateSpringParams(totalEnergyJ, torqueRatio)
  if (!Number.isSafeInteger(steps) || steps < 1) {
    throw new RangeError(`steps must be an integer >= 1, got ${steps}.`)
  }
  if (totalEnergyJ === 0 || thFromDeg === thToDeg) return 0

  const dDeg = (thFromDeg - thToDeg) / steps
  const dRad = dDeg * DEG_TO_RAD
  let integral = 0
  let prevTau = springTorque(
    thToDeg,
    totalEnergyJ,
    torqueRatio,
    springZeroOffsetDeg
  )
  for (let i = 1; i <= steps; i++) {
    const th = thToDeg + i * dDeg
    const currTau = springTorque(
      th,
      totalEnergyJ,
      torqueRatio,
      springZeroOffsetDeg
    )
    integral += 0.5 * (prevTau + currTau) * dRad
    prevTau = currTau
  }
  return integral
}

export function createTorsionSpringSpec(
  model: LauncherModel,
  totalEnergyJ: number
): TorsionSpringSpec {
  const tb = model.trapBank
  validateSpringParams(totalEnergyJ, tb.torqueRatio)
  const tauCock180Nm =
    tb.count > 0 && totalEnergyJ > 0
      ? totalEnergyJ / (Math.PI * (1 + tb.torqueRatio) * 0.5)
      : 0
  return {
    count: tb.count,
    totalEnergyJ: tb.count > 0 ? totalEnergyJ : 0,
    torqueRatio: tb.torqueRatio,
    thCockMaxDeg: tb.thCockMaxDeg,
    thRestDeg: tb.thRestDeg,
    springZeroOffsetDeg: tb.springZeroOffsetDeg,
    tauRestNm: tauCock180Nm * tb.torqueRatio,
    tauCock180Nm,
  }
}

export function instantaneousSpringTorque(
  spec: TorsionSpringSpec,
  thetaDeg: number
): number {
  if (spec.count <= 0 || spec.totalEnergyJ <= 0 || thetaDeg <= spec.thRestDeg) {
    return 0
  }
  return springTorque(
    thetaDeg,
    spec.totalEnergyJ,
    spec.torqueRatio,
    spec.springZeroOffsetDeg
  )
}

export function springPotentialEnergy(
  spec: TorsionSpringSpec,
  thetaDeg: number
): number {
  if (spec.count <= 0 || spec.totalEnergyJ <= 0 || thetaDeg <= spec.thRestDeg) {
    return 0
  }
  return springWork(
    thetaDeg,
    spec.thRestDeg,
    spec.totalEnergyJ,
    spec.torqueRatio,
    spec.springZeroOffsetDeg
  )
}

function sampleStandardNormal(rng: () => number): number {
  const u1 = Math.max(1e-12, Math.min(1 - 1e-12, rng()))
  const u2 = rng()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

/**
 * Sample combined spring bank energy (over 180 deg) scaled across 1-, 2-, and 3-trap banks.
 * Returns 0 for 0-trap models (e.g. gravity_trebuchet).
 */
export function sampleSpringBankEnergy(
  model: LauncherModel,
  env: SpringEnvParams,
  rng: () => number,
  perTrap = false
): number {
  assertFiniteNumber(env.nominalEnergyJ, 'env.nominalEnergyJ')
  assertFiniteNumber(env.energyVarianceJ, 'env.energyVarianceJ')
  if (env.nominalEnergyJ < 0) {
    throw new RangeError(`env.nominalEnergyJ must be >= 0, got ${env.nominalEnergyJ}.`)
  }
  if (env.energyVarianceJ < 0) {
    throw new RangeError(`env.energyVarianceJ must be >= 0, got ${env.energyVarianceJ}.`)
  }

  const count = model.trapBank.count
  if (count <= 0 || env.nominalEnergyJ === 0) return 0

  const modelBankNominalJ = count * model.trapBank.nominalEnergyPerTrapJ
  const scale = modelBankNominalJ / BASELINE_3TRAP_ENERGY_J
  const nominalBankJ = env.nominalEnergyJ * scale
  const varianceBankJ = env.energyVarianceJ * scale

  if (varianceBankJ === 0) {
    return Math.max(0, nominalBankJ)
  }

  const dist = env.energyDistribution ?? 'uniform'
  if (perTrap && count > 1) {
    const trapNominalJ = nominalBankJ / count
    let total = 0
    if (dist === 'gaussian') {
      const sigmaPerTrap = (varianceBankJ * 0.5) / Math.sqrt(count)
      for (let i = 0; i < count; i++) {
        total += Math.max(0, trapNominalJ + sigmaPerTrap * sampleStandardNormal(rng))
      }
    } else {
      const halfWidthPerTrap = varianceBankJ / count
      for (let i = 0; i < count; i++) {
        total += Math.max(0, trapNominalJ + (2 * rng() - 1) * halfWidthPerTrap)
      }
    }
    return Math.max(0, total)
  }

  if (dist === 'gaussian') {
    const sigma = varianceBankJ * 0.5
    return Math.max(0, nominalBankJ + sigma * sampleStandardNormal(rng))
  }
  return Math.max(0, nominalBankJ + (2 * rng() - 1) * varianceBankJ)
}
