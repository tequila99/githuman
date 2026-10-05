import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { reactive } from 'vue'
import { FakeWorker, installFakeWorker } from '../fake-worker.ts'
import {
  tokenizeInWorker,
  workerAvailable
} from '@/utils/highlight-worker-client'
import type { LineTokens } from '@/utils/shiki-engine'

// The module keeps one worker for the whole file, so the order of the tests matters:
// the test without a worker runs first, and the dead worker comes last.
installFakeWorker('manual')

function lastWorker(): FakeWorker {
  return FakeWorker.instances.at(-1)!
}

function lastRequestId(): number {
  const request = lastWorker().requests().at(-1)!
  return request.id
}

describe('tokenizeInWorker', () => {
  it('sends nothing for a signal that is aborted already', async () => {
    const controller = new AbortController()
    controller.abort()
    const outcome = await tokenizeInWorker('typescript', ['x'], {
      sliceSize: 100,
      signal: controller.signal
    })
    assert.equal(outcome, 'aborted')
    assert.equal(FakeWorker.instances.length, 0)
  })

  it('routes the slices by id and ends with done', async () => {
    const got: [number, number][] = []
    const first = tokenizeInWorker('typescript', ['a', 'b'], {
      sliceSize: 1,
      onSlice: (tokens, start) => got.push([1, start])
    })
    const firstId = lastRequestId()
    const second = tokenizeInWorker('typescript', ['c'], {
      sliceSize: 1,
      onSlice: (tokens, start) => got.push([2, start])
    })
    const secondId = lastRequestId()
    const tokens: LineTokens[] = [[{ content: 'x' }]]

    lastWorker().reply({ type: 'slice', id: secondId, start: 0, tokens })
    lastWorker().reply({ type: 'slice', id: firstId, start: 0, tokens })
    lastWorker().reply({ type: 'slice', id: firstId, start: 1, tokens })
    lastWorker().reply({ type: 'done', id: firstId, ok: true })
    lastWorker().reply({ type: 'done', id: secondId, ok: false })

    assert.equal(await first, 'done')
    assert.equal(await second, 'failed')
    assert.deepEqual(got, [
      [2, 0],
      [1, 0],
      [1, 1]
    ])
  })

  it('sends a cancel on abort and ignores later slices', async () => {
    const controller = new AbortController()
    let slices = 0
    const request = tokenizeInWorker('typescript', ['a'], {
      sliceSize: 1,
      signal: controller.signal,
      onSlice: () => slices++
    })
    const id = lastRequestId()
    controller.abort()
    assert.equal(await request, 'aborted')
    assert.deepEqual(lastWorker().messages.at(-1), { type: 'cancel', id })

    lastWorker().reply({ type: 'slice', id, start: 0, tokens: [[]] })
    lastWorker().reply({ type: 'done', id, ok: true })
    assert.equal(slices, 0)
  })

  it('sends a reactive array as a plain copy', () => {
    const lines = reactive(['const a = 1'])
    void tokenizeInWorker('typescript', lines, { sliceSize: 100 })
    const request = lastWorker().requests().at(-1)!
    assert.deepEqual(request.lines, ['const a = 1'])
  })

  it('gives unsent for data the worker cannot get, and keeps the worker on', async () => {
    FakeWorker.unclonableLang = 'css'
    const originalError = console.error
    console.error = () => undefined
    try {
      const outcome = await tokenizeInWorker('css', ['a {}'], {
        sliceSize: 100
      })
      assert.equal(outcome, 'unsent')
    } finally {
      console.error = originalError
      FakeWorker.unclonableLang = null
    }
    assert.equal(workerAvailable(), true)
  })

  it('fails all requests when the worker dies, and turns the worker off', async () => {
    const first = tokenizeInWorker('typescript', ['a'], { sliceSize: 100 })
    const second = tokenizeInWorker('typescript', ['b'], { sliceSize: 100 })
    const dead = lastWorker()
    const originalError = console.error
    let logged = 0
    console.error = () => logged++
    try {
      dead.fail()
    } finally {
      console.error = originalError
    }

    assert.equal(logged, 1)
    assert.equal(await first, 'failed')
    assert.equal(await second, 'failed')
    assert.equal(dead.terminated, true)
    assert.equal(workerAvailable(), false)
  })
})
