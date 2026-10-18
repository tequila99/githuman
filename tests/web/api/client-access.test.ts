import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { apiGet, apiGetText, ApiRequestError } from '@/api/client'
import { onAccessProblem } from '@/utils/access-problem'

test('an answer 401 reports a possible loss of access; others do not', async t => {
  let reports = 0
  onAccessProblem(() => reports++)
  let status = 401
  const fetch = mock.method(globalThis, 'fetch', async () =>
    Response.json({ message: 'no access' }, { status })
  )
  t.after(() => {
    fetch.mock.restore()
    onAccessProblem(() => {})
  })
  await assert.rejects(() => apiGet('/api/reviews'), ApiRequestError)
  await assert.rejects(() => apiGetText('/api/reviews/1/export'), /no access/)
  assert.equal(reports, 2)
  status = 404
  await assert.rejects(() => apiGet('/api/reviews'), ApiRequestError)
  assert.equal(reports, 2)
})
