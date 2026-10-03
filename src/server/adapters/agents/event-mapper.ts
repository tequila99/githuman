import type {
  RequestPermissionRequest,
  SessionConfigOption,
  SessionUpdate,
  ToolCallContent
} from '@agentclientprotocol/sdk'
import type {
  AgentChatEvent,
  AgentConfigChoice,
  AgentConfigOption,
  AgentToolDiff
} from '../../../shared/agents/types.ts'
import { toAgentToolStatus } from '../../../shared/agents/types.ts'
import { truncateText } from '../../utils/text.ts'

/** Cap on tool output forwarded to the browser; agents can dump whole files. */
const MAX_TOOL_OUTPUT_CHARS = 20_000
/** Cap on each text of a diff in a tool event. The chat shows 200 lines at most. */
const MAX_TOOL_DIFF_CHARS = 20_000
/** Cap for a permission request: the user decides on what the diff shows. */
const MAX_PERMISSION_DIFF_CHARS = 100_000

/** Flattens ACP select options (plain or grouped) into one list. */
function flattenChoices(
  options: Extract<SessionConfigOption, { type: 'select' }>['options']
): AgentConfigChoice[] {
  const choices: AgentConfigChoice[] = []
  for (const entry of options) {
    const members = 'group' in entry ? entry.options : [entry]
    const group = 'group' in entry ? entry.name : undefined
    for (const member of members) {
      choices.push({
        value: member.value,
        name: member.name,
        ...(member.description ? { description: member.description } : {}),
        ...(group === undefined ? {} : { group })
      })
    }
  }
  return choices
}

export function mapConfigOptions(
  options: readonly SessionConfigOption[] | null | undefined
): AgentConfigOption[] {
  return (options ?? []).map(option => ({
    id: option.id,
    name: option.name,
    ...(option.category ? { category: option.category } : {}),
    ...(option.description ? { description: option.description } : {}),
    type: option.type,
    currentValue: option.currentValue,
    ...(option.type === 'select'
      ? { options: flattenChoices(option.options) }
      : {})
  }))
}

/** Cuts both texts of a diff; `truncated` tells the reader that the diff is partial. */
function capDiff(diff: AgentToolDiff, max: number): AgentToolDiff {
  const oldText = diff.oldText === null ? null : diff.oldText.slice(0, max)
  const newText = diff.newText.slice(0, max)
  return oldText === diff.oldText && newText === diff.newText
    ? diff
    : { ...diff, oldText, newText, truncated: true }
}

export function extractToolContent(
  content: ToolCallContent[] | null | undefined,
  maxDiffChars: number = MAX_TOOL_DIFF_CHARS
): {
  diffs: AgentToolDiff[]
  output: string | undefined
} {
  const diffs: AgentToolDiff[] = []
  const texts: string[] = []
  for (const item of content ?? []) {
    if (item.type === 'diff') {
      diffs.push(
        capDiff(
          {
            path: item.path,
            oldText: item.oldText ?? null,
            newText: item.newText
          },
          maxDiffChars
        )
      )
    } else if (item.type === 'content' && item.content.type === 'text') {
      texts.push(item.content.text)
    }
    // 'terminal' content needs the terminal capability, which we don't declare.
  }
  return {
    diffs,
    output:
      texts.length > 0
        ? truncateText(texts.join('\n'), MAX_TOOL_OUTPUT_CHARS)
        : undefined
  }
}

/**
 * Maps one ACP `session/update` to a chat event, or null for updates the UI
 * doesn't show. Sticks to the standard fields (`kind`, `status`, `locations`,
 * `content`) — `_meta` differs per agent (ADR 0023 spike).
 */
export function mapSessionUpdate(update: SessionUpdate): AgentChatEvent | null {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
    case 'agent_thought_chunk':
      return {
        type: 'message',
        role:
          update.sessionUpdate === 'agent_message_chunk' ? 'agent' : 'thought',
        text:
          update.content.type === 'text'
            ? update.content.text
            : `[${update.content.type}]`
      }
    case 'tool_call':
    case 'tool_call_update': {
      const { diffs, output } = extractToolContent(update.content)
      const status = toAgentToolStatus(update.status)
      return {
        type: 'tool',
        toolCallId: update.toolCallId,
        ...(update.title ? { title: update.title } : {}),
        ...(update.kind ? { kind: update.kind } : {}),
        ...(status ? { status } : {}),
        ...(update.locations
          ? { locations: update.locations.map(l => l.path) }
          : {}),
        ...(diffs.length > 0 ? { diffs } : {}),
        ...(output === undefined ? {} : { output })
      }
    }
    case 'plan':
      return {
        type: 'plan',
        entries: update.entries.map(e => ({
          content: e.content,
          status: e.status
        }))
      }
    case 'usage_update':
      return {
        type: 'usage',
        used: update.used,
        size: update.size,
        ...(update.cost ? { cost: update.cost.amount } : {})
      }
    case 'config_option_update':
      return { type: 'config', options: mapConfigOptions(update.configOptions) }
    default:
      // user_message_chunk (we already know what the user typed), command/mode/
      // config/session-info updates, …
      return null
  }
}

export function mapPermissionRequest(
  requestId: string,
  params: RequestPermissionRequest
): Extract<AgentChatEvent, { type: 'permission' }> {
  const { diffs } = extractToolContent(
    params.toolCall.content,
    MAX_PERMISSION_DIFF_CHARS
  )
  return {
    type: 'permission',
    requestId,
    toolCallId: params.toolCall.toolCallId,
    title: params.toolCall.title ?? 'Tool call',
    options: params.options.map(o => ({
      optionId: o.optionId,
      name: o.name,
      kind: o.kind
    })),
    diffs
  }
}
