import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeSessionTask } from '@/utils/session-task-chip'

const tasks = new Map([
  ['open', { title: 'Open task', state: 'open' as const }],
  ['done', { title: 'Done task', state: 'closed' as const }]
])
const find = (id: string) => tasks.get(id)

test('an empty assignment has no task', () => {
  assert.deepEqual(describeSessionTask([], find), {
    id: null,
    title: '',
    closed: false,
    extra: 0
  })
})

test('the first task names the chip and the rest are counted', () => {
  assert.deepEqual(describeSessionTask(['open', 'done', 'other'], find), {
    id: 'open',
    title: 'Open task',
    closed: false,
    extra: 2
  })
})

test('a closed task is marked and an unknown label falls back to the ID', () => {
  assert.equal(describeSessionTask(['done'], find).closed, true)
  const unknown = describeSessionTask(['missing'], find)
  assert.equal(unknown.title, 'missing')
  assert.equal(unknown.closed, false)
})
