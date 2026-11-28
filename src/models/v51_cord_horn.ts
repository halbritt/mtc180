import {
  NOMINAL_ENERGY_PER_TRAP_J,
  REGULATION_GOLF_BALL,
  type LauncherModel,
} from './types'

export const V51_TH_COCK_FULL_DEG = 171.0

export const V51_NOTCH_PSIS_DEG = [
  34.5, 25.5, 16.5, 7.8, -0.2, -8.2,
] as const

export const V51_STOP_HOLES_MM = {
  42: [-120.9, 134.1],
  50: [-131.8, 129.8],
  58: [-142.0, 124.1],
} as const

export const V51_CORD_HORN: LauncherModel = {
  id: 'v51_cord_horn',
  name: 'MTC-180 v5.1 Cord-and-Horn',
  version: '5.1',
  description:
    'Floor-flush 3-trap catapult with M4 through-bolted cord horn (dead centre +5 deg past 42 deg stop), 6-notch gravity sear, and open 45 deg V-cup.',
  isActiveRepoDesign: true,
  topology: 'cord_horn',
  projectile: REGULATION_GOLF_BALL,
  rubricCompliance: {
    baseFits2ft: true,
    baseFlushOnFloor: true,
    baseDimensionsMm: [470, 204, 18],
    diameterMm: Math.hypot(470, 204),
    ballUnder3In: true,
    usesTrigger: true,
    trapsFlatOnBase: true,
    equipmentBonus: 'ball',
    notes:
      'Active repo design (cad/installed_floorflush.star). Base 470x204x18 mm flush on floor, 3 Victor M040 traps flat, zero rubber bands. Notches 4-6 start < 3.00 in (2.96, 2.02, 1.08 in); Notches 1-3 start > 3.00 in (3.96, 4.94, 5.86 in).',
  },
  trapBank: {
    count: 3,
    nominalEnergyPerTrapJ: NOMINAL_ENERGY_PER_TRAP_J,
    energyVarianceJ: 0.1,
    torqueRatio: 0.5,
    thCockMaxDeg: 173.0,
    thRestDeg: 7.0,
    springZeroOffsetDeg: 0.0,
    bailInertiaKgM2: 0.579e-4,
    bailMassXKgM: 9.87e-4,
    hingePosMm: [124.0, 29.5],
    trapPitchMm: 46.15,
    bearingFrictionNm: 0.012,
  },
  arm: {
    massKg: 0.0594,
    inertiaKgM2: 4.447e-4,
    cgArmMm: [-22.0, 6.0],
    lengthBallM: Math.hypot(171.3, 1.3) * 1e-3,
    ballOffsetArmMm: [-171.3, 1.3],
    pivotPosMm: [-96.0, 72.0],
    stopInertiaKgM2: 0,
    widthMm: 12.0,
  },
  cradle: {
    type: 'zero_lip_vcup',
    retentionForceN: 0,
    snapEnergyJ: 0,
  },
  linkage: {
    kind: 'cord_horn',
    rPullMm: 50.8,
    rollerPosMm: [48.0, 43.0],
    rRollEffMm: 6.85,
    hornRMm: 108.0,
    hornADeg: 39.0,
    notchPsisDeg: V51_NOTCH_PSIS_DEG,
    stopAnglesDeg: [42, 50, 58],
    stopHolesMm: V51_STOP_HOLES_MM,
    cordTieNotchIndex: 5,
    cordTieThCockDeg: V51_TH_COCK_FULL_DEG,
  },
  adjustments: [
    {
      id: 'notch',
      label: 'Ratchet Sear Notch',
      unit: 'notch',
      kind: 'discrete',
      options: [1, 2, 3, 4, 5, 6],
      optionLabels: [
        '1 (34.5 deg)',
        '2 (25.5 deg)',
        '3 (16.5 deg)',
        '4 (7.8 deg)',
        '5 (-0.2 deg)',
        '6 (-8.2 deg, max)',
      ],
      min: 1,
      max: 6,
      step: 1,
      defaultValue: 6,
    },
    {
      id: 'launchDeg',
      label: 'Launch Stop Angle',
      unit: 'deg',
      kind: 'discrete',
      options: [42, 50, 58],
      optionLabels: ['42 deg (stop 48)', '50 deg (stop 40)', '58 deg (stop 32)'],
      min: 42,
      max: 58,
      step: 8,
      defaultValue: 42,
    },
    {
      id: 'yawDeg',
      label: 'Base Yaw Aim',
      unit: 'deg',
      kind: 'continuous',
      min: -15,
      max: 15,
      step: 0.5,
      defaultValue: 0,
    },
  ],
  cycleTiming: {
    cockPerTrapS: 2.2,
    loadS: 0.5,
    aimAdjustS: 1.5,
    humanSigmaS: 0.8,
  },
  tolerances: {
    cockAngleSigmaDeg: 0.5,
    seatingOffsetSigmaM: 0.0008,
    yawSigmaDeg: 0.6,
    stopAngleSigmaDeg: 0.4,
  },
}
