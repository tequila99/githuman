import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { FakeWorker, installFakeWorker, waitFor } from '../fake-worker.ts'
import {
  highlightCached,
  warmUpHighlighter
} from '@/composables/use-syntax-highlighting'
import { workerAvailable } from '@/utils/highlight-worker-client'

// The module keeps one worker and the warm languages for the whole file: each test uses
// its own languages, and the dead worker comes last.
installFakeWorker('auto')

function requestsFor(lang: string): number {
  return FakeWorker.instances
    .flatMap(worker => worker.requests())
    .filter(request => request.lang === lang).length
}

/** Waits until the worker has no pending answers: a warm-up gives no promise to await. */
function settle() {
  return new Promise(resolve => setTimeout(resolve, 200))
}

describe('warmUpHighlighter', () => {
  it('warms up each language once', async () => {
    warmUpHighlighter(['a.ts', 'b.ts', 'c.css'])
    await waitFor(() => requestsFor('typescript') === 1)
    await settle()
    warmUpHighlighter(['a.ts', 'c.css'])
    await settle()
    assert.equal(requestsFor('typescript'), 1)
    assert.equal(requestsFor('css'), 1)
  })

  it('warms up a language again after a failure', async () => {
    FakeWorker.failingLangs.add('scss')
    warmUpHighlighter(['a.scss'])
    await waitFor(() => requestsFor('scss') === 1)
    await settle()
    FakeWorker.failingLangs.delete('scss')
    warmUpHighlighter(['a.scss'])
    await waitFor(() => requestsFor('scss') === 2)
  })
})

describe('highlightCached', () => {
  it('tokenizes on the main thread when the worker cannot get the request', async () => {
    FakeWorker.unclonableLang = 'python'
    const originalError = console.error
    console.error = () => undefined
    try {
      const tokens = await highlightCached({}, 'a.py', () => ['x = 1'])
      assert.equal(tokens?.length, 1)
    } finally {
      console.error = originalError
      FakeWorker.unclonableLang = null
    }
    assert.equal(workerAvailable(), true)
  })

  it('repeats a request on the main thread when the worker dies during it', async () => {
    FakeWorker.mode = 'manual'
    const request = highlightCached({}, 'a.go', () => ['package main'])
    const worker = FakeWorker.instances.at(-1)!
    await waitFor(() => worker.requests().some(r => r.lang === 'go'))
    const originalError = console.error
    console.error = () => undefined
    try {
      worker.fail()
    } finally {
      console.error = originalError
    }
    const tokens = await request
    assert.equal(tokens?.length, 1)
    assert.equal(workerAvailable(), false)
  })
})
