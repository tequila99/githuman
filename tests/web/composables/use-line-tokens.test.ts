import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, nextTick, ref, watch } from 'vue'
import { waitFor } from '../fake-worker.ts'
import {
  useLineTokens,
  type HighlightSource
} from '@/composables/use-line-tokens'
import {
  cachedHighlight,
  highlightCached
} from '@/composables/use-syntax-highlighting'

function makeLines(count: number, name = 'v'): string[] {
  return Array.from({ length: count }, (_, i) => `const ${name}${i} = ${i}`)
}

function sourceOf(lines: string[], path = 'a.ts'): HighlightSource {
  return { key: lines, path, lines: () => lines }
}

describe('useLineTokens', () => {
  it('keeps the tokens when the same key comes in a new source object', async () => {
    const lines = makeLines(3)
    const tick = ref(0)
    const scope = effectScope()
    const { tokens } = scope.run(() =>
      useLineTokens(() => {
        void tick.value
        return sourceOf(lines)
      }, true)
    )!
    await waitFor(() => tokens.value !== null)
    const first = tokens.value

    tick.value++
    await nextTick()
    assert.equal(tokens.value, first)
    scope.stop()
  })

  it('drops the tokens for a new key and tokenizes the new text', async () => {
    const lines = ref(makeLines(2, 'a'))
    const scope = effectScope()
    const { tokens } = scope.run(() =>
      useLineTokens(() => sourceOf(lines.value), true)
    )!
    await waitFor(() => tokens.value?.length === 2)

    lines.value = makeLines(5, 'b')
    await nextTick()
    assert.equal(tokens.value, null)
    await waitFor(() => tokens.value?.length === 5)
    scope.stop()
  })

  it('takes the tokens from the cache at once, without a hold or a call of lines', async () => {
    const lines = makeLines(2, 'cached')
    await highlightCached(lines, 'a.ts', () => lines)
    let calls = 0
    const scope = effectScope()
    const { tokens, holdForTokens } = scope.run(() =>
      useLineTokens(
        () => ({
          key: lines,
          path: 'a.ts',
          lines: () => {
            calls++
            return lines
          }
        }),
        true
      )
    )!
    assert.equal(tokens.value?.length, 2)
    assert.equal(holdForTokens.value, false)
    assert.equal(calls, 0)
    scope.stop()
  })

  it('does no work and no hold without a source or a grammar', async () => {
    const plain = ['some text']
    const scope = effectScope()
    const none = scope.run(() => useLineTokens(null, true))!
    const unknown = scope.run(() =>
      useLineTokens(sourceOf(plain, 'notes.unknown'), true)
    )!
    assert.equal(none.holdForTokens.value, false)
    assert.equal(unknown.holdForTokens.value, false)
    await highlightCached({}, 'queue-end.ts', () => ['x'])
    assert.equal(unknown.tokens.value, null)
    assert.equal(cachedHighlight(plain), undefined)
    scope.stop()
  })

  it('reports the first slice of 100 lines, then the whole text', async () => {
    const lines = makeLines(250, 'slice')
    const scope = effectScope()
    const lengths: number[] = []
    scope.run(() => {
      const { tokens } = useLineTokens(sourceOf(lines), true)
      watch(tokens, value => lengths.push(value?.length ?? 0), {
        flush: 'sync'
      })
    })
    await waitFor(() => lengths.at(-1) === 250)
    assert.equal(lengths[0], 100)
    assert.equal(lengths.at(-1), 250)
    scope.stop()
  })

  it('asks for the rest when it is enabled again after a stop', async () => {
    const lines = makeLines(3000, 'stop')
    const enabled = ref(true)
    const scope = effectScope()
    const lengths: number[] = []
    const { tokens } = scope.run(() => {
      const result = useLineTokens(sourceOf(lines), enabled)
      watch(result.tokens, value => lengths.push(value?.length ?? 0), {
        flush: 'sync'
      })
      return result
    })!
    await waitFor(() => tokens.value !== null)
    enabled.value = false
    await nextTick()
    assert.ok(tokens.value!.length < 3000)

    enabled.value = true
    await waitFor(() => tokens.value?.length === 3000)
    // The colors on screen never get shorter.
    assert.deepEqual(
      lengths,
      [...lengths].sort((a, b) => a - b)
    )
    scope.stop()
  })
})
