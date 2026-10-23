export type TerminalKey = 'escape' | 'tab' | 'up' | 'down' | 'left' | 'right'

// xterm sends these when an application enables focus reporting (DECSET 1004).
const FOCUS_REPORTS = new Set(['\u001b[I', '\u001b[O'])

/** A focus report is not user input: a hidden or inactive terminal still sends it. */
export function isFocusReport(data: string): boolean {
  return FOCUS_REPORTS.has(data)
}

export function terminalKeyInput(
  key: TerminalKey,
  applicationCursor: boolean
): string {
  if (key === 'escape') return '\u001b'
  if (key === 'tab') return '\t'
  const suffix = { up: 'A', down: 'B', right: 'C', left: 'D' }[key]
  return `\u001b${applicationCursor ? 'O' : '['}${suffix}`
}

export function terminalControlInput(data: string): string {
  if (data.length !== 1) return data
  if (data.charCodeAt(0) > 127) return data
  if (data === ' ') return '\0'
  if (data === '?') return '\u007f'
  const code = data.toUpperCase().charCodeAt(0)
  return code >= 64 && code <= 95 ? String.fromCharCode(code - 64) : data
}
