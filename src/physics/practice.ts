import { measure, type Sample, type Target } from './telemetry'

/** Centre offset from release, and full field-aligned dimensions in metres. */
export type PracticeTarget = Target &
  (
    | { shape: 'circle'; radius: number }
    | { shape: 'rectangle'; length: number; width: number }
  )

function positiveMetres(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

/** Compare a recorded position with the closed boundary of a practice target. */
export function evaluatePractice(
  samples: readonly Sample[],
  target: PracticeTarget,
  endpoint: 'contact' | 'rest'
) {
  if (!Number.isFinite(target?.x) || !Number.isFinite(target?.y)) {
    throw new Error('The target centre needs finite x and y offsets.')
  }
  switch (target.shape) {
    case 'circle':
      if (!positiveMetres(target.radius))
        throw new Error('The target radius must be finite and positive.')
      break
    case 'rectangle':
      if (!positiveMetres(target.length) || !positiveMetres(target.width)) {
        throw new Error('Target length and width must be finite and positive.')
      }
      break
    default:
      throw new Error('Unknown target shape.')
  }
  if (endpoint !== 'contact' && endpoint !== 'rest')
    throw new Error('Unknown trace endpoint.')

  measure(samples)
  const release = samples[0]
  const observed =
    endpoint === 'contact'
      ? samples.find((sample) => sample.event === 'contact')!
      : samples[samples.length - 1]
  const dx = observed.x - release.x - target.x
  const dy = observed.y - release.y - target.y
  const radialError = Math.hypot(dx, dy)
  if (!Number.isFinite(radialError))
    throw new Error('Target error exceeds the measurable numeric range.')
  const hit =
    target.shape === 'circle'
      ? radialError <= target.radius
      : Math.abs(dx) <= target.length / 2 && Math.abs(dy) <= target.width / 2
  return { dx, dy, radialError, hit }
}
