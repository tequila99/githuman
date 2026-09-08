/**
 * Decodes a git-quoted path (core.quotePath format, e.g. `"\320\220..."`)
 * back to a proper UTF-8 string. Paths that are not quoted are returned
 * unchanged — this is defense-in-depth for a server that may not pass `-z`
 * to git, where non-ASCII bytes get octal-escaped and the whole path
 * wrapped in double quotes.
 */
export function decodeGitPath(raw: string): string {
  if (raw.length < 2 || raw[0] !== '"' || raw[raw.length - 1] !== '"') {
    return raw
  }

  const inner = raw.slice(1, -1)
  const bytes: number[] = []

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (ch === '\\' && /^[0-7]{3}$/.test(inner.slice(i + 1, i + 4))) {
      bytes.push(parseInt(inner.slice(i + 1, i + 4), 8))
      i += 3
    } else if (ch === '\\' && inner[i + 1] === '"') {
      bytes.push(0x22)
      i += 1
    } else if (ch === '\\' && inner[i + 1] === '\\') {
      bytes.push(0x5c)
      i += 1
    } else {
      bytes.push((ch ?? '').charCodeAt(0))
    }
  }

  return new TextDecoder('utf-8').decode(new Uint8Array(bytes))
}
