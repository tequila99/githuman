import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, nextTick, ref } from 'vue'
import { useFileHighlight } from '@/composables/use-file-highlight'
import {
  cachedHighlight,
  highlightFileCached
} from '@/composables/use-syntax-highlighting'
import type { DiffFile } from '@/api/types'

// Time budget for the first tokenizing: it loads the highlighter.
const WAIT_TIMEOUT_MS = 10_000

function makeFile(path: string, hunkSizes: number[]): DiffFile {
  return {
    oldPath: path,
    newPath: path,
    status: 'modified',
    additions: 0,
    deletions: 0,
    isBinary: false,
    hunks: hunkSizes.map((size, hunkIndex) => ({
      oldStart: 1,
      oldLines: size,
      newStart: 1,
      newLines: size,
      lines: Array.from({ length: size }, (_, i) => ({
        type: 'context' as const,
        content: `const v${hunkIndex}_${i} = ${i}`,
        oldLineNumber: i + 1,
        newLineNumber: i + 1
      }))
    }))
  }
}

/** Waits until the highlight queue has run every job that is in it now. */
async function drainQueue() {
  await highlightFileCached(makeFile('queue-end.ts', [1]))
}

async function waitFor(condition: () => boolean) {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > WAIT_TIMEOUT_MS) throw new Error('timeout')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

describe('useFileHighlight', () => {
  it('cuts the tokens into one slice per hunk', async () => {
    const file = ref(makeFile('a.ts', [2, 3]))
    const scope = effectScope()
    const { hunkTokens } = scope.run(() => useFileHighlight(file, true))!

    assert.equal(hunkTokens.value, null)
    await waitFor(() => hunkTokens.value !== null)

    assert.deepEqual(
      hunkTokens.value!.map(slice => slice.length),
      [2, 3]
    )
    scope.stop()
  })

  it('stays null for a language without highlighting', async () => {
    const file = ref(makeFile('notes.unknown', [2]))
    const scope = effectScope()
    const { hunkTokens } = scope.run(() => useFileHighlight(file, true))!

    await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(hunkTokens.value, null)
    scope.stop()
  })

  it('does no work while disabled and starts when enabled', async () => {
    const file = ref(makeFile('b.ts', [1]))
    const enabled = ref(false)
    const scope = effectScope()
    const { hunkTokens } = scope.run(() => useFileHighlight(file, enabled))!

    await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(hunkTokens.value, null)

    enabled.value = true
    await waitFor(() => hunkTokens.value !== null)
    assert.equal(hunkTokens.value!.length, 1)
    scope.stop()
  })

  it('drops the tokens when the file changes', async () => {
    const file = ref(makeFile('c.ts', [1]))
    const scope = effectScope()
    const { hunkTokens } = scope.run(() => useFileHighlight(file, true))!
    await waitFor(() => hunkTokens.value !== null)

    file.value = makeFile('notes.unknown', [1])
    await nextTick()
    assert.equal(hunkTokens.value, null)
    scope.stop()
  })

  it('ignores a result that arrives after the file changed', async () => {
    const file = ref(makeFile('d.ts', [1]))
    const scope = effectScope()
    const { hunkTokens } = scope.run(() => useFileHighlight(file, true))!

    // The first request is still in the queue when the file changes.
    file.value = makeFile('e.ts', [2, 2])
    await waitFor(() => hunkTokens.value !== null)

    assert.deepEqual(
      hunkTokens.value!.map(slice => slice.length),
      [2, 2]
    )
    scope.stop()
  })

  it('accepts a getter for both inputs', async () => {
    const file = makeFile('f.ts', [1])
    const scope = effectScope()
    const { hunkTokens } = scope.run(() =>
      useFileHighlight(
        () => file,
        () => true
      )
    )!
    await waitFor(() => hunkTokens.value !== null)
    assert.equal(hunkTokens.value!.length, 1)
    scope.stop()
  })

  it('a card closed before its turn in the queue does no tokenizing', async () => {
    const file = makeFile('g.ts', [3])
    const enabled = ref(true)
    const scope = effectScope()
    const { hunkTokens } = scope.run(() =>
      useFileHighlight(() => file, enabled)
    )!

    // The job waits for its turn in the queue; the card closes first.
    enabled.value = false
    await nextTick()
    await drainQueue()
    assert.equal(cachedHighlight(file), undefined)
    assert.equal(hunkTokens.value, null)

    enabled.value = true
    await waitFor(() => hunkTokens.value !== null)
    assert.equal(hunkTokens.value!.length, 1)
    scope.stop()
  })

  it('an unmounted card does no tokenizing', async () => {
    const file = makeFile('h.ts', [3])
    const scope = effectScope()
    scope.run(() => useFileHighlight(() => file, true))
    scope.stop()

    await drainQueue()
    assert.equal(cachedHighlight(file), undefined)
  })
})
