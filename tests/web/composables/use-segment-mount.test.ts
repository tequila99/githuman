import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, nextTick, shallowReactive } from 'vue'
import {
  useSegmentMount,
  type SegmentMountOptions
} from '@/composables/use-segment-mount'
import { resetMountQueue } from '@/utils/mount-queue'
import { rememberSegmentHeight, segmentHeight } from '@/utils/segment-heights'
import {
  installSegmentObservers,
  TestIntersectionObserver,
  TestResizeObserver
} from '../helpers/segment-environment'

let frames: Array<() => void>
let restore: () => void
const cleanups: Array<() => void> = []
beforeEach(() => {
  frames = []
  resetMountQueue(callback => frames.push(callback))
  restore = installSegmentObservers()
})
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  restore()
})
function frame() {
  const callbacks = frames.splice(0)
  for (const callback of callbacks) callback()
}
function setup(initial: Partial<SegmentMountOptions> = {}, rootPresent = true) {
  const options = shallowReactive<SegmentMountOptions>({
    minHeight: 500,
    cost: 35,
    ...initial
  })
  const el = { offsetHeight: 900 } as HTMLElement & { offsetHeight: number }
  const root = { clientWidth: 800 } as Element & { clientWidth: number }
  const scope = effectScope()
  const state = scope.run(() => useSegmentMount(options, () => el))!
  state.start(rootPresent ? root : null)
  cleanups.push(() => scope.stop())
  const near = (value: boolean) =>
    TestIntersectionObserver.all
      .find(observer => observer.targets.has(el))!
      .deliver(el, value)
  const visible = (value: boolean) =>
    TestIntersectionObserver.all
      .filter(observer => observer.targets.has(el))[1]!
      .deliver(el, value)
  return { options, el, root, state, scope, near, visible }
}

test('near rows wait for the queue; leaving cancels without losing observation', async () => {
  const s = setup()
  s.near(true)
  assert.equal(s.state.mounted.value, false)
  s.near(false)
  frame()
  assert.equal(s.state.mounted.value, false)
  s.near(true)
  frame()
  await nextTick()
  assert.equal(s.state.mounted.value, true)
  s.near(false)
  assert.equal(s.state.height.value, 900)
  assert.equal(s.state.mounted.value, false)
})

test('a new owner/version replaces measured height while the component survives', async () => {
  const s = setup({
    heightOwner: {},
    heightKey: 'rows:0',
    heightVersion: 'one',
    cacheHeight: true
  })
  s.near(true)
  frame()
  s.near(false)
  assert.equal(s.state.height.value, 900)
  s.options.heightOwner = {}
  s.options.minHeight = 100
  await nextTick()
  assert.equal(s.state.height.value, 100)
  s.options.heightVersion = 'two'
  s.options.minHeight = 80
  await nextTick()
  assert.equal(s.state.height.value, 80)
})

test('a cached measurement equal to the estimate remains measured', async () => {
  const owner = {}
  rememberSegmentHeight(owner, 'rows:0', 'one', 500)
  const s = setup({
    heightOwner: owner,
    heightKey: 'rows:0',
    heightVersion: 'one',
    cacheHeight: true
  })
  s.options.minHeight = 100
  await nextTick()
  assert.equal(s.state.height.value, 500)
})

test('disabled caching ignores stale heights and cannot overwrite the leaf cache', () => {
  const owner = {}
  rememberSegmentHeight(owner, 'hunk', 'one', 1200)
  const s = setup({
    heightOwner: owner,
    heightKey: 'hunk',
    heightVersion: 'one',
    cacheHeight: false
  })
  assert.equal(s.state.height.value, 500)
  s.near(true)
  frame()
  s.near(false)
  assert.equal(s.state.height.value, 900)
  assert.equal(segmentHeight(owner, 'hunk', 'one'), 1200)
})

test('width invalidation applies to wrapped rows but not fixed code height', async () => {
  const s = setup({ widthSensitive: true })
  s.near(true)
  frame()
  s.near(false)
  s.root.clientWidth = 400
  TestResizeObserver.all[0]!.deliver()
  assert.equal(s.state.height.value, 500)
  s.options.widthSensitive = false
  await nextTick()
  s.near(true)
  frame()
  s.near(false)
  s.root.clientWidth = 200
  TestResizeObserver.all[0]!.deliver()
  assert.equal(s.state.height.value, 900)
})

