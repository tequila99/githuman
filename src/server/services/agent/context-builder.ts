import { MAX_ATTACHMENT_BYTES } from '../../../shared/agents/constants.ts'
import { AgentContextError } from '../../errors/agents.ts'
import { errorMessage } from '../../../shared/utils/error-message.ts'
import { formatDiffFile } from '../../../shared/agents/context-format.ts'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { ContentBlock } from '@agentclientprotocol/sdk'
import type {
  AgentContextItem,
  AgentPromptRequest
} from '../../../shared/agents/types.ts'
import type { DiffFile } from '../../../shared/diff/types.ts'
import { getStagedDiff, getUnstagedDiff } from '../diff.service.ts'
import { exportAsMarkdown } from '../export.service.ts'
import { resolveWithinRepo } from '../git.service.ts'
import { safeFileName } from '../../utils/file-name.ts'
import { decodeText, truncateText } from '../../utils/text.ts'

/** Per attached item. Bigger contexts are cut with a visible marker, never silently. */
export const MAX_EMBEDDED_CHARS = 200_000

export interface ContextBuilderDeps {
  db: DatabaseSync
  repositoryPath: string
  /** Agent advertised `promptCapabilities.embeddedContext`. */
  embeddedContext: boolean
  /** Agent advertised `promptCapabilities.image`. */
  image: boolean
  /** Where binary attachments are written for the agent to read; outside the repository. */
  attachmentDir: string
}

/** What ACP agents (and the models behind them) accept as an image block. */
const IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp'
])

function diffFilePath(file: DiffFile): string {
  return file.newPath || file.oldPath
}

function fenceFor(text: string): string {
  const longest = Math.max(
    0,
    ...(text.match(/`+/g) ?? []).map(run => run.length)
  )
  return '`'.repeat(Math.max(3, longest + 1))
}

/**
 * Text the agent cannot fetch on its own (a diff of staged content, a review)
 * goes in as an embedded resource when the agent supports it, otherwise as a
 * fenced block in a plain text part — same content either way.
 */
function embed(
  deps: ContextBuilderDeps,
  uri: string,
  title: string,
  mimeType: string,
  text: string
): ContentBlock {
  const body = truncateText(
    text,
    MAX_EMBEDDED_CHARS,
    omitted => `\n… [truncated by githuman: ${omitted} more characters]`
  )
  if (deps.embeddedContext) {
    return { type: 'resource', resource: { uri, mimeType, text: body } }
  }
  const fence = fenceFor(body)
  return { type: 'text', text: `${title}\n${fence}\n${body}\n${fence}` }
}

function asContextError(error: unknown): AgentContextError {
  return new AgentContextError(errorMessage(error), { cause: error })
}

async function buildDiffItem(
  item: Extract<AgentContextItem, { kind: 'diff' }>,
  deps: ContextBuilderDeps
): Promise<ContentBlock> {
  const files =
    item.source === 'staged'
      ? await getStagedDiff(deps.repositoryPath)
      : await getUnstagedDiff(deps.repositoryPath)
  const selected =
    item.path === undefined
      ? files
      : files.filter(file => diffFilePath(file) === item.path)
  if (selected.length === 0) {
    throw new AgentContextError(
      item.path === undefined
        ? `No ${item.source} changes to attach`
        : `No ${item.source} changes in "${item.path}"`
    )
  }
  return embed(
    deps,
    `githuman://diff/${item.source}/${item.path ?? ''}`,
    `Diff (${item.source}${item.path === undefined ? '' : `, ${item.path}`}):`,
    'text/x-diff',
    selected.map(formatDiffFile).join('\n')
  )
}

async function buildFileItem(
  item: Extract<AgentContextItem, { kind: 'file' }>,
  deps: ContextBuilderDeps
): Promise<ContentBlock> {
  let absolute: string
  try {
    absolute = resolveWithinRepo(deps.repositoryPath, item.path)
  } catch (error) {
    throw asContextError(error)
  }
  const info = await stat(absolute).catch(() => null)
  if (!info?.isFile()) {
    throw new AgentContextError(
      `"${item.path}" is not a file in the repository`
    )
  }
  return {
    type: 'resource_link',
    uri: pathToFileURL(absolute).href,
    name: item.path
  }
}

async function buildReviewItem(
  item: Extract<AgentContextItem, { kind: 'review' }>,
  deps: ContextBuilderDeps
): Promise<ContentBlock> {
  let markdown: string
  try {
    markdown = await exportAsMarkdown(
      deps.db,
      item.reviewId,
      deps.repositoryPath
    )
  } catch (error) {
    throw asContextError(error)
  }
  return embed(
    deps,
    `githuman://review/${item.reviewId}`,
    'Code review with comments:',
    'text/markdown',
    markdown
  )
}

/**
 * Images become image blocks, UTF-8 text is embedded. Anything else (PDF,
 * archives, …) is written to disk and passed as a link the agent opens with
 * its own tools: adapters don't hand ACP blob resources to the model as files
 * — codex-acp turns them into a base64 text dump the model can't read.
 */
async function buildAttachmentItem(
  item: Extract<AgentContextItem, { kind: 'attachment' }>,
  deps: ContextBuilderDeps
): Promise<ContentBlock> {
  const bytes = Buffer.from(item.data, 'base64')
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new AgentContextError(
      `"${item.name}" is larger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`
    )
  }
  if (IMAGE_MIME_TYPES.has(item.mimeType)) {
    if (!deps.image) {
      throw new AgentContextError('This agent does not accept images')
    }
    return { type: 'image', mimeType: item.mimeType, data: item.data }
  }
  const text = decodeText(bytes)
  if (text !== null) {
    return embed(
      deps,
      `githuman://attachment/${encodeURIComponent(item.name)}`,
      `Attached file ${item.name}:`,
      item.mimeType || 'text/plain',
      text
    )
  }
  // A directory per attachment keeps the user's file name without collisions.
  const dir = join(deps.attachmentDir, randomUUID())
  const path = join(dir, safeFileName(item.name))
  await mkdir(dir, { recursive: true })
  await writeFile(path, bytes)
  return {
    type: 'resource_link',
    uri: pathToFileURL(path).href,
    name: item.name,
    ...(item.mimeType === '' ? {} : { mimeType: item.mimeType })
  }
}

function buildItem(
  item: AgentContextItem,
  deps: ContextBuilderDeps
): Promise<ContentBlock> {
  if (item.kind === 'diff') {
    return buildDiffItem(item, deps)
  }
  if (item.kind === 'file') {
    return buildFileItem(item, deps)
  }
  if (item.kind === 'attachment') {
    return buildAttachmentItem(item, deps)
  }
  return buildReviewItem(item, deps)
}

/** The user's text first, then each attached item as its own content block. */
export async function buildPromptBlocks(
  request: AgentPromptRequest,
  deps: ContextBuilderDeps
): Promise<ContentBlock[]> {
  const items = await Promise.all(
    (request.context ?? []).map(item => buildItem(item, deps))
  )
  return [{ type: 'text', text: request.text }, ...items]
}
