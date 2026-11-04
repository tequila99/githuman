import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import {
  createArtifactActions,
  useArtifactActionsStore
} from '@/stores/artifact-actions-store'
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
test('a committed action reports the applied outcome even when the read-back fails', async () => {
  const value = {
    ...inspection(),
    phase: 'authorized' as const,
    authorizationId: 'grant'
  }
  serve(value)
  const model = createArtifactActions('store')
  await model.select('pending')
  const served = globalThis.fetch
  globalThis.fetch = async (input, init) =>
    init?.method === 'POST'
      ? new Response('{}')
      : new Response('{"message":"gone"}', { status: 404 })
  await model.execute()
  globalThis.fetch = served
  assert.equal(model.state.outcome, 'applied')
  assert.equal(model.state.unavailable, true)
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

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status })
}
test('a failed read-back after a successful approve is not an approve failure', async () => {
  const value = inspection()
  let approved = false
  globalThis.fetch = async (input, init) => {
    if (init?.method === 'POST') {
      approved = true
      return json({})
    }
    if (approved) return json({ message: 'down' }, 500)
    return json(
      input === '/api/artifact-actions'
        ? { storeId: 'store', items: [value.pending] }
        : value
    )
  }
  const model = createArtifactActions('store')
  await model.select('pending')
  model.state.confirmed = true
  await model.approve()
  assert.equal(model.state.outcome, 'granted')
  assert.equal(model.state.error, null)
  assert.ok(model.state.refreshError)
  assert.equal(model.state.confirmed, false)
  assert.equal(model.state.busy, false)
})
test('the selected action stays visible after it leaves the pending list', async () => {
  const value = inspection()
  let approved = false
  globalThis.fetch = async (input, init) => {
    if (init?.method === 'POST') {
      approved = true
      return json({})
    }
    if (input === '/api/artifact-actions') {
      return json({ storeId: 'store', items: approved ? [] : [value.pending] })
    }
    return json(
      approved ? { ...value, phase: 'authorized', canExecute: false } : value
    )
  }
  const model = createArtifactActions('store')
  await model.list()
  await model.select('pending')
  model.state.confirmed = true
  await model.approve()
  assert.equal(model.state.items.length, 0)
  assert.equal(model.state.selectedId, 'pending')
  assert.equal(model.state.inspection?.phase, 'authorized')
})
test('revoke keeps the selection and reports the end result', async () => {
  const value = inspection()
  const writes: { url: string; body: unknown }[] = []
  globalThis.fetch = async (input, init) => {
    if (init?.method === 'DELETE') {
      writes.push({ url: typeof input === 'string' ? input : '', body: null })
      return json({ revoked: true })
    }
    return json(
      input === '/api/artifact-actions'
        ? { storeId: 'store', items: [] }
        : value
    )
  }
  const model = createArtifactActions('store')
  await model.select('pending')
  await model.revoke()
  assert.equal(writes.length, 1)
  assert.equal(model.state.selectedId, 'pending')
  assert.equal(model.state.outcome, 'revoked')
  assert.equal(model.state.inspection, null)
})
test('a missing action becomes unavailable instead of an empty success', async () => {
  globalThis.fetch = async () => json({ message: 'Not found' }, 404)
  const model = createArtifactActions('store')
  await model.select('gone')
  assert.equal(model.state.unavailable, true)
  assert.equal(model.state.inspection, null)
})
test('a late list from before stop cannot land after start', async () => {
  const waiting: ((response: Response) => void)[] = []
  globalThis.fetch = () =>
    new Promise<Response>(done => {
      waiting.push(done)
    })
  const model = createArtifactActions('store')
  const first = model.list()
  model.stop()
  void model.start()
  await Promise.resolve()
  waiting[0]?.(json({ storeId: 'store', items: [inspection().pending] }))
  await first
  assert.deepEqual(model.state.items, [])
})
test('expiry clears the confirmation without a server answer', async () => {
  let time = 1000
  const value = inspection()
  value.pending.expiresAt = 5000
  serve(value)
  const model = createArtifactActions('store', () => time)
  await model.select('pending')
  model.state.confirmed = true
  assert.equal(model.nextExpiry(), 5000)
  time = 5000
  model.expire()
  assert.equal(model.state.confirmed, false)
  assert.equal(model.state.expired, true)
  await assert.rejects(model.approve(), /stale|expired/)
})
test('the bootstrap takes the store identity from the server list', async () => {
  setActivePinia(createPinia())
  globalThis.fetch = async () =>
    json({ storeId: 'server-store', items: [inspection().pending] })
  const store = useArtifactActionsStore()
  await store.bootstrap()
  assert.ok(store.model)
  assert.equal(store.model.state.items.length, 1)
  const first = store.model
  globalThis.fetch = async () => json({ storeId: 'other', items: [] })
  await store.bootstrap()
  assert.notEqual(store.model, first)
  assert.equal(first.state.stale, true)
})
test('a failed bootstrap reports an error and can retry', async () => {
  setActivePinia(createPinia())
  globalThis.fetch = async () => json({ message: 'down' }, 500)
  const store = useArtifactActionsStore()
  await store.bootstrap()
  assert.ok(store.error)
  assert.equal(store.model, null)
  globalThis.fetch = async () => json({ storeId: 's', items: [] })
  await store.bootstrap()
  assert.equal(store.error, null)
  assert.ok(store.model)
})
