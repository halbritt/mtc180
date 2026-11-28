import { describe, expect, it } from 'vitest'
import {
  distancePoints,
  evaluateRubric,
  manualSections,
  type RubricInput,
} from './rubric'

const fullMarks = Object.fromEntries(
  manualSections.flatMap((section) =>
    section.criteria.map((criterion) => [criterion.id, section.points])
  )
)
const full: RubricInput = {
  distanceM: 5,
  targetHits: [true, true],
  marks: fullMarks,
  equipment: 'none',
  lateDays: 0,
  groupShares: [3, 3],
}

describe('competition scoring', () => {
  it('awards each distance milestone exactly at its threshold and caps at ten', () => {
    for (let metres = 1; metres <= 5; metres++) {
      expect(distancePoints(metres - 0.000001)).toBe(2 * (metres - 1))
      expect(distancePoints(metres)).toBe(2 * metres)
    }
    expect(distancePoints(0)).toBe(0)
    expect(distancePoints(5.99)).toBe(10)
    expect(distancePoints(50)).toBe(10)
  })

  it('keeps every ungraded criterion pending, including adjustments', () => {
    const grade = evaluateRubric({})
    expect(grade).toMatchObject({
      distance: null,
      hitPoints: [null, null],
      performance: { earned: 0, assessed: 0, possible: 20, complete: false },
      base: { earned: 0, assessed: 0, possible: 110, complete: false },
      groupBonuses: null,
      individualTotals: null,
      lateAdjustment: null,
      equipmentBonus: null,
    })
  })

  it('distinguishes a miss and a judged zero from an unmarked criterion', () => {
    const grade = evaluateRubric({
      distanceM: 0,
      targetHits: [null, false],
      marks: { cleanup: 0 },
    })
    expect(grade.hitPoints).toEqual([null, 0])
    expect(grade.performance).toEqual({
      earned: 0,
      assessed: 15,
      possible: 20,
      complete: false,
    })
    expect(grade.sections[0]).toEqual({
      earned: 0,
      assessed: 5,
      possible: 20,
      complete: false,
    })
    expect(grade.base.assessed).toBe(20)
  })

  it.each([
    [
      [true, false],
      [5, 0],
    ],
    [
      [false, true],
      [0, 5],
    ],
    [
      [true, true],
      [5, 5],
    ],
  ] as const)(
    'scores target results %j independently',
    (targetHits, points) => {
      expect(evaluateRubric({ targetHits }).hitPoints).toEqual(points)
    }
  )

  it('includes the five judge-scored sections in the 110 point base grade', () => {
    const grade = evaluateRubric(full)
    expect(grade.sections.map((part) => part.earned)).toEqual([
      20, 20, 25, 15, 10,
    ])
    expect(grade.base).toEqual({
      earned: 110,
      assessed: 110,
      possible: 110,
      complete: true,
    })
    expect(grade.performance).toEqual({
      earned: 20,
      assessed: 20,
      possible: 20,
      complete: true,
    })
  })

  it('retains the actual points entered by the judge', () => {
    const grade = evaluateRubric({ marks: { labels: 2.5, respect: 1 } })
    expect(grade.base.earned).toBe(3.5)
    expect(grade.base.assessed).toBe(7)
  })
})

describe('individual adjustments', () => {
  it.each([
    ['none', 0],
    ['ball', 4],
    ['trebuchet', 6],
    ['both', 8],
  ] as const)(
    'awards the listed equipment bonus for %s',
    (equipment, points) => {
      expect(evaluateRubric({ equipment }).equipmentBonus).toBe(points)
    }
  )

  it('adds the equipment and personal share then deducts ten points per late day', () => {
    const grade = evaluateRubric({
      ...full,
      equipment: 'both',
      lateDays: 2,
      groupShares: [1.5, 4.5, 0],
    })
    expect(grade.lateAdjustment).toBe(-20)
    expect(grade.individualTotals).toEqual([99.5, 102.5, 98])
  })

  it('voids every group share when an allocation does not total six', () => {
    for (const shares of [
      [2, 3],
      [2, 3, 3],
      [0, 0],
    ]) {
      const grade = evaluateRubric({ ...full, groupShares: shares })
      expect(grade.groupBonuses).toEqual(shares.map(() => 0))
      expect(grade.individualTotals).toEqual(shares.map(() => 110))
    }
  })

  it('waits for every allocation, adjustment and criterion before publishing a final grade', () => {
    expect(
      evaluateRubric({ ...full, groupShares: [0, null] }).groupBonuses
    ).toEqual([null, null])
    for (const missing of [
      { equipment: null },
      { distanceM: null },
      { lateDays: null },
      { groupShares: [0, null] },
    ]) {
      expect(evaluateRubric({ ...full, ...missing }).individualTotals).toEqual([
        null,
        null,
      ])
    }
  })

  it('rejects invalid distances, criterion marks, dates, and group allocations', () => {
    const invalidCases: RubricInput[] = [
      { distanceM: -1 },
      { distanceM: NaN },
      { distanceM: Infinity },
      { lateDays: 0.5 },
      { lateDays: -1 },
      { marks: { respect: 3 } },
      { marks: { labels: -1 } },
      { groupShares: [6] },
      { groupShares: [0, 0, 0, 6] },
      { groupShares: [-1, 7] },
    ]
    for (const invalid of invalidCases)
      expect(() => evaluateRubric(invalid)).toThrow()
  })

  it('handles 6 * Number.EPSILON float sum tolerance in groupShares and preserves -0 normalization', () => {
    const floatShares = evaluateRubric({
      ...full,
      groupShares: [0.1, 0.2, 5.7],
    })
    expect(floatShares.groupBonuses).toEqual([0.1, 0.2, 5.7])

    const negZero = evaluateRubric({
      ...full,
      distanceM: -0,
      lateDays: -0,
      groupShares: [-0, 6],
    })
    expect(Object.is(negZero.distance, -0)).toBe(true)
    expect(negZero.lateAdjustment).toBe(0)
    expect(Object.is(negZero.groupBonuses?.[0], -0)).toBe(true)
    expect(negZero.individualTotals).toEqual([100, 106])
  })
})
