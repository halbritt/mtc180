import type { Sample, Target } from '../../../src/physics/telemetry'

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

export interface AdjustmentDef {
  id: string
  label: string
  kind: 'discrete' | 'continuous'
  unit?: string
  defaultValue: number
  options?: readonly number[]
  optionLabels?: readonly string[]
  min?: number
  max?: number
  step?: number
}

export interface LauncherModel {
  id: string
  name: string
  version?: string
  description?: string
  isActiveRepoDesign?: boolean
  topology: LauncherTopology
  projectile?: Record<string, unknown>
  rubricCompliance: {
    baseFits2ft: boolean
    baseFlushOnFloor?: boolean
    baseDimensionsMm?: readonly [number, number, number]
    diameterMm: number
    ballUnder3In: boolean
    usesTrigger?: boolean
    trapsFlatOnBase?: boolean
    equipmentBonus: 'none' | 'ball' | 'trebuchet' | 'both'
    notes: string
  }
  trapBank: {
    count: number
    nominalEnergyPerTrapJ: number
    energyVarianceJ?: number
    torqueRatio: number
    thCockMaxDeg: number
    thRestDeg: number
    springZeroOffsetDeg?: number
    bailInertiaKgM2: number
    bailMassXKgM?: number
    hingePosMm?: readonly [number, number]
    trapPitchMm?: number
    bearingFrictionNm?: number
  }
  arm: {
    massKg: number
    inertiaKgM2: number
    cgArmMm?: readonly [number, number]
    cgArmM?: [number, number] | number
    lengthBallM: number
    ballOffsetArmMm?: readonly [number, number]
    pivotPosMm?: readonly [number, number]
    stopInertiaKgM2?: number
    widthMm?: number
  }
  cradle: {
    type: CradleType
    retentionForceN: number
    snapEnergyJ?: number
    railGeometry?: Record<string, unknown>
  }
  linkage: Record<string, unknown>
  adjustments: readonly AdjustmentDef[]
  cycleTiming: {
    cockPerTrapS: number
    loadS: number
    aimAdjustS: number
    humanSigmaS: number
  }
  tolerances: {
    cockAngleSigmaDeg: number
    seatingOffsetSigmaM: number
    yawSigmaDeg: number
    stopAngleSigmaDeg: number
  }
}

export type AdjustmentValues = Record<string, number>

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
  armTraceSamples: Array<{ t: number; psiDeg: number; thDeg: number; omegaArm: number }>
  cycleTimeS: number
  cockedBallBottomHeightM?: number
  cordSlackAtDeg?: number | null
  peakCordTensionN?: number
  reachable?: boolean
  springTotalStoredJ?: number
  springResidualPeJ?: number
}

export interface FullSimulationResult {
  trace: Sample[]
  release: LaunchReleaseState
  carryDistanceM: number
  rollDistanceM: number
  totalDistanceM: number
  bouncePoints: Array<{ t: number; x: number; y: number; z: number }>
  energyEfficiencyPct: number
  rubricDistancePts: number
  rubricAccuracyPts: number
  rubricTotalProjectedPts: number
  cycleTimeS: number
  armFrames: Array<{ t: number; psiDeg: number; thDeg: number }>
}

export interface AutoSightResult {
  reachable: boolean
  adjustments: AdjustmentValues
  predictedDistanceM: number
  errorM: number
  message?: string
}

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

export interface SequenceOptions {
  windowS: number
  target?: Target
  targets?: readonly [Target, Target]
  targetAdjustments?: readonly AdjustmentValues[]
  targetRadiusM?: number
  seed: number
}

export interface SequenceResult {
  windowS: number
  shotsAttempted: number
  shotsCompleted: number
  totalElapsedS: number
  shots: FullSimulationResult[]
  target1Hits: number
  target2Hits: number
}

export interface Cep95Ellipse {
  centerX: number
  centerY: number
  semiMajorM: number
  semiMinorM: number
  angleRad: number
}

export interface MonteCarloRequest {
  jobId: string
  models: LauncherModel[]
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
  landings: Array<{ restX: number; restY: number; carryM: number; totalM: number; score: number }>
}

export interface MonteCarloResponse {
  jobId: string
  type: 'progress' | 'done' | 'error'
  completed: number
  total: number
  results?: MonteCarloDesignSummary[]
  error?: string
}

export type SpringTorqueFn = (
  thetaDeg: number,
  totalEnergyJ: number,
  torqueRatio: number
) => number

