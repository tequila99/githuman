import type { AgentContextItem } from '@/api/types'
import {
  isDirectoryPath,
  mentionParts,
  withoutTrailingSlash
} from '../../shared/agents/mention-paths.ts'

/**
 * Logic of the chat input's `@` mentions of files and directories, kept free of the DOM where it
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

/**
 * The name of a file or directory (`web/`), or `dir/name` when another mention
 * in the message has the same name.
 */
export function mentionLabel(
  path: string,
  allPaths: readonly string[]
): string {
  const { name, parent } = mentionParts(path)
  const clash = allPaths.some(
    other => other !== path && mentionParts(other).name === name
  )
  const above = parent.split('/').at(-1) ?? ''
  return clash && above !== '' ? `${above}/${name}` : name
}

/** The context items for the mentioned paths: a path that ends with `/` is a directory (#80). */
export function mentionContext(paths: readonly string[]): AgentContextItem[] {
  return paths.map(path =>
    isDirectoryPath(path)
      ? { kind: 'directory', path: withoutTrailingSlash(path) }
      : { kind: 'file', path }
  )
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
  /** Mentioned paths, each once, in order of appearance. A directory path ends with `/`. */
  paths: string[]
}

/**
 * Flattens the editor content to the text sent to the agent plus the paths
 * mentioned. Mentions stay in the text as `@path` — a marker the agent can
 * read — while each file or directory goes once, as context.
 */
export function serializeEditor(
  nodes: readonly EditorNode[]
): SerializedMessage {
  const paths: string[] = []
  let text = ''

  function walk(list: readonly EditorNode[]): void {
    for (const node of list) {
      if (node.type === 'text') {
        text += node.text
      } else if (node.type === 'br') {
        text += '\n'
      } else if (node.type === 'mention') {
        text += `@${node.path}`
        if (!paths.includes(node.path)) paths.push(node.path)
      } else {
        // A block starts a line of its own.
        if (text !== '' && !text.endsWith('\n')) text += '\n'
        walk(node.children)
      }
    }
  }
  walk(nodes)
  return { text: text.replace(/ /g, ' ').trim(), paths }
}
