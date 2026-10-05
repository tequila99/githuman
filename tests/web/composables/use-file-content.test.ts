import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isProxy } from 'vue'
import { useFileContent } from '@/composables/use-file-content'

let originalFetch: typeof fetch
let answers: ((lines: string[]) => void)[] = []

beforeEach(() => {
  originalFetch = globalThis.fetch
  answers = []
  globalThis.fetch = async () =>
    new Promise<Response>(resolve => {
      answers.push(lines =>
        resolve(
          new Response(JSON.stringify({ lines, isBinary: false }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        )
      )
    })
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

async function settle() {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('useFileContent cache', () => {
  it('shows the last read of a file at once in a new instance, then refreshes it', async () => {
    const first = useFileContent({ cache: true })
    const firstRequest = first.fetchContent('cached-a.ts', 'WORKTREE')
    answers[0]!(['one', 'two'])
    await firstRequest

    const second = useFileContent({ cache: true })
    const secondRequest = second.fetchContent('cached-a.ts', 'WORKTREE')
    assert.deepEqual(second.lines.value, ['one', 'two'])
    assert.equal(second.loading.value, true)

    answers[1]!(['one', 'two', 'three'])
    await secondRequest
    await settle()
    assert.deepEqual(second.lines.value, ['one', 'two', 'three'])
    assert.equal(second.loading.value, false)
  })

  it('starts empty without the cache option', async () => {
    const first = useFileContent({ cache: true })
    const request = first.fetchContent('cached-b.ts', 'WORKTREE')
    answers[0]!(['x'])
    await request

    const plain = useFileContent()
    void plain.fetchContent('cached-b.ts', 'WORKTREE')
    assert.deepEqual(plain.lines.value, [])
  })

  it('keys the cache by ref and path', async () => {
    const first = useFileContent({ cache: true })
    const request = first.fetchContent('cached-c.ts', 'WORKTREE')
    answers[0]!(['worktree'])
    await request

    const other = useFileContent({ cache: true })
    void other.fetchContent('cached-c.ts', 'HEAD')
    assert.deepEqual(other.lines.value, [])
  })
})

describe('useFileContent lines', () => {
  it('holds a plain array, not a reactive proxy', async () => {
    const content = useFileContent()
    const request = content.fetchContent('plain.ts', 'WORKTREE')
    answers[0]!(['a'])
    await request
    assert.equal(isProxy(content.lines.value), false)
  })

  it('keeps the same array when a refetch gives the same text', async () => {
    const content = useFileContent({ cache: true })
    const first = content.fetchContent('same.ts', 'WORKTREE')
    answers[0]!(['one', 'two'])
    await first
    const before = content.lines.value

    const second = content.fetchContent('same.ts', 'WORKTREE')
    answers[1]!(['one', 'two'])
    await second
    assert.equal(content.lines.value, before)

    // A new instance gets the same array from the cache.
    const other = useFileContent({ cache: true })
    void other.fetchContent('same.ts', 'WORKTREE')
    assert.equal(other.lines.value, before)
  })

  it('takes a new array when the text changes', async () => {
    const content = useFileContent()
    const first = content.fetchContent('changed.ts', 'WORKTREE')
    answers[0]!(['one'])
    await first
    const before = content.lines.value

    const second = content.fetchContent('changed.ts', 'WORKTREE')
    answers[1]!(['one', 'two'])
    await second
    assert.notEqual(content.lines.value, before)
    assert.deepEqual(content.lines.value, ['one', 'two'])
  })

  it('clears an old error when a refetch gives the same text', async () => {
    const content = useFileContent()
    const first = content.fetchContent('error.ts', 'WORKTREE')
    answers[0]!(['one'])
    await first

    globalThis.fetch = async () => {
      throw new Error('offline')
    }
    await content.fetchContent('error.ts', 'WORKTREE')
    assert.equal(content.error.value, 'offline')

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ lines: ['one'], isBinary: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    await content.fetchContent('error.ts', 'WORKTREE')
    assert.equal(content.error.value, null)
  })
})
