import {
  computeRailTopMm,
  V50_CIRCULAR_CAM,
  V51_CORD_HORN,
  type AdjustmentValues,
  type LauncherModel,
  type RailGeometry,
} from '../models'

const DEG_TO_RAD = Math.PI / 180
const RAD_TO_DEG = 180 / Math.PI
const TWO_PI = 2 * Math.PI

const V51_LINKAGE =
  V51_CORD_HORN.linkage.kind === 'cord_horn'
    ? V51_CORD_HORN.linkage
    : (() => {
        throw new Error('V51_CORD_HORN linkage must be cord_horn')
      })()

const V50_LINKAGE =
  V50_CIRCULAR_CAM.linkage.kind === 'circular_cam'
    ? V50_CIRCULAR_CAM.linkage
    : (() => {
        throw new Error('V50_CIRCULAR_CAM linkage must be circular_cam')
      })()

export interface CordSideResult {
  readonly spanMm: number
  readonly touchAngleRad: number
  readonly leverArmMm: number
  readonly 2: number
}

export interface CordLinkageTable {
  readonly cordLengthMm: number
  readonly psiCockDeg: number
  readonly psiStopDeg: number
  readonly psiDeadDeg: number
  readonly psiEndDeg: number
  readonly thCockDeg: number
  readonly reachable: boolean
  readonly psisDeg: Float64Array
  readonly thOfPsiDeg: Float64Array
  readonly levBMm: Float64Array
  readonly levHMm: Float64Array
  readonly h1: Float64Array
  readonly h2: Float64Array
  evalAtPsi: (psiDeg: number) => {
    inRange: boolean
    thDeg: number
    levBMm: number
    levHMm: number
    h1: number
    h2: number
  }
}

export interface DirectRailKinematics {
  readonly x0M: number
  readonly y0M: number
  readonly xbM: number
  readonly sEndM: number
  readonly gammaRad: number
  readonly rideHM: number
  readonly rolling: boolean
  readonly frictionless: boolean
  readonly inertiaBaseKgM2: number
  readonly mxBaseKgM: number
  readonly thCockDeg: number
  readonly thStopDeg: number
  readonly zHingeM: number
  readonly cockedBallBottomHeightM: number
}

export interface DirectCupKinematics {
  readonly oxM: number
  readonly ozM: number
  readonly rBallM: number
  readonly pivotPosM: readonly [number, number]
  readonly thCockDeg: number
  readonly thStopDeg: number
  readonly cockedBallBottomHeightM: number
}

export interface TiltedCradleKinematics {
  readonly rBallM: number
  readonly oxM: number
  readonly ozM: number
  readonly alphaTrapFrontDeg: number
  readonly thCockDeg: number
  readonly thStopDeg: number
  readonly zPivotM: number
  readonly cockedBallBottomHeightM: number
}

export interface InclinedRampKinematics {
  readonly rampAngleDeg: number
  readonly rampAngleRad: number
  readonly rampLengthM: number
  readonly rampStartZM: number
  readonly thCockDeg: number
  readonly thRestDeg: number
  readonly muChute: number
  readonly hingePosMm: readonly [number, number]
  readonly rollerPosMm: readonly [number, number]
  readonly rPullMm: number
  readonly rRollEffMm: number
  readonly cockedBallBottomHeightM: number
}

export interface TrebuchetKinematics {
  readonly counterweightMassKg: number
  readonly dropHeightM: number
  readonly kCwM: number
  readonly counterweightArmM: number
  readonly throwingArmM: number
  readonly slingLengthM: number
  readonly pinAngleDeg: number
  readonly pivotHeightM: number
  readonly pouchMassKg: number
  readonly th0Rad: number
  readonly beta0Rad: number
  readonly troughCenterZM: number
  readonly startsInTrough: boolean
  readonly zBall0M: number
  readonly cockedBallBottomHeightM: number
}

function mod2Pi(angleRad: number): number {
  const m = angleRad % TWO_PI
  return m < 0 ? m + TWO_PI : m
}

function tangentToRoller(
  qx: number,
  qz: number,
  cx: number,
  cz: number,
  rRollMm: number,
  side: 1 | -1
): { spanMm: number; touchAngleRad: number; ux: number; uz: number } {
  const dx = qx - cx
  const dz = qz - cz
  const dist = Math.hypot(dx, dz)
  if (dist <= rRollMm + 1e-9) {
    const ang = Math.atan2(dz, dx)
    return {
      spanMm: 1e-6,
      touchAngleRad: ang,
      ux: -Math.cos(ang),
      uz: -Math.sin(ang),
    }
  }
  const ratio = Math.min(1, Math.max(-1, rRollMm / dist))
  const ang = Math.atan2(dz, dx) + side * Math.acos(ratio)
  const spanMm = Math.sqrt(Math.max(1e-12, dist * dist - rRollMm * rRollMm))
  const tx = cx + rRollMm * Math.cos(ang)
  const tz = cz + rRollMm * Math.sin(ang)
  return {
    spanMm,
    touchAngleRad: ang,
    ux: (tx - qx) / spanMm,
    uz: (tz - qz) / spanMm,
  }
}

