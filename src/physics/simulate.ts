import { type AdjustmentValues, type LauncherModel } from '../models'
import { buildAeroParams, simulateFlight } from './aero'
import {
  solveLaunch,
  validateDt,
  type EnvConfig,
  type LaunchReleaseState,
} from './launch_solver'
import { distancePoints } from './rubric'
import { measure, type Sample, type Target } from './telemetry'
import { simulateTurf, validateTurfParams } from './turf'

const EQUIPMENT_BONUS_PTS = {
  none: 0,
  ball: 4,
  trebuchet: 6,
  both: 8,
} as const

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
    nominalEnergyJ: 2.12,
    energyVarianceJ: 0,
    energyDistribution: 'uniform',
    turfEn: 0.32,
    turfMuR: 0.12,
    turfScatterSigmaRad: 0.015,
    windVecMps: [0, 0, 0],
    airDensityKgM3: 1.225,
    projectile: 'golf_ball',
    gravityMps2: 9.80665,
    ...overrides,
  }
}

export function simulateShot(
  model: LauncherModel,
  adjustments: AdjustmentValues,
  env: EnvConfig,
  target: Target,
  seed: number
): FullSimulationResult {
  if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) {
    throw new RangeError('target.x and target.y must be finite numbers.')
  }
  if (typeof seed !== 'number' || !Number.isFinite(seed)) {
    throw new RangeError(`seed must be a finite number, got ${String(seed)}.`)
  }

  validateTurfParams({
    en: env.turfEn,
    muR: env.turfMuR,
    scatterSigmaRad: env.turfScatterSigmaRad,
  })
  buildAeroParams(env, model.projectile)
  if (env.dtS !== undefined) {
    validateDt(env.dtS)
  }

  const rng = createSeededRng(seed)
  const rawRelease = solveLaunch(model, adjustments, env, rng)
  const cycleTimeS = Math.max(1e-3, rawRelease.cycleTimeS)
  const release: LaunchReleaseState =
    rawRelease.cycleTimeS === cycleTimeS
      ? rawRelease
      : { ...rawRelease, cycleTimeS }

  const armFrames = release.armTraceSamples.map(({ t, psiDeg, thDeg }) => ({
    t,
    psiDeg,
    thDeg,
  }))

  const totalSpringJ =
    release.springTotalStoredJ ?? release.energyBudget.springInitialJ
  const energyEfficiencyPct =
    totalSpringJ > 0
      ? (100 *
          (release.energyBudget.keTransBallJ +
            release.energyBudget.keRotBallJ)) /
        totalSpringJ
      : 0

  const equipPts =
    EQUIPMENT_BONUS_PTS[model.rubricCompliance.equipmentBonus] ?? 0

  if (!release.leftCradle || release.reachable === false) {
    const t0 = Math.max(0, release.tReleaseS)
    const x0 = release.posM[0]
    const y0 = release.posM[1]
    const z0 = Math.max(0, release.posM[2])
    const trace: Sample[] = [
      { t: t0, x: x0, y: y0, z: z0 },
      { t: t0 + 0.001, x: x0, y: y0, z: 0, event: 'contact' },
      { t: t0 + 0.002, x: x0, y: y0, z: 0, event: 'rest' },
    ]
    const m = measure(trace, target)
    const rubricDistancePts = distancePoints(0)
    const rubricAccuracyPts =
      m.radialError !== null && m.radialError <= 0.5 ? 5 : 0
    return {
      trace,
      release,
      carryDistanceM: 0,
      rollDistanceM: 0,
      totalDistanceM: 0,
      bouncePoints: [],
      energyEfficiencyPct,
      rubricDistancePts,
      rubricAccuracyPts,
      rubricTotalProjectedPts:
        rubricDistancePts + rubricAccuracyPts + equipPts,
      cycleTimeS,
      armFrames,
    }
  }

  const flight = simulateFlight(
    {
      posM: release.posM,
      velMps: release.velMps,
      omegaBallRadps: release.omegaBallRadps,
      tStartS: release.tReleaseS,
    },
    env,
    model.projectile
  )

  const turf = simulateTurf(
    {
      posM: flight.impactPosM,
      velMps: flight.impactVelMps,
      omegaBallRadps: flight.omegaAtImpactRadps,
      tStartS: flight.tImpactS,
    },
    env,
    rng,
    model.projectile
  )

  const trace: Sample[] = [...flight.samples.slice(0, -1), ...turf.samples]
  const m = measure(trace, target)

  const carryDistanceM = m.carry
  const rollDistanceM = m.rollout
  const totalDistanceM = m.total
  const rubricDistancePts = distancePoints(totalDistanceM)
  const rubricAccuracyPts =
    m.radialError !== null && m.radialError <= 0.5 ? 5 : 0

  return {
    trace,
    release,
    carryDistanceM,
    rollDistanceM,
    totalDistanceM,
    bouncePoints: turf.bouncePoints,
    energyEfficiencyPct,
    rubricDistancePts,
    rubricAccuracyPts,
    rubricTotalProjectedPts: rubricDistancePts + rubricAccuracyPts + equipPts,
    cycleTimeS,
    armFrames,
  }
}
