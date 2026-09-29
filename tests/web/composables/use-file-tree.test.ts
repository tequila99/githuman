import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { useFileTree } from '@/composables/use-file-tree'

function treeResponse(files: string[]): Response {
  return new Response(JSON.stringify({ files }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

function failure(): Response {
  return new Response(JSON.stringify({ message: 'git exploded' }), {
    status: 500,
    headers: { 'content-type': 'application/json' }
  })
}

let originalFetch: typeof fetch

beforeEach(() => {
  originalFetch = globalThis.fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('a failed refetch keeps the previous tree and reports the error (#43)', async () => {
  const { tree, error, fetchTree } = useFileTree()
  globalThis.fetch = async () => treeResponse(['a.txt'])
  await fetchTree('WORKTREE')

  globalThis.fetch = async () => failure()
  await fetchTree('WORKTREE')

  assert.deepEqual(
    tree.value.map(node => node.path),
    ['a.txt']
  )
  assert.equal(error.value, 'git exploded')
})

test('the error survives a retry in flight and clears only on success', async () => {
  const { error, fetchTree } = useFileTree()
  globalThis.fetch = async () => failure()
  await fetchTree('WORKTREE')

  let answer!: (response: Response) => void
  globalThis.fetch = () =>
    new Promise<Response>(resolve => {
      answer = resolve
    })
  const retry = fetchTree('WORKTREE')
  assert.equal(error.value, 'git exploded', 'no blink while retrying')

  answer(treeResponse(['a.txt']))
  await retry
  assert.equal(error.value, null)
})

test('initialLoading is true only until the first answer', async () => {
  const { initialLoading, fetchTree } = useFileTree()
  globalThis.fetch = async () => failure()
  const first = fetchTree('WORKTREE')
  assert.equal(initialLoading.value, true)
  await first
  assert.equal(initialLoading.value, false)

  globalThis.fetch = async () => treeResponse([])
  const refetch = fetchTree('WORKTREE')
  assert.equal(initialLoading.value, false, 'a refetch keeps the tree shown')
  await refetch
})

test('an older answer landing late does not overwrite a newer one', async () => {
  const { tree, error, fetchTree } = useFileTree()
  const answers: Array<(response: Response) => void> = []
  globalThis.fetch = () =>
    new Promise<Response>(resolve => {
      answers.push(resolve)
    })

  const older = fetchTree('WORKTREE')
  const newer = fetchTree('WORKTREE')
  assert.equal(answers.length, 2, 'both requests are in flight')
  answers[1]!(treeResponse(['new.txt']))
  await newer
  answers[0]!(failure())
  await older

  assert.deepEqual(
    tree.value.map(node => node.path),
    ['new.txt']
  )
  assert.equal(error.value, null)
})