test('keep pins mounted rows and releasing it outside near unmounts the form', async () => {
  const s = setup()
  s.near(true)
  frame()
  s.options.keep = true
  await nextTick()
  s.near(false)
  assert.equal(s.state.mounted.value, true)
  s.options.keep = false
  await nextTick()
  assert.equal(s.state.mounted.value, false)
  assert.equal(s.state.height.value, 900)
})

test('initial keep does not mount distant rows', () => {
  const s = setup({ keep: true })
  s.near(false)
  frame()
  assert.equal(s.state.mounted.value, false)
  assert.equal(s.state.height.value, 500)
})

test('changed pending cost uses the new budget and retains visible priority', async () => {
  const a = setup(),
    b = setup()
  a.near(true)
  b.near(true)
  b.visible(true)
  a.options.cost = 10
  b.options.cost = 10
  await nextTick()
  frame()
  assert.equal(a.state.mounted.value, true)
  assert.equal(b.state.mounted.value, true)
})

test('a version change keeps exactly one pending mount and unmount cancels it', async () => {
  const s = setup({ heightVersion: 'one' })
  s.near(true)
  s.options.heightVersion = 'two'
  await nextTick()
  s.scope.stop()
  frame()
  assert.equal(s.state.mounted.value, false)
  assert.equal(TestIntersectionObserver.all[0]!.targets.size, 0)
  assert.equal(TestResizeObserver.all[0]!.targets.size, 0)
})

test('destroying a mounted leaf saves its real height for reconstruction', () => {
  const owner = {}
  const options = {
    heightOwner: owner,
    heightKey: 'rows:0',
    heightVersion: 'one',
    cacheHeight: true
  }
  const s = setup(options)
  s.near(true)
  frame()
  s.scope.stop()
  const next = setup(options)
  assert.equal(next.state.height.value, 900)
})

test('nonqueued hunks mount immediately when near but never cache an aggregate', () => {
  const owner = {}
  const s = setup({
    queued: false,
    heightOwner: owner,
    heightKey: 'hunk',
    heightVersion: 'one'
  })
  s.near(true)
  assert.equal(s.state.mounted.value, true)
  assert.equal(frames.length, 0)
  s.near(false)
  s.scope.stop()
  assert.equal(segmentHeight(owner, 'hunk', 'one'), undefined)
})

test('immediate content and content without a root stay mounted', async () => {
  for (const immediate of [true, false]) {
    const s = setup({ immediate }, immediate)
    assert.equal(s.state.mounted.value, true)
    assert.equal(TestIntersectionObserver.all.length, 0)
    s.options.keep = false
    s.options.minHeight = 100
    await nextTick()
    assert.equal(s.state.mounted.value, true)
  }
})

test('a hunk aggregate never enters the cache in either parent/child exit order', () => {
  for (const parentFirst of [true, false]) {
    const owner = {}
    const parent = setup({
      heightOwner: owner,
      heightKey: 'hunk',
      heightVersion: 'v',
      queued: false
    })
    const child = setup({
      heightOwner: owner,
      heightKey: 'rows:0',
      heightVersion: 'v',
      cacheHeight: true
    })
    Object.defineProperty(parent.el, 'offsetHeight', {
      get: () =>
        child.state.mounted.value
          ? child.el.offsetHeight
          : child.state.height.value
    })
    parent.near(true)
    child.near(true)
    frame()
    for (const item of parentFirst ? [parent, child] : [child, parent])
      item.near(false)
    assert.equal(segmentHeight(owner, 'hunk', 'v'), undefined)
    assert.equal(segmentHeight(owner, 'rows:0', 'v'), 900)
    parent.scope.stop()
    child.scope.stop()
  }
})

test('destroying a hunk before child mount cancels the pending leaf job', () => {
  const owner = {}
  const parent = setup({
    heightOwner: owner,
    heightKey: 'hunk',
    heightVersion: 'v',
    queued: false
  })
  const child = setup({
    heightOwner: owner,
    heightKey: 'rows:0',
    heightVersion: 'v',
    cacheHeight: true
  })
  parent.near(true)
  child.near(true)
  parent.scope.stop()
  child.scope.stop()
  frame()
  assert.equal(child.state.mounted.value, false)
  assert.equal(segmentHeight(owner, 'hunk', 'v'), undefined)
  assert.equal(segmentHeight(owner, 'rows:0', 'v'), undefined)
})

test('destroying a noncached segment does not read an unused DOM measurement', () => {
  const s = setup({ immediate: true })
  Object.defineProperty(s.el, 'offsetHeight', {
    get: () => {
      throw new Error('unused layout read')
    }
  })
  s.scope.stop()
})
