import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { hunkText } from '@/utils/hunk-text'
import type { DiffHunk } from '@/api/types'

function hunk(contents: string[], preamble?: string[]): DiffHunk {
  return {
    oldStart: 1,
    oldLines: contents.length,
    newStart: 1,
    newLines: contents.length,
    lines: contents.map((content, i) => ({
      type: 'context' as const,
      content,
      oldLineNumber: i + 1,
      newLineNumber: i + 1
    })),
    ...(preamble ? { preamble } : {})
  }
}

describe('hunkText', () => {
  it('reads hunks without a preamble as one text', () => {
    const text = hunkText([hunk(['a', 'b']), hunk(['c'])])
    assert.deepEqual(text.lines, ['a', 'b', 'c'])
    assert.equal(text.documents, undefined)
  })

  it('puts the preamble before its hunk and makes one document per hunk', () => {
    const text = hunkText([hunk(['a', 'b']), hunk(['c'], ['p1', 'p2'])])
    assert.deepEqual(text.lines, ['a', 'b', 'p1', 'p2', 'c'])
    assert.deepEqual(text.documents, [
      { length: 2, skip: 0 },
      { length: 3, skip: 2 }
    ])
  })

  it('gives no lines for no hunks', () => {
    assert.deepEqual(hunkText([]), { lines: [], documents: undefined })
  })
})
