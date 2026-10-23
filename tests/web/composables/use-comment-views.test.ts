import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createRenderer, defineComponent, h, nextTick, shallowRef } from 'vue'
import { createPinia } from 'pinia'
import type { CreateCommentRequest, DiffHunk } from '@/api/types'
import { CARD_STATE_KEY } from '@/composables/use-card-state'
import { COMMENT_ACTIONS_KEY } from '@/composables/use-comment-actions'
import { provideTouchCommentSelection } from '@/composables/use-touch-comment-selection'
import {
  useDiffFileTouchOwner,
  useDiffHunkComment
} from '@/composables/use-diff-hunk-comment'
import {
  useFullFileComment,
  useFullFileTouchOwner
} from '@/composables/use-full-file-comment'

// A minimal host exercises composable mount/disposal without a DOM or component templates.
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
const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function fixtureHunk(start = 1): DiffHunk {
  return {
    oldStart: start,
    oldLines: 3,
    newStart: start,
    newLines: 3,
    lines: Array.from({ length: 3 }, (_, i) => ({
      type: 'removed',
      content: `line ${i}`,
      oldLineNumber: start + i,
      newLineNumber: null
    }))
  }
}
function mount<T>(setup: () => T, owner?: () => void) {
  const events = new EventTarget()
  // The hunk views and the file-level owner unmount separately, like virtual rows and cards.
  const rowsShown = shallowRef(true)
  const ownerShown = shallowRef(true)
  const revealed: string[] = []
  const oldWindow = globalThis.window
  Object.assign(globalThis, { window: events })
  let value!: T
  let touch!: ReturnType<typeof provideTouchCommentSelection>
  let fail = false
  const calls: CreateCommentRequest[] = []
  const Child = defineComponent({
    setup() {
      value = setup()
      return () => null
    }
  })
  const Owner = defineComponent({
    setup() {
      owner?.()
      return () => null
    }
  })
  const app = renderer.createApp(
    defineComponent({
      setup() {
        touch = provideTouchCommentSelection({
          reveal: path => revealed.push(path)
        })
        // One element root: the stub renderer cannot mount a fragment.
        return () =>
          h('div', [
            rowsShown.value ? h(Child) : null,
            owner && ownerShown.value ? h(Owner) : null
          ])
      }
    })
  )
  app.use(createPinia())
  app.provide(CARD_STATE_KEY, 'test:diff')
  app.provide(COMMENT_ACTIONS_KEY, {
    async create(request) {
      calls.push(request)
      if (fail) throw new Error('send failed')
    },
    async edit() {},
    async remove() {},
    async resolve() {},
    async unresolve() {}
  })
  app.mount({})
  cleanups.push(() => {
    app.unmount()
    Object.assign(globalThis, { window: oldWindow })
  })
  return {
    value,
    touch,
    calls,
    events,
    app,
    rowsShown,
    ownerShown,
    revealed,
    setFailure: (failed: boolean) => {
      fail = failed
    }
  }
}

test('diff mouse range preserves old-side lineType and retains its form after failed send', async () => {
  const hunk = shallowRef(fixtureHunk())
  const s = mount(() =>
    useDiffHunkComment({ path: 'a.ts', hunk, commentable: true })
  )
  s.value.handleMousedown('old', 3)
  s.value.handleMouseenter('new', 2)
  s.value.handleMouseenter('old', 1)
  s.events.dispatchEvent(new Event('mouseup'))
  assert.deepEqual(s.value.pendingLineRange.value, { start: 1, end: 3 })
  assert.equal(s.value.isSelected('old', 2), true)
  assert.equal(s.value.isSelected('new', 2), false)
  s.setFailure(true)
  await assert.rejects(s.value.submitNewComment('draft'), /send failed/)
  assert.equal(s.value.showNewForm(hunk.value.lines[2]!), true)
  s.setFailure(false)
  await s.value.submitNewComment('draft')
  assert.deepEqual(s.calls[1], {
    filePath: 'a.ts',
    lineNumber: 1,
    lineNumberEnd: 3,
    lineType: 'removed',
    content: 'draft'
  })
  assert.equal(s.value.ownAnchor.value, null)
})

test('shared card anchor is ignored by other hunks and invalidated only by changed selected text', async () => {
  const source = shallowRef(fixtureHunk())
  const s = mount(
    () => ({
      first: useDiffHunkComment({
        path: 'a.ts',
        hunk: source,
        commentable: true
      }),
      other: useDiffHunkComment({
        path: 'a.ts',
        hunk: fixtureHunk(20),
        commentable: true
      })
    }),
    () =>
      useDiffFileTouchOwner({
        hunks: () => [source.value, fixtureHunk(20)],
        fresh: true,
        rejected: () => {}
      })
  )
  s.value.first.handleTap('old', 1)
  s.value.first.handleTap('old', 3)
  s.touch.confirm()
  await nextTick()
  assert.ok(s.value.first.ownAnchor.value)
  assert.equal(s.value.other.ownAnchor.value, null)
  source.value = {
    ...source.value,
    lines: source.value.lines.map((line, i) =>
      i === 1 ? { ...line, content: 'changed' } : line
    )
  }
  await nextTick()
  assert.equal(s.value.first.ownAnchor.value, null)
})

