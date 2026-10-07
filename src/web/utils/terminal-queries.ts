import type { Terminal } from '@xterm/xterm'

// Final bytes of CSI queries: n is a status report, c is device attributes, t is window size.
const CSI_QUERY_FINALS = ['n', 'c', 't']
// Private CSI prefixes that turn the same final bytes into other queries.
const CSI_QUERY_PREFIXES = ['?', '>', '=']
// OSC 4 asks for a palette color. OSC 10, 11 and 12 ask for foreground, background and cursor colors.
const OSC_COLOR_QUERIES = [4, 10, 11, 12]
// OSC 52 reads or writes the clipboard.
const OSC_CLIPBOARD = 52
// DCS $q asks for a setting (DECRQSS). DCS +q asks for a terminfo capability (XTGETTCAP).
const DCS_QUERY_INTERMEDIATES = ['$', '+']

/**
 * Stops this view from answering terminal queries. The server answers them once
 * for every viewer. A second answer from a browser would reach the shell as input.
 */
export function ignoreTerminalQueries(terminal: Terminal): void {
  const { parser } = terminal
  for (const final of CSI_QUERY_FINALS) {
    parser.registerCsiHandler({ final }, () => true)
    for (const prefix of CSI_QUERY_PREFIXES)
      parser.registerCsiHandler({ prefix, final }, () => true)
  }
  // A color OSC with `?` is a query. Without `?` it sets a color, and xterm must apply it.
  for (const identifier of OSC_COLOR_QUERIES)
    parser.registerOscHandler(identifier, data => data.includes('?'))
  parser.registerOscHandler(OSC_CLIPBOARD, () => true)
  for (const intermediates of DCS_QUERY_INTERMEDIATES)
    parser.registerDcsHandler({ intermediates, final: 'q' }, () => true)
}
