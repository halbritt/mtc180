import type { Sample } from './telemetry'

type Position = Pick<Sample, 'x' | 'y' | 'z'>

function position({ x, y, z }: Sample): Position {
  return { x, y, z }
}

function interpolate(a: number, b: number, fraction: number): number {
  // Opposite-sign finite endpoints can overflow when subtracted.
  if (a < 0 !== b < 0) return (1 - fraction) * a + fraction * b
  return a + fraction * (b - a)
}

/** Sample a validated, chronological trace at seconds elapsed since its first observation. */
export function positionAt(
  samples: readonly Sample[],
  elapsed: number
): Position {
  if (samples.length === 0) throw new Error('Replay needs at least one sample.')
  if (!Number.isFinite(elapsed)) throw new Error('Replay time must be finite.')

  const first = samples[0]
  const last = samples[samples.length - 1]
  if (elapsed <= 0) return position(first)
  if (elapsed >= last.t - first.t) return position(last)

  // Compare elapsed times directly. Adding a short interval to a large clock
  // origin can round an interior playback time onto one of the observations.
  let low = 0
  let high = samples.length - 1
  while (high - low > 1) {
    const middle = low + Math.floor((high - low) / 2)
    if (samples[middle].t - first.t <= elapsed) low = middle
    else high = middle
  }

  const before = samples[low]
  const after = samples[high]
  const offset = elapsed - (before.t - first.t)
  if (offset === 0) return position(before)

  const interval = after.t - before.t
  const fraction = Number.isFinite(interval)
    ? offset / interval
    : offset / 2 / (after.t / 2 - before.t / 2)
  return {
    x: interpolate(before.x, after.x, fraction),
    y: interpolate(before.y, after.y, fraction),
    z: interpolate(before.z, after.z, fraction),
  }
}