export function bailSide(
  thDeg: number,
  hingePosMm: readonly [number, number] = V51_CORD_HORN.trapBank.hingePosMm,
  rollerPosMm: readonly [number, number] = V51_LINKAGE.rollerPosMm,
  rPullMm = V51_LINKAGE.rPullMm,
  rRollEffMm = V51_LINKAGE.rRollEffMm
): CordSideResult {
  const thRad = thDeg * DEG_TO_RAD
  const rx = rPullMm * Math.cos(thRad)
  const rz = rPullMm * Math.sin(thRad)
  const ex = hingePosMm[0] + rx
  const ez = hingePosMm[1] + rz
  const t = tangentToRoller(
    ex,
    ez,
    rollerPosMm[0],
    rollerPosMm[1],
    rRollEffMm,
    -1
  )
  const leverArmMm = rx * t.uz - rz * t.ux
  return {
    spanMm: t.spanMm,
    touchAngleRad: t.touchAngleRad,
    leverArmMm,
    2: leverArmMm,
  }
}

export function hornSide(
  psiDeg: number,
  hornRMm = V51_LINKAGE.hornRMm,
  hornADeg = V51_LINKAGE.hornADeg,
  pivotPosMm: readonly [number, number] = V51_CORD_HORN.arm.pivotPosMm,
  rollerPosMm: readonly [number, number] = V51_LINKAGE.rollerPosMm,
  rRollEffMm = V51_LINKAGE.rRollEffMm
): CordSideResult {
  const angRad = (hornADeg - psiDeg) * DEG_TO_RAD
  const rx = hornRMm * Math.cos(angRad)
  const rz = hornRMm * Math.sin(angRad)
  const qx = pivotPosMm[0] + rx
  const qz = pivotPosMm[1] + rz
  const t = tangentToRoller(
    qx,
    qz,
    rollerPosMm[0],
    rollerPosMm[1],
    rRollEffMm,
    1
  )
  const leverArmMm = rz * t.ux - rx * t.uz
  return {
    spanMm: t.spanMm,
    touchAngleRad: t.touchAngleRad,
    leverArmMm,
    2: leverArmMm,
  }
}

export function computeHornLeverArmMm(
  psiDeg: number,
  model?: LauncherModel
): number {
  if (model && model.linkage.kind === 'cord_horn') {
    return hornSide(
      psiDeg,
      model.linkage.hornRMm,
      model.linkage.hornADeg,
      model.arm.pivotPosMm,
      model.linkage.rollerPosMm,
      model.linkage.rRollEffMm
    ).leverArmMm
  }
  if (model && model.linkage.kind === 'circular_cam') {
    return model.linkage.rCamEffMm
  }
  return hornSide(psiDeg).leverArmMm
}

export function camSide(
  psiDeg: number,
  rCamEffMm = V50_LINKAGE.rCamEffMm,
  camKnotDeg = V50_LINKAGE.camKnotDeg,
  pivotPosMm: readonly [number, number] = V50_CIRCULAR_CAM.arm.pivotPosMm,
  rollerPosMm: readonly [number, number] = V50_LINKAGE.rollerPosMm,
  rRollEffMm = V50_LINKAGE.rRollEffMm
): CordSideResult {
  const dx = rollerPosMm[0] - pivotPosMm[0]
  const dz = rollerPosMm[1] - pivotPosMm[1]
  const dist = Math.hypot(dx, dz)
  const sumR = rCamEffMm + rRollEffMm
  const ratio = dist > 1e-9 ? Math.min(1, Math.max(-1, sumR / dist)) : 1
  const phiRad = Math.atan2(dz, dx) + Math.acos(ratio)
  const spanStraight = Math.sqrt(Math.max(1e-12, dist * dist - sumR * sumR))
  const wrapDeg = camKnotDeg - (phiRad * RAD_TO_DEG + psiDeg)
  const spanMm = spanStraight + rCamEffMm * wrapDeg * DEG_TO_RAD
  return {
    spanMm,
    touchAngleRad: phiRad + Math.PI,
    leverArmMm: rCamEffMm,
    2: rCamEffMm,
  }
}

