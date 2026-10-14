import { test } from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, shallowRef } from 'vue'
import { useNoteLinkSuggestions } from '@/composables/notes/use-note-link-suggestions'

test('suggestions support values, refs and getters with case-insensitive queries', () => {
  const scope = effectScope()
  scope.run(() => {
    const paths = shallowRef(['folder/Alpha.md', 'Beta.md'])
    const query = shallowRef<string | null>('ALP')
    const list = useNoteLinkSuggestions(() => paths.value, query)
    assert.deepEqual(list.matches.value, ['folder/Alpha.md'])
    query.value = 'beta'
    assert.deepEqual(list.matches.value, ['Beta.md'])
    paths.value = ['new/Beta.md']
    assert.deepEqual(list.matches.value, ['new/Beta.md'])
    assert.deepEqual(useNoteLinkSuggestions(['a.md'], null).matches.value, [
      'a.md'
    ])
  })
  scope.stop()
})

test('navigation wraps, resets for new query and remains valid when results shrink', () => {
  const scope = effectScope()
  scope.run(() => {
    const paths = shallowRef(['a.md', 'b.md', 'c.md'])
    const query = shallowRef<string | null>(null)
    const list = useNoteLinkSuggestions(paths, () => query.value)
    list.move(-1)
    assert.equal(list.active.value, 2)
    list.move(1)
    assert.equal(list.active.value, 0)
    list.move(-1)
    paths.value = ['a.md']
    assert.equal(list.active.value, 0)
    query.value = 'absent'
    list.move(-1)
    assert.equal(list.active.value, 0)
    assert.deepEqual(list.matches.value, [])
    query.value = null
    paths.value = ['a.md', 'b.md']
    list.move(1)
    query.value = ''
    assert.equal(list.active.value, 0)
  })
  scope.stop()
})
