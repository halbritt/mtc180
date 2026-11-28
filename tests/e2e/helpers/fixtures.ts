import type { RubricInput } from '../../../src/physics/rubric'
import type { AdjustmentValues, EnergyBudget, EnvConfig, LauncherModel } from './contracts'

export const REPO_CONSTANTS = {
  M_BALL: 0.04593,
  R_BALL: 0.021335,
  E_SPRING_NOMINAL: 2.12,
  E_SPRING_TWO_J: 2.0,
  TORQUE_RATIO: 0.5,
  MAX_DIAMETER_MM: 914.4,
  THREE_INCHES_M: 0.0762,
  G_DEFAULT: 9.80665,
  V51_NOTCH6_42_VACUUM_SPEED_MPS: 6.93,
  V51_NOTCH6_42_VACUUM_CARRY_M: 5.08,
  V50_CAM_156_VACUUM_SPEED_MPS: 5.21,
  V50_CAM_156_VACUUM_CARRY_M: 2.96,
  DIRECT_ARM_1A_ROLL_SPEED_MPS: 5.86,
  DIRECT_ARM_1A_ROLL_THETA_DEG: 87.5,
  DIRECT_ARM_1A_ROLL_ELEV_DEG: 33.5,
  DIRECT_ARM_1A_ROLL_CARRY_M: 3.58,
  DIRECT_ARM_1A_SLIDE_CARRY_M: 3.41,
} as const

/** Deterministic mulberry32 PRNG returning values in [0, 1). */
export function createSeededRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function createNominalEnv(overrides: Partial<EnvConfig> = {}): EnvConfig {
  return {
    nominalEnergyJ: REPO_CONSTANTS.E_SPRING_NOMINAL,
    energyVarianceJ: 0,
    energyDistribution: 'uniform',
    turfEn: 0.32,
    turfMuR: 0.12,
    turfScatterSigmaRad: 0.015,
    windVecMps: [0, 0, 0],
    airDensityKgM3: 1.225,
    projectile: 'golf_ball',
    gravityMps2: REPO_CONSTANTS.G_DEFAULT,
    ...overrides,
  }
}

export function createVacuumEnv(overrides: Partial<EnvConfig> = {}): EnvConfig {
  return createNominalEnv({
    nominalEnergyJ: REPO_CONSTANTS.E_SPRING_NOMINAL,
    energyVarianceJ: 0,
    windVecMps: [0, 0, 0],
    airDensityKgM3: 0,
    cdOverride: 0,
    turfScatterSigmaRad: 0,
    ...overrides,
  })
}

export function createTurfPresetEnv(
  preset: 'firm' | 'soft' | 'wet' | 'dry',
  overrides: Partial<EnvConfig> = {}
): EnvConfig {
  switch (preset) {
    case 'firm':
      return createNominalEnv({ turfEn: 0.4, turfMuR: 0.08, ...overrides })
    case 'soft':
      return createNominalEnv({ turfEn: 0.25, turfMuR: 0.16, ...overrides })
    case 'wet':
      return createNominalEnv({ turfEn: 0.25, turfMuR: 0.2, ...overrides })
    case 'dry':
      return createNominalEnv({ turfEn: 0.35, turfMuR: 0.08, ...overrides })
  }
}

export function createRubricInput(overrides: Record<string, unknown> = {}): RubricInput & Record<string, unknown> {
  const fullMarks: Record<string, number> = {
    requirements: 5,
    time: 5,
    trigger: 5,
    cleanup: 5,
    designFormat: 5,
    materials: 5,
    distanceDesign: 5,
    accuracyDesign: 5,
    physicsFormat: 5,
    beforeLaunch: 5,
    duringLaunch: 5,
    flight: 5,
    impact: 5,
    legible: 5,
    labels: 5,
    paper: 5,
    respect: 2,
    launcher: 2,
    retrieval: 2,
    order: 2,
    warning: 2,
  }
  return {
    distanceM: 5.0,
    targetHits: [true, true],
    marks: fullMarks,
    equipment: 'ball',
    lateDays: 0,
    groupShares: [2, 2, 2],
    ...overrides,
  }
}

export function assertFinite(n: number, label: string): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new Error(`Expected finite number for ${label}, got ${String(n)}`)
  }
  return n
}

export function defaultAdjustmentsForModel(model: LauncherModel): AdjustmentValues {
  const out: AdjustmentValues = {}
  for (const adj of model.adjustments) {
    out[adj.id] = adj.defaultValue
  }
  return out
}

export function sumEnergyBudget(b: EnergyBudget): number {
  return (
    assertFinite(b.keTransBallJ, 'keTransBallJ') +
    assertFinite(b.keRotBallJ, 'keRotBallJ') +
    assertFinite(b.keRotArmBailsJ, 'keRotArmBailsJ') +
    assertFinite(b.peGravityDeltaJ, 'peGravityDeltaJ') +
    assertFinite(b.frictionLossJ, 'frictionLossJ')
  )
}