export function cordLen(
  thDeg: number,
  psiDeg: number,
  model?: LauncherModel
): number {
  if (!model || model.linkage.kind === 'cord_horn') {
    const lk =
      model && model.linkage.kind === 'cord_horn' ? model.linkage : V51_LINKAGE
    const hp = model ? model.trapBank.hingePosMm : V51_CORD_HORN.trapBank.hingePosMm
    const pp = model ? model.arm.pivotPosMm : V51_CORD_HORN.arm.pivotPosMm
    const b = bailSide(thDeg, hp, lk.rollerPosMm, lk.rPullMm, lk.rRollEffMm)
    const h = hornSide(
      psiDeg,
      lk.hornRMm,
      lk.hornADeg,
      pp,
      lk.rollerPosMm,
      lk.rRollEffMm
    )
    return (
      b.spanMm +
      h.spanMm +
      lk.rRollEffMm * mod2Pi(b.touchAngleRad - h.touchAngleRad)
    )
  }
  if (model.linkage.kind === 'circular_cam') {
    const lk = model.linkage
    const b = bailSide(
      thDeg,
      model.trapBank.hingePosMm,
      lk.rollerPosMm,
      lk.rPullMm,
      lk.rRollEffMm
    )
    const h = camSide(
      psiDeg,
      lk.rCamEffMm,
      lk.camKnotDeg,
      model.arm.pivotPosMm,
      lk.rollerPosMm,
      lk.rRollEffMm
    )
    return (
      b.spanMm +
      h.spanMm +
      lk.rRollEffMm * mod2Pi(b.touchAngleRad - h.touchAngleRad)
    )
  }
  throw new RangeError(`cordLen requires cord_horn or circular_cam topology, got ${model.topology}.`)
}

function interpSorted(
  xs: Float64Array,
  ys: Float64Array,
  x: number,
  descending = false
): number {
  const n = xs.length
  if (n === 0) return Number.NaN
  if (n === 1) return ys[0]
  if (!descending) {
    if (x <= xs[0]) return ys[0]
    if (x >= xs[n - 1]) return ys[n - 1]
    let lo = 0
    let hi = n - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (xs[mid] <= x) lo = mid
      else hi = mid
    }
    const span = xs[hi] - xs[lo]
    const f = span !== 0 ? (x - xs[lo]) / span : 0
    return ys[lo] + f * (ys[hi] - ys[lo])
  }
  // Descending xs
  if (x >= xs[0]) return ys[0]
  if (x <= xs[n - 1]) return ys[n - 1]
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (xs[mid] >= x) lo = mid
    else hi = mid
  }
  const span = xs[hi] - xs[lo]
  const f = span !== 0 ? (x - xs[lo]) / span : 0
  return ys[lo] + f * (ys[hi] - ys[lo])
}

const MAX_BAIL_SWEEP_CACHE_SIZE = 64
const MAX_CORD_TABLE_CACHE_SIZE = 256

interface BailSweepCacheEntry {
  readonly ths: Float64Array
  readonly lbArr: Float64Array
  readonly lb0: number
  readonly lbMin: number
  readonly lbDescending: boolean
  readonly bAtRestSpanMm: number
  readonly bAtRestTouchAngleRad: number
}

const bailSweepCache = new Map<string, BailSweepCacheEntry>()
const cordLinkageTableCache = new Map<string, CordLinkageTable>()

function lruGet<V>(cache: Map<string, V>, key: string): V | undefined {
  const val = cache.get(key)
  if (val !== undefined) {
    cache.delete(key)
    cache.set(key, val)
  }
  return val
}

function lruSet<V>(
  cache: Map<string, V>,
  key: string,
  val: V,
  maxSize: number
): void {
  if (cache.has(key)) {
    cache.delete(key)
  } else if (cache.size >= maxSize) {
    const oldestKey = cache.keys().next().value
    if (oldestKey !== undefined) {
      cache.delete(oldestKey)
    }
  }
  cache.set(key, val)
}

function fmtNumKey(n: number): string {
  return Object.is(n, -0) ? '-0' : String(n)
}

export function clearCordLinkageCache(): void {
  cordLinkageTableCache.clear()
  bailSweepCache.clear()
}

export function getCordLinkageCacheStats(): {
  tableCacheSize: number
  bailSweepCacheSize: number
  maxTableCacheSize: number
  maxBailSweepCacheSize: number
} {
  return {
    tableCacheSize: cordLinkageTableCache.size,
    bailSweepCacheSize: bailSweepCache.size,
    maxTableCacheSize: MAX_CORD_TABLE_CACHE_SIZE,
    maxBailSweepCacheSize: MAX_BAIL_SWEEP_CACHE_SIZE,
  }
}

