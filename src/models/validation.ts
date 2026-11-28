import {
  REGULATION_GOLF_BALL,
  type AdjustmentDef,
  type AdjustmentValues,
  type LauncherModel,
  type RailGeometry,
} from './types'

const VALID_EQUIPMENT = new Set(['none', 'ball', 'trebuchet', 'both'])
const MAX_WOOD_BASE_THICKNESS_MM = 25.4
const LAUNCH_SITE_2FT_MM = 609.6

export interface DirectArmPegPosition {
  readonly peg: number
  readonly flip: 0 | 1
  readonly label: string
  readonly x0Mm: number
  readonly xbMm: number
  readonly railTopMm: number
  readonly bzCockedMm: number
  readonly zBotMm: number
  readonly zBotIn: number
}

export interface V51NotchBallPos {
  readonly bxMm: number
  readonly bzMm: number
  readonly zBotMm: number
  readonly zBotIn: number
}

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`)
  }
  return value
}

function assertFinite(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RangeError(`${label} must be a finite number.`)
  }
  return value
}

function assertPositive(value: number, label: string): number {
  assertFinite(value, label)
  if (value <= 0) {
    throw new RangeError(`${label} must be positive.`)
  }
  return value
}

function assertNonNegative(value: number, label: string): number {
  assertFinite(value, label)
  if (value < 0) {
    throw new RangeError(`${label} must be non-negative.`)
  }
  return value
}

function assertFinitePair(
  pair: readonly [number, number],
  label: string
): void {
  if (!Array.isArray(pair) || pair.length !== 2) {
    throw new TypeError(`${label} must be a 2-tuple of numbers.`)
  }
  assertFinite(pair[0], `${label}[0]`)
  assertFinite(pair[1], `${label}[1]`)
}

function validateRailGeometry(rail: RailGeometry, modelId: string): void {
  const prefix = `${modelId}.cradle.railGeometry`
  assertPositive(rail.lTipMm, `${prefix}.lTipMm`)
  assertNonNegative(rail.xRise0Mm, `${prefix}.xRise0Mm`)
  assertPositive(rail.xRise1Mm, `${prefix}.xRise1Mm`)
  if (rail.xRise0Mm >= rail.xRise1Mm || rail.xRise1Mm >= rail.lTipMm) {
    throw new RangeError(
      `${prefix} requires 0 <= xRise0Mm < xRise1Mm < lTipMm.`
    )
  }
  assertNonNegative(rail.hzFootMm, `${prefix}.hzFootMm`)
  assertPositive(rail.hzRootMm, `${prefix}.hzRootMm`)
  assertNonNegative(rail.hzTipMm, `${prefix}.hzTipMm`)
  assertFinite(rail.gammaRad, `${prefix}.gammaRad`)
  assertNonNegative(rail.zWireMm, `${prefix}.zWireMm`)
  assertPositive(rail.railHalfInMm, `${prefix}.railHalfInMm`)
  assertPositive(rail.railContactMm, `${prefix}.railContactMm`)
  assertPositive(rail.faceHalfMm, `${prefix}.faceHalfMm`)
  assertPositive(rail.faceTiltDeg, `${prefix}.faceTiltDeg`)
  assertPositive(rail.rideHMm, `${prefix}.rideHMm`)
  assertPositive(rail.pegX0Mm, `${prefix}.pegX0Mm`)
  assertPositive(rail.pegPitchMm, `${prefix}.pegPitchMm`)
  if (!Number.isSafeInteger(rail.pegCount) || rail.pegCount < 1) {
    throw new RangeError(`${prefix}.pegCount must be an integer >= 1.`)
  }
  assertPositive(rail.blockLenMm, `${prefix}.blockLenMm`)
  assertPositive(rail.blockHoleOffMm, `${prefix}.blockHoleOffMm`)
  if (rail.blockHoleOffMm >= rail.blockLenMm) {
    throw new RangeError(`${prefix}.blockHoleOffMm must be < blockLenMm.`)
  }
  assertPositive(rail.blockTopMm, `${prefix}.blockTopMm`)
  assertPositive(rail.blockMassKg, `${prefix}.blockMassKg`)
  assertFinite(rail.blockCgOffsetMm, `${prefix}.blockCgOffsetMm`)
}

function validateAdjustmentDef(adj: AdjustmentDef, modelId: string): void {
  const prefix = `${modelId}.adjustments[${adj.id}]`
  assertNonEmptyString(adj.id, `${modelId}.adjustments[].id`)
  assertNonEmptyString(adj.label, `${prefix}.label`)
  if (typeof adj.unit !== 'string') {
    throw new TypeError(`${prefix}.unit must be a string.`)
  }
  assertFinite(adj.min, `${prefix}.min`)
  assertFinite(adj.max, `${prefix}.max`)
  assertPositive(adj.step, `${prefix}.step`)
  assertFinite(adj.defaultValue, `${prefix}.defaultValue`)

  if (adj.min > adj.max) {
    throw new RangeError(`${prefix} requires min <= max.`)
  }
  if (adj.defaultValue < adj.min || adj.defaultValue > adj.max) {
    throw new RangeError(`${prefix}.defaultValue must fall within [min, max].`)
  }

  if (adj.kind === 'discrete') {
    if (!adj.options || adj.options.length === 0) {
      throw new RangeError(`${prefix}.options must be non-empty for discrete.`)
    }
    for (let i = 0; i < adj.options.length; i++) {
      const opt = assertFinite(adj.options[i], `${prefix}.options[${i}]`)
      if (opt < adj.min || opt > adj.max) {
        throw new RangeError(
          `${prefix}.options[${i}] must fall within [min, max].`
        )
      }
      if (i > 0 && opt <= adj.options[i - 1]) {
        throw new RangeError(
          `${prefix}.options must be strictly ascending.`
        )
      }
    }
    if (!adj.options.some((opt) => Math.abs(opt - adj.defaultValue) <= 1e-12)) {
      throw new RangeError(
        `${prefix}.defaultValue must be listed in discrete options.`
      )
    }
    if (
      adj.optionLabels !== undefined &&
      adj.optionLabels.length !== adj.options.length
    ) {
      throw new RangeError(
        `${prefix}.optionLabels length must match options length.`
      )
    }
  } else if (adj.kind !== 'continuous') {
    throw new TypeError(`${prefix}.kind must be 'discrete' or 'continuous'.`)
  }
}

export function validateLauncherModel(model: LauncherModel): LauncherModel {
  const id = assertNonEmptyString(model.id, 'model.id')
  assertNonEmptyString(model.name, `${id}.name`)
  assertNonEmptyString(model.version, `${id}.version`)
  assertNonEmptyString(model.description, `${id}.description`)

  if (model.linkage.kind !== model.topology) {
    throw new Error(
      `${id}: topology "${model.topology}" does not match linkage.kind "${model.linkage.kind}".`
    )
  }

  // Projectile validation
  assertNonEmptyString(model.projectile.name, `${id}.projectile.name`)
  assertPositive(model.projectile.massKg, `${id}.projectile.massKg`)
  assertPositive(model.projectile.radiusM, `${id}.projectile.radiusM`)
  assertPositive(model.projectile.inertiaKgM2, `${id}.projectile.inertiaKgM2`)
  assertNonNegative(model.projectile.cd, `${id}.projectile.cd`)
  assertNonNegative(model.projectile.clFactor, `${id}.projectile.clFactor`)
  assertNonNegative(
    model.projectile.spinDecayPerS,
    `${id}.projectile.spinDecayPerS`
  )

  // Rubric compliance validation
  const rc = model.rubricCompliance
  if (rc.baseDimensionsMm.length !== 3) {
    throw new TypeError(`${id}.rubricCompliance.baseDimensionsMm needs 3 values.`)
  }
  const [baseL, baseW, baseT] = rc.baseDimensionsMm
  assertPositive(baseL, `${id}.rubricCompliance.baseDimensionsMm[0]`)
  assertPositive(baseW, `${id}.rubricCompliance.baseDimensionsMm[1]`)
  assertPositive(baseT, `${id}.rubricCompliance.baseDimensionsMm[2]`)
  assertPositive(rc.diameterMm, `${id}.rubricCompliance.diameterMm`)
  if (!VALID_EQUIPMENT.has(rc.equipmentBonus)) {
    throw new RangeError(
      `${id}.rubricCompliance.equipmentBonus "${rc.equipmentBonus}" is invalid.`
    )
  }
  if (
    rc.baseFits2ft &&
    (baseL > LAUNCH_SITE_2FT_MM ||
      baseW > LAUNCH_SITE_2FT_MM ||
      baseT > MAX_WOOD_BASE_THICKNESS_MM)
  ) {
    throw new RangeError(
      `${id}.rubricCompliance.baseFits2ft is true but base exceeds 2'x2'x1" (${LAUNCH_SITE_2FT_MM}x${LAUNCH_SITE_2FT_MM}x${MAX_WOOD_BASE_THICKNESS_MM} mm).`
    )
  }

  // Trap bank & trebuchet mutual exclusion
  const tb = model.trapBank
  if (!Number.isSafeInteger(tb.count) || tb.count < 0) {
    throw new RangeError(`${id}.trapBank.count must be a non-negative integer.`)
  }
  assertNonNegative(
    tb.nominalEnergyPerTrapJ,
    `${id}.trapBank.nominalEnergyPerTrapJ`
  )
  assertNonNegative(tb.energyVarianceJ, `${id}.trapBank.energyVarianceJ`)
  assertFinite(tb.torqueRatio, `${id}.trapBank.torqueRatio`)
  if (tb.torqueRatio <= 0 || tb.torqueRatio > 1) {
    throw new RangeError(`${id}.trapBank.torqueRatio must be in (0, 1].`)
  }
  assertFinite(tb.thCockMaxDeg, `${id}.trapBank.thCockMaxDeg`)
  assertFinite(tb.thRestDeg, `${id}.trapBank.thRestDeg`)
  assertFinite(tb.springZeroOffsetDeg, `${id}.trapBank.springZeroOffsetDeg`)
  assertNonNegative(tb.bailInertiaKgM2, `${id}.trapBank.bailInertiaKgM2`)
  assertNonNegative(tb.bailMassXKgM, `${id}.trapBank.bailMassXKgM`)
  assertFinitePair(tb.hingePosMm, `${id}.trapBank.hingePosMm`)
  assertNonNegative(tb.trapPitchMm, `${id}.trapBank.trapPitchMm`)
  assertNonNegative(tb.bearingFrictionNm, `${id}.trapBank.bearingFrictionNm`)

  const isTrebuchet =
    model.topology === 'gravity_trebuchet' ||
    rc.equipmentBonus === 'trebuchet' ||
    rc.equipmentBonus === 'both'

  if (isTrebuchet) {
    if (model.topology !== 'gravity_trebuchet') {
      throw new Error(
        `${id}: equipmentBonus "${rc.equipmentBonus}" requires topology "gravity_trebuchet".`
      )
    }
    if (tb.count !== 0) {
      throw new RangeError(
        `${id}: gravity_trebuchet must have trapBank.count === 0 (found ${tb.count}).`
      )
    }
    if (rc.trapsFlatOnBase) {
      throw new RangeError(
        `${id}: gravity_trebuchet cannot set trapsFlatOnBase = true.`
      )
    }
    if (rc.equipmentBonus !== 'trebuchet' && rc.equipmentBonus !== 'both') {
      throw new RangeError(
        `${id}: gravity_trebuchet equipmentBonus must be 'trebuchet' or 'both'.`
      )
    }
  } else {
    if (tb.count < 1) {
      throw new RangeError(
        `${id}: mousetrap topology "${model.topology}" requires trapBank.count >= 1.`
      )
    }
    assertPositive(
      tb.nominalEnergyPerTrapJ,
      `${id}.trapBank.nominalEnergyPerTrapJ`
    )
    assertPositive(tb.bailInertiaKgM2, `${id}.trapBank.bailInertiaKgM2`)
    if (tb.thCockMaxDeg <= tb.thRestDeg) {
      throw new RangeError(
        `${id}.trapBank requires thCockMaxDeg > thRestDeg when count > 0.`
      )
    }
  }

  // Arm validation
  assertPositive(model.arm.massKg, `${id}.arm.massKg`)
  assertPositive(model.arm.inertiaKgM2, `${id}.arm.inertiaKgM2`)
  assertFinitePair(model.arm.cgArmMm, `${id}.arm.cgArmMm`)
  assertPositive(model.arm.lengthBallM, `${id}.arm.lengthBallM`)
  assertFinitePair(model.arm.ballOffsetArmMm, `${id}.arm.ballOffsetArmMm`)
  assertFinitePair(model.arm.pivotPosMm, `${id}.arm.pivotPosMm`)
  assertNonNegative(model.arm.stopInertiaKgM2, `${id}.arm.stopInertiaKgM2`)
  assertPositive(model.arm.widthMm, `${id}.arm.widthMm`)

  // Cradle validation
  assertNonNegative(
    model.cradle.retentionForceN,
    `${id}.cradle.retentionForceN`
  )
  assertNonNegative(model.cradle.snapEnergyJ, `${id}.cradle.snapEnergyJ`)
  if (model.cradle.railGeometry) {
    validateRailGeometry(model.cradle.railGeometry, id)
  }

  // Linkage-specific validation
  const lk = model.linkage
  switch (lk.kind) {
    case 'cord_horn':
      assertPositive(lk.rPullMm, `${id}.linkage.rPullMm`)
      assertFinitePair(lk.rollerPosMm, `${id}.linkage.rollerPosMm`)
      assertPositive(lk.rRollEffMm, `${id}.linkage.rRollEffMm`)
      assertPositive(lk.hornRMm, `${id}.linkage.hornRMm`)
      assertFinite(lk.hornADeg, `${id}.linkage.hornADeg`)
      if (lk.notchPsisDeg.length === 0 || lk.stopAnglesDeg.length === 0) {
        throw new RangeError(`${id}.linkage requires non-empty notches and stops.`)
      }
      for (const deg of lk.stopAnglesDeg) {
        if (!Object.hasOwn(lk.stopHolesMm, deg)) {
          throw new Error(`${id}.linkage.stopHolesMm missing stop ${deg}.`)
        }
      }
      if (
        !Number.isSafeInteger(lk.cordTieNotchIndex) ||
        lk.cordTieNotchIndex < 0 ||
        lk.cordTieNotchIndex >= lk.notchPsisDeg.length
      ) {
        throw new RangeError(`${id}.linkage.cordTieNotchIndex out of range.`)
      }
      break
    case 'circular_cam':
      assertPositive(lk.rPullMm, `${id}.linkage.rPullMm`)
      assertFinitePair(lk.rollerPosMm, `${id}.linkage.rollerPosMm`)
      assertPositive(lk.rRollEffMm, `${id}.linkage.rRollEffMm`)
      assertPositive(lk.rCamMm, `${id}.linkage.rCamMm`)
      assertPositive(lk.rCamEffMm, `${id}.linkage.rCamEffMm`)
      assertFinite(lk.camKnotDeg, `${id}.linkage.camKnotDeg`)
      assertFinite(lk.cordTieThCockDeg, `${id}.linkage.cordTieThCockDeg`)
      if (lk.notchPsisDeg.length === 0 || lk.stopAnglesDeg.length === 0) {
        throw new RangeError(`${id}.linkage requires non-empty notches and stops.`)
      }
      for (const deg of lk.stopAnglesDeg) {
        if (!Object.hasOwn(lk.stopHolesMm, deg)) {
          throw new Error(`${id}.linkage.stopHolesMm missing stop ${deg}.`)
        }
      }
      break
    case 'direct_rail':
      assertFinite(lk.thStopDeg, `${id}.linkage.thStopDeg`)
      if (!model.cradle.railGeometry) {
        throw new Error(`${id}: direct_rail requires cradle.railGeometry.`)
      }
      break
    case 'tilted_cradle':
      assertFinite(lk.boardTiltDeg, `${id}.linkage.boardTiltDeg`)
      assertFinite(lk.bailRestDeg, `${id}.linkage.bailRestDeg`)
      assertPositive(lk.stopAboveRestDeg, `${id}.linkage.stopAboveRestDeg`)
      assertPositive(lk.zPivotMm, `${id}.linkage.zPivotMm`)
      break
    case 'direct_cup':
      assertFinite(lk.thStopDeg, `${id}.linkage.thStopDeg`)
      break
    case 'inclined_ramp':
      assertPositive(lk.rPullMm, `${id}.linkage.rPullMm`)
      assertFinitePair(lk.rollerPosMm, `${id}.linkage.rollerPosMm`)
      assertPositive(lk.rRollEffMm, `${id}.linkage.rRollEffMm`)
      assertPositive(lk.rampLengthMm, `${id}.linkage.rampLengthMm`)
      assertNonNegative(lk.rampStartZMm, `${id}.linkage.rampStartZMm`)
      assertFinitePair(lk.rampAngleRangeDeg, `${id}.linkage.rampAngleRangeDeg`)
      if (lk.rampAngleRangeDeg[0] >= lk.rampAngleRangeDeg[1]) {
        throw new RangeError(`${id}.linkage.rampAngleRangeDeg invalid range.`)
      }
      assertFinite(lk.defaultRampAngleDeg, `${id}.linkage.defaultRampAngleDeg`)
      assertFinitePair(lk.cockAngleRangeDeg, `${id}.linkage.cockAngleRangeDeg`)
      if (lk.cockAngleRangeDeg[0] >= lk.cockAngleRangeDeg[1]) {
        throw new RangeError(`${id}.linkage.cockAngleRangeDeg invalid range.`)
      }
      assertNonNegative(lk.muChute, `${id}.linkage.muChute`)
      break
    case 'gravity_trebuchet':
      assertPositive(
        lk.counterweightMassKg,
        `${id}.linkage.counterweightMassKg`
      )
      assertPositive(lk.dropHeightM, `${id}.linkage.dropHeightM`)
      assertPositive(lk.counterweightArmM, `${id}.linkage.counterweightArmM`)
      assertPositive(lk.throwingArmM, `${id}.linkage.throwingArmM`)
      assertPositive(lk.slingLengthM, `${id}.linkage.slingLengthM`)
      assertFinite(lk.pinAngleDeg, `${id}.linkage.pinAngleDeg`)
      assertPositive(lk.pivotHeightM, `${id}.linkage.pivotHeightM`)
      assertNonNegative(lk.pouchMassKg, `${id}.linkage.pouchMassKg`)
      assertFinite(lk.cockAngleDeg, `${id}.linkage.cockAngleDeg`)
      assertNonNegative(lk.troughBottomZMm, `${id}.linkage.troughBottomZMm`)
      break
  }

  // Adjustments validation
  const seenIds = new Set<string>()
  for (const adj of model.adjustments) {
    validateAdjustmentDef(adj, id)
    if (seenIds.has(adj.id)) {
      throw new Error(`${id}: duplicate adjustment id "${adj.id}".`)
    }
    seenIds.add(adj.id)
  }

  // Timing & tolerances
  assertNonNegative(
    model.cycleTiming.cockPerTrapS,
    `${id}.cycleTiming.cockPerTrapS`
  )
  assertNonNegative(model.cycleTiming.loadS, `${id}.cycleTiming.loadS`)
  assertNonNegative(
    model.cycleTiming.aimAdjustS,
    `${id}.cycleTiming.aimAdjustS`
  )
  assertNonNegative(
    model.cycleTiming.humanSigmaS,
    `${id}.cycleTiming.humanSigmaS`
  )
  assertNonNegative(
    model.tolerances.cockAngleSigmaDeg,
    `${id}.tolerances.cockAngleSigmaDeg`
  )
  assertNonNegative(
    model.tolerances.seatingOffsetSigmaM,
    `${id}.tolerances.seatingOffsetSigmaM`
  )
  assertNonNegative(
    model.tolerances.yawSigmaDeg,
    `${id}.tolerances.yawSigmaDeg`
  )
  assertNonNegative(
    model.tolerances.stopAngleSigmaDeg,
    `${id}.tolerances.stopAngleSigmaDeg`
  )

  return model
}

