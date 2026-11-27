/** Field coordinates in metres. The positive y axis points crossrange. */
export interface Target {
  x: number
  y: number
}

/** A timestamp in seconds and a sampled field position. z is altitude in metres. */
export interface Sample extends Target {
  t: number
  z: number
  event?: 'contact' | 'rest'
}

function horizontalDistance(a: Target, b: Target): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Measure a completed trace from the release (first sample) through marked rest. */
export function measure(samples: readonly Sample[], target?: Target) {
  const release = samples[0]
  const rest = samples[samples.length - 1]
  if (!release || !rest)
    throw new Error(
      'A completed trace needs at least a contact and a rest sample.'
    )
  if (
    target !== undefined &&
    (!Number.isFinite(target?.x) || !Number.isFinite(target?.y))
  ) {
    throw new Error('Target coordinates must be finite numbers.')
  }

  let firstContact: Sample | undefined
  let previous: Sample | undefined
  let rollout = 0
  let apex = -Infinity
  for (const [index, sample] of samples.entries()) {
    if (
      !sample ||
      ![sample.t, sample.x, sample.y, sample.z].every(Number.isFinite)
    ) {
      throw new Error(`Sample ${index + 1} needs finite t, x, y, and z values.`)
    }
    if (previous && sample.t <= previous.t) {
      throw new Error(`Time must increase at sample ${index + 1}.`)
    }
    if (
      sample.event !== undefined &&
      sample.event !== 'contact' &&
      sample.event !== 'rest'
    ) {
      throw new Error(`Unknown event at sample ${index + 1}.`)
    }
    if (sample.event === 'rest' && index !== samples.length - 1) {
      throw new Error('Only the last sample may mark rest.')
    }

    if (firstContact && previous)
      rollout += horizontalDistance(previous, sample)
    if (sample.event === 'contact' && !firstContact) firstContact = sample
    apex = Math.max(apex, sample.z)
    previous = sample
  }

  if (!firstContact)
    throw new Error('Mark the first ground strike with a contact event.')
  if (rest.event !== 'rest')
    throw new Error('Mark the final position with a rest event.')

  const result = {
    carry: horizontalDistance(release, firstContact),
    rollout,
    total: horizontalDistance(release, rest),
    apex,
    restX: rest.x,
    restY: rest.y,
    targetDistance: target ? horizontalDistance(release, target) : null,
    radialError: target ? horizontalDistance(rest, target) : null,
    lateralError: target ? rest.y - target.y : null,
  }
  if (
    !Object.values(result).every(
      (value) => value === null || Number.isFinite(value)
    )
  ) {
    throw new Error('Trace coordinates exceed the measurable numeric range.')
  }
  return result
}
