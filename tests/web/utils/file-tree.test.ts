import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTree, flattenTree, treeIndentPx } from '@/utils/file-tree'

const PATHS = ['README.md', 'src/web/a.ts', 'src/web/b.ts', 'src/z.ts']

test('folders come first and a folder with one folder joins it in one row (#76)', () => {
  const rows = flattenTree(buildTree(PATHS, new Set()), new Set(), false)
  assert.deepEqual(
    rows.map(row => [row.kind, row.name, row.depth]),
    [
      ['folder', 'src', 0],
      ['folder', 'web', 1],
      ['file', 'a.ts', 2],
      ['file', 'b.ts', 2],
      ['file', 'z.ts', 1],
      ['file', 'README.md', 0]
    ]
  )
  const chain = flattenTree(
    buildTree(['a/b/c/d.ts'], new Set()),
    new Set(),
    false
  )
  assert.deepEqual(chain[0], {
    kind: 'folder',
    path: 'a/b/c',
    paths: ['a', 'a/b', 'a/b/c'],
    name: 'a/b/c',
    depth: 0,
    expanded: true
  })
})

test('any closed folder of a chain closes its row, unless collapse is ignored (#76)', () => {
  const tree = buildTree(['a/b/c/d.ts'], new Set())
  const closed = flattenTree(tree, new Set(['a/b']), false)
  assert.deepEqual(
    closed.map(row => row.path),
    ['a/b/c']
  )
  assert.equal(closed[0]?.kind === 'folder' && closed[0].expanded, false)
  assert.equal(flattenTree(tree, new Set(['a/b']), true).length, 2)
})

test('tree indent puts a file past the chevron of its folder', () => {
  assert.equal(treeIndentPx(0, false), 8)
  assert.equal(treeIndentPx(2, false), 32)
  assert.equal(treeIndentPx(1, true), 40)
})

test('buildTree keeps a file and a folder that share a path (#76)', () => {
  const tree = buildTree(['foo/bar.ts', 'foo'], new Set())
  assert.deepEqual(
    tree.map(node => [node.type, node.path]),
    [
      ['directory', 'foo'],
      ['file', 'foo']
    ]
  )
})
