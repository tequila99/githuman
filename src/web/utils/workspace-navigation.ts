import type {
  LocationQuery,
  LocationQueryRaw,
  RouteLocationNormalized
} from 'vue-router'

// Keep the JS threshold shared by every workspace projection.
export const NARROW_WORKSPACE_WIDTH = 900

/** Every narrow check uses this function, so all parts of the UI switch at the same width. */
export function isNarrowWorkspace(width: number): boolean {
  return width <= NARROW_WORKSPACE_WIDTH
}

export type WorkspacePane = 'list' | 'content' | 'agent'
export type WorkspaceWindow = 'terminal' | 'preview'
export type WorkspaceRoute = Pick<
  RouteLocationNormalized,
  'path' | 'name' | 'query' | 'hash'
>

export function workspacePanes(
  route: WorkspaceRoute,
  agent: boolean
): WorkspacePane[] {
  const panes: WorkspacePane[] = route.path.startsWith('/reviews')
    ? ['list']
    : ['list', 'content']
  if (agent) panes.push('agent')
  return panes
}

export function initialWorkspacePane(route: WorkspaceRoute): WorkspacePane {
  return route.name === 'note-document' ? 'content' : 'list'
}

export function workspaceProjection(
  route: WorkspaceRoute,
  agent: boolean,
  terminal: boolean
) {
  const panes = workspacePanes(route, agent)
  const requested = route.query.uiPane
  const pane =
    panes.find(candidate => candidate === requested) ??
    initialWorkspacePane(route)
  const window =
    route.query.uiWindow === 'preview' ||
    (route.query.uiWindow === 'terminal' && terminal)
      ? route.query.uiWindow
      : null
  const query: LocationQueryRaw = { ...route.query }
  if (requested !== undefined && requested !== pane) query.uiPane = pane
  if (route.query.uiWindow !== undefined && !window) delete query.uiWindow
  if (window) query.uiPane = pane
  return { pane, window, panes, query }
}

export function documentRouteKey(route: WorkspaceRoute): string {
  const query = Object.entries(route.query)
    .filter(([key]) => key !== 'uiPane' && key !== 'uiWindow')
    .sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify([route.path, route.hash, query])
}

export function isWorkspaceOnlyNavigation(
  to: WorkspaceRoute,
  from: WorkspaceRoute
): boolean {
  return documentRouteKey(to) === documentRouteKey(from)
}

export function paneQuery(
  query: LocationQuery,
  pane: WorkspacePane
): LocationQueryRaw {
  const next: LocationQueryRaw = { ...query, uiPane: pane }
  delete next.uiWindow
  return next
}
