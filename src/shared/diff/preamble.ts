// The farthest line, above a hunk, that its preamble may reach (ADR 0036). The reach is a
// limit, not the size: the preamble starts at a safe line within it. A reach of 60 gave the
// fewest wrong lines in a test on the history of this repository.
export const PREAMBLE_REACH = 60

// A budget for one preamble, in characters. A minified file has lines of many kilobytes.
const PREAMBLE_MAX_CHARS = 4000

// A line that closes a tag. At the start of a preamble it has no opening tag, and a markup
// grammar then loses its state.
const CLOSER = /^\s*(<\/|\/>|>)/

// A top-level block of a Vue file: the tag stands alone on its line, at column 0.
const VUE_BLOCK_OPEN = /^<(template|script|style)\b[^>]*>\s*$/

/** The opening tag of the Vue block that holds the line at `end` (0-based), or `undefined`. */
function vueBlockOpenTag(lines: readonly string[], end: number) {
  let open: { tag: string; text: string } | undefined
  for (let i = 0; i < end && i < lines.length; i++) {
    const text = lines[i]!
    const match = VUE_BLOCK_OPEN.exec(text)
    if (match) {
      open = { tag: match[1]!, text }
    } else if (open && text.startsWith(`</${open.tag}>`)) {
      open = undefined
    }
  }
  return open?.text
}

/**
 * The lines that go before a hunk in the highlighter, from lines above `firstLine` (1-based).
 * The preamble starts at the farthest safe line within {@link PREAMBLE_REACH}. A line is safe
 * when it is indented no deeper than every line after it, up to the hunk, and does not close
 * a tag. Then the preamble holds no line that closes a block opened above it, and the
 * grammar keeps a sound state. In a Vue file the opening tag of the enclosing block comes
 * first, so the parser knows the language. `sideLines` are all lines of the file on the side
 * of `firstLine`.
 */
export function hunkPreamble(
  path: string,
  sideLines: readonly string[],
  firstLine: number
): string[] {
  const end = Math.min(firstLine - 1, sideLines.length)
  if (end <= 0) return []

  let start = end
  let chars = 0
  let shallowest = Infinity
  for (let i = end - 1; i >= Math.max(0, end - PREAMBLE_REACH); i--) {
    const line = sideLines[i]!
    chars += line.length
    if (chars > PREAMBLE_MAX_CHARS) break
    if (line.trim() === '') continue
    const indent = line.length - line.trimStart().length
    if (indent <= shallowest && !CLOSER.test(line)) start = i
    shallowest = Math.min(shallowest, indent)
  }
  const lines = sideLines.slice(start, end)

  if (path.toLowerCase().endsWith('.vue')) {
    const tag = vueBlockOpenTag(sideLines, start)
    if (tag !== undefined) lines.unshift(tag)
  }
  return lines
}
