import type {
  AgentChatEnvelope,
  AgentConfigOption,
  AgentContextItem,
  AgentPermissionOption,
  AgentSessionInfo,
  AgentSessionState,
  AgentSessionStatus,
  AgentStreamEnvelope,
  AgentToolDiff,
  AgentToolStatus
} from '@/api/types'
import { isRecord } from '@/utils/guards'

export type ChatItem =
  | { kind: 'user'; id: string; text: string; context: AgentContextItem[] }
  | { kind: 'agent' | 'thought'; id: string; text: string }
  | {
      kind: 'tool'
      id: string
      title: string
      toolKind: string | undefined
      status: AgentToolStatus
      locations: string[]
      diffs: AgentToolDiff[]
      output: string | undefined
    }
  | { kind: 'error'; id: string; text: string }
  /** A permission request the server granted by itself (auto-approve). */
  | { kind: 'auto-approved'; id: string; title: string }

export interface PendingPermission {
  requestId: string
  toolCallId: string
  title: string
  options: AgentPermissionOption[]
  diffs: AgentToolDiff[]
}

export interface ChatState {
  items: ChatItem[]
  permissions: PendingPermission[]
  status: AgentSessionStatus
  usage: { used: number; size: number; cost: number | undefined } | null
  /** The agent's settings (model, mode, …) as last published. */
  config: AgentConfigOption[]
  /** The server answers the agent's permission requests itself. */
  autoApprove: boolean
  /** Sequence number of the last event applied; replays of older ones are ignored. */
  lastEventId: number
  lastStopReason: string | null
}

function toolItemId(toolCallId: string): string {
  return `tool:${toolCallId}`
}

export function createChatState(): ChatState {
  return {
    items: [],
    permissions: [],
    status: 'starting',
    usage: null,
    config: [],
    autoApprove: false,
    lastEventId: 0,
    lastStopReason: null
  }
}

/**
 * Folds one session event into the transcript (mutating `state`, which is
 * reactive in the store). Message chunks extend the trailing item of the same
 * role; tool events merge by `toolCallId` — only changed fields are sent.
 * Events at or below `lastEventId` are skipped so a reconnect replay can't
 * duplicate anything.
 */
export function applyEnvelope(
  state: ChatState,
  envelope: AgentChatEnvelope
): void {
  if (envelope.id <= state.lastEventId) return
  state.lastEventId = envelope.id
  const { event } = envelope
  // Prefixed: a tool call id from the agent must not equal an event id.
  const id = `ev:${envelope.id}`

  switch (event.type) {
    case 'status':
      state.status = event.status
      break
    case 'config':
      state.config = event.options
      break
    case 'user':
      state.items.push({
        kind: 'user',
        id,
        text: event.text,
        context: event.context
      })
      break
    case 'message': {
      const last = state.items.at(-1)
      const kind = event.role
      if (last && last.kind === kind) {
        last.text += event.text
      } else {
        state.items.push({ kind, id, text: event.text })
      }
      break
    }
    case 'tool': {
      const existing = state.items.find(
        (item): item is Extract<ChatItem, { kind: 'tool' }> =>
          item.kind === 'tool' && item.id === toolItemId(event.toolCallId)
      )
      if (existing) {
        if (event.title) existing.title = event.title
        if (event.kind) existing.toolKind = event.kind
        if (event.status) existing.status = event.status
        if (event.locations) existing.locations = event.locations
        if (event.diffs) existing.diffs = event.diffs
        if (event.output !== undefined) existing.output = event.output
      } else {
        state.items.push({
          kind: 'tool',
          id: toolItemId(event.toolCallId),
          title: event.title ?? '',
          toolKind: event.kind,
          status: event.status ?? 'pending',
          locations: event.locations ?? [],
          diffs: event.diffs ?? [],
          output: event.output
        })
      }
      break
    }
    case 'permission':
      // The session state may already list this request (ADR 0031).
      if (!state.permissions.some(p => p.requestId === event.requestId)) {
        state.permissions.push({
          requestId: event.requestId,
          toolCallId: event.toolCallId,
          title: event.title,
          options: event.options,
          diffs: event.diffs
        })
      }
      break
    case 'permission-resolved':
      state.permissions = state.permissions.filter(
        p => p.requestId !== event.requestId
      )
      break
    case 'auto-approve':
      state.autoApprove = event.enabled
      break
    case 'auto-approved':
      state.items.push({ kind: 'auto-approved', id, title: event.title })
      break
    case 'usage':
      state.usage = {
        used: event.used,
        size: event.size,
        cost: event.cost
      }
      break
    case 'stop':
      state.lastStopReason = event.stopReason
      break
    case 'error':
      state.items.push({ kind: 'error', id, text: event.message })
      break
    case 'plan':
      // Not shown in the MVP.
      break
  }
}

