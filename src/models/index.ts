export {
  NOMINAL_ENERGY_PER_TRAP_J,
  REGULATION_GOLF_BALL,
  type AdjustmentDef,
  type AdjustmentValues,
  type ArmConfig,
  type CradleConfig,
  type CradleType,
  type CycleTimingConfig,
  type LauncherModel,
  type LauncherTopology,
  type LinkageConfig,
  type ProjectileSpec,
  type RailGeometry,
  type RubricComplianceMeta,
  type SetupTolerancesConfig,
  type TrapBankConfig,
} from './types'

export {
  computeDirectArmPegPositions,
  computeRailTopMm,
  computeV51NotchBallPos,
  defaultAdjustments,
  validateAndClampAdjustments,
  validateLauncherModel,
  type DirectArmPegPosition,
  type V51NotchBallPos,
} from './validation'

export {
  V51_CORD_HORN,
  V51_NOTCH_PSIS_DEG,
  V51_STOP_HOLES_MM,
  V51_TH_COCK_FULL_DEG,
} from './v51_cord_horn'
export {
  V50_CIRCULAR_CAM,
  V50_NOTCH_PSIS_DEG,
  V50_STOP_HOLES_MM,
} from './v50_circular_cam'
export {
  DIRECT_ARM_RAIL,
  DIRECT_ARM_RAIL_GEOMETRY,
} from './direct_arm_rail'
export { V41_TILTED_CRADLE } from './v41_tilted_cradle'
export {
  DIRECT_ARM_1TRAP,
  DIRECT_ARM_2TRAP,
  DIRECT_CUP_2TRAP,
  FLOOR_FLUSH_INCLINED_RAMP,
  GRAVITY_SLING_TREBUCHET,
} from './candidates'
export {
  getLauncherModel,
  isModelRubricCompliant,
  LAUNCHER_MODELS,
  LAUNCHER_MODELS_BY_ID,
  listLauncherModels,
  type LauncherModelFilter,
} from './registry'
