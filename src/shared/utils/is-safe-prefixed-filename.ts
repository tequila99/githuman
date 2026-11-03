// Keep the name to one path component; filesystem containment needs a separate check.
export function isSafePrefixedFilename(name: string, prefix: string): boolean {
  return (
    name.length > 0 &&
    name !== '.' &&
    name !== '..' &&
    name.startsWith(prefix) &&
    !name.includes('/') &&
    !name.includes('\\') &&
    !name.includes('\0')
  )
}
