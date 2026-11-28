import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from 'three'
import type { AdjustmentValues, LauncherModel } from './models'
import { bailSide } from './physics/linkage'

const DEG_TO_RAD = Math.PI / 180

export interface LauncherRig {
  group: Group
  setPose: (psiDeg: number, thDeg: number, progress01: number) => void
  setYaw: (yawDeg: number) => void
  setPositionFromRelease: (releasePosM: readonly [number, number, number]) => void
  dispose: () => void
}

interface TopologyAnimState {
  setPose: (psiDeg: number, thDeg: number, progress01: number) => void
}

function makeMat(color: number, roughness = 0.6, metalness = 0.1): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness, metalness })
}

function makeBox(
  w: number,
  h: number,
  d: number,
  mat: MeshStandardMaterial
): Mesh {
  return new Mesh(new BoxGeometry(w, h, d), mat)
}

function makeLine(points: Vector3[], color: number): Line {
  const geo = new BufferGeometry().setFromPoints(points)
  const mat = new LineBasicMaterial({ color })
  return new Line(geo, mat)
}

function updateLinePoints(line: Line, points: Vector3[]): void {
  const pos = line.geometry.getAttribute('position') as Float32BufferAttribute
  for (let i = 0; i < points.length; i++) {
    pos.setXYZ(i, points[i].x, points[i].y, points[i].z)
  }
  pos.needsUpdate = true
}

function createTrapBankMeshes(
  parent: Group,
  model: LauncherModel,
  baseTopY: number,
  woodMat: MeshStandardMaterial,
  wireMat: MeshStandardMaterial,
  hingeOverrideM?: [number, number]
): { bailsPivot: Group; hingeM: [number, number]; rPullM: number } {
  const count = Math.max(0, model.trapBank.count)
  const hingeMm = model.trapBank.hingePosMm ?? [0, 29.5]
  const hingeM: [number, number] = hingeOverrideM ?? [
    hingeMm[0] * 1e-3,
    hingeMm[1] * 1e-3,
  ]
  const pitchM = (model.trapBank.trapPitchMm ?? 46.15) * 1e-3
  const lk = model.linkage as { rPullMm?: number }
  const rPullM = (lk.rPullMm ?? 50.8) * 1e-3
  const bailsPivot = new Group()
  bailsPivot.position.set(hingeM[0], hingeM[1], 0)
  parent.add(bailsPivot)

  if (count === 0) {
    return { bailsPivot, hingeM, rPullM }
  }

  const trapW = 0.044
  const trapL = 0.098
  const trapH = Math.max(0.006, hingeM[1] - baseTopY)

  for (let i = 0; i < count; i++) {
    const zOff = (i - (count - 1) / 2) * pitchM
    const trapBlock = makeBox(trapL, trapH, trapW, woodMat)
    trapBlock.position.set(hingeM[0], baseTopY + trapH / 2, zOff)
    parent.add(trapBlock)

    const sideA = makeBox(rPullM, 0.003, 0.003, wireMat)
    sideA.position.set(rPullM / 2, 0, zOff - trapW * 0.36)
    const sideB = makeBox(rPullM, 0.003, 0.003, wireMat)
    sideB.position.set(rPullM / 2, 0, zOff + trapW * 0.36)
    const cross = makeBox(0.003, 0.003, trapW * 0.72, wireMat)
    cross.position.set(rPullM, 0, zOff)
    bailsPivot.add(sideA, sideB, cross)
  }

  if (count > 1) {
    const spanZ = (count - 1) * pitchM + trapW * 0.72
    const coupler = makeBox(0.005, 0.005, spanZ, wireMat)
    coupler.position.set(rPullM, 0, 0)
    bailsPivot.add(coupler)
  }

  return { bailsPivot, hingeM, rPullM }
}

