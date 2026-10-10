import { isDirectoryPath, withoutTrailingSlash } from './mention-paths.ts'

function isSubsequence(needle: string, haystack: string): boolean {
  let at = 0
  for (const char of haystack) {
    if (char === needle[at]) {
      at++
    }
    if (at === needle.length) {
      return true
    }
  }
  return needle.length === 0
}

/** Lower is better; undefined = no match. */
function score(path: string, query: string): number | undefined {
  const lower = path.toLowerCase()
  // A query that ends with `/` names a directory: `web/` or `src/web/` puts
  // `src/web/` first, above the files in it.
  if (query.endsWith('/') && isDirectoryPath(lower) && lower.endsWith(query)) {
    const before = lower.length - query.length
    if (before === 0 || lower[before - 1] === '/') return 0
  }
  // The name of a directory is taken without the `/`: with it, the name is empty.
  const name = withoutTrailingSlash(lower)
  const base = name.slice(name.lastIndexOf('/') + 1)
  if (base === query) return 0
  if (base.startsWith(query)) return 1
  if (base.includes(query)) return 2
  if (lower.includes(query)) return 3
  if (isSubsequence(query, lower)) return 4
  return undefined
}

/**
 * Orders `paths` by how well they match `query`: name first (exact, prefix,
 * substring), then anywhere in the path, then as scattered letters. Ties go
 * to a file before a directory, then to the shorter path. An empty query
 * matches everything, so files lead the list and short directories do not.
 */
export function rankPaths(paths: readonly string[], query: string): string[] {
  const needle = query.trim().toLowerCase()
  const scored: { path: string; rank: number; directory: number }[] = []
  for (const path of paths) {
    const rank = needle === '' ? 0 : score(path, needle)
    if (rank !== undefined) {
      scored.push({ path, rank, directory: isDirectoryPath(path) ? 1 : 0 })
    }
  }
  return scored
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.directory - b.directory ||
        a.path.length - b.path.length ||
        a.path.localeCompare(b.path)
    )
    .map(entry => entry.path)
}