function computeBailSweep(model: LauncherModel): BailSweepCacheEntry {
  const lk = model.linkage
  if (lk.kind !== 'cord_horn' && lk.kind !== 'circular_cam') {
    throw new RangeError(
      `buildCordLinkageTable requires cord_horn or circular_cam, got ${model.topology}.`
    )
  }
  const tb = model.trapBank
  const thStep = 0.05
  const nTh = Math.max(2, Math.round((tb.thCockMaxDeg - tb.thRestDeg) / thStep) + 1)
  const ths = new Float64Array(nTh)
  const lbArr = new Float64Array(nTh)
  for (let i = 0; i < nTh; i++) {
    const th = i === nTh - 1 ? tb.thCockMaxDeg : tb.thRestDeg + i * thStep
    ths[i] = th
    lbArr[i] = cordLen(th, 0, model)
  }
  const lb0 = lbArr[0]
  const lbMin = lbArr[nTh - 1]
  const lbDescending = lbMin < lb0
  const bAtRest = bailSide(
    tb.thRestDeg,
    tb.hingePosMm,
    lk.rollerPosMm,
    lk.rPullMm,
    lk.rRollEffMm
  )
  return {
    ths,
    lbArr,
    lb0,
    lbMin,
    lbDescending,
    bAtRestSpanMm: bAtRest.spanMm,
    bAtRestTouchAngleRad: bAtRest.touchAngleRad,
  }
}

export function buildCordLinkageTable(
  model: LauncherModel,
  psiCockDeg: number,
  psiStopDeg: number,
  cordOffsetMmOverride?: number
): CordLinkageTable {
  const lk = model.linkage
  if (lk.kind !== 'cord_horn' && lk.kind !== 'circular_cam') {
    throw new RangeError(
      `buildCordLinkageTable requires cord_horn or circular_cam, got ${model.topology}.`
    )
  }
  const tb = model.trapBank
  const psiTieDeg =
    lk.kind === 'cord_horn'
      ? lk.notchPsisDeg[lk.cordTieNotchIndex]
      : lk.notchPsisDeg[lk.notchPsisDeg.length - 1]
  const lkOffset = (lk as { cordLengthOffsetMm?: number }).cordLengthOffsetMm
  const offsetMm =
    cordOffsetMmOverride ?? (typeof lkOffset === 'number' ? lkOffset : 0)

  const paramA = lk.kind === 'cord_horn' ? lk.hornRMm : lk.rCamEffMm
  const paramB = lk.kind === 'cord_horn' ? lk.hornADeg : lk.camKnotDeg

  const allFinite =
    Number.isFinite(tb.thCockMaxDeg) &&
    Number.isFinite(tb.thRestDeg) &&
    Number.isFinite(tb.hingePosMm[0]) &&
    Number.isFinite(tb.hingePosMm[1]) &&
    Number.isFinite(model.arm.pivotPosMm[0]) &&
    Number.isFinite(model.arm.pivotPosMm[1]) &&
    Number.isFinite(lk.rollerPosMm[0]) &&
    Number.isFinite(lk.rollerPosMm[1]) &&
    Number.isFinite(lk.rPullMm) &&
    Number.isFinite(lk.rRollEffMm) &&
    Number.isFinite(paramA) &&
    Number.isFinite(paramB) &&
    Number.isFinite(lk.cordTieThCockDeg) &&
    Number.isFinite(psiTieDeg) &&
    Number.isFinite(offsetMm) &&
    Number.isFinite(psiCockDeg) &&
    Number.isFinite(psiStopDeg)

  if (!allFinite) {
    const sweep = computeBailSweep(model)
    return buildCordLinkageTableFromSweep(
      model,
      psiCockDeg,
      psiStopDeg,
      psiTieDeg,
      offsetMm,
      sweep
    )
  }

  const bailKey =
    `${lk.kind}|${fmtNumKey(tb.thCockMaxDeg)}|${fmtNumKey(tb.thRestDeg)}` +
    `|${fmtNumKey(tb.hingePosMm[0])}|${fmtNumKey(tb.hingePosMm[1])}` +
    `|${fmtNumKey(model.arm.pivotPosMm[0])}|${fmtNumKey(model.arm.pivotPosMm[1])}` +
    `|${fmtNumKey(lk.rollerPosMm[0])}|${fmtNumKey(lk.rollerPosMm[1])}` +
    `|${fmtNumKey(lk.rPullMm)}|${fmtNumKey(lk.rRollEffMm)}` +
    `|${fmtNumKey(paramA)}|${fmtNumKey(paramB)}`
  const tableKey =
    `${bailKey}|${fmtNumKey(lk.cordTieThCockDeg)}|${fmtNumKey(psiTieDeg)}` +
    `|${fmtNumKey(offsetMm)}|${fmtNumKey(psiCockDeg)}|${fmtNumKey(psiStopDeg)}`

  const cachedTable = lruGet(cordLinkageTableCache, tableKey)
  if (cachedTable !== undefined) {
    return cachedTable
  }

  let sweep = lruGet(bailSweepCache, bailKey)
  if (sweep === undefined) {
    sweep = computeBailSweep(model)
    lruSet(bailSweepCache, bailKey, sweep, MAX_BAIL_SWEEP_CACHE_SIZE)
  }

  const table = buildCordLinkageTableFromSweep(
    model,
    psiCockDeg,
    psiStopDeg,
    psiTieDeg,
    offsetMm,
    sweep
  )
  lruSet(cordLinkageTableCache, tableKey, table, MAX_CORD_TABLE_CACHE_SIZE)
  return table
}

