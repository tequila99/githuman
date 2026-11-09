import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeStoredTask,
  resolveTaskFields
} from '../../src/shared/tasks/normalize.ts'

const BASE = {
  storeId: 's',
  id: 'i',
  version: 1,
  title: 'T',
  state: 'open' as const
}

test('a stored task without description and links reads as empty, and externalUrl becomes a link', () => {
  assert.deepEqual(normalizeStoredTask({ ...BASE }), {
    ...BASE,
    createdAt: '',
    description: '',
    links: [],
    tags: []
  })
  assert.deepEqual(
    normalizeStoredTask({ ...BASE, externalUrl: 'https://a.org/1' }),
    {
      ...BASE,
      createdAt: '',
      description: '',
      links: [{ url: 'https://a.org/1' }],
      tags: []
    }
  )
})

test('omitted description and links keep their previous values, and labels are trimmed', () => {
  const previous = {
    title: 'Old',
    state: 'open' as const,
    description: 'Text',
    links: [{ url: 'https://a.org/1' }],
    tags: ['keep']
  }
  assert.deepEqual(
    resolveTaskFields({ title: 'New', state: 'open' }, previous),
    { ...previous, title: 'New' }
  )
  assert.deepEqual(
    resolveTaskFields(
      {
        title: 'New',
        state: 'open',
        links: [
          { url: ' https://b.org/ ', label: '  Issue ' },
          { url: 'https://c.org/', label: '  ' }
        ]
      },
      previous
    ).links,
    [{ url: 'https://b.org/', label: 'Issue' }, { url: 'https://c.org/' }]
  )
  assert.deepEqual(
    resolveTaskFields(
      { title: 'N', state: 'open', externalUrl: null },
      previous
    ).links,
    []
  )
})

test('tags are replaced when given and kept when omitted', () => {
  const previous = {
    title: 'Old',
    state: 'open' as const,
    description: '',
    links: [],
    tags: ['a']
  }
  assert.deepEqual(
    resolveTaskFields({ title: 'N', state: 'open', tags: ['b', 'c'] }, previous)
      .tags,
    ['b', 'c']
  )
  assert.deepEqual(
    resolveTaskFields({ title: 'N', state: 'open', tags: [] }, previous).tags,
    []
  )
})
