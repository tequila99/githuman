import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createArtifactActions } from '@/stores/artifact-actions-store'
import type { ArtifactActionInspection } from '@/api/types'

let savedFetch: typeof fetch
beforeEach(() => {
  savedFetch = globalThis.fetch
})
afterEach(() => {
  globalThis.fetch = savedFetch
})
function inspection(): ArtifactActionInspection {
  return {
    storeId: 'store',
    pending: {
      id: 'pending',
      sessionId: 'user:local',
      expiresAt: Date.now() + 60000,
      action: {
        kind: 'lifecycle',
        changeSetId: 'proposal',
        version: 2,
        validationId: 'validation'
      },
      actionDigest: 'action',
      manifestDigest: 'manifest'
    },
    phase: 'pending',
    canExecute: true,
    ready: true,
    problem: null,
    proposal: null,
    validation: null,
    preview: null,
    authorizationId: null
  }
}
function serve(
  value: ArtifactActionInspection,
  writes: { url: string; body: unknown }[] = []
) {
  globalThis.fetch = async (input, init) => {
    assert.equal(typeof input, 'string')
    const url = input as string
    if (init?.method === 'POST') {
      writes.push({
        url,
        body: JSON.parse(typeof init.body === 'string' ? init.body : '')
      })
      return new Response('{}')
    }
    return new Response(
      JSON.stringify(
        url === '/api/artifact-actions'
          ? { storeId: 'store', items: [value.pending] }
          : value
      )
    )
  }
}
test('approval requires explicit confirmation of a current unexpired scope', async () => {
  const value = inspection()
  const writes: { url: string; body: unknown }[] = []
  serve(value, writes)
  const model = createArtifactActions('store')
  await model.select('pending')
  await assert.rejects(model.approve(), /explicitly/)
  model.state.confirmed = true
  value.pending.expiresAt = 0
  await model.refresh()
  model.state.confirmed = true
  await assert.rejects(model.approve(), /expired/)
  assert.equal(writes.length, 0)
})
test('agent-owned authorization cannot execute through the user UI', async () => {
  const value = {
    ...inspection(),
    phase: 'authorized' as const,
    canExecute: false
  }
  serve(value)
  const model = createArtifactActions('store')
  await model.select('pending')
  await assert.rejects(model.execute(), /requesting session/)
})
test('commit binds exact reviewed version, validation and grant', async () => {
  const value = {
    ...inspection(),
    phase: 'authorized' as const,
    authorizationId: 'grant'
  }
  const writes: { url: string; body: unknown }[] = []
  serve(value, writes)
  const model = createArtifactActions('store')
  await model.select('pending')
  await model.execute()
  assert.ok(writes[0])
  assert.equal(writes[0].url, '/api/artifact-change-sets/proposal/commit')
  assert.deepEqual(writes[0].body, {
    version: 2,
    validationId: 'validation',
    authorizationId: 'grant',
    requestId: (writes[0].body as { requestId: string }).requestId
  })
  assert.ok((writes[0].body as { requestId: string }).requestId)
})
test('lost approval response retains request identity for a deliberate retry', async () => {
  const value = inspection()
  const model = createArtifactActions('store')
  const requestIds: string[] = []
  globalThis.fetch = async (input, init) => {
    if (init?.method === 'POST') {
      requestIds.push(
        JSON.parse(typeof init.body === 'string' ? init.body : '')
          .sourceUserRequestId
      )
      throw new Error('Connection lost')
    }
    return new Response(
      JSON.stringify(
        input === '/api/artifact-actions'
          ? { storeId: 'store', items: [value.pending] }
          : value
      )
    )
  }
  await model.select('pending')
  model.state.confirmed = true
  await assert.rejects(model.approve(), /Connection lost/)
  assert.equal(model.state.confirmed, false)
  assert.equal(model.state.stale, true)
  await model.refresh()
  model.state.confirmed = true
  await assert.rejects(model.approve())
  assert.equal(requestIds.length, 2)
  assert.equal(requestIds[0], requestIds[1])
})
test('changed scope and foreign identity clear confirmation and block writes', async () => {
  const value = inspection()
  serve(value)
  const model = createArtifactActions('store')
  await model.select('pending')
  model.state.confirmed = true
  value.pending.actionDigest = 'changed'
  await model.refresh()
  assert.equal(model.state.confirmed, false)
  value.storeId = 'foreign'
  await model.refresh()
  assert.equal(model.state.stale, true)
  await assert.rejects(model.approve(), /stale/)
})
test('late inspection cannot restore a selection after teardown', async () => {
  let resolve!: (response: Response) => void
  globalThis.fetch = () =>
    new Promise<Response>(done => {
      resolve = done
    })
  const model = createArtifactActions('store')
  const reading = model.select('pending')
  model.stop()
  resolve(new Response(JSON.stringify(inspection())))
  await reading
  assert.equal(model.state.inspection, null)
  assert.equal(model.state.stale, true)
})
