export interface TextPosition {
  before: string
  leading: string
  character: string
  trailing: string
  after: string
}

/**
 * Splits `text` around a 1-based line and column. The column counts UTF-16
 * code units and is clamped to the line. Returns `null` when the line is absent.
 */
export function locateLine(
  text: string,
  line: number | undefined,
  column = 1
): TextPosition | null {
  if (!line || !Number.isSafeInteger(line) || line < 1) return null
  let start = 0
  for (let index = 1; index < line; index++) {
    const end = text.indexOf('\n', start)
    if (end < 0) return null
    start = end + 1
  }
  const end = text.indexOf('\n', start)
  const stop = end < 0 ? text.length : end
  const at = Math.min(stop, start + Math.max(0, column - 1))
  const next = Math.min(at + 1, stop)
  return {
    before: text.slice(0, start),
    leading: text.slice(start, at),
    character: text.slice(at, next),
    trailing: text.slice(next, stop),
    after: text.slice(stop)
  }
}
