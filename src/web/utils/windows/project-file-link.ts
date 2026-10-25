import { resolveMarkdownFileLink } from './markdown-file-link'
import { PROJECT_FILE_ROUTE } from '@/constants/project-files'
import { WORKTREE_REF } from '@/constants/git'

// Schemes that look like "name:digits" but never name a project file.
const NON_FILE_SCHEMES = new Set([
  'tel',
  'sms',
  'mailto',
  'callto',
  'facetime',
  'geo',
  'whatsapp',
  'viber',
  'skype',
  'magnet',
  'urn'
])
// A URI scheme at the start of a link, for example "https:".
const SCHEME_PATTERN = /^([a-z][a-z\d+.-]*):/i
// "name:12" or "name:12:3": a file name with a position, not a scheme.
const FILE_WITH_POSITION_PATTERN = /^[^/:]+:\d+(?::\d+)?(?:#.*)?$/
const FILE_URI_PATTERN = /^file:\/\//i
const WEB_URL_PATTERN = /^https?:\/\//i
// Routes of this application: they are not repository-relative links.
const APP_ROUTE_PATTERN = /^\/(api|notes|reviews|access|files)(?:[/?]|$)/
// A ":line" or ":line:column" ending of a path.
const POSITION_SUFFIX_PATTERN = /:(\d+)(?::(\d+))?$/

export interface ProjectFileLink {
  path: string
  anchor: string
  line?: number | undefined
  column?: number | undefined
}
export interface ProjectLinkContext {
  repositoryPath: string
  origin: string
  origins: string[]
  from?: string
}

function schemeOf(href: string): string | undefined {
  return SCHEME_PATTERN.exec(href)?.[1]?.toLowerCase()
}

function isNonFileScheme(href: string): boolean {
  const scheme = schemeOf(href)
  return scheme !== undefined && NON_FILE_SCHEMES.has(scheme)
}

// "src/a.ts:12" has a scheme-like start, but it is a file with a position.
function hasUriScheme(href: string): boolean {
  return SCHEME_PATTERN.test(href) && !FILE_WITH_POSITION_PATTERN.test(href)
}

function isInsideRepository(path: string, repositoryPath: string): boolean {
  return decodeURIComponent(path).startsWith(
    repositoryPath.replace(/\/$/, '') + '/'
  )
}

/** Path and hash of a local file: URI, or null for a remote or special one. */
function fileUriToPath(uri: string): string | null {
  const url = new URL(uri)
  const isRemote = url.hostname !== '' && url.hostname !== 'localhost'
  if (isRemote || url.username || url.password || url.search) return null
  return url.pathname + url.hash
}

/** Path, query and hash of a URL to this server inside the repository, else null. */
function webUrlToPath(
  href: string,
  context: ProjectLinkContext
): string | null {
  const url = new URL(href)
  const isTrustedOrigin = [context.origin, ...context.origins].includes(
    url.origin
  )
  if (url.username || url.password || !isTrustedOrigin) return null
  if (!isInsideRepository(url.pathname, context.repositoryPath)) return null
  return url.pathname + url.search + url.hash
}

function isApplicationRoute(target: string): boolean {
  return target === '/' || APP_ROUTE_PATTERN.test(target)
}

export function parseProjectFileLink(
  href: string,
  context: ProjectLinkContext
): ProjectFileLink | null {
  if (!href || href.startsWith('#') || href.startsWith('//')) return null
  if (isNonFileScheme(href)) return null
  let raw = href
  if (hasUriScheme(raw)) {
    let converted: string | null
    if (FILE_URI_PATTERN.test(raw)) {
      converted = fileUriToPath(raw)
    } else if (WEB_URL_PATTERN.test(raw)) {
      converted = webUrlToPath(raw, context)
    } else {
      converted = null
    }
    if (converted === null) return null
    raw = converted
  }
  const hash = raw.indexOf('#')
  let target = hash < 0 ? raw : raw.slice(0, hash)
  if (!target) return null
  if (
    target.startsWith('/') &&
    !isInsideRepository(target, context.repositoryPath)
  ) {
    if (isApplicationRoute(target)) return null
    throw new Error('Link leaves the repository')
  }
  if (target.includes('?')) {
    throw new Error('Project file links do not support query parameters')
  }
  const suffix = POSITION_SUFFIX_PATTERN.exec(target)
  if (suffix) target = target.slice(0, suffix.index)
  const link = {
    path: decodeURIComponent(target),
    anchor: hash < 0 ? '' : decodeURIComponent(raw.slice(hash + 1))
  }
  return {
    path: resolveMarkdownFileLink(link, context.repositoryPath, context.from),
    anchor: link.anchor,
    ...(suffix
      ? { line: Number(suffix[1]), column: Number(suffix[2] ?? 1) }
      : {})
  }
}
export function projectFileRoute(
  link: ProjectFileLink,
  ref = WORKTREE_REF
): string {
  const query = new URLSearchParams({ path: link.path, ref })
  if (link.anchor) query.set('anchor', link.anchor)
  if (link.line) query.set('line', String(link.line))
  if (link.column) query.set('column', String(link.column))
  return PROJECT_FILE_ROUTE + '?' + query.toString()
}

/** Reads the link and the ref back from the parameters that `projectFileRoute` wrote. */
export function projectFileFromQuery(read: (key: string) => string | null): {
  link: ProjectFileLink
  ref: string
} | null {
  const path = read('path')
  if (!path) return null
  return {
    link: {
      path,
      anchor: read('anchor') ?? '',
      line: Number(read('line')) || undefined,
      column: Number(read('column')) || undefined
    },
    ref: read('ref') ?? WORKTREE_REF
  }
}
export function projectFileContentUrl(path: string, download = false): string {
  return (
    '/api/project-files/content?' +
    new URLSearchParams({ path, download: String(download) }).toString()
  )
}