/**
 * Sets what the server says the chat is now. Events that follow in the replay
 * only repeat or refine it, so the chat ends up in the same state either way.
 */
export function applySessionState(
  state: ChatState,
  session: AgentSessionState
): void {
  state.status = session.status
  state.autoApprove = session.autoApprove
  state.config = session.config
  state.permissions = session.permissions.map(
    ({ requestId, toolCallId, title, options, diffs }) => ({
      requestId,
      toolCallId,
      title,
      options,
      diffs
    })
  )
}

/** Parses the `data` of the shared stream's `state` event; null for anything else. */
export function parseSessionState(data: string): AgentSessionState | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return null
  }
  if (
    isRecord(parsed) &&
    typeof parsed.sessionId === 'string' &&
    typeof parsed.status === 'string' &&
    typeof parsed.autoApprove === 'boolean' &&
    Array.isArray(parsed.config) &&
    Array.isArray(parsed.permissions)
  ) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shape checked above; payload comes from our own server (via unknown: a record has no overlap with the state type)
    return parsed as unknown as AgentSessionState
  }
  return null
}

export function contextKey(item: AgentContextItem): string {
  return JSON.stringify(item)
}

/** `base` plus the items of `extra` it does not have yet, in order. */
export function mergeContext(
  base: readonly AgentContextItem[],
  extra: readonly AgentContextItem[]
): AgentContextItem[] {
  const seen = new Set<string>()
  const merged: AgentContextItem[] = []
  for (const item of [...base, ...extra]) {
    const key = contextKey(item)
    if (!seen.has(key)) {
      seen.add(key)
      merged.push(item)
    }
  }
  return merged
}

/** A chat and everything the UI keeps about it. */
export interface AgentChatEntry {
  /** The server's view; the transcript's own state lives in `chat`. */
  info: AgentSessionInfo
  chat: ChatState
  /** Context attached to the next message. */
  pendingContext: AgentContextItem[]
  error: string | null
  /** Files changed after a review was sent to the agent — its line numbers may be off. */
  reviewStale: boolean
  /** The server is asked to end the chat; guards against a second close. */
  closing: boolean
  /** Registration order; lets a session-list snapshot tell stale from new. */
  seq: number
}

/** True when the transcript contains a prompt that carried a review. */
export function hasReviewContext(items: readonly ChatItem[]): boolean {
  return items.some(
    item => item.kind === 'user' && item.context.some(c => c.kind === 'review')
  )
}

/** Parses the `data` of the shared stream's `agent` event; null for anything else. */
export function parseStreamEnvelope(data: string): AgentStreamEnvelope | null {
  const envelope = parseEnvelope(data)
  if (!envelope) return null
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- parseEnvelope vetted the shape; sessionId is checked below
  const { sessionId } = envelope as Partial<AgentStreamEnvelope>
  return typeof sessionId === 'string' && sessionId !== ''
    ? { ...envelope, sessionId }
    : null
}

/** Parses an SSE `data` payload; null for anything that isn't an envelope. */
export function parseEnvelope(data: string): AgentChatEnvelope | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return null
  }
  if (
    isRecord(parsed) &&
    typeof parsed.id === 'number' &&
    isRecord(parsed.event) &&
    typeof parsed.event.type === 'string'
  ) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shape checked above; payload comes from our own server (via unknown: a record has no overlap with the envelope type)
    return parsed as unknown as AgentChatEnvelope
  }
  return null
}
