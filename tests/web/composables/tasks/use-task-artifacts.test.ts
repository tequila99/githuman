import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRenderer, defineComponent, nextTick, shallowRef } from 'vue'
import { createI18n } from 'vue-i18n'
import en from '@/i18n/en-US/index'
import { tasksApi } from '@/api/tasks'
import { artifactsApi } from '@/api/artifacts'
import { useTaskArtifacts } from '@/composables/tasks/use-task-artifacts'
import type { Artifact, ArtifactSearchItem, TaskArtifact } from '@/api/types'

// Exercise lifecycle cleanup and reactive inputs without a browser DOM.
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

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}
function mount(input: Parameters<typeof useTaskArtifacts>[0]) {
  let state!: ReturnType<typeof useTaskArtifacts>
  const app = renderer.createApp(
    defineComponent({
      setup() {
        state = useTaskArtifacts(input)
        return () => null
      }
    })
  )
  app.use(createI18n({ legacy: false, locale: 'en', messages: { en } }))
  Object.assign(app.config.globalProperties, { $q: { notify() {} } })
  app.mount({})
  return { state, unmount: () => app.unmount() }
}

// The shared event stream only needs listener registration in these tests.
Object.assign(globalThis, {
  EventSource: class {
    addEventListener() {}
    close() {}
  }
})
const flush = () => new Promise<void>(resolve => setImmediate(resolve))

test('reactive task changes ignore stale loads and disposal ignores pending responses', async t => {
  for (const getter of [false, true]) {
    const id = shallowRef('first')
    const first = deferred<{ items: TaskArtifact[] }>()
    const second = deferred<{ items: TaskArtifact[] }>()
    t.mock.method(tasksApi, 'artifacts', (value: string) =>
      value === 'first' ? first.promise : second.promise
    )
    const mounted = mount(getter ? () => id.value : id)
    id.value = 'second'
    await nextTick()
    second.resolve({ items: [{ id: 'new' } as TaskArtifact] })
    await flush()
    first.resolve({ items: [{ id: 'old' } as TaskArtifact] })
    await flush()
    assert.equal(mounted.state.items.value[0]?.id, 'new')
    mounted.unmount()
    t.mock.restoreAll()
  }
  const pending = deferred<{ items: TaskArtifact[] }>()
  t.mock.method(tasksApi, 'artifacts', () => pending.promise)
  const mounted = mount('plain-value')
  mounted.unmount()
  pending.resolve({ items: [{ id: 'late' } as TaskArtifact] })
  await flush()
  assert.deepEqual(mounted.state.items.value, [])
})

test('binding keeps the task selected when the action started and refuses overlapping actions', async t => {
  t.mock.method(tasksApi, 'artifacts', async () => ({ items: [] }))
  const pending = deferred<Artifact>()
  t.mock.method(artifactsApi, 'get', () => pending.promise)
  const writes: string[][] = []
  t.mock.method(
    tasksApi,
    'setArtifactTasks',
    async (_artifact: Artifact, ids: string[]) => {
      writes.push(ids)
    }
  )
  const id = shallowRef('first')
  const mounted = mount(() => id.value)
  try {
    const saving = mounted.state.add({ id: 'artifact' } as ArtifactSearchItem)
    await mounted.state.add({ id: 'other' } as ArtifactSearchItem)
    id.value = 'second'
    await nextTick()
    pending.resolve({ taskIds: ['existing'] } as Artifact)
    await saving
    assert.deepEqual(writes, [['existing', 'first']])
    assert.equal(mounted.state.busy.value, false)
  } finally {
    mounted.unmount()
  }
})