export function defaultAdjustments(model: LauncherModel): AdjustmentValues {
  const out: AdjustmentValues = {}
  for (const adj of model.adjustments) {
    out[adj.id] = adj.defaultValue
  }
  return out
}

function snapToAdjustment(adj: AdjustmentDef, value: number): number {
  if (adj.kind === 'discrete') {
    const options = adj.options!
    let best = options[0]
    let bestDiff = Math.abs(value - best)
    for (let i = 1; i < options.length; i++) {
      const diff = Math.abs(value - options[i])
      if (diff < bestDiff) {
        best = options[i]
        bestDiff = diff
      }
    }
    return best
  }
  const clamped = Math.min(adj.max, Math.max(adj.min, value))
  const steps = Math.round((clamped - adj.min) / adj.step)
  const snapped = Math.min(adj.max, Math.max(adj.min, adj.min + steps * adj.step))
  return Number(snapped.toFixed(10))
}

export function validateAndClampAdjustments(
  model: LauncherModel,
  raw?: Partial<Record<string, number>>
): AdjustmentValues {
  const result = defaultAdjustments(model)
  if (raw === undefined) return result
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new TypeError('Adjustments input must be a plain record object.')
  }
  const byId = new Map(model.adjustments.map((adj) => [adj.id, adj]))
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue
    const def = byId.get(key)
    if (!def) {
      throw new RangeError(
        `Unknown adjustment key "${key}" for model "${model.id}".`
      )
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new RangeError(`Adjustment "${key}" must be a finite number.`)
    }
    result[key] = snapToAdjustment(def, value)
  }
  return result
}

