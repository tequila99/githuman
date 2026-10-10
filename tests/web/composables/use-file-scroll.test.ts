import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, nextTick, shallowRef } from 'vue'
import {
  useFileScroll,
  type VirtualScrollApi
} from '@/composables/use-file-scroll'
import type { ScrollRequest } from '@/stores/file-explorer-store'
import type { followScrollTarget } from '@/utils/follow-scroll-target'

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})
async function flush() {
  await nextTick()
  await nextTick()
}
function setup(ready = true) {
  const request = shallowRef<ScrollRequest | null>({
    path: 'a.ts',
    index: 4,
    seq: 1
  })
  const calls: Array<[number, string | undefined]> = []
  const api: VirtualScrollApi = {
    reset: () => {},
    scrollTo: (index, edge) => calls.push([index, edge])
  }
  const list = shallowRef<VirtualScrollApi | null>(ready ? api : null)
  const rootElement = {} as Element
  const root = shallowRef<Element | null>(ready ? rootElement : null)
  const input = new EventTarget()
  let followers = 0,
    stopped = 0
  let target: (() => Element | null) | undefined
  const follow: typeof followScrollTarget = options => {
    target = options.target
    followers++
    return () => {
      stopped++
    }
  }
  const scope = effectScope()
  scope.run(() =>
    useFileScroll({ request, list, root, inputTarget: input, follow })
  )
  cleanups.push(() => scope.stop())
  return {
    request,
    list,
    api,
    root,
    rootElement,
    input,
    scope,
    calls,
    counts: () => ({ followers, stopped }),
    target: () => target?.()
  }
}

test('starts when request, list and root become ready', async () => {
  const s = setup(false)
  await flush()
  assert.deepEqual(s.calls, [])
  s.list.value = s.api
  await flush()
  assert.deepEqual(s.calls, [])
  s.root.value = s.rootElement
  await flush()
  assert.deepEqual(s.calls, [[4, 'start']])
  assert.equal(s.counts().followers, 1)
})

test('input before list readiness permanently cancels that request, but a new click starts', async () => {
  const s = setup(false)
  s.input.dispatchEvent(new Event('wheel'))
  s.list.value = s.api
  s.root.value = s.rootElement
  await flush()
  assert.deepEqual(s.calls, [])
  s.request.value = { path: 'a.ts', index: 4, seq: 2 }
  await flush()
  assert.deepEqual(s.calls, [[4, 'start']])
})

test('input and teardown cancel a pending nextTick before scrollTo', async () => {
  const s = setup()
  s.input.dispatchEvent(new Event('keydown'))
  await flush()
  assert.deepEqual(s.calls, [])
  const other = setup()
  other.scope.stop()
  await flush()
  assert.deepEqual(other.calls, [])
})

test('a newer request cancels the old follower; deliberate input releases the new one', async () => {
  const s = setup()
  await flush()
  s.request.value = { path: 'b.ts', index: 20, seq: 2 }
  await flush()
  assert.deepEqual(s.calls, [
    [4, 'start'],
    [20, 'start']
  ])
  assert.deepEqual(s.counts(), { followers: 2, stopped: 1 })
  s.input.dispatchEvent(new Event('pointerdown'))
  assert.deepEqual(s.counts(), { followers: 2, stopped: 2 })
  s.scope.stop()
  s.input.dispatchEvent(new Event('touchstart'))
  assert.equal(s.counts().stopped, 2)
})

test('changing root or source cancels rather than resumes the old operation', async () => {
  const s = setup()
  await flush()
  s.root.value = null
  await flush()
  s.root.value = s.rootElement
  await flush()
  assert.deepEqual(s.calls, [[4, 'start']])
  assert.equal(s.counts().stopped, 1)
  s.request.value = { path: 'b.ts', index: 10, seq: 2 }
  await flush()
  s.request.value = null
  await flush()
  assert.deepEqual(s.counts(), { followers: 2, stopped: 2 })
})

test('the follower aligns the card itself, not its sticky header (#77)', async () => {
  const card = { id: 'diff-file-a.ts' } as Element
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      getElementById: (id: string) => (id === card.id ? card : null)
    }
  })
  cleanups.push(() => {
    if (previous) {
      Object.defineProperty(globalThis, 'document', previous)
    } else {
      Reflect.deleteProperty(globalThis, 'document')
    }
  })
  const s = setup()
  await flush()
  assert.equal(s.target(), card)
})