export function createLauncherRig(
  model: LauncherModel,
  adjustments: AdjustmentValues
): LauncherRig {
  const group = new Group()
  const body = new Group()
  group.add(body)

  const woodMat = makeMat(0xb88b58, 0.75, 0.05)
  const trapWoodMat = makeMat(0xd5b37c, 0.72, 0.05)
  const armMat = makeMat(0x2e6f5e, 0.5, 0.15)
  const metalMat = makeMat(0xc8d2d0, 0.35, 0.65)
  const accentMat = makeMat(0xe6a13c, 0.45, 0.2)
  const darkMat = makeMat(0x283633, 0.65, 0.25)
  const ballMat = makeMat(0xfafaf5, 0.35, 0.05)

  const baseDims = model.rubricCompliance.baseDimensionsMm ?? [400, 200, 18]
  const baseL = baseDims[0] * 1e-3
  const baseW = baseDims[1] * 1e-3
  const baseT = baseDims[2] * 1e-3

  const baseMesh = makeBox(baseL, baseT, baseW, woodMat)
  baseMesh.position.set(0, baseT / 2, 0)
  body.add(baseMesh)

  const rBall = model.projectile?.radiusM ?? 0.021335
  const seatedBall = new Mesh(new SphereGeometry(rBall * 1.1, 14, 10), ballMat)

  let anim: TopologyAnimState

  if (model.topology === 'cord_horn' || model.topology === 'circular_cam') {
    const pivotMm = model.arm.pivotPosMm ?? [-96, 72]
    const px = pivotMm[0] * 1e-3
    const pz = pivotMm[1] * 1e-3
    const ox = (model.arm.ballOffsetArmMm?.[0] ?? -171.3) * 1e-3
    const oz = (model.arm.ballOffsetArmMm?.[1] ?? 1.3) * 1e-3

    // Stanchions around pivot
    for (const zSide of [-0.022, 0.022]) {
      const post = makeBox(0.028, pz + 0.02, 0.01, woodMat)
      post.position.set(px, baseT + (pz + 0.02 - baseT) / 2, zSide)
      body.add(post)
    }

    // Stop crossbar
    const lk = model.linkage as {
      rollerPosMm: readonly [number, number]
      rRollEffMm: number
      hornRMm?: number
      hornADeg?: number
      rCamMm?: number
      rCamEffMm?: number
      camKnotDeg?: number
      stopHolesMm?: Record<number, readonly [number, number]>
    }
    const stopDeg = adjustments.launchDeg ?? 42
    const stopHole = lk.stopHolesMm?.[stopDeg]
    if (stopHole) {
      const stopPin = new Mesh(new CylinderGeometry(0.004, 0.004, 0.054, 10), accentMat)
      stopPin.rotation.x = Math.PI / 2
      stopPin.position.set(stopHole[0] * 1e-3, stopHole[1] * 1e-3, 0)
      body.add(stopPin)
    }

    // Roller
    const rx = lk.rollerPosMm[0] * 1e-3
    const rz = lk.rollerPosMm[1] * 1e-3
    const rRoll = lk.rRollEffMm * 1e-3
    const roller = new Mesh(new CylinderGeometry(rRoll, rRoll, 0.06, 14), metalMat)
    roller.rotation.x = Math.PI / 2
    roller.position.set(rx, rz, 0)
    body.add(roller)

    const { bailsPivot, hingeM, rPullM } = createTrapBankMeshes(
      body,
      model,
      baseT,
      trapWoodMat,
      metalMat
    )

    const armPivot = new Group()
    armPivot.position.set(px, pz, 0)
    body.add(armPivot)

    const armLen = Math.hypot(ox, oz)
    const armBeam = makeBox(armLen + 0.03, 0.014, 0.014, armMat)
    armBeam.position.set(ox / 2, oz / 2, 0)
    armPivot.add(armBeam)

    const cup = makeBox(0.026, 0.012, 0.026, accentMat)
    cup.position.set(ox, oz - 0.01, 0)
    armPivot.add(cup)

    seatedBall.position.set(ox, oz, 0)
    armPivot.add(seatedBall)

    let hornLocalX = 0.08
    let hornLocalY = 0.06
    if (model.topology === 'cord_horn') {
      const hR = (lk.hornRMm ?? 108) * 1e-3
      const hA = (lk.hornADeg ?? 39) * DEG_TO_RAD
      hornLocalX = hR * Math.cos(hA)
      hornLocalY = hR * Math.sin(hA)
      const horn = makeBox(hR, 0.01, 0.01, darkMat)
      horn.position.set(hornLocalX / 2, hornLocalY / 2, 0)
      horn.rotation.z = hA
      armPivot.add(horn)
    } else {
      const rCam = (lk.rCamMm ?? 98) * 1e-3
      const cam = new Mesh(new CylinderGeometry(rCam, rCam, 0.012, 24, 1, false, 0, Math.PI), darkMat)
      cam.rotation.x = Math.PI / 2
      armPivot.add(cam)
      const knotRad = (lk.camKnotDeg ?? 123) * DEG_TO_RAD
      hornLocalX = (lk.rCamEffMm ?? 96.5) * 1e-3 * Math.cos(knotRad)
      hornLocalY = (lk.rCamEffMm ?? 96.5) * 1e-3 * Math.sin(knotRad)
    }

    const cordLine = makeLine(
      [new Vector3(), new Vector3(rx, rz + rRoll, 0), new Vector3()],
      0xffe39e
    )
    body.add(cordLine)

    anim = {
      setPose(psiDeg, thDeg, progress01) {
        armPivot.rotation.z = -psiDeg * DEG_TO_RAD
        bailsPivot.rotation.z = thDeg * DEG_TO_RAD
        seatedBall.visible = progress01 < 0.995

        const thRad = thDeg * DEG_TO_RAD
        const bx = hingeM[0] + rPullM * Math.cos(thRad)
        const by = hingeM[1] + rPullM * Math.sin(thRad)
        const pRad = -psiDeg * DEG_TO_RAD
        const hx = px + hornLocalX * Math.cos(pRad) - hornLocalY * Math.sin(pRad)
        const hy = pz + hornLocalX * Math.sin(pRad) + hornLocalY * Math.cos(pRad)
        updateLinePoints(cordLine, [
          new Vector3(bx, by, 0),
          new Vector3(rx, rz + rRoll, 0),
          new Vector3(hx, hy, 0),
        ])
      },
    }
  } else if (model.topology === 'direct_rail') {
    const rail = model.cradle.railGeometry
    const zHingeM = (model.trapBank.hingePosMm?.[1] ?? 29.5) * 1e-3
    const { bailsPivot } = createTrapBankMeshes(
      body,
      model,
      baseT,
      trapWoodMat,
      metalMat
    )

    const armPivot = new Group()
    armPivot.position.set(0, zHingeM, 0)
    body.add(armPivot)

    const lTipM = (rail?.lTipMm ?? 200) * 1e-3
    const armBeam = makeBox(lTipM, 0.012, 0.016, armMat)
    armBeam.position.set(lTipM / 2, 0, 0)
    armPivot.add(armBeam)

    // Tangent rail pair (y_loc mapped to -Y in armPivot)
    const xRise1 = (rail?.xRise1Mm ?? 57) * 1e-3
    const hzRoot = (rail?.hzRootMm ?? 16) * 1e-3
    const hzTip = (rail?.hzTipMm ?? 6) * 1e-3
    const railLen = Math.hypot(lTipM - xRise1, hzRoot - hzTip)
    const gamma = rail?.gammaRad ?? Math.atan((hzRoot - hzTip) / (lTipM - xRise1))
    for (const zRail of [-0.008, 0.008]) {
      const railBar = makeBox(railLen, 0.004, 0.004, metalMat)
      railBar.position.set((xRise1 + lTipM) / 2, -(hzRoot + hzTip) / 2, zRail)
      railBar.rotation.z = gamma
      armPivot.add(railBar)
    }

    const peg = Math.max(1, Math.round(adjustments.peg ?? 1))
    const flip = (adjustments.flip ?? 0) === 1 ? 1 : 0
    const pegX =
      ((rail?.pegX0Mm ?? 61) +
        (peg - 1) * (rail?.pegPitchMm ?? 10) +
        (flip ? (rail?.blockLenMm ?? 12) - (rail?.blockHoleOffMm ?? 3.5) : (rail?.blockHoleOffMm ?? 3.5))) *
      1e-3
    const backstop = makeBox(0.012, 0.018, 0.02, accentMat)
    backstop.position.set(pegX, -0.012, 0)
    armPivot.add(backstop)

    const xStartM = pegX + 0.015
    const yStartM = hzRoot - (xStartM - xRise1) * Math.tan(gamma) + 0.018
    seatedBall.position.set(xStartM, -yStartM, 0)
    armPivot.add(seatedBall)

    // Stop frame
    const stopPost = makeBox(0.014, 0.08, 0.04, darkMat)
    stopPost.position.set(0.08, baseT + 0.04, 0)
    body.add(stopPost)

    anim = {
      setPose(_psiDeg, thDeg, progress01) {
        armPivot.rotation.z = thDeg * DEG_TO_RAD
        bailsPivot.rotation.z = thDeg * DEG_TO_RAD
        const slideT = Math.max(0, Math.min(1, (progress01 - 0.45) / 0.55))
        const curX = xStartM + slideT * Math.max(0.02, lTipM - xStartM)
        const curY = hzRoot - (curX - xRise1) * Math.tan(gamma) + 0.018
        seatedBall.position.set(curX, -curY, 0)
        seatedBall.visible = progress01 < 0.995
      },
    }
  } else if (model.topology === 'tilted_cradle') {
    const zPivot = ((model.linkage as { zPivotMm?: number }).zPivotMm ?? 225) * 1e-3
    // Elevated trunnion stand
    for (const zSide of [-0.075, 0.075]) {
      const tower = makeBox(0.04, zPivot, 0.014, darkMat)
      tower.position.set(0, baseT + zPivot / 2, zSide)
      body.add(tower)
    }

    const boardGroup = new Group()
    boardGroup.position.set(0, zPivot, 0)
    body.add(boardGroup)

    const board = makeBox(baseL, 0.012, baseW, woodMat)
    board.position.set(0, -0.008, 0)
    boardGroup.add(board)

    const { bailsPivot } = createTrapBankMeshes(
      boardGroup,
      model,
      0,
      trapWoodMat,
      metalMat,
      [0, 0]
    )

    const armPivot = new Group()
    boardGroup.add(armPivot)
    const ox = (model.arm.ballOffsetArmMm?.[0] ?? 140) * 1e-3
    const oz = (model.arm.ballOffsetArmMm?.[1] ?? 23) * 1e-3
    const armBeam = makeBox(ox, 0.012, 0.022, armMat)
    armBeam.position.set(ox / 2, 0, 0)
    armPivot.add(armBeam)

    const cradle = makeBox(0.028, 0.016, 0.028, accentMat)
    cradle.position.set(ox, -oz + 0.01, 0)
    armPivot.add(cradle)

    seatedBall.position.set(ox, -oz, 0)
    armPivot.add(seatedBall)

    anim = {
      setPose(psiDeg, thDeg, progress01) {
        const boardTiltDeg = psiDeg - thDeg
        boardGroup.rotation.z = boardTiltDeg * DEG_TO_RAD
        armPivot.rotation.z = thDeg * DEG_TO_RAD
        bailsPivot.rotation.z = thDeg * DEG_TO_RAD
        seatedBall.visible = progress01 < 0.995
      },
    }
  } else if (model.topology === 'direct_cup') {
    const zHingeM = (model.trapBank.hingePosMm?.[1] ?? 29.5) * 1e-3
    const { bailsPivot } = createTrapBankMeshes(
      body,
      model,
      baseT,
      trapWoodMat,
      metalMat
    )

    const armPivot = new Group()
    armPivot.position.set(0, zHingeM, 0)
    body.add(armPivot)

    const ox = (model.arm.ballOffsetArmMm?.[0] ?? 160) * 1e-3
    const oz = (model.arm.ballOffsetArmMm?.[1] ?? 18) * 1e-3
    const armBeam = makeBox(ox, 0.012, 0.022, armMat)
    armBeam.position.set(ox / 2, 0, 0)
    armPivot.add(armBeam)

    const cup = makeBox(0.024, 0.012, 0.024, accentMat)
    cup.position.set(ox, -oz + 0.01, 0)
    armPivot.add(cup)

    seatedBall.position.set(ox, -oz, 0)
    armPivot.add(seatedBall)

    const stopRad = (adjustments.stopAngleDeg ?? 132) * DEG_TO_RAD
    const stopBar = makeBox(0.012, 0.14, 0.05, darkMat)
    stopBar.position.set(0.07 * Math.cos(stopRad), zHingeM + 0.07 * Math.sin(stopRad), 0)
    stopBar.rotation.z = stopRad - Math.PI / 2
    body.add(stopBar)

    anim = {
      setPose(_psiDeg, thDeg, progress01) {
        armPivot.rotation.z = thDeg * DEG_TO_RAD
        bailsPivot.rotation.z = thDeg * DEG_TO_RAD
        seatedBall.visible = progress01 < 0.995
      },
    }
  } else if (model.topology === 'inclined_ramp') {
    const lk = model.linkage as {
      rollerPosMm: readonly [number, number]
      rRollEffMm: number
      rampLengthMm: number
      rampStartZMm: number
      defaultRampAngleDeg: number
    }
    const { bailsPivot, hingeM, rPullM } = createTrapBankMeshes(
      body,
      model,
      baseT,
      trapWoodMat,
      metalMat
    )
    const rx = lk.rollerPosMm[0] * 1e-3
    const rz = lk.rollerPosMm[1] * 1e-3
    const rRoll = lk.rRollEffMm * 1e-3
    const roller = new Mesh(new CylinderGeometry(rRoll, rRoll, 0.06, 14), metalMat)
    roller.rotation.x = Math.PI / 2
    roller.position.set(rx, rz, 0)
    body.add(roller)

    const rampStartX = (model.arm.pivotPosMm?.[0] ?? -120) * 1e-3
    const rampStartZ = lk.rampStartZMm * 1e-3
    const rampLen = lk.rampLengthMm * 1e-3

    const rampGroup = new Group()
    rampGroup.position.set(rampStartX, rampStartZ, 0)
    body.add(rampGroup)

    const chuteFloor = makeBox(rampLen, 0.008, 0.044, armMat)
    chuteFloor.position.set(rampLen / 2, -0.004, 0)
    rampGroup.add(chuteFloor)

    const sled = makeBox(0.026, 0.02, 0.032, accentMat)
    rampGroup.add(sled)
    rampGroup.add(seatedBall)

    const cordLine = makeLine(
      [new Vector3(), new Vector3(rx, rz + rRoll, 0), new Vector3()],
      0xffe39e
    )
    body.add(cordLine)

    const thCockRef = adjustments.cockAngleDeg ?? model.trapBank.thCockMaxDeg
    const c0 = bailSide(
      thCockRef,
      model.trapBank.hingePosMm ?? [160, 29.5],
      lk.rollerPosMm,
      rPullM * 1e3,
      lk.rRollEffMm
    ).spanMm

    anim = {
      setPose(psiDeg, thDeg, progress01) {
        const rampRad = psiDeg * DEG_TO_RAD
        rampGroup.rotation.z = rampRad
        bailsPivot.rotation.z = thDeg * DEG_TO_RAD

        const cNow = bailSide(
          thDeg,
          model.trapBank.hingePosMm ?? [160, 29.5],
          lk.rollerPosMm,
          rPullM * 1e3,
          lk.rRollEffMm
        ).spanMm
        const frac = Math.max(0, Math.min(1, (c0 - cNow) / Math.max(20, c0 * 0.45)))
        const s = Math.max(0, Math.min(rampLen, frac * rampLen))
        sled.position.set(s, 0.012, 0)
        seatedBall.position.set(s + 0.024, rBall, 0)
        seatedBall.visible = progress01 < 0.995

        const thRad = thDeg * DEG_TO_RAD
        const bx = hingeM[0] + rPullM * Math.cos(thRad)
        const by = hingeM[1] + rPullM * Math.sin(thRad)
        const sx = rampStartX + s * Math.cos(rampRad)
        const sy = rampStartZ + s * Math.sin(rampRad)
        updateLinePoints(cordLine, [
          new Vector3(bx, by, 0),
          new Vector3(rx, rz + rRoll, 0),
          new Vector3(sx, sy, 0),
        ])
      },
    }
  } else {
    // gravity_trebuchet
    const lk = model.linkage as {
      counterweightArmM: number
      throwingArmM: number
      slingLengthM: number
      pivotHeightM: number
      troughBottomZMm: number
    }
    const zPiv = lk.pivotHeightM
    const la = lk.throwingArmM
    const lCw = lk.counterweightArmM
    const ls = adjustments.slingLengthM ?? lk.slingLengthM

    // A-frame uprights
    for (const zSide of [-0.08, 0.08]) {
      for (const tilt of [-0.22, 0.22]) {
        const legLen = Math.hypot(0.11, zPiv)
        const leg = makeBox(0.02, legLen, 0.016, woodMat)
        leg.position.set(tilt * 0.5, baseT + zPiv / 2, zSide)
        leg.rotation.z = tilt
        body.add(leg)
      }
    }

    // Launch trough
    const trough = makeBox(0.36, 0.008, 0.056, darkMat)
    trough.position.set(0, lk.troughBottomZMm * 1e-3 - 0.004, 0)
    body.add(trough)

    const armPivot = new Group()
    armPivot.position.set(0, zPiv, 0)
    body.add(armPivot)

    const beam = makeBox(la + lCw, 0.018, 0.024, armMat)
    beam.position.set((lCw - la) / 2, 0, 0)
    armPivot.add(beam)

    const cwBox = makeBox(0.065, 0.075, 0.065, accentMat)
    body.add(cwBox)

    const slingLine = makeLine([new Vector3(), new Vector3()], 0xffe39e)
    body.add(slingLine)
    body.add(seatedBall)

    anim = {
      setPose(psiDeg, thDeg, progress01) {
        const thRad = thDeg * DEG_TO_RAD
        const betaRad = psiDeg * DEG_TO_RAD
        armPivot.rotation.z = -thRad

        const cwX = lCw * Math.cos(thRad)
        const cwY = zPiv - lCw * Math.sin(thRad)
        cwBox.position.set(cwX, cwY - 0.045, 0)

        const tipX = -la * Math.cos(thRad)
        const tipY = zPiv + la * Math.sin(thRad)
        const pouchX = tipX + ls * Math.cos(betaRad)
        const pouchY = tipY - ls * Math.sin(betaRad)
        updateLinePoints(slingLine, [
          new Vector3(tipX, tipY, 0),
          new Vector3(pouchX, pouchY, 0),
        ])
        seatedBall.position.set(pouchX, pouchY, 0)
        seatedBall.visible = progress01 < 0.995
      },
    }
  }

  return {
    group,
    setPose(psiDeg: number, thDeg: number, progress01: number) {
      anim.setPose(psiDeg, thDeg, progress01)
    },
    setYaw(yawDeg: number) {
      group.rotation.y = yawDeg * DEG_TO_RAD
    },
    setPositionFromRelease(releasePosM: readonly [number, number, number]) {
      group.position.set(-releasePosM[0], 0, releasePosM[1])
    },
    dispose() {
      group.traverse((obj) => {
        if (obj instanceof Mesh || obj instanceof Line) {
          obj.geometry.dispose()
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
          for (const m of mats) m.dispose()
        }
      })
      group.clear()
    },
  }
}
