import {
  evaluateRubric,
  manualSections,
  type RubricInput,
} from './physics/rubric'
import './scorecard.css'

function labeledControl(caption: string, control: HTMLElement) {
  const label = document.createElement('label')
  label.className = 'score-entry'
  const text = document.createElement('span')
  text.textContent = caption
  label.append(text, control)
  return label
}

function pointsInput(name: string, maximum: number) {
  const input = document.createElement('input')
  input.type = 'number'
  input.name = name
  input.min = '0'
  input.max = String(maximum)
  input.step = 'any'
  input.placeholder = 'Pending'
  return input
}

function scoreText(score: ReturnType<typeof evaluateRubric>['base']) {
  if (score.assessed === 0) return 'Pending'
  if (score.complete) return `${score.earned} / ${score.possible}`
  return `${score.earned} / ${score.assessed} assessed · ${score.possible} possible`
}

export function updateScorecardTrace(carry: number, total: number) {
  for (const [kind, value] of [
    ['carry', carry],
    ['total', total],
  ] as const) {
    const button = document.querySelector<HTMLButtonElement>(
      `#score-use-${kind}`
    )!
    button.value = String(value)
    button.disabled = false
  }
}

export function mountScorecard() {
  const form = document.querySelector<HTMLFormElement>('#grading')!
  const competition = document.querySelector<HTMLOutputElement>(
    '#competition-points'
  )!
  const base = document.querySelector<HTMLOutputElement>('#base-points')!
  const adjusted =
    document.querySelector<HTMLOutputElement>('#adjusted-points')!
  const error = document.querySelector<HTMLElement>('#grade-error')!
  const targets = document.querySelector<HTMLElement>('#score-targets')!
  const sections = document.querySelector<HTMLElement>('#score-sections')!
  const members = document.querySelector<HTMLElement>('#score-members')!
  const allocation = document.querySelector<HTMLElement>('#score-allocation')!

  const field = (name: string) =>
    form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement
  for (const button of form.querySelectorAll<HTMLButtonElement>(
    '.score-copy button'
  )) {
    button.addEventListener('click', () => {
      field('distance').value = button.value
      update()
    })
  }
  const individualList =
    document.querySelector<HTMLUListElement>('#score-individuals')!
  for (let i = 1; i <= 2; i++) {
    const select = document.createElement('select')
    select.name = `hit${i}`
    select.append(
      new Option('Pending', ''),
      new Option('Hit', 'hit'),
      new Option('Miss', 'miss')
    )
    targets.append(labeledControl(`Target ${i}`, select))
  }
  for (const section of manualSections) {
    const group = document.createElement('fieldset')
    const legend = document.createElement('legend')
    legend.textContent = `${section.label} · ${
      section.points * section.criteria.length
    } pts`
    group.append(legend)
    for (const criterion of section.criteria) {
      group.append(
        labeledControl(
          `${criterion.label} (0–${section.points})`,
          pointsInput(criterion.id, section.points)
        )
      )
    }
    sections.append(group)
  }
  const memberRows = ['Member 1 share', 'Member 2 share', 'Member 3 share'].map(
    (label, i) => {
      const row = labeledControl(label, pointsInput(`share${i}`, 6))
      members.append(row)
      return row
    }
  )

  function update() {
    const errors: string[] = []
    function number(name: string): number | null {
      const control = field(name) as HTMLInputElement
      if (!control.validity.valid) {
        const label = control.labels?.[0]?.textContent?.trim() || name
        errors.push(`${label} — ${control.validationMessage}`)
        return null
      }
      return control.value === '' ? null : control.valueAsNumber
    }
    const hit = (name: string) => {
      const value = field(name).value
      return value === '' ? null : value === 'hit'
    }

    const group = field('group').value
    const memberCount = group === '3' ? 3 : group === '2' ? 2 : 0
    allocation.hidden = memberCount === 0
    memberRows.forEach((row, i) => {
      row.hidden = i >= memberCount
    })
    const groupShares =
      group === 'none'
        ? [0, 0]
        : memberCount
        ? Array.from({ length: memberCount }, (_, i) => number(`share${i}`))
        : undefined
    const marks: Record<string, number | null> = {}
    for (const section of manualSections) {
      for (const criterion of section.criteria)
        marks[criterion.id] = number(criterion.id)
    }

    const result = evaluateRubric({
      distanceM: number('distance'),
      targetHits: [hit('hit1'), hit('hit2')],
      marks,
      equipment: (field('equipment').value || null) as RubricInput['equipment'],
      groupShares,
      lateDays: number('late'),
    })
    competition.value = scoreText(result.performance)
    base.value = scoreText(result.base)
    const final = result.individualTotals?.[0]
    adjusted.value = memberCount
      ? 'By member'
      : final == null
      ? 'Pending'
      : `${final} pts`
    individualList.hidden = !memberCount
    individualList.replaceChildren(
      ...Array.from({ length: memberCount }, (_, i) => {
        const item = document.createElement('li')
        const share = result.groupBonuses?.[i]
        const total = result.individualTotals?.[i]
        const bonusText =
          share == null ? 'bonus pending' : `+${share} group bonus`
        const totalText = total == null ? 'total pending' : `${total} pts total`
        item.textContent = `Member ${i + 1} · ${bonusText} · ${totalText}`
        return item
      })
    )
    error.hidden = !errors.length
    error.textContent = errors.join(' ')
  }
  form.addEventListener('input', update)
  update()
}
