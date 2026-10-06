// Matches CSI and SS3 sequences (arrows, Home, End) and a lone ESC with one next character.
// oxlint-disable-next-line eslint/no-control-regex -- the pattern must match the ESC control character
const ESCAPE_SEQUENCE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|O.|.)?/gs

export interface TerminalLineAction {
  draft: string
  lines: string[]
  signal?: 'interrupt' | 'eof'
}
export function editTerminalLine(
  draft: string,
  input: string
): TerminalLineAction {
  const result: TerminalLineAction = { draft, lines: [] }
  // Remove escape sequences first, so their tail never enters the draft.
  // Join CR and LF pairs, so one Enter key press makes one line.
  const text = input.replace(ESCAPE_SEQUENCE, '').replace(/\r\n/g, '\n')
  for (const character of text) {
    if (character === '\x03') {
      // Ctrl+C: discard the draft and tell the caller to send an interrupt.
      result.draft = ''
      result.signal = 'interrupt'
    } else if (character === '\x04') {
      // Ctrl+D: signal end of input only on an empty draft, as a shell does.
      if (!result.draft) result.signal = 'eof'
    } else if (character === '\x7f' || character === '\b') {
      // Backspace: remove the last code point, so a surrogate pair stays whole.
      result.draft = Array.from(result.draft).slice(0, -1).join('')
    } else if (character === '\r' || character === '\n') {
      // Enter: move the draft to the finished lines and start a new draft.
      result.lines.push(result.draft)
      result.draft = ''
    } else if (character >= ' ') {
      // Printable character: append it. Other control characters are dropped.
      result.draft += character
    }
  }
  return result
}
