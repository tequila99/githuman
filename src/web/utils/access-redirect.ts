import type { RouteLocationNormalized, RouteLocationRaw } from 'vue-router'
import type { AccessMode } from '@/stores/access-store'

// Route of the pairing page; it lives outside the main layout.
export const ACCESS_ROUTE_NAME = 'access'

/**
 * Navigation guard result for the access mode. Without access every page
 * goes to the pairing page, which keeps the wanted path in `from`. With
 * access the pairing page goes back to that path. Only a same-site path is
 * accepted: `//host` would open another site.
 */
export function accessRedirect(
  mode: AccessMode,
  to: Pick<RouteLocationNormalized, 'name' | 'fullPath' | 'query'>
): true | RouteLocationRaw {
  const onAccessPage = to.name === ACCESS_ROUTE_NAME
  if (mode !== 'app') {
    return onAccessPage
      ? true
      : { name: ACCESS_ROUTE_NAME, query: { from: to.fullPath } }
  }
  if (!onAccessPage) return true
  const from = to.query.from
  return typeof from === 'string' &&
    from.startsWith('/') &&
    !from.startsWith('//')
    ? from
    : '/'
}
