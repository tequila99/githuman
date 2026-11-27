import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_ARTIFACT_PAGE_BYTES } from '../../../src/shared/artifacts/constants.ts'
import {
  keysetPage,
  type KeyedRow,
  type PageKey
} from '../../../src/server/utils/artifact-page.ts'

const BASE = { storeId: 'store', epoch: 1, query: 'q' }

function rows(texts: string[]): KeyedRow<{ text: string }>[] {
  return texts.map((text, index) => ({
    item: { text },
    key: { createdAt: `t${index}`, id: `id${index}` }
  }))
}

function cursorOf(data: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(data)).toString('base64url')
}

test('keysetPage asks for one extra row and cursors the last returned key', () => {
  const asked: number[] = []
  const all = rows(['a', 'b', 'c'])
  const page = keysetPage(
    (_after, count) => {
      asked.push(count)
      return all.slice(0, count)
    },
    { ...BASE, limit: 2 }
  )
  assert.deepEqual(asked, [3])
  assert.equal(page.items.length, 2)
  const cursor = JSON.parse(
    Buffer.from(page.nextCursor ?? '', 'base64url').toString('utf8')
  )
  assert.deepEqual(cursor.after, { createdAt: 't1', id: 'id1' })
})

test('keysetPage has no cursor on the last page', () => {
  const page = keysetPage(() => rows(['a', 'b']), { ...BASE, limit: 2 })
  assert.equal(page.nextCursor, null)
})

test('keysetPage cuts by bytes before the limit and cursors the last returned item', () => {
  const big = 'x'.repeat(Math.floor(MAX_ARTIFACT_PAGE_BYTES * 0.6))
  const page = keysetPage(() => rows([big, big, big]), { ...BASE, limit: 10 })
  assert.equal(page.items.length, 1)
  const cursor = JSON.parse(
    Buffer.from(page.nextCursor ?? '', 'base64url').toString('utf8')
  )
  assert.deepEqual(cursor.after, { createdAt: 't0', id: 'id0' })
})

test('keysetPage returns one oversized item and moves on', () => {
  const huge = 'x'.repeat(MAX_ARTIFACT_PAGE_BYTES * 2)
  const page = keysetPage(() => rows([huge, 'b']), { ...BASE, limit: 5 })
  assert.equal(page.items.length, 1)
  assert.ok(page.nextCursor)
})

test('keysetPage passes the cursor key, including a null creation time', () => {
  let seen: PageKey | undefined
  const after = { createdAt: null, id: 'z' }
  keysetPage(
    key => {
      seen = key
      return []
    },
    { ...BASE, cursor: cursorOf({ storeId: 'store', query: 'q', after }) }
  )
  assert.deepEqual(seen, after)
})

test('keysetPage rejects malformed and foreign cursors', () => {
  const bad = [
    'not-base64-json',
    cursorOf({ storeId: 'store', query: 'q' }),
    cursorOf({
      storeId: 'store',
      query: 'q',
      after: { createdAt: 1, id: 'a' }
    }),
    cursorOf({
      storeId: 'store',
      query: 'q',
      after: { createdAt: null, id: '' }
    }),
    cursorOf({
      storeId: 'other',
      query: 'q',
      after: { createdAt: null, id: 'a' }
    }),
    cursorOf({
      storeId: 'store',
      query: 'other',
      after: { createdAt: null, id: 'a' }
    }),
    cursorOf({ storeId: 'store', query: 'q', offset: 1 })
  ]
  for (const cursor of bad) {
    assert.throws(
      () => keysetPage(() => [], { ...BASE, cursor }),
      /Invalid page cursor/
    )
  }
})
