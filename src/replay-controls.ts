import { positionAt } from './physics/replay'
import type { Sample } from './physics/telemetry'

/** Attach playback to a field that can display positions from a validated trace. */
export function mountReplay(
  setCursor: (point: Pick<Sample, 'x' | 'y' | 'z'>) => void,
  onPlayToggle?: (playing: boolean) => void
) {
  const controls = document.querySelector<HTMLElement>('#replay')!
  const toggle = document.querySelector<HTMLButtonElement>('#replay-play')!
  const time = document.querySelector<HTMLInputElement>('#replay-time')!
  const speed = document.querySelector<HTMLSelectElement>('#replay-speed')!
  const clock = document.querySelector<HTMLElement>('#replay-clock')!
  let trace: readonly Sample[] = []
  let duration = 0
  let elapsed = 0
  let rate = Number(speed.value)
  let frame: number | undefined
  let lastTick = 0

  function seek(seconds: number) {
    elapsed = Math.min(duration, Math.max(0, seconds))
    setCursor(positionAt(trace, elapsed))
    time.value = String(elapsed)
    const readout = elapsed.toFixed(2) + ' / ' + duration.toFixed(2) + ' s'
    clock.textContent = readout
    time.setAttribute('aria-valuetext', readout)
  }

  function stop(notify = false) {
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
    toggle.textContent = elapsed >= duration ? 'Replay' : 'Play'
    if (notify) onPlayToggle?.(false)
  }

  function advance(now: number) {
    // An input event can run after the document frame timestamp but before its callback.
    const tick = Math.max(lastTick, now)
    seek(elapsed + ((tick - lastTick) * rate) / 1000)
    lastTick = tick
  }

  function animate(now: number) {
    advance(now)
    if (elapsed >= duration) stop(true)
    else frame = requestAnimationFrame(animate)
  }

  toggle.addEventListener('click', () => {
    if (frame !== undefined) {
      advance(performance.now())
      stop(true)
      return
    }
    if (elapsed >= duration) seek(0)
    lastTick = performance.now()
    toggle.textContent = 'Pause'
    frame = requestAnimationFrame(animate)
    onPlayToggle?.(true)
  })
  time.addEventListener('input', () => {
    seek(time.valueAsNumber)
    stop(true)
  })
  speed.addEventListener('change', () => {
    if (frame !== undefined) advance(performance.now())
    rate = Number(speed.value)
  })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && frame !== undefined) {
      advance(performance.now())
      stop(true)
    }
  })

  return (samples: readonly Sample[]) => {
    stop(false)
    trace = samples
    duration = samples[samples.length - 1].t - samples[0].t
    controls.hidden = !Number.isFinite(duration) || duration <= 0
    if (controls.hidden) return
    time.max = String(duration)
    toggle.textContent = 'Play'
    seek(0)
  }
}