function buildCordLinkageTableFromSweep(
  model: LauncherModel,
  psiCockDeg: number,
  psiStopDeg: number,
  psiTieDeg: number,
  offsetMm: number,
  sweep: BailSweepCacheEntry
): CordLinkageTable {
  const lk = model.linkage
  if (lk.kind !== 'cord_horn' && lk.kind !== 'circular_cam') {
    throw new RangeError(
      `buildCordLinkageTable requires cord_horn or circular_cam, got ${model.topology}.`
    )
  }
  const tb = model.trapBank
  const cordLengthMm = cordLen(lk.cordTieThCockDeg, psiTieDeg, model) + offsetMm

  const {
    ths,
    lbArr,
    lb0,
    lbMin,
    lbDescending,
    bAtRestSpanMm,
    bAtRestTouchAngleRad,
  } = sweep

  const psiMax = Math.max(psiCockDeg + 1, psiStopDeg + 20)
  const psiStep = 0.05
  const nPsiAll = Math.max(2, Math.round((psiMax - psiCockDeg) / psiStep) + 1)

  const allPsis = new Float64Array(nPsiAll)
  const allNeeds = new Float64Array(nPsiAll)
  const allLevH = new Float64Array(nPsiAll)
  let psiDeadDeg = Number.NaN
  let usableCount = nPsiAll
  let clipped = false

  for (let i = 0; i < nPsiAll; i++) {
    const psi = i === nPsiAll - 1 ? psiMax : psiCockDeg + i * psiStep
    allPsis[i] = psi
    const hSide =
      lk.kind === 'cord_horn'
        ? hornSide(
            psi,
            lk.hornRMm,
            lk.hornADeg,
            model.arm.pivotPosMm,
            lk.rollerPosMm,
            lk.rRollEffMm
          )
        : camSide(
            psi,
            lk.rCamEffMm,
            lk.camKnotDeg,
            model.arm.pivotPosMm,
            lk.rollerPosMm,
            lk.rRollEffMm
          )
    const lAtRest =
      bAtRestSpanMm +
      hSide.spanMm +
      lk.rRollEffMm * mod2Pi(bAtRestTouchAngleRad - hSide.touchAngleRad)
    const need = cordLengthMm - (lAtRest - lb0)
    allNeeds[i] = need
    const levH = hSide.leverArmMm
    allLevH[i] = levH
    if (Number.isNaN(psiDeadDeg) && levH <= 0.5) {
      psiDeadDeg = psi
    }
    if (!clipped && (levH <= 0.5 || need > lb0 || need < lbMin)) {
      usableCount = i
      clipped = true
    }
  }

  const reachable = usableCount > 0 && !(clipped && usableCount === 0)
  if (!reachable || usableCount < 2) {
    return Object.freeze({
      cordLengthMm,
      psiCockDeg,
      psiStopDeg,
      psiDeadDeg,
      psiEndDeg: psiCockDeg,
      thCockDeg: Number.NaN,
      reachable: false,
      psisDeg: new Float64Array(0),
      thOfPsiDeg: new Float64Array(0),
      levBMm: new Float64Array(0),
      levHMm: new Float64Array(0),
      h1: new Float64Array(0),
      h2: new Float64Array(0),
      evalAtPsi: () => ({
        inRange: false,
        thDeg: Number.NaN,
        levBMm: 0,
        levHMm: 0,
        h1: 0,
        h2: 0,
      }),
    })
  }

  const psisDeg = allPsis.slice(0, usableCount)
  const thOfPsiDeg = new Float64Array(usableCount)
  const levBMm = new Float64Array(usableCount)
  const levHMm = allLevH.slice(0, usableCount)
  const h1 = new Float64Array(usableCount)
  const h2 = new Float64Array(usableCount)

  for (let i = 0; i < usableCount; i++) {
    const th = interpSorted(lbArr, ths, allNeeds[i], lbDescending)
    thOfPsiDeg[i] = th
    const lbVal = bailSide(
      th,
      tb.hingePosMm,
      lk.rollerPosMm,
      lk.rPullMm,
      lk.rRollEffMm
    ).leverArmMm
    levBMm[i] = lbVal
    h1[i] = Math.abs(lbVal) > 1e-6 ? -levHMm[i] / lbVal : 0
  }

  for (let i = 0; i < usableCount; i++) {
    if (i === 0) {
      const dRad = (psisDeg[1] - psisDeg[0]) * DEG_TO_RAD
      h2[i] = dRad !== 0 ? (h1[1] - h1[0]) / dRad : 0
    } else if (i === usableCount - 1) {
      const dRad = (psisDeg[i] - psisDeg[i - 1]) * DEG_TO_RAD
      h2[i] = dRad !== 0 ? (h1[i] - h1[i - 1]) / dRad : 0
    } else {
      const dRad = (psisDeg[i + 1] - psisDeg[i - 1]) * DEG_TO_RAD
      h2[i] = dRad !== 0 ? (h1[i + 1] - h1[i - 1]) / dRad : 0
    }
  }

  const psiEndDeg = psisDeg[usableCount - 1]
  const thCockDeg = thOfPsiDeg[0]

  return Object.freeze({
    cordLengthMm,
    psiCockDeg,
    psiStopDeg,
    psiDeadDeg,
    psiEndDeg,
    thCockDeg,
    reachable: true,
    psisDeg,
    thOfPsiDeg,
    levBMm,
    levHMm,
    h1,
    h2,
    evalAtPsi(psiDeg: number) {
      if (psiDeg < psisDeg[0] || psiDeg > psiEndDeg) {
        return {
          inRange: false,
          thDeg: Number.NaN,
          levBMm: 0,
          levHMm: 0,
          h1: 0,
          h2: 0,
        }
      }
      return {
        inRange: true,
        thDeg: interpSorted(psisDeg, thOfPsiDeg, psiDeg, false),
        levBMm: interpSorted(psisDeg, levBMm, psiDeg, false),
        levHMm: interpSorted(psisDeg, levHMm, psiDeg, false),
        h1: interpSorted(psisDeg, h1, psiDeg, false),
        h2: interpSorted(psisDeg, h2, psiDeg, false),
      }
    },
  })
}

