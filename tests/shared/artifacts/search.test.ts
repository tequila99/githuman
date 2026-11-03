import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  boundedSearchDistance,
  searchMatchExpression
} from '../../../src/shared/artifacts/search.ts'

// Use the full unrestricted matrix to check the production algorithm's banded representation.
function referenceDistance(a: string, b: string): number {
  const maximum = a.length + b.length
  const matrix = Array.from({ length: a.length + 2 }, () =>
    Array<number>(b.length + 2).fill(0)
  )
  matrix[0][0] = maximum
  for (let i = 0; i <= a.length; i++) {
    matrix[i + 1][0] = maximum
    matrix[i + 1][1] = i
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j + 1] = maximum
    matrix[1][j + 1] = j
  }
  const positions = new Map<string, number>()
  for (let i = 1; i <= a.length; i++) {
    let previousMatch = 0
    for (let j = 1; j <= b.length; j++) {
      const row = positions.get(b[j - 1]) ?? 0,
        column = previousMatch
      let substitution = 1
      if (a[i - 1] === b[j - 1]) {
        substitution = 0
        previousMatch = j
      }
      matrix[i + 1][j + 1] = Math.min(
        matrix[i][j] + substitution,
        matrix[i + 1][j] + 1,
        matrix[i][j + 1] + 1,
        matrix[row][column] + (i - row - 1) + 1 + (j - column - 1)
      )
    }
    positions.set(a[i - 1], i)
  }
  return matrix[a.length + 1][b.length + 1]
}

test('banded unrestricted Damerau matches full distance for all abc strings of length at most four', () => {
  const strings = ['']
  for (let length = 1; length <= 4; length++) {
    const previous = strings.filter(text => text.length === length - 1)
    for (const prefix of previous) {
      for (const character of 'abc') strings.push(prefix + character)
    }
  }
  for (const left of strings) {
    for (const right of strings) {
      const expected = referenceDistance(left, right)
      for (const limit of [1, 2]) {
        const actual = boundedSearchDistance(left, right, limit)
        assert.equal(
          actual <= limit,
          expected <= limit,
          `${left}/${right}/${limit}`
        )
        if (expected <= limit) {
          assert.equal(actual, expected, `${left}/${right}/${limit}`)
        }
      }
    }
  }
})

test('MATCH builder omits empty groups without emitting invalid parentheses', () => {
  assert.equal(searchMatchExpression([[], [''], ['alpha', '']]), '("alpha")')
  assert.equal(searchMatchExpression([[], ['']]), '')
})
