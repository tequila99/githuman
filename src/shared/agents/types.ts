import type { Static } from '@sinclair/typebox'
import type {
  CreateSessionBody,
  ContextItem,
  PromptBody,
  AutoApproveBody,
  ConfigBody,
  PermissionBody
} from './schemas.ts'

/** An ACP agent the user can start a chat session with (see `server/config/agents.ts`). */
export interface AgentPresetInfo {
  id: string
  title: string
  /** The launcher binary was found in PATH. Says nothing about login/auth. */
  available: boolean
  /** The agent applies edits without ever asking (pi-acp sends no permission requests). */
  autoApprovesEdits: boolean
}

export type AgentSessionStatus = 'starting' | 'ready' | 'busy' | 'closed'

export interface AgentSessionInfo {
  id: string
  presetId: string
  /** What the chat is called in the UI. */
  name: string
  status: AgentSessionStatus
  reviewId: string | null
  /** The server answers the agent's permission requests itself (see `AgentChatEvent` `auto-approve`). */
  autoApprove: boolean
  /** Why the session ended, when it ended because it could not start. */
  error: string | null
}

export type CreateAgentSessionRequest = Static<typeof CreateSessionBody>

/**
 * Context the user attaches to a prompt. `diff` is the live working-tree
 * diff (optionally one file); `file` is a path inside the repository, handed
 * to the agent as a link it reads itself; `review` is the review rendered as
 * markdown with its comments; `attachment` is a file from the user's machine
 * (uploaded or a pasted image), base64 in `data` — images go to the agent as
 * images, anything else as an embedded file.
 */
export type AgentContextItem = Static<typeof ContextItem>

export type AgentPromptRequest = Static<typeof PromptBody>

export interface AgentToolDiff {
  path: string
  oldText: string | null
  newText: string
  /** The server cut `oldText` or `newText`: the diff shows only the start of the file. */
  truncated?: true
}

/** The states of an ACP tool call (`ToolCallStatus`); the list lets code check a string at run time. */
export const AGENT_TOOL_STATUSES = [
  'pending',
  'in_progress',
  'completed',
  'failed'
] as const

export type AgentToolStatus = (typeof AGENT_TOOL_STATUSES)[number]

/** The status if `value` names one, else `undefined`: ACP statuses arrive as plain strings. */
export function toAgentToolStatus(
  value: string | null | undefined
): AgentToolStatus | undefined {
  return AGENT_TOOL_STATUSES.find(status => status === value)
}

export interface AgentPermissionOption {
  optionId: string
  name: string
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always'
}

/**
 * One event of a chat session's SSE stream. Message and tool events are
 * incremental: clients concatenate `message` chunks and merge `tool` events
 * by `toolCallId` (only fields that changed are present on updates).
 */
export type AgentChatEvent =
  | { type: 'status'; status: AgentSessionStatus; error?: string }
  /** The full, current set of settings; each event replaces the previous one. */
  | { type: 'config'; options: AgentConfigOption[] }
  /** What the user sent. Part of the stream so a reloaded page or a second tab rebuilds the whole transcript. */
  | { type: 'user'; text: string; context: AgentContextItem[] }
  | { type: 'message'; role: 'agent' | 'thought'; text: string }
  | {
      type: 'tool'
      toolCallId: string
      title?: string
      kind?: string
      status?: AgentToolStatus
      locations?: string[]
      diffs?: AgentToolDiff[]
      output?: string
    }
  | {
      type: 'permission'
      requestId: string
      toolCallId: string
      title: string
      options: AgentPermissionOption[]
      diffs: AgentToolDiff[]
    }
  | { type: 'permission-resolved'; requestId: string }
  /** The auto-approve switch changed (ADR 0024). */
  | { type: 'auto-approve'; enabled: boolean }
  /** A permission request the server granted by itself — kept in the transcript for audit. */
  | { type: 'auto-approved'; title: string }
  | { type: 'plan'; entries: { content: string; status: string }[] }
  | { type: 'usage'; used: number; size: number; cost?: number }
  | { type: 'stop'; stopReason: string }
  | { type: 'error'; message: string }

/** A permission request as the stream carries it. */
export type AgentPermissionRequest = Extract<
  AgentChatEvent,
  { type: 'permission' }
>

/**
 * What a chat is now. Events carry the same facts, but a client that joins
 * late or misses events cannot rebuild them from a buffer that dropped the
 * old ones. The stream sends this before it replays events (ADR 0031).
 */
export interface AgentSessionState {
  sessionId: string
  status: AgentSessionStatus
  autoApprove: boolean
  config: AgentConfigOption[]
  /** Requests still waiting for an answer. */
  permissions: AgentPermissionRequest[]
}

/**
 * One event of a chat session. `id` comes from a counter shared by all
 * sessions, so it is strictly increasing within a session and one
 * `Last-Event-ID` serves the single stream that carries every chat.
 */
export interface AgentChatEnvelope {
  id: number
  event: AgentChatEvent
}

/** SSE `data` of the `agent` event on `GET /api/agent/events` (its `id` is the SSE `id`). */
export interface AgentStreamEnvelope extends AgentChatEnvelope {
  sessionId: string
}

export type AgentSetAutoApproveRequest = Static<typeof AutoApproveBody>

export interface AgentFileSearchResponse {
  files: string[]
}

/**
 * A per-session setting the agent exposes (ACP `configOptions`): usually
 * `model`, `mode` and `thought_level`. Select options of grouped lists are
 * flattened — each option carries its group's name.
 */
export interface AgentConfigOption {
  id: string
  name: string
  /** ACP semantic category — 'model' | 'mode' | 'thought_level' | agent-specific. */
  category?: string
  description?: string
  type: 'select' | 'boolean'
  currentValue: string | boolean
  /** Only for `select`. */
  options?: AgentConfigChoice[]
}

export interface AgentConfigChoice {
  value: string
  name: string
  description?: string
  group?: string
}

export type AgentSetConfigRequest = Static<typeof ConfigBody>

export type AgentPermissionAnswer = Static<typeof PermissionBody>

export interface AgentPreset {
  id: string
  title: string
  /** Launcher binary, looked up in PATH (never a shell string). */
  command: string
  args: string[]
  /** Extra binary the adapter shells out to; its absence makes the preset unavailable. */
  requires?: string
  autoApprovesEdits: boolean
  env?: Record<string, string>
}