export function computeDirectRailConfig(
  model: LauncherModel,
  adjustments: AdjustmentValues,
  seatingJitterM = 0,
  cockJitterDeg = 0,
  stopJitterDeg = 0
): DirectRailKinematics {
  if (model.linkage.kind !== 'direct_rail' || !model.cradle.railGeometry) {
    throw new RangeError(`${model.id} is not a direct_rail launcher.`)
  }
  const rail = model.cradle.railGeometry as RailGeometry & {
    roll?: boolean
    frictionless?: boolean
  }
  const peg = Math.max(1, Math.min(rail.pegCount, Math.round(adjustments.peg ?? 1)))
  const flip = (adjustments.flip ?? 0) === 1 ? 1 : 0
  const holeOffset =
    flip === 1 ? rail.blockLenMm - rail.blockHoleOffMm : rail.blockHoleOffMm
  const xFaceMm = rail.pegX0Mm + rail.pegPitchMm * (peg - 1) + holeOffset
  const rBallMm = model.projectile.radiusM * 1000
  let xMm = xFaceMm + 13.0
  for (let i = 0; i < 8; i++) {
    const dz = computeRailTopMm(rail, xMm) + rail.rideHMm - rail.blockTopMm
    xMm = xFaceMm + Math.sqrt(Math.max(0, rBallMm * rBallMm - dz * dz))
  }
  const x0M = Math.max(
    0.04,
    Math.min(rail.lTipMm * 1e-3 - 0.002, xMm * 1e-3 + seatingJitterM)
  )
  const railTopMm = computeRailTopMm(rail, x0M * 1000)
  const y0M = (rail.zWireMm + railTopMm + rail.rideHMm) * 1e-3
  const xbM = (x0M * 1000 + rail.blockCgOffsetMm) * 1e-3
  const sEndM = (rail.lTipMm * 1e-3 - x0M) / Math.cos(rail.gammaRad)

  const thStopDeg = Math.max(
    model.trapBank.thRestDeg,
    model.linkage.thStopDeg + stopJitterDeg
  )
  const thCockDeg = Math.max(
    thStopDeg + 2,
    Math.min(180, model.trapBank.thCockMaxDeg + cockJitterDeg)
  )
  const zHingeM = model.trapBank.hingePosMm[1] * 1e-3
  const thCockRad = thCockDeg * DEG_TO_RAD
  const bzCockedM =
    zHingeM + x0M * Math.sin(thCockRad) - y0M * Math.cos(thCockRad)
  const cockedBallBottomHeightM = bzCockedM - model.projectile.radiusM

  const frictionless = rail.frictionless === true
  const rolling =
    rail.roll !== undefined
      ? rail.roll
      : frictionless
        ? false
        : (adjustments.rolling ?? (model.linkage.rollingModeDefault ? 1 : 0)) !== 0

  const inertiaBaseKgM2 =
    model.arm.inertiaKgM2 +
    model.trapBank.bailInertiaKgM2 +
    rail.blockMassKg * xbM * xbM
  const mxBaseKgM =
    model.arm.massKg * (model.arm.cgArmMm[0] * 1e-3) +
    model.trapBank.bailMassXKgM +
    rail.blockMassKg * xbM

  return {
    x0M,
    y0M,
    xbM,
    sEndM,
    gammaRad: rail.gammaRad,
    rideHM: rail.rideHMm * 1e-3,
    rolling,
    frictionless,
    inertiaBaseKgM2,
    mxBaseKgM,
    thCockDeg,
    thStopDeg,
    zHingeM,
    cockedBallBottomHeightM,
  }
}

