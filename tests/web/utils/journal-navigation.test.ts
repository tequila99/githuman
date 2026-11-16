import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultJournalFilters,
  journalFilterQuery,
  journalFiltersActive,
  journalRouteState
} from '@/utils/journal-navigation'
import { localDayEndIso, localDayStartIso } from '@/utils/date'
import { workspacePanes } from '@/utils/workspace-navigation'

test('journal filters round trip in URL and preserve workspace navigation', () => {
  const filters = {
    ...defaultJournalFilters(),
    taskId: '12345678-1234-4234-9234-123456789abc',
    agentName: 'Codex',
    model: 'gpt-test',
    kind: 'decision' as const,
    author: 'agent' as const,
    createdFrom: '2026-11-01',
    createdTo: '2026-11-12'
  }
  const query = journalFilterQuery(
    { q: 'Ёжик', uiPane: 'list', uiWindow: 'preview' },
    filters
  )
  assert.equal(journalFiltersActive(filters), true)
  assert.equal(journalFiltersActive(defaultJournalFilters()), false)
  assert.equal(query.q, 'Ёжик')
  assert.equal(query.uiWindow, 'preview')
  const parsed = journalRouteState(query as Record<string, string>)
  assert.deepEqual(parsed.filters, filters)
  assert.equal(parsed.input.createdFrom, localDayStartIso('2026-11-01'))
  assert.equal(parsed.input.createdTo, localDayEndIso('2026-11-12'))
  assert.deepEqual(
    journalFilterQuery({ ...query, q: 'literal' }, defaultJournalFilters()),
    { q: 'literal', uiPane: 'list', uiWindow: 'preview' }
  )
})
test('malformed journal URL filters are ignored and text length is bounded', () => {
  const parsed = journalRouteState({
    kind: 'unknown',
    author: ['agent'],
    from: '2026-02-30',
    to: 'invalid',
    taskId: 'invalid',
    q: 'x'.repeat(300)
  })
  assert.deepEqual(parsed.filters, defaultJournalFilters())
  assert.equal(parsed.text.length, 256)
  assert.deepEqual(journalRouteState({ q: ['ignored'] }).input, {})
})
test('journal has no empty content pane on a narrow workspace', () => {
  const route = { path: '/journal', name: 'journal', query: {}, hash: '' }
  assert.deepEqual(workspacePanes(route, false), ['list'])
  assert.deepEqual(workspacePanes(route, true), ['list', 'agent'])
})
