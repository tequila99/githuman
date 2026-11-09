import {
  ARTIFACT_STATUSES,
  INACTIVE_ARTIFACT_STATUSES
} from '../../../src/shared/artifacts/constants.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  artifactFilterQuery,
  artifactFiltersActive,
  defaultArtifactFilters,
  artifactRouteState,
  artifactDocumentRoute
} from '@/utils/artifact-navigation'

test('URL restores filters, grouping and a store-scoped selection', () => {
  const storeId = '00000000-0000-4000-8000-000000000001'
  const selectedId = '00000000-0000-4000-8000-000000000002'
  const state = artifactRouteState({
    storeId,
    selectedId,
    q: 'search',
    status: 'draft',
    typeId: 'spec',
    taskId: selectedId,
    tag: ['tag', 'other'],
    tagMode: 'any',
    from: '2026-10-01',
    to: '2026-10-31',
    mode: 'exact',
    group: 'task'
  })
  assert.deepEqual(state.selection, { storeId, id: selectedId })
  assert.equal(state.group, 'task')
  assert.deepEqual(state.input, {
    query: 'search',
    mode: 'exact',
    sort: 'createdAt',
    limit: 50,
    filters: {
      statuses: ['draft'],
      typeIds: ['spec'],
      taskIds: [selectedId],
      tags: ['tag', 'other'],
      tagMode: 'any',
      createdFrom: new Date(2026, 9, 1).toISOString(),
      createdTo: new Date(2026, 9, 31, 23, 59, 59, 999).toISOString()
    }
  })
  assert.equal(state.filters.createdFrom, '2026-10-01')
})

test('several types and tags are restored from repeated URL parameters', () => {
  const state = artifactRouteState({
    typeId: ['adr', 'plan', 'adr'],
    tag: ['a', 'b'],
    from: 'not-a-date',
    to: '2026-02-31'
  })
  assert.deepEqual(state.filters.typeIds, ['adr', 'plan'])
  assert.deepEqual(state.input.filters?.typeIds, ['adr', 'plan'])
  assert.equal(state.filters.tagMode, 'all')
  assert.equal(state.filters.createdFrom, null)
  assert.equal(state.filters.createdTo, null)
  assert.equal(state.input.sort, 'createdAt')
})

test('invalid identities, arrays and unknown options fall back without filesystem access', () => {
  const state = artifactRouteState({
    selectedId: '../../secret',
    storeId: 'unknown',
    taskId: 'invalid',
    q: ['one', 'two'],
    status: 'unknown',
    group: 'unknown'
  })
  assert.equal(state.selection, null)
  assert.equal(state.group, 'none')
  assert.equal(state.input.query, '')
  assert.equal(state.filters.status, 'active')
  assert.deepEqual(state.input.filters, {
    statuses: ARTIFACT_STATUSES.filter(
      value => !INACTIVE_ARTIFACT_STATUSES.includes(value)
    )
  })
})

test('absent and invalid status exclude inactive statuses; explicit statuses remain selectable', () => {
  for (const status of [
    undefined,
    null,
    '',
    'unknown',
    ['draft', 'accepted']
  ]) {
    const state = artifactRouteState(status === undefined ? {} : { status })
    assert.equal(state.filters.status, 'active')
    assert.deepEqual(
      state.input.filters?.statuses,
      ARTIFACT_STATUSES.filter(
        value => !INACTIVE_ARTIFACT_STATUSES.includes(value)
      )
    )
  }
  for (const status of ARTIFACT_STATUSES) {
    const state = artifactRouteState({ status })
    assert.equal(state.filters.status, status)
    assert.deepEqual(state.input.filters?.statuses, [status])
  }
})

test('applying and resetting filters preserves search, selection and unrelated workspace query', () => {
  const selection = {
    storeId: '00000000-0000-4000-8000-000000000001',
    selectedId: '00000000-0000-4000-8000-000000000002'
  }
  const query = {
    ...selection,
    q: 'project',
    uiPane: 'content',
    uiWindow: 'preview',
    other: ['one', 'two'],
    status: 'draft',
    typeId: 'plan',
    taskId: selection.selectedId,
    tag: 'internal',
    tagMode: 'any',
    from: '2026-10-01',
    to: '2026-10-02',
    group: 'type',
    mode: 'exact'
  }
  assert.deepEqual(artifactFilterQuery(query, defaultArtifactFilters()), {
    ...selection,
    q: 'project',
    uiPane: 'content',
    uiWindow: 'preview',
    other: ['one', 'two'],
    status: 'all'
  })
  assert.deepEqual(
    artifactFilterQuery(query, {
      ...defaultArtifactFilters(),
      status: 'deleted',
      typeIds: ['adr', 'plan'],
      tags: ['evidence', 'proof'],
      tagMode: 'any',
      createdFrom: '2026-09-01',
      group: 'task',
      mode: 'exact'
    }),
    {
      ...selection,
      q: 'project',
      uiPane: 'content',
      uiWindow: 'preview',
      other: ['one', 'two'],
      status: 'deleted',
      typeId: ['adr', 'plan'],
      tag: ['evidence', 'proof'],
      tagMode: 'any',
      from: '2026-09-01',
      group: 'task',
      mode: 'exact'
    }
  )
  assert.equal(
    artifactFiltersActive(artifactRouteState({ q: 'search' }).filters),
    true
  )
  assert.equal(
    artifactFiltersActive(artifactRouteState({ group: 'type' }).filters),
    true
  )
  assert.equal(
    artifactFiltersActive(artifactRouteState({ from: '2026-10-01' }).filters),
    true
  )
  assert.equal(
    artifactFiltersActive(artifactRouteState({ mode: 'exact' }).filters),
    true
  )
})

test('document links preserve catalog filters and select the content pane without a floating window', () => {
  assert.deepEqual(
    artifactDocumentRoute('store', 'target', {
      q: 'query',
      status: 'draft',
      uiPane: 'list',
      uiWindow: 'terminal'
    }),
    {
      path: '/artifacts',
      query: {
        q: 'query',
        status: 'draft',
        uiPane: 'content',
        uiWindow: undefined,
        storeId: 'store',
        selectedId: 'target'
      }
    }
  )
})

test('malformed calendar dates cannot crash URL parsing', () => {
  for (const day of ['2026-99-99', '2026-00-01', '2026-01-00', '2025-02-29']) {
    const state = artifactRouteState({ from: day, to: day })
    assert.equal(state.filters.createdFrom, null)
    assert.equal(state.filters.createdTo, null)
    assert.equal(state.input.filters?.createdFrom, undefined)
    assert.equal(state.input.filters?.createdTo, undefined)
  }
})

test('resetting status explicitly restores all records and survives URL roundtrip', () => {
  const filters = defaultArtifactFilters()
  const query = artifactFilterQuery({}, filters)
  assert.equal(query.status, 'all')
  const state = artifactRouteState({ status: 'all' })
  assert.equal(state.filters.status, null)
  assert.deepEqual(state.input.filters?.statuses, [...ARTIFACT_STATUSES])
  assert.equal(artifactFiltersActive(state.filters), false)
  assert.equal(
    artifactFilterQuery({}, artifactRouteState({}).filters).status,
    'active'
  )
})
