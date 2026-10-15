import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextTick, shallowRef } from 'vue'
import { useNoteEditorPosition } from '@/composables/notes/use-note-editor-position'

test('source replacements preserve scrolling and shift the selection past edited URLs', async () => {
  const input = {
    selectionStart: 12,
    selectionEnd: 15,
    scrollTop: 70,
    setSelectionRange(start: number, end: number) {
      this.selectionStart = start
      this.selectionEnd = end
    }
  }
  const body = { scrollTop: 90, querySelector: () => input }
  let text = ''
  let remounts = 0
  const position = useNoteEditorPosition(
    body as unknown as HTMLElement,
    'source',
    value => {
      text = value
      input.scrollTop = 0
      body.scrollTop = 0
    },
    () => remounts++
  )
  position.apply('updated', [{ start: 0, end: 10, value: 'short' }])
  await nextTick()
  assert.equal(text, 'updated')
  assert.deepEqual([input.selectionStart, input.selectionEnd], [7, 10])
  assert.equal(input.scrollTop, 70)
  assert.equal(body.scrollTop, 90)
  assert.equal(remounts, 0)
})

test('visual replacements restore the current body scroll once the new editor is ready', async () => {
  const body = shallowRef({ scrollTop: 240, querySelector: () => null })
  let remounts = 0
  const position = useNoteEditorPosition(
    () => body.value as unknown as HTMLElement,
    'visual',
    () => {},
    () => remounts++
  )
  position.apply('updated', [])
  await nextTick()
  body.value = { scrollTop: 0, querySelector: () => null }
  position.ready()
  await nextTick()
  assert.equal(remounts, 1)
  assert.equal(body.value.scrollTop, 240)
  body.value.scrollTop = 120
  position.ready()
  await nextTick()
  assert.equal(body.value.scrollTop, 120)
})