export function computeDirectCupConfig(
  model: LauncherModel,
  adjustments: AdjustmentValues,
  seatingJitterM = 0,
  cockJitterDeg = 0,
  stopJitterDeg = 0
): DirectCupKinematics {
  if (model.linkage.kind !== 'direct_cup') {
    throw new RangeError(`${model.id} is not a direct_cup launcher.`)
  }
  const oxNomM = model.arm.ballOffsetArmMm[0] * 1e-3
  const ozNomM = model.arm.ballOffsetArmMm[1] * 1e-3
  const rNom = Math.hypot(oxNomM, ozNomM)
  const rBallM = Math.max(0.03, rNom + seatingJitterM)
  const scale = rNom > 0 ? rBallM / rNom : 1
  const oxM = oxNomM * scale
  const ozM = ozNomM * scale

  const thStopDeg = Math.max(
    model.trapBank.thRestDeg + 1,
    (adjustments.stopAngleDeg ?? model.linkage.thStopDeg) + stopJitterDeg
  )
  const thCockDeg = Math.max(
    thStopDeg + 2,
    Math.min(
      model.trapBank.thCockMaxDeg,
      (adjustments.cockAngleDeg ?? model.trapBank.thCockMaxDeg) + cockJitterDeg
    )
  )
  const pivotPosM: readonly [number, number] = [
    model.arm.pivotPosMm[0] * 1e-3,
    model.arm.pivotPosMm[1] * 1e-3,
  ]
  const thCockRad = thCockDeg * DEG_TO_RAD
  const bzCockedM =
    pivotPosM[1] + oxM * Math.sin(thCockRad) - ozM * Math.cos(thCockRad)

  return {
    oxM,
    ozM,
    rBallM,
    pivotPosM,
    thCockDeg,
    thStopDeg,
    cockedBallBottomHeightM: bzCockedM - model.projectile.radiusM,
  }
}

export function computeTiltedCradleConfig(
  model: LauncherModel,
  adjustments: AdjustmentValues,
  seatingJitterM = 0,
  cockJitterDeg = 0,
  stopJitterDeg = 0
): TiltedCradleKinematics {
  if (model.linkage.kind !== 'tilted_cradle') {
    throw new RangeError(`${model.id} is not a tilted_cradle launcher.`)
  }
  const oxNomM = model.arm.ballOffsetArmMm[0] * 1e-3
  const ozNomM = model.arm.ballOffsetArmMm[1] * 1e-3
  const rNom = Math.hypot(oxNomM, ozNomM)
  const rBallM = Math.max(0.03, rNom + seatingJitterM)
  const scale = rNom > 0 ? rBallM / rNom : 1
  const oxM = oxNomM * scale
  const ozM = ozNomM * scale

  const launchDeg = adjustments.launchDeg ?? 90 - model.linkage.boardTiltDeg
  const stopDeg = adjustments.stopDeg ?? model.linkage.stopAboveRestDeg
  const thStopDeg = Math.max(
    model.trapBank.thRestDeg + 0.5,
    stopDeg - model.linkage.bailRestDeg + stopJitterDeg
  )
  const thCockDeg = Math.max(
    thStopDeg + 5,
    Math.min(
      model.trapBank.thCockMaxDeg,
      model.trapBank.thCockMaxDeg + cockJitterDeg
    )
  )
  // Orient arm stop angle so ball tangent velocity points along launchDeg at thStopDeg
  const ballOffsetAngleDeg = Math.atan2(ozM, oxM) * RAD_TO_DEG
  const alphaTrapFrontDeg =
    launchDeg + 90 + ballOffsetAngleDeg - thStopDeg
  const zPivotM = model.linkage.zPivotMm * 1e-3
  const alphaCockRad = (alphaTrapFrontDeg + thCockDeg) * DEG_TO_RAD
  const bzCockedM =
    zPivotM + oxM * Math.sin(alphaCockRad) - ozM * Math.cos(alphaCockRad)

  return {
    rBallM,
    oxM,
    ozM,
    alphaTrapFrontDeg,
    thCockDeg,
    thStopDeg,
    zPivotM,
    cockedBallBottomHeightM: bzCockedM - model.projectile.radiusM,
  }
}

