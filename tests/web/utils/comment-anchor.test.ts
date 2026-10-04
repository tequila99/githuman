import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkAnchor,
  createAnchor,
  type AnchorLine
} from '@/utils/comment-anchor'

function lines(texts: string[], firstKey = 1): AnchorLine[] {
  return texts.map((text, i) => ({ key: firstKey + i, text }))
}

describe('comment anchor', () => {
  const file = lines(['a', 'b', 'c', 'd'])
  const anchor = createAnchor('full', 2, 3, file)

  it('is valid while the selected lines keep their text', () => {
    assert.equal(checkAnchor(anchor, file), 'valid')
    assert.equal(checkAnchor(anchor, lines(['a', 'b', 'c', 'X'])), 'valid')
  })

  it('is stale when a selected line changes', () => {
    assert.equal(checkAnchor(anchor, lines(['a', 'b', 'X', 'd'])), 'stale')
  })

  it('is stale when the lines shift to other numbers', () => {
    assert.equal(checkAnchor(anchor, lines(['new', 'a', 'b', 'c'])), 'stale')
  })

  it('is absent when its last line is not in the rows', () => {
    assert.equal(checkAnchor(anchor, lines(['a', 'b'])), 'absent')
    assert.equal(checkAnchor(anchor, lines(['x', 'y'], 10)), 'absent')
  })

  it('is stale when the rows lose a line inside the range', () => {
    const gap: AnchorLine[] = [
      { key: 1, text: 'a' },
      { key: null, text: 'removed' },
      { key: 3, text: 'c' }
    ]
    assert.equal(checkAnchor(anchor, gap), 'stale')
  })

  it('ignores rows without a number in the anchor column', () => {
    const hunk: AnchorLine[] = [
      { key: 2, text: 'b' },
      { key: null, text: 'removed' },
      { key: 3, text: 'c' }
    ]
    const diffAnchor = createAnchor('new', 2, 3, hunk)
    assert.equal(checkAnchor(diffAnchor, hunk), 'valid')
  })
})
