import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isNarrowWorkspace,
  NARROW_WORKSPACE_WIDTH,
  workspaceProjection,
  workspacePanes,
  documentRouteKey,
  isWorkspaceOnlyNavigation,
  paneQuery,
  type WorkspaceRoute
} from '@/utils/workspace-navigation'

function route(
  query: WorkspaceRoute['query'] = {},
  path = '/',
  name?: string
): WorkspaceRoute {
  return { path, name, hash: '', query }
}

test('route defaults and available panes preserve direct note links and Reviews', () => {
  assert.equal(workspaceProjection(route(), true, true).pane, 'list')
  assert.equal(
    workspaceProjection(
      route({}, '/notes/s/document/a', 'note-document'),
      true,
      true
    ).pane,
    'content'
  )
  assert.deepEqual(workspacePanes(route({}, '/reviews/a'), true), [
    'list',
    'agent'
  ])
  assert.deepEqual(workspacePanes(route(), false), ['list', 'content'])
})

test('query normalization keeps the pane under the window and unrelated query', () => {
  const result = workspaceProjection(
    route({ uiPane: 'agent', uiWindow: 'terminal', folder: 'work' }),
    true,
    true
  )
  assert.equal(result.pane, 'agent')
  assert.equal(result.window, 'terminal')
  assert.deepEqual(result.query, {
    uiPane: 'agent',
    uiWindow: 'terminal',
    folder: 'work'
  })
  assert.equal(
    workspaceProjection(route({ uiWindow: 'preview' }), true, false).window,
    'preview'
  )
})

test('disabled, unknown and non-scalar query values normalize without losing context', () => {
  for (const uiPane of ['wrong', ['list', 'content'], null]) {
    const result = workspaceProjection(
      route({ uiPane, uiWindow: ['terminal', 'preview'], folder: 'x' }),
      false,
      false
    )
    assert.equal(result.pane, 'list')
    assert.equal(result.window, null)
    assert.deepEqual(result.query, { uiPane: 'list', folder: 'x' })
  }
  assert.deepEqual(
    workspaceProjection(
      route({ uiPane: 'agent', uiWindow: 'preview' }),
      false,
      false
    ).query,
    { uiPane: 'list', uiWindow: 'preview' }
  )
  assert.equal(
    workspaceProjection(route({ uiPane: 'content' }, '/reviews'), true, true)
      .pane,
    'list'
  )
  assert.equal(
    workspaceProjection(route({ uiWindow: 'terminal' }), true, false).query
      .uiWindow,
    undefined
  )
})

test('only shell query changes bypass document navigation', () => {
  const a = route({ folder: 'x', uiPane: 'list' }, '/notes')
  const b = route(
    { uiWindow: 'preview', uiPane: 'content', folder: 'x' },
    '/notes'
  )
  assert.equal(documentRouteKey(a), documentRouteKey(b))
  assert.equal(isWorkspaceOnlyNavigation(a, b), true)
  assert.equal(isWorkspaceOnlyNavigation(a, { ...b, hash: '#heading' }), false)
  assert.equal(
    isWorkspaceOnlyNavigation(a, route({ folder: 'y' }, '/notes')),
    false
  )
  assert.equal(
    isWorkspaceOnlyNavigation(a, { ...b, path: '/notes/s/document/b' }),
    false
  )
  assert.deepEqual(paneQuery({ folder: 'x', uiWindow: 'preview' }, 'content'), {
    folder: 'x',
    uiPane: 'content'
  })
})

test('the narrow workspace includes its threshold width', () => {
  assert.equal(isNarrowWorkspace(NARROW_WORKSPACE_WIDTH), true)
  assert.equal(isNarrowWorkspace(NARROW_WORKSPACE_WIDTH + 1), false)
})
