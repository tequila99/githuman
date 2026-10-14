export function noteLink(from: string, to: string): string {
  const base = from.split('/').slice(0, -1)
  const target = to.split('/')
  while (base.length && target.length && base[0] === target[0]) {
    base.shift()
    target.shift()
  }
  return [
    ...base.map(() => '..'),
    ...target.map(segment =>
      encodeURIComponent(segment).replace(
        /[!'()*]/g,
        char => '%' + char.charCodeAt(0).toString(16)
      )
    )
  ].join('/')
}

export function resolveNoteLink(
  from: string,
  href: string
): { path: string; anchor: string } | null {
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//')) return null
  if (href.startsWith('/') || href.includes('\\') || href.includes('?')) {
    throw new Error('Invalid note link')
  }
  const [target = '', fragment = ''] = href.split('#')
  const decoded = decodeURIComponent(target)
  if (
    decoded.includes('\\') ||
    decoded.includes('\0') ||
    decoded.startsWith('/')
  ) {
    throw new Error('Invalid note link')
  }
  const parts = target ? from.split('/').slice(0, -1) : from.split('/')
  for (const part of decoded.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!parts.length) throw new Error('Link leaves the notes folder')
      parts.pop()
    } else {
      parts.push(part)
    }
  }
  const path = parts.join('/')
  if (!path.toLowerCase().endsWith('.md')) {
    throw new Error('This link does not point to a Markdown note')
  }
  return { path, anchor: decodeURIComponent(fragment) }
}
