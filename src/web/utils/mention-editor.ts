/**
 * Logic of the chat input's `@` file mentions, kept free of the DOM where it
 * can be so it is testable: the editor component only wires it to a
 * contenteditable element.
 */

export interface MentionTrigger {
  /** What has been typed after the `@`. */
  query: string
  /** Index of the `@` in the text that was examined. */
  start: number
}

/**
 * A mention starts at an `@` that opens the text or follows white space (so
 * `me@example.com` is not one) and runs up to the caret without a blank in
 * between. Paths with blanks in them can't be typed — a known limit.
 */
export function findMentionTrigger(
  textBeforeCaret: string
): MentionTrigger | null {
  const match = /(?:^|\s)@([^\s@]*)$/.exec(textBeforeCaret)
  if (!match) return null
  const query = match[1] ?? ''
  return { query, start: textBeforeCaret.length - query.length - 1 }
}

/** The file's name, or `dir/name` when another mention in the message has the same name. */
export function mentionLabel(
  path: string,
  allPaths: readonly string[]
): string {
  const parts = path.split('/')
  const name = parts.at(-1) ?? path
  const clash = allPaths.some(
    other => other !== path && other.split('/').at(-1) === name
  )
  return clash && parts.length > 1 ? parts.slice(-2).join('/') : name
}

/** The structure of the editor's content, as far as sending a message cares. */
export type EditorNode =
  | { type: 'text'; text: string }
  | { type: 'br' }
  | { type: 'mention'; path: string }
  /** A block such as the `<div>` browsers wrap new lines in. */
  | { type: 'block'; children: EditorNode[] }

export interface SerializedMessage {
  /** The message text; every mention reads `@path` in it. */
  text: string
  /** Mentioned files, each once, in order of appearance. */
  files: string[]
}

/**
 * Flattens the editor content to the text sent to the agent plus the files
 * mentioned. Mentions stay in the text as `@path` — a marker the agent can
 * read — while the file's content travels once, as context.
 */
export function serializeEditor(
  nodes: readonly EditorNode[]
): SerializedMessage {
  const files: string[] = []
  let text = ''

  function walk(list: readonly EditorNode[]): void {
    for (const node of list) {
      if (node.type === 'text') {
        text += node.text
      } else if (node.type === 'br') {
        text += '\n'
      } else if (node.type === 'mention') {
        text += `@${node.path}`
        if (!files.includes(node.path)) files.push(node.path)
      } else {
        // A block starts a line of its own.
        if (text !== '' && !text.endsWith('\n')) text += '\n'
        walk(node.children)
      }
    }
  }
  walk(nodes)
  return { text: text.replace(/ /g, ' ').trim(), files }
}
