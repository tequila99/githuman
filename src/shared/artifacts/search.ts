// Grapheme boundaries retain the original range when NFC or lowercase changes its length.
const SEGMENTER = new Intl.Segmenter('und', { granularity: 'grapheme' })
export type SearchOffset = [number, number, number, number]

export function normalizeSearch(text: string): string {
  return text.normalize('NFC').toLowerCase().replaceAll('ё', 'е')
}
export function searchCopy(text: string): {
  text: string
  offsets: SearchOffset[]
} {
  // ASCII has no grapheme-length changes; avoid segmenting large control-heavy documents.
  // oxlint-disable-next-line no-control-regex -- This fast path intentionally recognizes all ASCII code units.
  if (/^[\x00-\x7f]*$/.test(text)) {
    return { text: normalizeSearch(text), offsets: [] }
  }
  let normalized = ''
  const offsets: SearchOffset[] = []
  for (const part of SEGMENTER.segment(text)) {
    const value = normalizeSearch(part.segment)
    if (value.length !== part.segment.length) {
      offsets.push([
        normalized.length,
        normalized.length + value.length,
        part.index,
        part.index + part.segment.length
      ])
    }
    normalized += value
  }
  return { text: normalizeSearch(text), offsets }
}
export function originalSearchRange(
  start: number,
  end: number,
  offsets: readonly SearchOffset[]
): [number, number] {
  function offset(value: number, tail: boolean) {
    let delta = 0
    for (const [from, to, originalFrom, originalTo] of offsets) {
      if (value <= from) break
      if (value < to) return tail ? originalTo : originalFrom
      delta = originalTo - to
    }
    return value + delta
  }
  return [offset(start, false), offset(end, true)]
}
export function searchTokens(text: string, unique = true): string[] {
  const tokens = normalizeSearch(text).match(/[\p{L}\p{N}\p{M}]+/gu) ?? []
  return unique ? [...new Set(tokens)] : tokens
}
export function searchGrams(text: string, width: number): string[] {
  const chars = Array.from(text),
    result = new Set<string>()
  for (let i = 0; i <= chars.length - width; i++) {
    result.add(chars.slice(i, i + width).join(''))
  }
  return [...result]
}
export function searchEditLimit(token: string): number {
  const length = Array.from(token).length
  return length <= 3 ? 0 : length <= 7 ? 1 : 2
}
// Keep unrestricted transpositions while bounding useful cells to the edit-distance band.
export function boundedSearchDistance(
  left: string,
  right: string,
  limit: number
): number {
  const a = Array.from(left),
    b = Array.from(right)
  if (Math.abs(a.length - b.length) > limit) return limit + 1
  const matrix = new Map<number, Map<number, number>>()
  const cell = (i: number, j: number) => matrix.get(i)?.get(j) ?? limit + 1
  const put = (i: number, j: number, value: number) => {
    let row = matrix.get(i)
    if (!row) {
      row = new Map()
      matrix.set(i, row)
    }
    row.set(j, value)
  }
  for (let i = 0; i <= a.length; i++) put(i + 1, 1, i)
  for (let j = 0; j <= b.length; j++) put(1, j + 1, j)
  const last = new Map<string, number>()
  for (let i = 1; i <= a.length; i++) {
    let matched = 0
    for (let j = 1; j <= b.length; j++) {
      const previousRow = last.get(b[j - 1] ?? '') ?? 0,
        previousColumn = matched
      const cost = Number(a[i - 1] !== b[j - 1])
      if (!cost) matched = j
      if (Math.abs(i - j) > limit) continue
      put(
        i + 1,
        j + 1,
        Math.min(
          cell(i, j) + cost,
          cell(i + 1, j) + 1,
          cell(i, j + 1) + 1,
          cell(previousRow, previousColumn) +
            (i - previousRow - 1) +
            1 +
            (j - previousColumn - 1)
        )
      )
    }
    last.set(a[i - 1] ?? '', i)
  }
  return cell(a.length + 1, b.length + 1)
}
export function searchMatchExpression(groups: readonly string[][]): string {
  return groups
    .map(group => group.filter(token => token.length > 0))
    .filter(group => group.length > 0)
    .map(
      group =>
        `(${group.map(token => '"' + token.replaceAll('"', '""') + '"').join(' OR ')})`
    )
    .join(' AND ')
}
