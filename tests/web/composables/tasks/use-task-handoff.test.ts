import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createRenderer, defineComponent } from 'vue'
import { ApiRequestError } from '@/api/client'
import { taskJournalApi } from '@/api/task-journal'
import { tasksApi } from '@/api/tasks'
import { sessionTasksApi } from '@/api/session-tasks'
import { useTaskHandoff } from '@/composables/tasks/use-task-handoff'
import type { Handoff, Task } from '../../../../src/web/api/types.ts'

// Run the reactive lifecycle without introducing component test infrastructure.
const renderer = createRenderer<object, object>({
  patchProp() {},
  insert() {},
  remove() {},
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  setText() {},
  setElementText() {},
  parentNode: () => null,
  nextSibling: () => null
})
function handoff(
  state: Handoff['state'],
  extra: Partial<Handoff> = {}
): Handoff {
  return {
    id: 'h1',
    storeId: 'store',
    taskId: 'task',
    state,
    sourceSessionId: null,
    targetSessionId: null,
    snapshot: 'snapshot',
    digest: 'digest',
    capturedAt: '2026-11-12T00:00:00Z',
    expiresAt: 0,
    error: null,
    ...extra
  }
}
function mount(t: TestContext, session = false) {
  const ready: string[] = []
  let state!: ReturnType<typeof useTaskHandoff>
  const app = renderer.createApp(
    defineComponent({
      setup() {
        state = useTaskHandoff({
          ...(session ? {} : { taskId: () => 'task' }),
          sourceSessionId: () => (session ? 'source' : undefined),
          onReady: id => {
            ready.push(id)
          }
        })
        return () => null
      }
    })
  )
  app.mount({})
  t.after(() => app.unmount())
  t.mock.method(tasksApi, 'get', async () => ({ storeId: 'store' }) as Task)
  t.mock.method(taskJournalApi, 'preview', async () => handoff('preview'))
  return { state, ready }
}

test('a definite confirm refusal keeps its message and does not poll', async t => {
  const { state } = mount(t)
  await state.preview('fake')
  t.mock.method(taskJournalApi, 'confirm', async () => {
    throw new ApiRequestError('The task changed. Refresh the preview.', 409)
  })
  const poll = t.mock.method(taskJournalApi, 'handoff', async () =>
    handoff('preview')
  )
  await state.confirm()
  assert.equal(state.error.value, 'The task changed. Refresh the preview.')
  // A poll that sees the unchanged preview must not erase the explanation.
  await state.poll()
  assert.equal(poll.mock.callCount(), 1)
  assert.equal(state.error.value, 'The task changed. Refresh the preview.')
  assert.equal(state.operation.value?.state, 'preview')
})

test('a full chat list is reported as a slot problem', async t => {
  const { state } = mount(t)
  await state.preview('fake')
  t.mock.method(taskJournalApi, 'confirm', async () => {
    throw new ApiRequestError(
      'All chat slots are in use.',
      409,
      'GHT_AGENT_SESSION_LIMIT'
    )
  })
  await state.confirm()
  assert.equal(state.slotsFull.value, true)
  state.reset()
  assert.equal(state.slotsFull.value, false)
  assert.equal(state.operation.value, null)
})

test('a lost confirm response is reconciled by polling the same operation', async t => {
  const { state, ready } = mount(t)
  await state.preview('fake')
  const confirm = t.mock.method(taskJournalApi, 'confirm', async () => {
    throw new TypeError('Failed to fetch')
  })
  t.mock.method(taskJournalApi, 'handoff', async () =>
    handoff('ready', { targetSessionId: 'target' })
  )
  await state.confirm()
  await state.poll()
  assert.equal(confirm.mock.callCount(), 1)
  assert.deepEqual(ready, ['target'])
  assert.equal(state.error.value, null)
})

test('a failed preparation shows the server error', async t => {
  const { state, ready } = mount(t)
  await state.preview('fake')
  t.mock.method(taskJournalApi, 'confirm', async () => handoff('preparing'))
  t.mock.method(taskJournalApi, 'handoff', async () =>
    handoff('failed', { error: 'Target agent failed to start.' })
  )
  await state.confirm()
  await state.poll()
  assert.equal(state.error.value, 'Target agent failed to start.')
  assert.deepEqual(ready, [])
})

test('session preview sends name and exact source assignment without requiring a task', async t => {
  const { state } = mount(t, true)
  t.mock.method(tasksApi, 'list', async () => ({
    storeId: 'store',
    items: [],
    nextCursor: null
  }))
  t.mock.method(sessionTasksApi, 'get', async () => ({
    sessionId: 'source',
    version: 7,
    taskIds: []
  }))
  const preview = t.mock.method(taskJournalApi, 'previewSession', async () =>
    handoff('preview', { taskId: null, sourceSessionId: 'source' })
  )
  await state.preview('fake', ' New chat ')
  const input = preview.mock.calls[0]!.arguments[0]
  assert.ok(input)
  assert.equal(input.storeId, 'store')
  assert.equal(input.sourceSessionId, 'source')
  assert.equal(input.sourceAssignmentVersion, 7)
  assert.equal(input.name, 'New chat')
  assert.equal(state.operation.value?.taskId, null)
  await state.preview('fake', ' New chat ')
  const retry = preview.mock.calls[1]!.arguments[0]
  assert.ok(retry)
  assert.equal(retry.requestId, input.requestId)
})

test('continuing without preview confirms once despite repeated clicks', async t => {
  const { state, ready } = mount(t)
  const confirm = t.mock.method(taskJournalApi, 'confirm', async () =>
    handoff('ready', { targetSessionId: 'target' })
  )
  await Promise.all([
    state.continueWithoutPreview('fake', 'New chat'),
    state.continueWithoutPreview('fake', 'New chat')
  ])
  assert.equal(confirm.mock.callCount(), 1)
  assert.deepEqual(confirm.mock.calls[0]!.arguments, ['h1', 'digest'])
  assert.deepEqual(ready, ['target'])
})

test('continuing without preview stops when capturing context fails', async t => {
  const { state } = mount(t)
  t.mock.method(taskJournalApi, 'preview', async () => {
    throw new ApiRequestError('The source changed.', 409)
  })
  const confirm = t.mock.method(taskJournalApi, 'confirm', async () =>
    handoff('preparing')
  )
  await state.continueWithoutPreview('fake')
  assert.equal(confirm.mock.callCount(), 0)
  assert.equal(state.error.value, 'The source changed.')
  assert.equal(state.busy.value, false)
})
