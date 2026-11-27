/** Criteria from "The Mousetrap Catapult", Catapult Grading Rubric, pp. 3–4. */
const paragraphFormat =
  'At least ⅔ page, typed and double-spaced in 12-point Times New Roman'

export const manualSections = [
  {
    id: 'catapult',
    label: 'Catapult',
    points: 5,
    criteria: [
      { id: 'requirements', label: 'Meets the size and material requirements' },
      { id: 'time', label: 'Completes launches within the assigned time' },
      { id: 'trigger', label: 'Trigger works properly' },
      { id: 'cleanup', label: 'Clears materials after both launch days' },
    ],
  },
  {
    id: 'design',
    label: 'Design paragraph',
    points: 5,
    criteria: [
      { id: 'designFormat', label: paragraphFormat },
      { id: 'materials', label: 'Identifies the materials used' },
      {
        id: 'distanceDesign',
        label: 'Explains design choices for maximum distance',
      },
      {
        id: 'accuracyDesign',
        label: 'Explains adjustment for different target distances',
      },
    ],
  },
  {
    id: 'physics',
    label: 'Physics paragraph',
    points: 5,
    criteria: [
      { id: 'physicsFormat', label: paragraphFormat },
      {
        id: 'beforeLaunch',
        label: 'Describes energy in the set mechanism and ball before launch',
      },
      {
        id: 'duringLaunch',
        label: 'Explains energy and its changes during launch',
      },
      { id: 'flight', label: 'Explains energy and its changes during flight' },
      {
        id: 'impact',
        label: 'Explains energy and its changes at ground impact',
      },
    ],
  },
  {
    id: 'diagram',
    label: 'Diagram',
    points: 5,
    criteria: [
      { id: 'legible', label: 'Uses straight lines and legible labels' },
      { id: 'labels', label: 'Names at least five component parts' },
      { id: 'paper', label: 'Fills a page of unlined white paper' },
    ],
  },
  {
    id: 'group',
    label: 'Group',
    points: 2,
    criteria: [
      { id: 'respect', label: 'Respects other groups during launch' },
      { id: 'launcher', label: 'One member launches the balls' },
      {
        id: 'retrieval',
        label: 'One member returns every ball after the final launch',
      },
      { id: 'order', label: 'Follows the assigned launch order' },
      {
        id: 'warning',
        label: 'One member monitors time and gives a one-minute warning',
      },
    ],
  },
] as const

const equipmentPoints = { none: 0, ball: 4, trebuchet: 6, both: 8 } as const

export interface RubricInput {
  /** Competition distance accepted by the judge, in metres. */
  distanceM?: number | null
  targetHits?: readonly [boolean | null, boolean | null]
  /** Teacher-entered points keyed by criterion id. */
  marks?: Readonly<Record<string, number | null>>
  equipment?: keyof typeof equipmentPoints | null
  lateDays?: number | null
  /** One share for each member, including an explicit 0 for a zero share. */
  groupShares?: readonly (number | null)[]
}

export interface Score {
  earned: number
  /** Points available across the criteria already assessed. */
  assessed: number
  possible: number
  complete: boolean
}

function checkedNumber(value: number, label: string, max = Infinity) {
  if (!Number.isFinite(value) || value < 0 || value > max) {
    throw new RangeError(`Invalid ${label}.`)
  }
  return value
}

export function distancePoints(metres: number): number {
  return (
    2 * Math.min(5, Math.floor(checkedNumber(metres, 'distance in metres')))
  )
}

function summarize(
  marks: readonly (readonly [number | null, number])[]
): Score {
  let earned = 0
  let assessed = 0
  let possible = 0
  for (const [points, weight] of marks) {
    possible += weight
    if (points !== null) {
      earned += points
      assessed += weight
    }
  }
  return { earned, assessed, possible, complete: assessed === possible }
}

function distributeBonus(
  shares: RubricInput['groupShares']
): (number | null)[] | null {
  if (shares === undefined) return null
  if (shares.length !== 2 && shares.length !== 3)
    throw new RangeError('A group has two or three members.')
  let sum = 0
  let pending = false
  for (const share of shares) {
    if (share === null) pending = true
    else sum += checkedNumber(share, 'group share')
  }
  if (pending) return shares.map(() => null)
  // The handout voids every share when the group fails to allocate exactly six.
  if (Math.abs(sum - 6) > 6 * Number.EPSILON) return shares.map(() => 0)
  return [...shares]
}

export function evaluateRubric(input: RubricInput) {
  const distance =
    input.distanceM == null ? null : distancePoints(input.distanceM)
  function hitPointsFor(index: 0 | 1) {
    const hit = input.targetHits?.[index]
    if (hit == null) return null
    if (typeof hit !== 'boolean')
      throw new TypeError('A target result must be hit, miss, or pending.')
    return hit ? 5 : 0
  }
  const hitPoints: [number | null, number | null] = [
    hitPointsFor(0),
    hitPointsFor(1),
  ]
  const performanceMarks: [number | null, number][] = [
    [distance, 10],
    [hitPoints[0], 5],
    [hitPoints[1], 5],
  ]
  const performance = summarize(performanceMarks)
  const manualMarks = manualSections.map((section) =>
    section.criteria.map((criterion) => {
      const points = input.marks?.[criterion.id]
      const awarded =
        points == null
          ? null
          : checkedNumber(points, criterion.label, section.points)
      return [awarded, section.points] as const
    })
  )
  const sections = manualMarks.map(summarize)
  const base = summarize([...performanceMarks, ...manualMarks.flat()])

  const equipment = input.equipment
  if (equipment != null && !Object.hasOwn(equipmentPoints, equipment))
    throw new RangeError('Unknown equipment category.')
  const equipmentBonus = equipment == null ? null : equipmentPoints[equipment]
  const days = input.lateDays
  if (days != null && (!Number.isSafeInteger(days) || days < 0)) {
    throw new RangeError('Late days must be a nonnegative whole number.')
  }
  const lateAdjustment = days == null ? null : days === 0 ? 0 : -10 * days
  const groupBonuses = distributeBonus(input.groupShares)
  const individualTotals =
    groupBonuses?.map((share) =>
      base.complete &&
      equipmentBonus !== null &&
      lateAdjustment !== null &&
      share !== null
        ? base.earned + equipmentBonus + lateAdjustment + share
        : null
    ) ?? null
  return {
    distance,
    hitPoints,
    sections,
    performance,
    base,
    equipmentBonus,
    lateAdjustment,
    groupBonuses,
    individualTotals,
  }
}