export function computeRailTopMm(rail: RailGeometry, xMm: number): number {
  if (xMm <= rail.xRise0Mm) return rail.hzFootMm
  if (xMm <= rail.xRise1Mm) {
    return (
      rail.hzFootMm +
      ((rail.hzRootMm - rail.hzFootMm) * (xMm - rail.xRise0Mm)) /
        (rail.xRise1Mm - rail.xRise0Mm)
    )
  }
  return (
    rail.hzRootMm +
    ((rail.hzTipMm - rail.hzRootMm) * (xMm - rail.xRise1Mm)) /
      (rail.lTipMm - rail.xRise1Mm)
  )
}

export function computeDirectArmPegPositions(
  rail: RailGeometry,
  ballRadiusMm = REGULATION_GOLF_BALL.radiusM * 1000,
  thCockDeg = 173.0,
  zHingeMm = 29.5
): DirectArmPegPosition[] {
  const thRad = (thCockDeg * Math.PI) / 180
  const cosTh = Math.cos(thRad)
  const sinTh = Math.sin(thRad)
  const positions: DirectArmPegPosition[] = []

  for (let pegIdx = 0; pegIdx < rail.pegCount; pegIdx++) {
    for (const flip of [0, 1] as const) {
      const holeOffset =
        flip === 1
          ? rail.blockLenMm - rail.blockHoleOffMm
          : rail.blockHoleOffMm
      const xFace = rail.pegX0Mm + rail.pegPitchMm * pegIdx + holeOffset
      let x = xFace + 13.0
      for (let iter = 0; iter < 8; iter++) {
        const dz = computeRailTopMm(rail, x) + rail.rideHMm - rail.blockTopMm
        x = xFace + Math.sqrt(Math.max(0, ballRadiusMm * ballRadiusMm - dz * dz))
      }
      const railTopMm = computeRailTopMm(rail, x)
      const yArm = rail.zWireMm + railTopMm + rail.rideHMm
      const bzCockedMm = zHingeMm + x * sinTh - yArm * cosTh
      const zBotMm = bzCockedMm - ballRadiusMm
      positions.push({
        peg: pegIdx + 1,
        flip,
        label: `${pegIdx + 1}${flip === 1 ? 'B' : 'A'}`,
        x0Mm: x,
        xbMm: x - 20.0,
        railTopMm,
        bzCockedMm,
        zBotMm,
        zBotIn: zBotMm / 25.4,
      })
    }
  }
  return positions
}

export function computeV51NotchBallPos(
  psiDeg: number,
  pivotPosMm: readonly [number, number] = [-96.0, 72.0],
  ballOffsetArmMm: readonly [number, number] = [-171.3, 1.3],
  ballRadiusMm = REGULATION_GOLF_BALL.radiusM * 1000
): V51NotchBallPos {
  const rad = (psiDeg * Math.PI) / 180
  const cosPsi = Math.cos(rad)
  const sinPsi = Math.sin(rad)
  const [ox, oz] = ballOffsetArmMm
  const bxMm = pivotPosMm[0] + ox * cosPsi + oz * sinPsi
  const bzMm = pivotPosMm[1] - ox * sinPsi + oz * cosPsi
  const zBotMm = bzMm - ballRadiusMm
  return {
    bxMm,
    bzMm,
    zBotMm,
    zBotIn: zBotMm / 25.4,
  }
}
