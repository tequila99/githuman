import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { FakeWorker, installFakeWorker, waitFor } from '../fake-worker.ts'
import { warmUpHighlighter } from '@/composables/use-syntax-highlighting'

// This file starts with no `Worker`, as in Node. The module keeps the warm languages for
// the whole file, so no other test may run here before the one below.

describe('warmUpHighlighter without a worker', () => {
  it('does nothing, and leaves the language cold for a later worker', async () => {
    assert.equal(typeof Worker, 'undefined')
    warmUpHighlighter(['a.go'])
    // A warm-up on the main thread would be a started job. Wait for it to be done.
    await new Promise(resolve => setTimeout(resolve, 200))

    installFakeWorker('auto')
    warmUpHighlighter(['a.go'])
    await waitFor(() =>
      FakeWorker.instances
        .flatMap(worker => worker.requests())
        .some(request => request.lang === 'go')
    )
    const requests = FakeWorker.instances
      .flatMap(worker => worker.requests())
      .filter(request => request.lang === 'go')
    assert.equal(requests.length, 1)
  })
})
