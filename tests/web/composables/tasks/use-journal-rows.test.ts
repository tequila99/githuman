import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shallowRef } from 'vue'
import type { JournalSearchEntry } from '@/api/types'
import { useJournalRows } from '@/composables/tasks/use-journal-rows'

function entry(seq: number): JournalSearchEntry {
  return {
    seq,
    id: String(seq),
    storeId: 'store',
    taskId: 'task',
    taskTitle: 'Task',
    isSuperseded: false,
    kind: 'note',
    eventType: null,
    body: String(seq),
    actor: { kind: 'user', id: 'local' },
    sessionId: null,
    turnId: null,
    supersedesEntryId: null,
    createdAt: '2026-11-12T00:00:00Z'
  }
}

test('grouping keeps stores distinct and preserves entry order within each task', () => {
  const first = entry(1)
  const second = { ...entry(2), storeId: 'other' }
  const third = entry(3)
  const unassigned = { ...entry(4), taskId: null, taskTitle: null }
  const unnamed = { ...entry(5), taskId: 'unnamed', taskTitle: null }
  const rows = useJournalRows(
    [first, second, third, unassigned, unnamed],
    true,
    'No task'
  )
  assert.deepEqual(
    rows.value.map(row => (row.kind === 'group' ? row.label : row.entry.id)),
    ['Task', '1', '3', 'Task', '2', 'No task', '4', 'unnamed', '5']
  )
  assert.notEqual(rows.value[0]!.key, rows.value[3]!.key)
})

test('rows react to ref and getter inputs, including the fallback label', () => {
  const items = shallowRef<JournalSearchEntry[]>([entry(1)])
  const grouped = shallowRef(false)
  const label = shallowRef('No task')
  const rows = useJournalRows(items, () => grouped.value, label)
  assert.deepEqual(
    rows.value.map(row => row.kind),
    ['entry']
  )
  grouped.value = true
  assert.deepEqual(
    rows.value.map(row => row.kind),
    ['group', 'entry']
  )
  items.value = [{ ...entry(2), taskId: null, taskTitle: null }]
  label.value = 'Unassigned'
  const first = rows.value[0]!
  assert.equal(first.kind === 'group' && first.label, 'Unassigned')
  grouped.value = false
  assert.deepEqual(
    rows.value.map(row => row.key),
    ['2']
  )
  items.value = []
  assert.deepEqual(rows.value, [])
})
