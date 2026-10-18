import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accessRedirect } from '@/utils/access-redirect'

const page = (fullPath: string) => ({ name: undefined, fullPath, query: {} })
const access = (from?: string) => ({
  name: 'access',
  fullPath: '/access',
  query: from === undefined ? {} : { from }
})

test('without access every page goes to the pairing page and keeps its path', () => {
  assert.deepEqual(accessRedirect('pairing', page('/reviews/1')), {
    name: 'access',
    query: { from: '/reviews/1' }
  })
  assert.deepEqual(accessRedirect('unavailable', page('/')), {
    name: 'access',
    query: { from: '/' }
  })
  assert.equal(accessRedirect('pairing', access('/notes')), true)
})

test('with access the pairing page returns to a same-site path only', () => {
  assert.equal(accessRedirect('app', page('/notes')), true)
  assert.equal(accessRedirect('app', access('/notes')), '/notes')
  assert.equal(accessRedirect('app', access()), '/')
  assert.equal(accessRedirect('app', access('//evil.example')), '/')
  assert.equal(accessRedirect('app', access('https://evil.example')), '/')
})
