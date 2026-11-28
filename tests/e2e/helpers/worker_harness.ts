import type { MonteCarloRequest, MonteCarloResponse } from './contracts'

export interface WorkerJobOutcome {
  messages: MonteCarloResponse[]
  progressMessages: MonteCarloResponse[]
  done?: MonteCarloResponse
  error?: MonteCarloResponse
}

type MessageHandler = (event: { data: unknown }) => void | Promise<void>

interface WorkerSelfShim {
  onmessage: MessageHandler | null
  postMessage: (data: unknown) => void
  addEventListener: (type: string, listener: MessageHandler) => void
  removeEventListener: (type: string, listener: MessageHandler) => void
}

const listeners = new Set<MessageHandler>()
let activeSink: ((msg: MonteCarloResponse) => void) | null = null
let workerLoaded = false
let jobQueue: Promise<void> = Promise.resolve()

function enqueueJob<T>(fn: () => Promise<T>): Promise<T> {
  const run = jobQueue.then(fn, fn)
  jobQueue = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

function restoreProperty(
  target: object,
  key: PropertyKey,
  desc: PropertyDescriptor | undefined
): void {
  if (desc === undefined) {
    Reflect.deleteProperty(target, key)
  } else {
    Object.defineProperty(target, key, desc)
  }
}

const shimSelf: WorkerSelfShim = {
  onmessage: null,
  postMessage(data: unknown) {
    if (activeSink && data && typeof data === 'object') {
      activeSink(data as MonteCarloResponse)
    }
  },
  addEventListener(type: string, listener: MessageHandler) {
    if (type === 'message') listeners.add(listener)
  },
  removeEventListener(type: string, listener: MessageHandler) {
    if (type === 'message') listeners.delete(listener)
  },
}

function installWorkerGlobals(): () => void {
  const prevSelfDesc = Object.getOwnPropertyDescriptor(globalThis, 'self')
  const prevPostMessageDesc = Object.getOwnPropertyDescriptor(globalThis, 'postMessage')
  const g = globalThis as unknown as Record<string, unknown>
  let patchedSelfTarget: Record<string, unknown> | null = null
  const prevSelfMethodDescs: Array<[string, PropertyDescriptor | undefined]> = []

  if (!g.self) {
    Object.defineProperty(globalThis, 'self', {
      value: shimSelf,
      writable: true,
      enumerable: true,
      configurable: true,
    })
  } else if (g.self !== shimSelf && typeof g.self === 'object') {
    patchedSelfTarget = g.self as Record<string, unknown>
    for (const key of ['postMessage', 'addEventListener', 'removeEventListener'] as const) {
      prevSelfMethodDescs.push([key, Object.getOwnPropertyDescriptor(patchedSelfTarget, key)])
      patchedSelfTarget[key] = shimSelf[key]
    }
  }

  Object.defineProperty(globalThis, 'postMessage', {
    value: shimSelf.postMessage,
    writable: true,
    enumerable: true,
    configurable: true,
  })

  return () => {
    if (patchedSelfTarget) {
      for (const [key, desc] of prevSelfMethodDescs) {
        restoreProperty(patchedSelfTarget, key, desc)
      }
    }
    restoreProperty(globalThis, 'postMessage', prevPostMessageDesc)
    restoreProperty(globalThis, 'self', prevSelfDesc)
  }
}

async function ensureWorkerLoaded(): Promise<void> {
  if (!workerLoaded) {
    const g = globalThis as unknown as { self?: unknown }
    const workerModulePath = '../../../src/workers/montecarlo.worker'
    await import(workerModulePath)
    // Sync handler if worker attached to globalThis.self directly
    const currentSelf = g.self as Partial<WorkerSelfShim>
    if (currentSelf !== shimSelf && typeof currentSelf?.onmessage === 'function') {
      shimSelf.onmessage = currentSelf.onmessage
    }
    workerLoaded = true
  }
}

async function deliverToWorker(payload: MonteCarloRequest): Promise<void> {
  const event = { data: payload }
  if (typeof shimSelf.onmessage === 'function') {
    await shimSelf.onmessage(event)
  }
  for (const listener of Array.from(listeners)) {
    await listener(event)
  }
}

export async function runWorkerJob(
  request: MonteCarloRequest,
  timeoutMs = 20_000
): Promise<WorkerJobOutcome> {
  return enqueueJob(async () => {
    const restoreGlobals = installWorkerGlobals()
    try {
      await ensureWorkerLoaded()
      const messages: MonteCarloResponse[] = []

      return await new Promise<WorkerJobOutcome>((resolve, reject) => {
        let settled = false
        const timer = setTimeout(() => {
          if (settled) return
          settled = true
          activeSink = null
          reject(new Error(`Worker job '${request.jobId}' timed out after ${timeoutMs}ms`))
        }, timeoutMs)

        const finish = (outcome: WorkerJobOutcome) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          activeSink = null
          resolve(outcome)
        }

        activeSink = (msg: MonteCarloResponse) => {
          messages.push(msg)
          if (msg.type === 'done' || msg.type === 'error') {
            finish({
              messages,
              progressMessages: messages.filter((m) => m.type === 'progress'),
              done: messages.find((m) => m.type === 'done'),
              error: messages.find((m) => m.type === 'error'),
            })
          }
        }

        Promise.resolve(deliverToWorker(request)).catch((err: unknown) => {
          const errMsg: MonteCarloResponse = {
            jobId: request.jobId,
            type: 'error',
            completed: 0,
            total: request.trialsPerModel * request.models.length,
            error: err instanceof Error ? err.message : String(err),
          }
          messages.push(errMsg)
          finish({
            messages,
            progressMessages: messages.filter((m) => m.type === 'progress'),
            error: errMsg,
          })
        })
      })
    } finally {
      activeSink = null
      restoreGlobals()
    }
  })
}

export async function runWorkerSequence(
  requests: readonly MonteCarloRequest[],
  timeoutMs = 20_000
): Promise<WorkerJobOutcome[]> {
  const outcomes: WorkerJobOutcome[] = []
  for (const req of requests) {
    outcomes.push(await runWorkerJob(req, timeoutMs))
  }
  return outcomes
}
