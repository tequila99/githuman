import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import type { DiffLineType } from '@/api/types'
import { createTouchCommentSelection } from '@/composables/use-touch-comment-selection'
import { useCardStateStore } from '@/stores/card-state-store'
import { useGutterTap } from '@/composables/use-gutter-tap'

function lines() {
  return Array.from({ length: 200 }, (_, i) => ({
    key: i + 1,
    text: `line ${i}`
  }))
}
function event(x: number, type = 'touch') {
  return {
    pointerId: 1,
    isPrimary: true,
    clientX: x,
    clientY: 0,
    pointerType: type
  } as PointerEvent
}

function touchTap(key: number, column = 'old', mode: 'diff' | 'full' = 'diff') {
  return {
    path: 'a.txt',
    mode,
    column,
    key,
    lines: lines(),
    lineTypeAt: (line: number) =>
      (line % 2 ? 'added' : 'context') as DiffLineType
  }
}

test('touch range retains its start in the store and keeps columns separate', () => {
  setActivePinia(createPinia())
  const selection = createTouchCommentSelection()
  selection.tap('unstaged:a.txt', touchTap(150))
  selection.tap('unstaged:a.txt', touchTap(10))
  assert.equal(selection.selection.value?.anchor.startKey, 10)
  assert.equal(selection.selection.value?.anchor.endKey, 150)
  assert.equal(selection.selection.value?.origin, 150)
  // The diff comment takes the type of the first line of the range, not of the last tap.
  assert.equal(selection.selection.value?.lineType, 'context')
  // The range lives in the card state store, not in a component.
  assert.equal(
    (
      useCardStateStore().get('unstaged:a.txt', 'pending:touch') as {
        origin: number
      }
    ).origin,
    150
  )
  selection.tap('unstaged:a.txt', touchTap(20, 'new'))
  assert.equal(selection.selection.value?.anchor.column, 'new')
  assert.equal(selection.selection.value?.anchor.startKey, 20)
  assert.equal(selection.selection.value?.anchor.endKey, 20)
})

test('a range in another card replaces the current one, and cancel clears the store', () => {
  setActivePinia(createPinia())
  const store = useCardStateStore()
  const selection = createTouchCommentSelection()
  selection.tap('unstaged:a.txt', touchTap(1))
  selection.tap('unstaged:b.txt', touchTap(2))
  assert.equal(selection.selection.value?.cardKey, 'unstaged:b.txt')
  assert.equal(store.get('unstaged:a.txt', 'pending:touch'), undefined)
  selection.cancel()
  assert.equal(selection.selection.value, null)
  assert.equal(store.get('unstaged:b.txt', 'pending:touch'), undefined)
})

test('confirm only asks the owner to check, and brings back an unmounted card', () => {
  setActivePinia(createPinia())
  const revealed: string[] = []
  const selection = createTouchCommentSelection({
    reveal: path => revealed.push(path)
  })
  selection.tap('unstaged:a.txt', touchTap(1))
  selection.confirm()
  assert.equal(selection.selection.value?.phase, 'confirming')
  assert.deepEqual(revealed, ['a.txt'])
  // A second press while the check runs does nothing.
  selection.confirm()
  assert.deepEqual(revealed, ['a.txt'])
  const unregister = selection.registerOwner('unstaged:a.txt')
  selection.tap('unstaged:a.txt', touchTap(3))
  assert.equal(selection.selection.value?.phase, 'selecting')
  selection.confirm()
  assert.deepEqual(revealed, ['a.txt'])
  unregister()
})

test('gutter taps do not convert scrolling, cancellation or mouse dragging into touch selection', () => {
  const selected: number[] = []
  const tap = useGutterTap<number>(key => selected.push(key))
  tap.down(event(0), 4)
  tap.up(event(3))
  assert.deepEqual(selected, [4])
  tap.down(event(0), 8)
  tap.up(event(40))
  tap.down(event(0), 9)
  tap.cancel()
  tap.up(event(0))
  tap.down(event(0, 'mouse'), 10)
  tap.up(event(0, 'mouse'))
  assert.deepEqual(selected, [4])
})
