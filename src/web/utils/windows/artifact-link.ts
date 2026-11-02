import { isUuid } from '../../../shared/utils/is-uuid.ts'

export interface ArtifactLink {
  storeId: string
  artifactId: string
}

/** Only local artifact routes and explicit GitHuman identities can open a preview. */
export function parseArtifactLink(
  href: string,
  base: string
): ArtifactLink | null {
  try {
    const url = new URL(href, base)
    if (url.username || url.password) return null
    let storeId: string | null, artifactId: string | null
    if (url.protocol === 'githuman:') {
      if (url.host !== 'artifact' || url.search || url.hash) return null
      const parts = url.pathname.split('/')
      if (parts.length !== 3) return null
      storeId = parts[1] ?? null
      artifactId = parts[2] ?? null
    } else {
      if (url.origin !== new URL(base).origin) return null
      const route = url.hash.startsWith('#/')
        ? new URL(url.hash.slice(1), url.origin)
        : url
      if (route.pathname !== '/artifacts') return null
      storeId = route.searchParams.get('storeId')
      artifactId = route.searchParams.get('selectedId')
    }
    return isUuid(storeId) && isUuid(artifactId)
      ? { storeId, artifactId }
      : null
  } catch {
    return null
  }
}