export function computeInclinedRampConfig(
  model: LauncherModel,
  adjustments: AdjustmentValues,
  cockJitterDeg = 0
): InclinedRampKinematics {
  if (model.linkage.kind !== 'inclined_ramp') {
    throw new RangeError(`${model.id} is not an inclined_ramp launcher.`)
  }
  const lk = model.linkage
  const rampAngleDeg = adjustments.rampAngleDeg ?? lk.defaultRampAngleDeg
  const thCockDeg = Math.max(
    model.trapBank.thRestDeg + 5,
    Math.min(
      model.trapBank.thCockMaxDeg,
      (adjustments.cockAngleDeg ?? model.trapBank.thCockMaxDeg) + cockJitterDeg
    )
  )
  const rampStartZM = lk.rampStartZMm * 1e-3
  return {
    rampAngleDeg,
    rampAngleRad: rampAngleDeg * DEG_TO_RAD,
    rampLengthM: lk.rampLengthMm * 1e-3,
    rampStartZM,
    thCockDeg,
    thRestDeg: model.trapBank.thRestDeg,
    muChute: lk.muChute,
    hingePosMm: model.trapBank.hingePosMm,
    rollerPosMm: lk.rollerPosMm,
    rPullMm: lk.rPullMm,
    rRollEffMm: lk.rRollEffMm,
    cockedBallBottomHeightM: rampStartZM,
  }
}

export function computeTrebuchetConfig(
  model: LauncherModel,
  adjustments: AdjustmentValues,
  cockJitterDeg = 0,
  stopJitterDeg = 0
): TrebuchetKinematics {
  if (model.linkage.kind !== 'gravity_trebuchet') {
    throw new RangeError(`${model.id} is not a gravity_trebuchet launcher.`)
  }
  const lk = model.linkage
  const counterweightMassKg = adjustments.counterweightKg ?? lk.counterweightMassKg
  const dropHeightM = adjustments.dropHeightM ?? lk.dropHeightM
  const slingLengthM = adjustments.slingLengthM ?? lk.slingLengthM
  const pinAngleDeg = Math.max(
    5,
    Math.min(80, (adjustments.releasePinAngleDeg ?? lk.pinAngleDeg) + stopJitterDeg)
  )
  const th0Rad = Math.max(
    -75 * DEG_TO_RAD,
    Math.min(0, (lk.cockAngleDeg + cockJitterDeg) * DEG_TO_RAD)
  )
  const kCwM = dropHeightM / (1 - Math.sin(th0Rad))
  const troughBottomZM = lk.troughBottomZMm * 1e-3
  const troughCenterZM = troughBottomZM + model.projectile.radiusM
  const sinB0Raw =
    (lk.pivotHeightM + lk.throwingArmM * Math.sin(th0Rad) - troughCenterZM) /
    slingLengthM
  const startsInTrough = sinB0Raw >= -0.99 && sinB0Raw <= 0.99
  const sinB0 = Math.max(-0.99, Math.min(0.99, sinB0Raw))
  const beta0Rad = Math.PI - Math.asin(sinB0)
  const zBall0M =
    lk.pivotHeightM +
    lk.throwingArmM * Math.sin(th0Rad) -
    slingLengthM * Math.sin(beta0Rad)

  return {
    counterweightMassKg,
    dropHeightM,
    kCwM,
    counterweightArmM: lk.counterweightArmM,
    throwingArmM: lk.throwingArmM,
    slingLengthM,
    pinAngleDeg,
    pivotHeightM: lk.pivotHeightM,
    pouchMassKg: lk.pouchMassKg,
    th0Rad,
    beta0Rad,
    troughCenterZM,
    startsInTrough,
    zBall0M,
    cockedBallBottomHeightM: startsInTrough
      ? troughBottomZM
      : zBall0M - model.projectile.radiusM,
  }
}