test('touch range survives unmounted hunks and a new column starts a new range', async () => {
  const enabled = shallowRef(true)
  const source = shallowRef<DiffHunk>({
    oldStart: 1,
    oldLines: 2,
    newStart: 1,
    newLines: 2,
    lines: [1, 2].map(key => ({
      type: 'context',
      content: `line ${key}`,
      oldLineNumber: key,
      newLineNumber: key
    }))
  })
  const s = mount(() =>
    useDiffHunkComment({
      path: () => 'a.ts',
      hunk: source,
      commentable: () => enabled.value
    })
  )
  s.value.handleTap('old', 1)
  s.value.handleTap('new', 2)
  assert.equal(s.touch.selection.value?.anchor.column, 'new')
  assert.equal(s.touch.selection.value?.anchor.startKey, 2)
  // A hunk that is not commentable ignores taps and shows no touch range.
  enabled.value = false
  s.value.handleTap('new', 1)
  assert.equal(s.touch.selection.value?.anchor.startKey, 2)
  assert.equal(s.value.isSelected('new', 2), false)
  enabled.value = true
  // The virtual list unmounts the hunk and mounts it again: the start of the range stays.
  s.rowsShown.value = false
  await nextTick()
  assert.equal(s.touch.selection.value?.origin, 2)
  s.rowsShown.value = true
  await nextTick()
  s.value.handleTap('new', 1)
  assert.deepEqual(
    [
      s.touch.selection.value?.anchor.startKey,
      s.touch.selection.value?.anchor.endKey
    ],
    [1, 2]
  )
  assert.equal(s.value.isSelected('new', 1), true)
})

test('confirm creates no form for lines that changed while the card was unmounted', async () => {
  const hunks = shallowRef([fixtureHunk()])
  const notices: string[] = []
  const s = mount(
    () =>
      useDiffHunkComment({
        path: 'a.ts',
        hunk: () => hunks.value[0]!,
        commentable: true
      }),
    () =>
      useDiffFileTouchOwner({
        hunks,
        fresh: true,
        rejected: () => notices.push('changed')
      })
  )
  s.value.handleTap('old', 1)
  s.value.handleTap('old', 2)
  // The whole card leaves the window, and an edit deletes the selected hunk.
  s.rowsShown.value = false
  s.ownerShown.value = false
  await nextTick()
  hunks.value = [fixtureHunk(40)]
  s.touch.confirm()
  assert.deepEqual(s.revealed, ['a.ts'])
  assert.equal(s.touch.selection.value?.phase, 'confirming')
  s.ownerShown.value = true
  s.rowsShown.value = true
  await nextTick()
  assert.equal(s.touch.selection.value, null)
  assert.deepEqual(notices, ['changed'])
  assert.equal(s.value.ownAnchor.value, null)
})

test('an unchanged range confirms after a remount, only on fresh hunks, with the type of its start', async () => {
  const fresh = shallowRef(false)
  const hunk = shallowRef<DiffHunk>({
    oldStart: 1,
    oldLines: 2,
    newStart: 1,
    newLines: 3,
    lines: [
      { type: 'context', content: 'a', oldLineNumber: 1, newLineNumber: 1 },
      { type: 'added', content: 'b', oldLineNumber: null, newLineNumber: 2 },
      { type: 'context', content: 'c', oldLineNumber: 2, newLineNumber: 3 }
    ]
  })
  const s = mount(
    () => useDiffHunkComment({ path: 'a.ts', hunk, commentable: true }),
    () =>
      useDiffFileTouchOwner({
        hunks: () => [hunk.value],
        fresh,
        rejected: () => {}
      })
  )
  s.value.handleTap('new', 3)
  s.value.handleTap('new', 2)
  s.rowsShown.value = false
  await nextTick()
  s.touch.confirm()
  await nextTick()
  // Stale hunks during a refetch do not confirm the range.
  assert.equal(s.touch.selection.value?.phase, 'confirming')
  // An edit above the range moves the hunk. The text of the range is the same.
  hunk.value = { ...hunk.value, oldStart: 5, newStart: 5 }
  fresh.value = true
  await nextTick()
  assert.equal(s.touch.selection.value, null)
  s.rowsShown.value = true
  await nextTick()
  assert.deepEqual(s.value.pendingLineRange.value, { start: 2, end: 3 })
  await s.value.submitNewComment('note')
  assert.equal(s.calls[0]?.lineType, 'added')
})

test('full-file comments use WORKTREE numbering and independent full/diff slots', async () => {
  const lines = shallowRef(['first', 'second', 'third'])
  const s = mount(
    () => ({
      full: useFullFileComment({
        path: () => 'a.ts',
        lines: () => lines.value,
        commentable: true
      }),
      diff: useDiffHunkComment({
        path: 'a.ts',
        hunk: fixtureHunk(),
        commentable: true
      })
    }),
    () => useFullFileTouchOwner({ lines, fresh: true, rejected: () => {} })
  )
  s.value.full.handleTap('full', 1)
  s.value.full.handleTap('full', 3)
  s.touch.confirm()
  await nextTick()
  assert.deepEqual(s.value.full.pendingLineRange.value, { start: 1, end: 3 })
  assert.equal(s.value.diff.ownAnchor.value, null)
  s.setFailure(true)
  await assert.rejects(s.value.full.submitNewComment('full draft'))
  assert.ok(s.value.full.ownAnchor.value)
  s.setFailure(false)
  await s.value.full.submitNewComment('full draft')
  assert.deepEqual(s.calls[1], {
    filePath: 'a.ts',
    lineType: null,
    lineNumber: 1,
    lineNumberEnd: 3,
    content: 'full draft'
  })
  assert.equal(s.value.full.ownAnchor.value, null)
})
