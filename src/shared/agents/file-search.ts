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
  const base = lower.slice(lower.lastIndexOf('/') + 1)
  if (base === query) return 0
  if (base.startsWith(query)) return 1
  if (base.includes(query)) return 2
  if (lower.includes(query)) return 3
  if (isSubsequence(query, lower)) return 4
  return undefined
}

/**
 * Orders `files` by how well they match `query`: file name first (exact,
 * prefix, substring), then anywhere in the path, then as scattered letters.
 * Ties go to the shorter path. An empty query matches everything.
 */
export function rankFiles(files: readonly string[], query: string): string[] {
  const needle = query.trim().toLowerCase()
  const scored: { path: string; rank: number }[] = []
  for (const path of files) {
    const rank = needle === '' ? 0 : score(path, needle)
    if (rank !== undefined) {
      scored.push({ path, rank })
    }
  }
  return scored
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.path.length - b.path.length ||
        a.path.localeCompare(b.path)
    )
    .map(entry => entry.path)
}
