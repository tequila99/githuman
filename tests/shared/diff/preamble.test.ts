import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  hunkPreamble,
  PREAMBLE_REACH
} from '../../../src/shared/diff/preamble.ts'

const numbered = (count: number) =>
  Array.from({ length: count }, (_, i) => `line ${i + 1}`)

describe('hunkPreamble', () => {
  it('gives the lines right above the hunk', () => {
    const lines = numbered(10)
    assert.deepEqual(hunkPreamble('a.ts', lines, 4), [
      'line 1',
      'line 2',
      'line 3'
    ])
  })

  it('gives nothing for a hunk at the start of the file', () => {
    assert.deepEqual(hunkPreamble('a.ts', numbered(5), 1), [])
    assert.deepEqual(hunkPreamble('a.ts', [], 1), [])
  })

  it('stops at the reach and takes the nearest lines', () => {
    const lines = numbered(100)
    const preamble = hunkPreamble('a.ts', lines, 80)
    assert.equal(preamble.length, PREAMBLE_REACH)
    assert.equal(preamble[0], 'line 20')
    assert.equal(preamble.at(-1), 'line 79')
  })

  it('starts at a line that is not indented deeper than the lines after it', () => {
    const lines = [
      '      deep tail',
      '    </div>',
      '  <p>text</p>',
      '  <p>more</p>'
    ]
    assert.deepEqual(hunkPreamble('a.html', lines, 5), [
      '  <p>text</p>',
      '  <p>more</p>'
    ])
  })

  it('does not start at a line that closes a tag', () => {
    const lines = ['</div>', '<p>x</p>', '<p>y</p>']
    assert.deepEqual(hunkPreamble('a.html', lines, 4), ['<p>x</p>', '<p>y</p>'])
  })

  it('skips blank lines when it looks for a start', () => {
    const lines = ['let a = 1', '', '    nested()', '', 'let b = 2']
    assert.deepEqual(hunkPreamble('a.ts', lines, 6), lines)
  })

  it('does not run past the end of a short side', () => {
    assert.deepEqual(hunkPreamble('a.ts', numbered(3), 10), [
      'line 1',
      'line 2',
      'line 3'
    ])
  })

  it('keeps the nearest lines when the characters are over budget', () => {
    const long = 'x'.repeat(1500)
    const lines = [long, long, long, long, 'near']
    const preamble = hunkPreamble('a.ts', lines, 6)
    assert.equal(preamble.at(-1), 'near')
    assert.ok(preamble.length < lines.length)
    assert.ok(preamble.join('').length <= 4000)
  })

  describe('in a Vue file', () => {
    const vue = [
      '<template>',
      '  <div />',
      '</template>',
      '',
      '<script setup lang="ts">',
      ...numbered(60),
      '</script>',
      '<style scoped lang="scss">',
      '.a { color: red; }',
      '</style>'
    ]

    it('puts the opening tag of the block first when it is out of reach', () => {
      // Line 70 of the file is deep in the script block.
      const preamble = hunkPreamble('A.vue', vue, 70)
      assert.equal(preamble[0], '<script setup lang="ts">')
      assert.equal(preamble.length, PREAMBLE_REACH + 1)
      assert.equal(preamble.at(-1), vue[68])
    })

    it('does not repeat a tag that is already in the window', () => {
      const preamble = hunkPreamble('A.vue', vue, 8)
      assert.equal(
        preamble.filter(line => line === '<script setup lang="ts">').length,
        1
      )
      assert.equal(preamble[0], '<template>')
    })

    it('finds the style block after the script block closed', () => {
      // The style block stays open, and its tag is far above the hunk.
      const lines = [
        ...vue.slice(0, -1),
        ...Array.from({ length: 100 }, () => '.b {}')
      ]
      const preamble = hunkPreamble('A.vue', lines, lines.length)
      assert.equal(preamble[0], '<style scoped lang="scss">')
    })

    it('adds no tag when the preamble reaches the start of a block', () => {
      const lines = ['<script>', 'let a', '</script>', ...numbered(40)]
      const preamble = hunkPreamble('A.vue', lines, 43)
      // The whole file is within reach, so the tag is a line of the preamble already.
      assert.deepEqual(preamble, lines.slice(0, 42))
    })

    it('adds no tag in other files', () => {
      const preamble = hunkPreamble('a.ts', vue, 70)
      assert.notEqual(preamble[0], '<script setup lang="ts">')
    })
  })
})
