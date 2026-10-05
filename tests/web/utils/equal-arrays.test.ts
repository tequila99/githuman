import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { equalArrays } from '@/utils/equal-arrays'

function sameId(x: { id: number }, y: { id: number }) {
  return x.id === y.id
}

describe('equalArrays', () => {
  it('compares the length and each item', () => {
    assert.equal(equalArrays(['a', 'b'], ['a', 'b']), true)
    assert.equal(equalArrays([], []), true)
    assert.equal(equalArrays(['a'], ['a', 'b']), false)
    assert.equal(equalArrays(['a', 'b'], ['a', 'c']), false)
  })

  it('uses the given comparison', () => {
    assert.equal(equalArrays([{ id: 1 }], [{ id: 1 }], sameId), true)
    assert.equal(equalArrays([{ id: 1 }], [{ id: 2 }], sameId), false)
  })
})
