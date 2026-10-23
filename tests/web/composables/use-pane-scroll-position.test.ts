import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, nextTick, shallowRef } from 'vue'
import { usePaneScrollPosition } from '@/composables/use-pane-scroll-position'
import type { followScrollTarget } from '@/utils/follow-scroll-target'

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

/** A fake element with a fixed box and optional children for `querySelectorAll`. */
function box(
  top: number,
  height: number,
  attributes: Record<string, string> = {},
  children: Element[] = []
): Element {
  return {
    getBoundingClientRect: () => ({ top, bottom: top + height, height }),
    getAttribute: (name: string) => attributes[name] ?? null,
    dataset: { filePath: attributes['data-file-path'] },
    querySelector: () => null,
    querySelectorAll: (selector: string) =>
      children.filter(child =>
        selector === '[data-line-key]'
          ? child.getAttribute('data-line-key') !== null
          : child.getAttribute('data-file-path') !== null
      )
  } as unknown as Element
}

function setup() {
  // The first card starts above the window. Its third line is the first visible one.
  const lines = [0, 1, 2, 3].map(i =>
    box(-60 + i * 20, 20, { 'data-line-key': `${i}:${i}` })
  )
  const card = box(-60, 80, { 'data-file-path': 'a.ts' }, lines)
  const root = Object.assign(box(0, 400, {}, [card]), {
    clientWidth: 300,
    clientHeight: 400,
    clientTop: 0
  })
  const active = shallowRef(true)
  const ready = shallowRef(true)
  const rootRef = shallowRef<Element | null>(root)
  const request = shallowRef<unknown>(null)
  const follows: Array<{ offset: number | undefined; target: Element | null }> =
    []
  let stopped = 0
  const follow: typeof followScrollTarget = options => {
    follows.push({ offset: options.offset, target: options.target() })
    return () => stopped++
  }
  const scope = effectScope()
  scope.run(() =>
    usePaneScrollPosition({
      active,
      ready,
      root: rootRef,
      request,
      follow
    })
  )
  cleanups.push(() => scope.stop())
  return {
    lines,
    active,
    ready,
    rootRef,
    request,
    follows,
    stopped: () => stopped
  }
}

async function hideAndShow(s: ReturnType<typeof setup>) {
  s.active.value = false
  s.ready.value = false
  await nextTick()
  s.active.value = true
  s.ready.value = true
  await nextTick()
}

test('hiding the pane saves the first visible line and showing restores it', async () => {
  const s = setup()
  await hideAndShow(s)
  assert.equal(s.follows.length, 1)
  // Line 3 of the card is the first line below the top of the window, at 0px.
  assert.equal(s.follows[0]?.target, s.lines[3])
  assert.equal(s.follows[0]?.offset, 0)
})

test('a new navigation request or a new root discards the saved position', async () => {
  const s = setup()
  s.active.value = false
  s.ready.value = false
  await nextTick()
  s.request.value = { seq: 1 }
  s.active.value = true
  s.ready.value = true
  await nextTick()
  assert.equal(s.follows.length, 0)

  const other = setup()
  other.active.value = false
  other.ready.value = false
  await nextTick()
  // Another scroll element, for example after the source changes.
  other.rootRef.value = Object.create(other.rootRef.value) as Element
  other.active.value = true
  other.ready.value = true
  await nextTick()
  assert.equal(other.follows.length, 0)
})

test('the saved position is used once', async () => {
  const s = setup()
  await hideAndShow(s)
  // Geometry changes while the pane stays visible: no new snapshot, so no second restore.
  s.ready.value = false
  await nextTick()
  s.ready.value = true
  await nextTick()
  assert.equal(s.follows.length, 1)
  assert.ok(s.stopped() >= 1)
})
