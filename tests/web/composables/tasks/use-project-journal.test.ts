import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRenderer, defineComponent, reactive, nextTick } from 'vue'
import { taskJournalApi } from '@/api/task-journal'
import { useProjectJournal } from '@/composables/tasks/use-project-journal'
import type {
  JournalSearchInput,
  JournalSearchPage,
  JournalSearchEntry
} from '@/api/types'

// Run lifecycle and request races without adding Vue component test infrastructure.
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
// Shared SSE subscriber receives the same event as the browser after debounce.
const listeners = new Map<string, () => void>()
Object.assign(globalThis, {
  EventSource: class {
    addEventListener(type: string, cb: () => void) {
      listeners.set(type, cb)
    }
    close() {}
  }
})
const flush = () => new Promise<void>(resolve => setImmediate(resolve))
function mount(input: { value: JournalSearchInput; visible: boolean }) {
  let state!: ReturnType<typeof useProjectJournal>
  const app = renderer.createApp(
    defineComponent({
      setup() {
        state = useProjectJournal(
          () => input.value,
          () => input.visible
        )
        return () => null
      }
    })
  )
  app.mount({})
  return { state, unmount: () => app.unmount() }
}
function entry(seq: number): JournalSearchEntry {
  return {
    seq,
    id: String(seq),
    storeId: 'store',
    taskId: 'task',
    taskTitle: 'Task',
    isSuperseded: false,
    kind: 'note',
    eventType: null,
    body: String(seq),
    actor: { kind: 'user', id: 'local' },
    sessionId: null,
    turnId: null,
    supersedesEntryId: null,
    createdAt: '2026-11-12T00:00:00Z'
  }
}
function page(seq: number, next: number | null = null): JournalSearchPage {
  return {
    storeId: 'store',
    items: [entry(seq)],
    throughSeq: seq,
    nextBeforeSeq: next
  }
}
test('old search responses cannot replace a newer filter result', async t => {
  let finish!: (result: JournalSearchPage) => void
  t.mock.method(taskJournalApi, 'search', (query: JournalSearchInput) =>
    query.query === 'old'
      ? new Promise<JournalSearchPage>(resolve => {
          finish = resolve
        })
      : Promise.resolve(page(2))
  )
  const input = reactive({ value: { query: 'old' }, visible: true })
  const mounted = mount(input)
  t.after(mounted.unmount)
  input.value = { query: 'new' }
  await nextTick()
  await flush()
  assert.deepEqual(
    mounted.state.items.value.map(row => row.seq),
    [2]
  )
  finish(page(1))
  await flush()
  assert.deepEqual(
    mounted.state.items.value.map(row => row.seq),
    [2]
  )
})
test('older pages pin the store and snapshot and can retry without dropping entries', async t => {
  const calls: JournalSearchInput[] = []
  let fail = true
  t.mock.method(taskJournalApi, 'search', async (query: JournalSearchInput) => {
    calls.push(query)
    if (query.beforeSeq) {
      if (fail) throw new Error('offline')
      return { ...page(1), throughSeq: 2 }
    }
    return page(2, 2)
  })
  const mounted = mount(reactive({ value: {}, visible: true }))
  t.after(mounted.unmount)
  await flush()
  await mounted.state.older()
  assert.equal(mounted.state.error.value, 'offline')
  assert.equal(mounted.state.items.value.length, 1)
  fail = false
  await mounted.state.retry()
  assert.deepEqual(calls.at(-1), {
    storeId: 'store',
    beforeSeq: 2,
    throughSeq: 2
  })
  assert.deepEqual(
    mounted.state.items.value.map(row => row.seq),
    [2, 1]
  )
  assert.equal(mounted.state.error.value, null)
})
test('hidden journal waits for visibility and disposal ignores pending replies', async t => {
  let count = 0
  let finish!: (result: JournalSearchPage) => void
  t.mock.method(taskJournalApi, 'search', () => {
    count++
    return new Promise<JournalSearchPage>(resolve => {
      finish = resolve
    })
  })
  const input = reactive({ value: {}, visible: false })
  const mounted = mount(input)
  assert.equal(count, 0)
  input.visible = true
  await nextTick()
  assert.equal(count, 1)
  mounted.unmount()
  finish(page(1))
  await flush()
  assert.equal(mounted.state.items.value.length, 0)
})
test('explicit store changes clear old items and pagination', async t => {
  t.mock.method(
    taskJournalApi,
    'search',
    async (query: JournalSearchInput) => ({
      ...page(1, 1),
      storeId: query.storeId ?? 'store'
    })
  )
  const input = reactive<{ value: JournalSearchInput; visible: boolean }>({
    value: { storeId: 'store' },
    visible: true
  })
  const mounted = mount(input)
  t.after(mounted.unmount)
  await flush()
  input.value = { storeId: 'new-store' }
  assert.equal(mounted.state.items.value.length, 0)
  assert.equal(mounted.state.nextBefore.value, null)
  await flush()
  assert.equal(mounted.state.storeId.value, 'new-store')
})

test('SSE during refresh keeps an update notice without replacing the reading window', async t => {
  let finish!: (result: JournalSearchPage) => void
  let pending = false
  t.mock.method(taskJournalApi, 'search', () =>
    pending
      ? new Promise<JournalSearchPage>(resolve => {
          finish = resolve
        })
      : Promise.resolve(page(2, 2))
  )
  const mounted = mount(reactive({ value: {}, visible: true }))
  t.after(mounted.unmount)
  await flush()
  listeners.get('task-journal:changed')!()
  assert.equal(mounted.state.hasUpdates.value, true)
  assert.deepEqual(
    mounted.state.items.value.map(row => row.seq),
    [2]
  )
  pending = true
  const refreshing = mounted.state.refresh()
  listeners.get('task-journal:changed')!()
  finish(page(3))
  await refreshing
  assert.equal(mounted.state.hasUpdates.value, true)
  pending = false
  await mounted.state.refresh()
  assert.equal(mounted.state.hasUpdates.value, false)
})
