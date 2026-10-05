import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { effectScope } from 'vue'
import { FakeWorker, installFakeWorker, waitFor } from '../fake-worker.ts'
import { useLineTokens } from '@/composables/use-line-tokens'

// A worker that never answers: the hold must end by the limit, not by the tokens.
installFakeWorker('manual')

describe('useLineTokens hold', () => {
  it('ends the hold after the limit when no tokens come', async () => {
    const lines = ['const a = 1']
    const scope = effectScope()
    const { tokens, holdForTokens } = scope.run(() =>
      useLineTokens({ key: lines, path: 'a.ts', lines: () => lines }, true)
    )!
    assert.equal(holdForTokens.value, true)

    await waitFor(() => !holdForTokens.value, 2000)
    assert.equal(tokens.value, null)

    // An unmount stops the request in the worker.
    const worker = FakeWorker.instances.at(-1)!
    scope.stop()
    assert.equal(worker.messages.at(-1)?.type, 'cancel')
  })
})
