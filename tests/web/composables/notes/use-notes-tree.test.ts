import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shallowRef } from 'vue'
import { useNotesTree } from '@/composables/notes/use-notes-tree'
import type { NoteEntry } from '../../../../src/shared/notes/types.ts'

function setup() {
  const entries = shallowRef<NoteEntry[]>([
    { path: 'empty', folder: true, tags: [], error: null },
    {
      path: 'work/sub/Alpha.md',
      folder: false,
      tags: ['one', 'two'],
      error: null
    },
    { path: 'work/Beta.md', folder: false, tags: ['one'], error: null },
    { path: 'Other.md', folder: false, tags: [], error: null }
  ])
  return { entries, tree: useNotesTree(entries) }
}

test('search opens matching ancestors and restores manual expansion after clearing', () => {
  const { tree } = setup()
  tree.visibleExpanded.value = ['empty']
  tree.query.value = '  ALPHA  '
  assert.equal(tree.filtering.value, true)
  assert.deepEqual(
    tree.nodes.value.map(node => node.id),
    ['work']
  )
  assert.deepEqual(tree.visibleExpanded.value, ['work', 'work/sub'])
  tree.visibleExpanded.value = []
  tree.nodes.value[0]!.handler!()
  assert.deepEqual(tree.visibleExpanded.value, ['work', 'work/sub'])
  tree.query.value = ''
  assert.deepEqual(tree.visibleExpanded.value, ['empty'])
  assert.equal(tree.filtering.value, false)
  assert.deepEqual(
    tree.nodes.value.map(node => node.id),
    ['empty', 'work', 'Other.md']
  )
})

test('tag modes and query combine, keeping matches expanded until every filter clears', () => {
  const { tree } = setup()
  tree.visibleExpanded.value = ['work']
  tree.filter.value = { tags: ['one', 'two'], mode: 'all' }
  assert.deepEqual(tree.visibleExpanded.value, ['work', 'work/sub'])
  assert.deepEqual(
    tree.nodes.value[0]!.children.map(node => node.id),
    ['work/sub']
  )
  tree.filter.value = { tags: ['one', 'two'], mode: 'any' }
  assert.deepEqual(
    tree.nodes.value[0]!.children.map(node => node.id),
    ['work/sub', 'work/Beta.md']
  )
  tree.query.value = 'beta'
  assert.deepEqual(tree.visibleExpanded.value, ['work'])
  tree.query.value = ''
  assert.deepEqual(tree.visibleExpanded.value, ['work', 'work/sub'])
  tree.filter.value = { tags: [], mode: 'all' }
  assert.deepEqual(tree.visibleExpanded.value, ['work'])
})

test('new matching ancestors open during filtering without changing manual state', () => {
  const { tree, entries } = setup()
  tree.query.value = 'missing'
  assert.deepEqual(tree.nodes.value, [])
  assert.deepEqual(tree.visibleExpanded.value, [])
  entries.value = [
    ...entries.value,
    { path: 'new/nested/Missing.md', folder: false, tags: [], error: null }
  ]
  assert.deepEqual(tree.visibleExpanded.value, ['new', 'new/nested'])
  tree.query.value = '   '
  assert.equal(tree.filtering.value, false)
  assert.deepEqual(tree.visibleExpanded.value, [])
})
