export interface MarkdownFileLink {
  path: string
  anchor: string
}

export function parseMarkdownFileLink(href: string): MarkdownFileLink | null {
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//')) return null
  const hash = href.indexOf('#')
  const target = hash < 0 ? href : href.slice(0, hash)
  if (!target || target.includes('?')) return null
  const path = decodeURIComponent(target).replace(/:\d+(?::\d+)?$/, '')
  if (!/\.(md|markdown)$/i.test(path)) return null
  return {
    path,
    anchor: hash < 0 ? '' : decodeURIComponent(href.slice(hash + 1))
  }
}

export function resolveMarkdownFileLink(
  link: MarkdownFileLink,
  repositoryPath: string,
  from = ''
): string {
  if (
    !repositoryPath ||
    link.path.includes('\\') ||
    /\p{Cc}/u.test(link.path)
  ) {
    throw new Error('Invalid Markdown file link')
  }
  const root = repositoryPath.replace(/\/$/, '')
  const absolute = link.path.startsWith('/')
    ? link.path
    : root + '/' + [...from.split('/').slice(0, -1), link.path].join('/')
  const parts: string[] = []
  for (const part of absolute.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!parts.length) throw new Error('Link leaves the repository')
      parts.pop()
    } else {
      parts.push(part)
    }
  }
  const normalized = '/' + parts.join('/')
  if (!normalized.startsWith(root + '/')) {
    throw new Error('Link leaves the repository')
  }
  return normalized.slice(root.length + 1)
}
