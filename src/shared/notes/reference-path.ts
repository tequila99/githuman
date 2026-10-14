export function localReference(
  from: string,
  href: string
): { path: string; anchor: string } | null {
  if (
    /^[a-z][a-z\d+.-]*:/i.test(href) ||
    href.startsWith('/') ||
    href.includes('?')
  ) {
    return null
  }
  const hash = href.indexOf('#')
  const target = hash < 0 ? href : href.slice(0, hash)
  const anchor = hash < 0 ? '' : href.slice(hash + 1)
  try {
    const decoded = decodeURIComponent(target)
    if (decoded.startsWith('/') || /[\\\0]/.test(decoded)) return null
    const parts = target ? from.split('/').slice(0, -1) : from.split('/')
    for (const part of decoded.split('/')) {
      if (!part || part === '.') continue
      if (part === '..') {
        if (!parts.length) return null
        parts.pop()
      } else {
        parts.push(part)
      }
    }
    return { path: parts.join('/'), anchor }
  } catch {
    return null
  }
}

export function wikiReference(
  value: string,
  from: string,
  paths: readonly string[]
): {
  path: string | null
  anchor: string
  label: string
  ambiguous: boolean
} | null {
  const match = value.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/)
  if (!match) return null
  const [name = '', anchor = ''] = match[1]!.split('#')
  const target = /\.md$/i.test(name) ? name : name + '.md'
  const local = localReference(
    from,
    target.split('/').map(encodeURIComponent).join('/')
  )?.path
  const candidates = paths.filter(path => path.split('/').at(-1) === target)
  const path =
    local && paths.includes(local)
      ? local
      : paths.includes(target)
        ? target
        : candidates.length === 1
          ? candidates[0]!
          : null
  return {
    path,
    anchor,
    label: match[2] ?? name.replace(/\.md$/i, ''),
    ambiguous: candidates.length > 1 && !path
  }
}
