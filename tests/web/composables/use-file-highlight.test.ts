import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, nextTick, ref, watch } from 'vue'
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
  it('cuts the tokens into one entry per hunk', async () => {
    const file = ref(makeFile('a.ts', [2, 3]))
    const scope = effectScope()
    const { hunkTokens } = scope.run(() => useFileHighlight(file, true))!

    assert.equal(hunkTokens.value, null)
    await waitFor(() => hunkTokens.value !== null)

    assert.deepEqual(
      hunkTokens.value!.map(hunk => hunk.length),
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
      hunkTokens.value!.map(hunk => hunk.length),
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

  it('holds the card until the first tokens arrive, then lets go', async () => {
    const file = makeFile('hold.ts', [2])
    const scope = effectScope()
    const { hunkTokens, holdForTokens } = scope.run(() =>
      useFileHighlight(() => file, true)
    )!

    assert.equal(holdForTokens.value, true)
    await waitFor(() => hunkTokens.value !== null)
    assert.equal(holdForTokens.value, false)
    scope.stop()
  })

  it('does not hold a closed card, a plain file or an empty diff', () => {
    const scope = effectScope()
    const closed = scope.run(() =>
      useFileHighlight(() => makeFile('closed.ts', [1]), false)
    )!
    const plain = scope.run(() =>
      useFileHighlight(() => makeFile('notes.unknown', [1]), true)
    )!
    const empty = scope.run(() =>
      useFileHighlight(() => makeFile('empty.ts', []), true)
    )!

    assert.equal(closed.holdForTokens.value, false)
    assert.equal(plain.holdForTokens.value, false)
    assert.equal(empty.holdForTokens.value, false)
    scope.stop()
  })

  it('shows the first slice at once and the rest later', async () => {
    // 250 lines make three slices of 100, 100 and 50 lines.
    const file = makeFile('slices.ts', [250])
    const scope = effectScope()
    const lengths: number[] = []
    const { hunkTokens, holdForTokens } = scope.run(() => {
      const result = useFileHighlight(() => file, true)
      watch(
        result.hunkTokens,
        value => {
          if (value) lengths.push(value[0]!.length)
        },
        { flush: 'sync' }
      )
      return result
    })!

    await waitFor(() => hunkTokens.value !== null)
    // The hold ends with the first slice, before the whole file is done.
    assert.equal(holdForTokens.value, false)
    await waitFor(() => lengths.at(-1) === 250)
    assert.equal(lengths[0], 100)
    assert.equal(
      hunkTokens.value![0]!.every(tokens => tokens !== undefined),
      true
    )
    scope.stop()
  })

  it('does not hold again when a new version of the file arrives', async () => {
    const file = ref(makeFile('again.ts', [1]))
    const scope = effectScope()
    const { hunkTokens, holdForTokens } = scope.run(() =>
      useFileHighlight(file, true)
    )!
    await waitFor(() => hunkTokens.value !== null)

    file.value = makeFile('again.ts', [2])
    await nextTick()
    assert.equal(holdForTokens.value, false)
    scope.stop()
  })

  it('gives tokens for the hunk lines only, not for the preamble', async () => {
    const file = makeFile('pre.ts', [2, 3])
    file.hunks[1]!.preamble = ['/* open comment', 'still the comment']
    const scope = effectScope()
    const { hunkTokens } = scope.run(() => useFileHighlight(() => file, true))!

    await waitFor(() => hunkTokens.value?.[1]?.length === 3)
    assert.deepEqual(
      hunkTokens.value!.map(slice => slice.length),
      [2, 3]
    )
    // The preamble opens a comment, so `const` in the second hunk is part of it.
    const second = hunkTokens.value![1]![0]!
    assert.ok(second.every(token => token.colorLight === second[0]!.colorLight))
    scope.stop()
  })
})
