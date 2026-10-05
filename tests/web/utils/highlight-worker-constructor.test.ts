import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { FakeWorker, installFakeWorker } from '../fake-worker.ts'
import {
  tokenizeInWorker,
  workerAvailable
} from '@/utils/highlight-worker-client'

installFakeWorker('manual')

describe('tokenizeInWorker without a worker', () => {
  it('gives unsent and turns the worker off when the worker does not start', async () => {
    FakeWorker.throwOnCreate = true
    const originalError = console.error
    console.error = () => undefined
    try {
      const outcome = await tokenizeInWorker('typescript', ['a'], {
        sliceSize: 100
      })
      assert.equal(outcome, 'unsent')
    } finally {
      console.error = originalError
    }
    assert.equal(workerAvailable(), false)
  })
})
