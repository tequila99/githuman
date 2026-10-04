import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createWeightedLru } from '@/utils/weighted-lru'

const weigh = (value: string) => value.length

test('drops the oldest entries when the weight passes the limit', () => {
  const cache = createWeightedLru<string, string>(5, weigh)
  cache.set('a', 'xx')
  cache.set('b', 'xx')
  cache.set('c', 'xx')

  assert.equal(cache.get('a'), undefined)
  assert.equal(cache.get('b'), 'xx')
  assert.equal(cache.get('c'), 'xx')
})

test('get() makes an entry the newest', () => {
  const cache = createWeightedLru<string, string>(5, weigh)
  cache.set('a', 'xx')
  cache.set('b', 'xx')
  cache.get('a')
  cache.set('c', 'xx')

  assert.equal(cache.get('b'), undefined)
  assert.equal(cache.get('a'), 'xx')
})

test('keeps the newest entry even when it is heavier than the limit', () => {
  const cache = createWeightedLru<string, string>(3, weigh)
  cache.set('a', 'x')
  cache.set('big', 'xxxxxxxx')

  assert.equal(cache.get('big'), 'xxxxxxxx')
  assert.equal(cache.get('a'), undefined)
  assert.equal(cache.size(), 1)
})

test('replacing a key does not count its old weight twice', () => {
  const cache = createWeightedLru<string, string>(4, weigh)
  cache.set('a', 'xxx')
  cache.set('a', 'xxx')
  cache.set('b', 'x')

  assert.equal(cache.get('a'), 'xxx')
  assert.equal(cache.get('b'), 'x')
})
