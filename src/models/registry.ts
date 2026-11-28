import {
  DIRECT_ARM_1TRAP,
  DIRECT_ARM_2TRAP,
  DIRECT_CUP_2TRAP,
  FLOOR_FLUSH_INCLINED_RAMP,
  GRAVITY_SLING_TREBUCHET,
} from './candidates'
import { DIRECT_ARM_RAIL } from './direct_arm_rail'
import type {
  LauncherModel,
  LauncherTopology,
  RubricComplianceMeta,
} from './types'
import { V41_TILTED_CRADLE } from './v41_tilted_cradle'
import { V50_CIRCULAR_CAM } from './v50_circular_cam'
import { V51_CORD_HORN } from './v51_cord_horn'
import { validateLauncherModel } from './validation'

export interface LauncherModelFilter {
  readonly topology?: LauncherTopology
  readonly activeOnly?: boolean
  readonly rubricCompliantOnly?: boolean
  readonly equipmentBonus?: RubricComplianceMeta['equipmentBonus']
}

const RAW_MODELS: readonly LauncherModel[] = [
  V51_CORD_HORN,
  DIRECT_ARM_RAIL,
  V50_CIRCULAR_CAM,
  V41_TILTED_CRADLE,
  DIRECT_ARM_1TRAP,
  DIRECT_ARM_2TRAP,
  DIRECT_CUP_2TRAP,
  FLOOR_FLUSH_INCLINED_RAMP,
  GRAVITY_SLING_TREBUCHET,
]

export const LAUNCHER_MODELS: readonly LauncherModel[] = RAW_MODELS.map((model) =>
  validateLauncherModel(model)
)

const byIdRecord: Record<string, LauncherModel> = {}
for (const model of LAUNCHER_MODELS) {
  if (Object.hasOwn(byIdRecord, model.id)) {
    throw new Error(`Duplicate launcher model id "${model.id}".`)
  }
  byIdRecord[model.id] = model
}

export const LAUNCHER_MODELS_BY_ID: Readonly<Record<string, LauncherModel>> =
  byIdRecord

export function getLauncherModel(id: string): LauncherModel {
  if (typeof id !== 'string' || !Object.hasOwn(LAUNCHER_MODELS_BY_ID, id)) {
    throw new RangeError(`Unknown launcher model id "${id}".`)
  }
  return LAUNCHER_MODELS_BY_ID[id]
}

export function isModelRubricCompliant(model: LauncherModel): boolean {
  const rc = model.rubricCompliance
  const trapRuleOk =
    model.topology === 'gravity_trebuchet'
      ? model.trapBank.count === 0 && !rc.trapsFlatOnBase
      : rc.trapsFlatOnBase
  return (
    rc.baseFits2ft &&
    rc.baseFlushOnFloor &&
    rc.diameterMm < 914.4 &&
    rc.ballUnder3In &&
    rc.usesTrigger &&
    trapRuleOk
  )
}

export function listLauncherModels(
  filter?: LauncherModelFilter
): readonly LauncherModel[] {
  if (!filter) return LAUNCHER_MODELS
  return LAUNCHER_MODELS.filter((model) => {
    if (filter.topology !== undefined && model.topology !== filter.topology) {
      return false
    }
    if (filter.activeOnly && !model.isActiveRepoDesign) {
      return false
    }
    if (filter.rubricCompliantOnly && !isModelRubricCompliant(model)) {
      return false
    }
    if (
      filter.equipmentBonus !== undefined &&
      model.rubricCompliance.equipmentBonus !== filter.equipmentBonus
    ) {
      return false
    }
    return true
  })
}
