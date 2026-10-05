import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { tokenizeLines, type LineTokens } from '@/utils/shiki-engine'

/** Tokenizes and gathers the slices into one list, as the callers do. */
async function gather(lang: string, lines: string[], sliceSize?: number) {
  const all: LineTokens[] = []
  const outcome = await tokenizeLines(lang, lines, {
    sliceSize,
    onSlice: (tokens, start) => all.splice(start, tokens.length, ...tokens)
  })
  return { outcome, all }
}

const colorsOf = (tokens: LineTokens) =>
  new Set(tokens.map(token => token.colorLight))

describe('tokenizeLines', () => {
  it('gives the same tokens in slices as in one call', async () => {
    // A block comment and a template string cross the border of the first slice.
    const script = Array.from({ length: 95 }, (_, i) => `const a${i} = ${i}`)
    script.push(
      '/* start of a comment',
      ...Array.from({ length: 10 }, () => 'still a comment const x = 1'),
      '*/',
      'const t = `a',
      'b ${x}',
      'c`',
      'const z = 2'
    )
    const vue = [
      '<template>',
      ...Array.from(
        { length: 98 },
        (_, i) => `  <div :a="x${i}">{{ y }}</div>`
      ),
      '  <span',
      '    :b="c"',
      '  />',
      '</template>',
      '<script setup lang="ts">',
      'const q = 1',
      '</script>'
    ]

    for (const [lang, lines] of [
      ['typescript', script],
      ['vue', vue]
    ] as const) {
      const one = await gather(lang, [...lines])
      const sliced = await gather(lang, [...lines], 100)
      assert.equal(sliced.outcome, 'done')
      assert.equal(sliced.all.length, lines.length)
      assert.deepEqual(sliced.all, one.all, lang)
    }
  })

  it('stops before the first slice when the signal is aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    let slices = 0
    const outcome = await tokenizeLines('typescript', ['const x = 1'], {
      signal: controller.signal,
      onSlice: () => slices++
    })
    assert.equal(outcome, 'aborted')
    assert.equal(slices, 0)
  })

  it('stops between slices when the signal aborts', async () => {
    const controller = new AbortController()
    let slices = 0
    const outcome = await tokenizeLines(
      'typescript',
      Array.from({ length: 300 }, (_, i) => `let v${i} = ${i}`),
      {
        sliceSize: 100,
        yieldBetween: async () => controller.abort(),
        signal: controller.signal,
        onSlice: () => slices++
      }
    )
    assert.equal(outcome, 'aborted')
    assert.equal(slices, 1)
  })

  it('fails for a language without a grammar and for no lines', async () => {
    assert.equal(await tokenizeLines('cobol', ['MOVE A TO B']), 'failed')
    assert.equal(await tokenizeLines('typescript', []), 'failed')
  })

  describe('documents', () => {
    it('gives tokens for the lines after the preamble only', async () => {
      const lines = ['let a = 1', 'let b = 2', 'let c = 3', 'let d = 4']
      const all: LineTokens[] = []
      const starts: number[] = []
      const outcome = await tokenizeLines('typescript', lines, {
        documents: [{ length: 4, skip: 2 }],
        onSlice: (tokens, start) => {
          starts.push(start)
          all.splice(start, tokens.length, ...tokens)
        }
      })
      assert.equal(outcome, 'done')
      assert.equal(all.length, 2)
      assert.equal(all[0]!.map(token => token.content).join(''), 'let c = 3')
      assert.deepEqual(starts, [0])
    })

    it('uses the preamble as grammar state', async () => {
      // `still` is a comment only if the first line is read.
      const lines = ['/* open', 'const x = 1 */ const y = 2']
      const plain = await gather('typescript', ['const x = 1 */ const y = 2'])
      const all: LineTokens[] = []
      await tokenizeLines('typescript', lines, {
        documents: [{ length: 2, skip: 1 }],
        onSlice: (tokens, start) => all.splice(start, tokens.length, ...tokens)
      })
      // Inside the comment, `const` has the comment color. Alone, it is a keyword.
      assert.notDeepEqual(colorsOf(all[0]!), colorsOf(plain.all[0]!))
    })

    it('starts each document with a fresh state', async () => {
      // The comment in the first document must not leak into the second one.
      const lines = ['/* open', 'let a = 1', 'let b = 2']
      const joined = await gather('typescript', lines)
      const all: LineTokens[] = []
      await tokenizeLines('typescript', lines, {
        documents: [
          { length: 1, skip: 0 },
          { length: 2, skip: 0 }
        ],
        onSlice: (tokens, start) => all.splice(start, tokens.length, ...tokens)
      })
      assert.equal(all.length, 3)
      assert.notDeepEqual(all[2], joined.all[2])
      const alone = await gather('typescript', ['let b = 2'])
      assert.deepEqual(all[2], alone.all[0])
    })

    it('counts the start of a slice without the skipped lines', async () => {
      const preamble = Array.from({ length: 5 }, (_, i) => `let p${i} = 0`)
      const body = Array.from({ length: 7 }, (_, i) => `let v${i} = ${i}`)
      const starts: number[] = []
      const sizes: number[] = []
      const outcome = await tokenizeLines(
        'typescript',
        [...preamble, ...body, ...preamble, ...body],
        {
          documents: [
            { length: 12, skip: 5 },
            { length: 12, skip: 5 }
          ],
          sliceSize: 4,
          onSlice: (tokens, start) => {
            starts.push(start)
            sizes.push(tokens.length)
          }
        }
      )
      assert.equal(outcome, 'done')
      // A slice that holds only preamble lines is not reported.
      assert.equal(
        sizes.reduce((sum, size) => sum + size, 0),
        14
      )
      assert.equal(starts[0], 0)
      assert.equal(starts.at(-1)! + sizes.at(-1)!, 14)
    })

    it('fails when the documents do not fit the lines', async () => {
      const outcome = await tokenizeLines('typescript', ['let a = 1'], {
        documents: [{ length: 3, skip: 0 }]
      })
      assert.equal(outcome, 'failed')
    })
  })
})