export type SpringWorkFn = (
  thFromDeg: number,
  thToDeg: number,
  totalEnergyJ: number,
  torqueRatio: number
) => number

export type SolveLaunchFn = (
  model: LauncherModel,
  adjustments: AdjustmentValues,
  env: EnvConfig,
  rng: () => number
) => LaunchReleaseState

export type SimulateFlightFn = (input: FlightInput, env: EnvConfig) => FlightResult

export type SimulateTurfFn = (
  input: TurfInput,
  env: EnvConfig,
  rng?: () => number
) => TurfResult

export type SimulateShotFn = (
  model: LauncherModel,
  adjustments: AdjustmentValues,
  env: EnvConfig,
  target: Target,
  seed: number
) => FullSimulationResult

export type AutoSightFn = (
  model: LauncherModel,
  env: EnvConfig,
  targetDistanceM: number
) => AutoSightResult

export type SimulateSequenceFn = (
  model: LauncherModel,
  adjustments: AdjustmentValues,
  env: EnvConfig,
  options: SequenceOptions
) => SequenceResult

export type RunMonteCarloFn = (
  request: MonteCarloRequest,
  onProgress?: (completed: number, total: number) => void
) => MonteCarloDesignSummary[]

export const M4_SELECTORS = {
  modelSelect: '#model-select, [data-testid="model-select"], select[name="model"]',
  modelControls: '#model-controls',
  autosightTarget:
    '#autosight-target, [data-testid="autosight-target"], input[name="targetDistanceM"], input[name="targetDistance"]',
  autosightBtn:
    '#autosight-btn, [data-testid="autosight"], [data-testid="autosight-btn"], button[data-action="autosight"]',
  autosightStatus:
    '#autosight-status, #autosight-error, [data-testid="autosight-warning"], [role="alert"]',
  launchBtn: '#launch-btn, [data-testid="launch"], button[data-action="launch"]',
  runShootoutBtn:
    '#run-shootout, [data-testid="run-shootout"], button[data-action="shootout"]',
  shootoutTable:
    '#shootout-results, #shootout-table, [data-testid="shootout-table"], .shootout-table',
  shootoutRows:
    '#shootout-results tbody tr, #shootout-table tbody tr, [data-testid="shootout-table"] tbody tr, [data-testid="shootout-row"], .shootout-table tbody tr',
} as const

async function importSrcModule<T = Record<string, any>>(relPath: string): Promise<T> {
  const target = `../../../src/${relPath}`
  return (await import(target)) as T
}

export async function loadModelsModule(): Promise<Record<string, any>> {
  return importSrcModule('models/index')
}

export async function loadSpringModule(): Promise<
  { springTorque: SpringTorqueFn; springWork: SpringWorkFn } & Record<string, any>
> {
  return importSrcModule('physics/spring')
}

export async function loadLinkageModule(): Promise<Record<string, any>> {
  return importSrcModule('physics/linkage')
}

export async function loadLaunchSolverModule(): Promise<
  { solveLaunch: SolveLaunchFn } & Record<string, any>
> {
  return importSrcModule('physics/launch_solver')
}

export async function loadAeroModule(): Promise<
  { simulateFlight: SimulateFlightFn } & Record<string, any>
> {
  return importSrcModule('physics/aero')
}

export async function loadTurfModule(): Promise<
  { simulateTurf: SimulateTurfFn } & Record<string, any>
> {
  return importSrcModule('physics/turf')
}

export async function loadSimulateModule(): Promise<
  { simulateShot: SimulateShotFn } & Record<string, any>
> {
  return importSrcModule('physics/simulate')
}

export async function loadAutoSightModule(): Promise<
  { autoSight: AutoSightFn } & Record<string, any>
> {
  return importSrcModule('physics/autosight')
}

export async function loadSequenceModule(): Promise<
  { simulateSequence: SimulateSequenceFn } & Record<string, any>
> {
  return importSrcModule('physics/sequence')
}

export async function loadMonteCarloModule(): Promise<
  { runMonteCarlo: RunMonteCarloFn } & Record<string, any>
> {
  return importSrcModule('physics/montecarlo')
}

export async function loadRubricModule() {
  return await import('../../../src/physics/rubric')
}

export async function loadTelemetryModule() {
  return await import('../../../src/physics/telemetry')
}

export async function loadPracticeModule() {
  return await import('../../../src/physics/practice')
}

export async function loadReplayModule() {
  return await import('../../../src/physics/replay')
}
