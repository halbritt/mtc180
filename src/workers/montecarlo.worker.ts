import {
  runMonteCarlo,
  type MonteCarloRequest,
  type MonteCarloResponse,
} from '../physics/montecarlo'

interface WorkerScope {
  onmessage: ((event: { data: MonteCarloRequest }) => void) | null
  postMessage: (message: MonteCarloResponse) => void
}

const workerSelf = self as unknown as WorkerScope

workerSelf.onmessage = (event: { data: MonteCarloRequest }) => {
  const req = event?.data
  const jobId =
    req && typeof req === 'object' && typeof req.jobId === 'string'
      ? req.jobId
      : ''
  const total =
    req &&
    typeof req === 'object' &&
    Array.isArray(req.models) &&
    Number.isSafeInteger(req.trialsPerModel) &&
    req.trialsPerModel > 0
      ? req.models.length * req.trialsPerModel
      : 0

  try {
    const results = runMonteCarlo(req, (completed, batchTotal) => {
      workerSelf.postMessage({
        jobId: req.jobId,
        type: 'progress',
        completed,
        total: batchTotal,
      })
    })
    workerSelf.postMessage({
      jobId: req.jobId,
      type: 'done',
      completed: total,
      total,
      results,
    })
  } catch (err) {
    workerSelf.postMessage({
      jobId,
      type: 'error',
      completed: 0,
      total,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
