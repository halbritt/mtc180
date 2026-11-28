import type { RubricInput } from '../physics/rubric'

export type LauncherTopology =
  | 'cord_horn'
  | 'circular_cam'
  | 'direct_rail'
  | 'tilted_cradle'
  | 'direct_cup'
  | 'gravity_trebuchet'
  | 'inclined_ramp'

export type CradleType =
  | 'zero_lip_vcup'
  | 'pocketed_petals'
  | 'tangent_rail'
  | 'sling_pouch'

export interface ProjectileSpec {
  readonly name: string
  readonly isRealGolfBall: boolean
  readonly massKg: number
  readonly radiusM: number
  readonly inertiaKgM2: number
  readonly cd: number
  readonly clFactor: number
  readonly spinDecayPerS: number
}

export const REGULATION_GOLF_BALL: ProjectileSpec = {
  name: 'Regulation Golf Ball',
  isRealGolfBall: true,
  massKg: 0.04593,
  radiusM: 0.021335,
  inertiaKgM2: 0.4 * 0.04593 * 0.021335 * 0.021335,
  cd: 0.28,
  clFactor: 0.16,
  spinDecayPerS: 0.12,
}

/** Nominal 3-trap combined spring energy in repo sims (2.12 J / 3 traps). */
export const NOMINAL_ENERGY_PER_TRAP_J = 2.12 / 3

export interface RubricComplianceMeta {
  readonly baseFits2ft: boolean
  readonly baseFlushOnFloor: boolean
  readonly baseDimensionsMm: readonly [number, number, number]
  readonly diameterMm: number
  readonly ballUnder3In: boolean
  readonly usesTrigger: boolean
  readonly trapsFlatOnBase: boolean
  readonly equipmentBonus: NonNullable<RubricInput['equipment']>
  readonly notes: string
}

export interface TrapBankConfig {
  readonly count: number
  readonly nominalEnergyPerTrapJ: number
  /** Half-width (+/-) stochastic spring energy variation for the bank, in J. */
  readonly energyVarianceJ: number
  readonly torqueRatio: number
  readonly thCockMaxDeg: number
  readonly thRestDeg: number
  readonly springZeroOffsetDeg: number
  readonly bailInertiaKgM2: number
  readonly bailMassXKgM: number
  readonly hingePosMm: readonly [number, number]
  readonly trapPitchMm: number
  readonly bearingFrictionNm: number
}

export interface ArmConfig {
  readonly massKg: number
  readonly inertiaKgM2: number
  readonly cgArmMm: readonly [number, number]
  readonly lengthBallM: number
  readonly ballOffsetArmMm: readonly [number, number]
  readonly pivotPosMm: readonly [number, number]
  readonly stopInertiaKgM2: number
  readonly widthMm: number
}

export interface RailGeometry {
  readonly lTipMm: number
  readonly xRise0Mm: number
  readonly xRise1Mm: number
  readonly hzFootMm: number
  readonly hzRootMm: number
  readonly hzTipMm: number
  readonly gammaRad: number
  readonly zWireMm: number
  readonly railHalfInMm: number
  readonly railContactMm: number
  readonly faceHalfMm: number
  readonly faceTiltDeg: number
  readonly rideHMm: number
  readonly pegX0Mm: number
  readonly pegPitchMm: number
  readonly pegCount: number
  readonly blockLenMm: number
  readonly blockHoleOffMm: number
  readonly blockTopMm: number
  readonly blockMassKg: number
  readonly blockCgOffsetMm: number
}

export interface CradleConfig {
  readonly type: CradleType
  readonly retentionForceN: number
  readonly snapEnergyJ: number
  readonly railGeometry?: RailGeometry
}

export type LinkageConfig =
  | {
      readonly kind: 'cord_horn'
      readonly rPullMm: number
      readonly rollerPosMm: readonly [number, number]
      readonly rRollEffMm: number
      readonly hornRMm: number
      readonly hornADeg: number
      /** Arm cocking angles in deg indexed 0..5 for Notches 1..6 (short -> max). */
      readonly notchPsisDeg: readonly number[]
      readonly stopAnglesDeg: readonly number[]
      readonly stopHolesMm: Readonly<Record<number, readonly [number, number]>>
      readonly cordTieNotchIndex: number
    }
  | {
      readonly kind: 'circular_cam'
      readonly rPullMm: number
      readonly rollerPosMm: readonly [number, number]
      readonly rRollEffMm: number
      readonly rCamMm: number
      readonly rCamEffMm: number
      readonly camKnotDeg: number
      /** Arm cocking angles in deg indexed 0..5 for Notches 1..6 (short -> max). */
      readonly notchPsisDeg: readonly number[]
      readonly stopAnglesDeg: readonly number[]
      readonly stopHolesMm: Readonly<Record<number, readonly [number, number]>>
      readonly cordTieThCockDeg: number
    }
  | {
      readonly kind: 'direct_rail'
      readonly thStopDeg: number
      readonly rollingModeDefault: boolean
    }
  | {
      readonly kind: 'tilted_cradle'
      readonly boardTiltDeg: number
      readonly bailRestDeg: number
      readonly stopAboveRestDeg: number
      readonly zPivotMm: number
    }
  | {
      readonly kind: 'direct_cup'
      readonly thStopDeg: number
    }
  | {
      readonly kind: 'inclined_ramp'
      readonly rPullMm: number
      readonly rollerPosMm: readonly [number, number]
      readonly rRollEffMm: number
      readonly rampLengthMm: number
      readonly rampStartZMm: number
      readonly rampAngleRangeDeg: readonly [number, number]
      readonly defaultRampAngleDeg: number
      readonly cockAngleRangeDeg: readonly [number, number]
      readonly muChute: number
    }
  | {
      readonly kind: 'gravity_trebuchet'
      readonly counterweightMassKg: number
      readonly dropHeightM: number
      readonly counterweightArmM: number
      readonly throwingArmM: number
      readonly slingLengthM: number
      readonly pinAngleDeg: number
      readonly pivotHeightM: number
      readonly pouchMassKg: number
      readonly cockAngleDeg: number
      readonly troughBottomZMm: number
    }

export interface AdjustmentDef {
  readonly id: string
  readonly label: string
  readonly unit: string
  readonly kind: 'discrete' | 'continuous'
  readonly options?: readonly number[]
  readonly optionLabels?: readonly string[]
  readonly min: number
  readonly max: number
  readonly step: number
  readonly defaultValue: number
}

export type AdjustmentValues = Record<string, number>

export interface CycleTimingConfig {
  readonly cockPerTrapS: number
  readonly loadS: number
  readonly aimAdjustS: number
  readonly humanSigmaS: number
}

export interface SetupTolerancesConfig {
  readonly cockAngleSigmaDeg: number
  readonly seatingOffsetSigmaM: number
  readonly yawSigmaDeg: number
  readonly stopAngleSigmaDeg: number
}

export interface LauncherModel {
  readonly id: string
  readonly name: string
  readonly version: string
  readonly description: string
  readonly isActiveRepoDesign: boolean
  readonly topology: LauncherTopology
  readonly projectile: ProjectileSpec
  readonly rubricCompliance: RubricComplianceMeta
  readonly trapBank: TrapBankConfig
  readonly arm: ArmConfig
  readonly cradle: CradleConfig
  readonly linkage: LinkageConfig
  readonly adjustments: readonly AdjustmentDef[]
  readonly cycleTiming: CycleTimingConfig
  readonly tolerances: SetupTolerancesConfig
}
