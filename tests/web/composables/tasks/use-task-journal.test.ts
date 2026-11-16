import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRenderer, defineComponent, nextTick, reactive } from 'vue'
import { taskJournalApi } from '@/api/task-journal'
import { useTaskJournal } from '@/composables/tasks/use-task-journal'
import type { JournalEntry } from '../../../../src/shared/task-journal/types.ts'

// Run reactive lifecycle and request races without introducing component test infrastructure.
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
Object.assign(globalThis, {
  EventSource: class {
    addEventListener() {}
    close() {}
  }
})
const flush = () => new Promise<void>(resolve => setImmediate(resolve))
function mount(props: { taskId: string; storeId: string; active: boolean }) {
  let state!: ReturnType<typeof useTaskJournal>
  const app = renderer.createApp(
    defineComponent({
      setup() {
        state = useTaskJournal(props)
        return () => null
      }
    })
  )
  app.mount({})
  return { state, unmount: () => app.unmount() }
}
function entry(seq: number): JournalEntry {
  return {
    seq,
    id: String(seq),
    storeId: 'store',
    taskId: 'task',
    kind: 'note',
    eventType: null,
    body: String(seq),
    actor: { kind: 'user', id: 'local' },
    sessionId: null,
    turnId: null,
    supersedesEntryId: null,
    createdAt: '2026-11-11T00:00:00Z'
  }
}

test('journal refresh bridges more than a page of new entries without gaps', async t => {
  let newest = 60
  t.mock.method(
    taskJournalApi,
    'list',
    async (
      _taskId: string,
      _storeId: string,
      before?: number,
      through?: number
    ) => {
      const top = Math.min(
        before === undefined ? newest : before - 1,
        through ?? newest
      )
      const rows = Array.from({ length: Math.min(30, top) }, (_, index) =>
        entry(top - index)
      )
      return {
        items: rows,
        throughSeq: through ?? newest,
        nextBeforeSeq: top > 30 ? rows.at(-1)!.seq : null
      }
    }
  )
  const mounted = mount({ taskId: 'task', storeId: 'store', active: true })
  t.after(mounted.unmount)
  await flush()
  assert.equal(mounted.state.items.value.length, 30)
  newest = 140
  await mounted.state.refresh()
  await mounted.state.older()
  assert.deepEqual(
    mounted.state.items.value.map(row => row.seq),
    Array.from({ length: 140 }, (_, i) => 140 - i)
  )
})

test('journal retains failed append identity and isolates task changes from stale loads', async t => {
  t.mock.method(taskJournalApi, 'list', async () => ({
    items: [],
    throughSeq: 0,
    nextBeforeSeq: null
  }))
  const requestIds: string[] = []
  let fail = true
  t.mock.method(
    taskJournalApi,
    'append',
    async (_taskId: string, _storeId: string, input: { requestId: string }) => {
      requestIds.push(input.requestId)
      if (fail) throw new Error('network failed')
      return entry(1)
    }
  )
  const props = reactive({ taskId: 'task', storeId: 'store', active: true })
  const mounted = mount(props)
  t.after(mounted.unmount)
  await flush()
  mounted.state.draft.value.body = 'Saved decision'
  await mounted.state.append()
  assert.equal(mounted.state.draft.value.body, 'Saved decision')
  props.taskId = 'other'
  await nextTick()
  await flush()
  assert.equal(mounted.state.draft.value.body, '')
  props.taskId = 'task'
  await nextTick()
  await flush()
  assert.equal(mounted.state.draft.value.body, 'Saved decision')
  fail = false
  await mounted.state.append()
  assert.equal(requestIds[0], requestIds[1])
  assert.equal(mounted.state.draft.value.body, '')
})

test('an initially empty journal exposes older pages after its first burst', async t => {
  let newest = 0
  t.mock.method(
    taskJournalApi,
    'list',
    async (
      _taskId: string,
      _storeId: string,
      before?: number,
      through?: number
    ) => {
      const top = Math.min(
        before === undefined ? newest : before - 1,
        through ?? newest
      )
      const rows = Array.from({ length: Math.min(30, top) }, (_, i) =>
        entry(top - i)
      )
      return {
        items: rows,
        throughSeq: through ?? newest,
        nextBeforeSeq: top > 30 ? rows.at(-1)!.seq : null
      }
    }
  )
  const mounted = mount({ taskId: 'task', storeId: 'store', active: true })
  t.after(mounted.unmount)
  await flush()
  newest = 35
  await mounted.state.refresh()
  assert.notEqual(mounted.state.nextBefore.value, null)
  await mounted.state.older()
  assert.equal(mounted.state.items.value.length, 35)
})
