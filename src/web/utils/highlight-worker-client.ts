import type {
  LineDocument,
  LineTokens,
  TokenizeOutcome
} from '@/utils/shiki-engine'
import type {
  HighlightRequest,
  HighlightResponse
} from '@/workers/highlight-protocol'

interface Pending {
  onSlice: (tokens: LineTokens[], start: number) => void
  finish: (outcome: TokenizeOutcome) => void
}

let worker: Worker | null = null
// Set when the worker failed to start or died. Its errors are almost always a script that
// did not load, and a new worker gets the same error, so the main thread does the work.
let workerFailed = false
let nextId = 1
const pending = new Map<number, Pending>()

/** True when this environment can run the worker, and the worker did not fail. */
export function workerAvailable(): boolean {
  return typeof Worker !== 'undefined' && !workerFailed
}

function createWorker(): Worker {
  const created = new Worker(
    new URL('../workers/highlight.worker.ts', import.meta.url),
    { type: 'module' }
  )
  created.addEventListener(
    'message',
    (event: MessageEvent<HighlightResponse>) => {
      const response = event.data
      const entry = pending.get(response.id)
      if (!entry) return
      if (response.type === 'slice') {
        entry.onSlice(response.tokens, response.start)
      } else {
        pending.delete(response.id)
        entry.finish(response.ok ? 'done' : 'failed')
      }
    }
  )
  // A dead worker answers nothing: settle every request.
  created.addEventListener('error', event => {
    console.error(
      'The highlight worker failed, the main thread does the work now',
      event
    )
    workerFailed = true
    for (const entry of pending.values()) entry.finish('failed')
    pending.clear()
    created.terminate()
    worker = null
  })
  return created
}

function send(target: Worker, message: HighlightRequest) {
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a Worker has no target origin; the second argument is the transfer list
  target.postMessage(message)
}

/**
 * Tokenizes in the worker and reports each slice through `onSlice`. Gives `'unsent'` when the
 * worker did not get the request: then the caller can do the work on the main thread.
 */
export function tokenizeInWorker(
  lang: string,
  lines: string[],
  options: {
    sliceSize: number
    documents?: LineDocument[] | undefined
    signal?: AbortSignal | undefined
    onSlice?: ((tokens: LineTokens[], start: number) => void) | undefined
  }
): Promise<TokenizeOutcome | 'unsent'> {
  const { signal } = options
  if (signal?.aborted) return Promise.resolve('aborted')

  if (!worker) {
    try {
      worker = createWorker()
    } catch (err) {
      // A content security policy or no module workers: no worker in this page.
      console.error('The highlight worker did not start', err)
      workerFailed = true
      return Promise.resolve('unsent')
    }
  }
  const target = worker

  return new Promise(resolve => {
    const id = nextId++

    const onAbort = () => {
      if (!pending.delete(id)) return
      if (worker) send(worker, { type: 'cancel', id })
      resolve('aborted')
    }

    pending.set(id, {
      onSlice: (tokens, start) => options.onSlice?.(tokens, start),
      finish: outcome => {
        signal?.removeEventListener('abort', onAbort)
        resolve(outcome)
      }
    })

    try {
      // A copy: a reactive proxy cannot be cloned into the worker.
      send(target, {
        type: 'tokenize',
        id,
        lang,
        lines: Array.from(lines),
        // Copies too: the documents come from a reactive file.
        ...(options.documents
          ? { documents: options.documents.map(document => ({ ...document })) }
          : {}),
        sliceSize: options.sliceSize
      })
    } catch (err) {
      // Data that cannot go to the worker. This is a program error of one request,
      // so the worker stays on for the others.
      console.error('The highlight worker did not get the request', err)
      pending.delete(id)
      resolve('unsent')
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
