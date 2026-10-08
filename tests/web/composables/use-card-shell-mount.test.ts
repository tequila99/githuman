import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, nextTick, shallowReactive } from 'vue'
import {
  useCardShellMount,
  CARD_MOUNT_MARGIN_PX,
  type CardShellOptions
} from '@/composables/use-card-shell-mount'
import { resetMountQueue } from '@/utils/mount-queue'
import {
  installSegmentObservers,
  TestIntersectionObserver,
  TestResizeObserver
} from '../helpers/segment-environment'

let frames: Array<() => void>, restore: () => void
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
  for (const callback of frames.splice(0)) callback()
}
function setup(
  owner: object,
  root = { clientWidth: 800 } as Element,
  extra: Partial<CardShellOptions> = {}
) {
  const options = shallowReactive<CardShellOptions>({
    minHeight: 100,
    owner,
    version: 'diff',
    cacheHeight: true,
    keep: false,
    ...extra
  })
  const el = { offsetHeight: 900 } as HTMLElement
  const scope = effectScope()
  const mount = scope.run(() =>
    useCardShellMount(
      options,
      () => el,
      () => root
    )
  )!
  cleanups.push(() => scope.stop())
  function near(value: boolean) {
    TestIntersectionObserver.all
      .find(observer => observer.targets.has(el))!
      .deliver(el, value)
  }
  return { options, root, el, mount, scope, near }
}

test('reserves a matching width before mount, but cannot reuse a narrower-root measurement', () => {
  const owner = {},
    first = setup(owner)
  first.mount.start()
  first.near(true)
  frame()
  first.scope.stop()
  const same = setup(owner)
  assert.equal(same.mount.height.value, 900)
  const narrow = setup(owner, { clientWidth: 400 } as Element)
  assert.equal(narrow.mount.height.value, 100)
})

test('owner, mode and cache policy invalidate navigation hints on live shells', async () => {
  const owner = {},
    first = setup(owner)
  first.mount.start()
  first.near(true)
  frame()
  first.scope.stop()
  const shell = setup(owner)
  assert.equal(shell.mount.height.value, 900)
  shell.options.cacheHeight = false
  shell.options.version = 'full'
  await nextTick()
  assert.equal(shell.mount.height.value, 100)
  shell.options.cacheHeight = true
  shell.options.version = 'diff'
  await nextTick()
  assert.equal(shell.mount.height.value, 900)
  shell.options.owner = {}
  await nextTick()
  assert.equal(shell.mount.height.value, 100)
})

test('root resize invalidates a live reserve and all shells share observers', async () => {
  const root = { clientWidth: 800 } as Element,
    owner = {}
  const first = setup(owner, root)
  first.mount.start()
  first.near(true)
  frame()
  first.near(false)
  assert.equal(first.mount.height.value, 900)
  const second = setup({}, root)
  second.mount.start()
  assert.equal(TestIntersectionObserver.all.length, 2)
  assert.equal(
    TestIntersectionObserver.all[0]!.options?.rootMargin,
    `${CARD_MOUNT_MARGIN_PX}px 0px`
  )
  assert.equal(TestResizeObserver.all.length, 1)
  Object.assign(root, { clientWidth: 400 })
  TestResizeObserver.all[0]!.deliver()
  await nextTick()
  assert.equal(first.mount.height.value, 100)
  first.scope.stop()
  assert.equal(TestResizeObserver.all[0]!.targets.size, 1)
  second.scope.stop()
  assert.equal(TestResizeObserver.all[0]!.targets.size, 0)
})

test('leaving before activation cancels the heavy card job', () => {
  const shell = setup({})
  shell.mount.start()
  shell.near(true)
  shell.near(false)
  frame()
  assert.equal(shell.mount.mounted.value, false)
  shell.near(true)
  shell.scope.stop()
  frame()
  assert.equal(shell.mount.mounted.value, false)
})
