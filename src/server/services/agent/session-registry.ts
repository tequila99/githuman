import {
  UnknownAgentPresetError,
  TooManyAgentSessionsError
} from '../../errors/agents.ts'
import { MAX_AGENT_SESSIONS } from '../../../shared/agents/constants.ts'
import {
  type AgentPreset,
  type AgentPresetInfo,
  type AgentSessionState,
  type AgentSessionInfo,
  type AgentStreamEnvelope
} from '../../../shared/agents/types.ts'
import { uniqueChatName } from '../../../shared/agents/chat-names.ts'
import { AgentSession } from './agent-session.ts'
import { describePreset } from '../../config/agents.ts'

/** What the registry's single stream carries (ADR 0024). */
export type AgentStreamMessage =
  | { type: 'event'; envelope: AgentStreamEnvelope }
  /** The client missed events of this session for good and must rebuild it. */
  | { type: 'gap'; sessionId: string }
  /** What a session is now. Comes before the replayed events (ADR 0031). */
  | { type: 'state'; state: AgentSessionState }
  /** A session was opened or closed: re-read the list. */
  | { type: 'sessions' }

export type AgentStreamListener = (message: AgentStreamMessage) => void

export interface AgentSessionRegistry {
  listPresets: () => AgentPresetInfo[]
  /**
   * Registers a session and starts its agent in the background: the session is
   * `starting` until the handshake is done, and `closed` (with `error`) if it fails.
   */
  create: (
    presetId: string,
    reviewId: string | null,
    name?: string
  ) => AgentSession
  get: (id: string) => AgentSession | undefined
  list: () => AgentSessionInfo[]
  close: (id: string) => boolean
  closeAll: () => void
  /**
   * Replays what every session buffered after `afterId` (oldest first), then
   * delivers live messages. Returns an unsubscribe function.
   */
  subscribe: (listener: AgentStreamListener, afterId?: number) => () => void
}

export function createSessionRegistry(options: {
  presets: readonly AgentPreset[]
  repositoryPath: string
  /** Per-session event buffer size (tests shrink it to provoke gaps). */
  bufferLimit?: number
}): AgentSessionRegistry {
  const sessions = new Map<string, AgentSession>()
  const unsubscribeSession = new Map<string, () => void>()
  const listeners = new Set<AgentStreamListener>()
  let lastEventId = 0

  function broadcast(message: AgentStreamMessage): void {
    for (const listener of listeners) {
      listener(message)
    }
  }

  function drop(id: string): void {
    unsubscribeSession.get(id)?.()
    unsubscribeSession.delete(id)
    sessions.delete(id)
  }

  function closeAll(): void {
    for (const session of sessions.values()) {
      session.close()
    }
    for (const id of sessions.keys()) {
      drop(id)
    }
  }

  return {
    listPresets: () => options.presets.map(describePreset),
    create(presetId, reviewId, name) {
      const preset = options.presets.find(p => p.id === presetId)
      if (!preset) {
        throw new UnknownAgentPresetError(`Unknown agent "${presetId}"`)
      }
      if (sessions.size >= MAX_AGENT_SESSIONS) {
        throw new TooManyAgentSessionsError(
          `At most ${MAX_AGENT_SESSIONS} chats can be open at once`
        )
      }
      const session = new AgentSession({
        preset,
        // Open chats are told apart by name: a taken one gets "(1)", "(2)", …
        name: uniqueChatName(
          name?.trim() || preset.title,
          [...sessions.values()].map(s => s.name)
        ),
        cwd: options.repositoryPath,
        reviewId,
        nextEventId: () => ++lastEventId,
        ...(options.bufferLimit === undefined
          ? {}
          : { bufferLimit: options.bufferLimit })
      })
      sessions.set(session.id, session)
      unsubscribeSession.set(
        session.id,
        session.onEvent(envelope => {
          broadcast({
            type: 'event',
            envelope: { ...envelope, sessionId: session.id }
          })
        })
      )
      broadcast({ type: 'sessions' })
      void session.start()
      return session
    },
    get: id => sessions.get(id),
    list: () => [...sessions.values()].map(s => s.info()),
    close(id) {
      const session = sessions.get(id)
      if (!session) {
        return false
      }
      session.close()
      drop(id)
      broadcast({ type: 'sessions' })
      return true
    },
    closeAll,
    subscribe(listener, afterId = 0) {
      const replays = [...sessions.values()].map(session => ({
        sessionId: session.id,
        ...session.replay(afterId)
      }))
      for (const { sessionId, gap } of replays) {
        if (gap) {
          listener({ type: 'gap', sessionId })
        }
        // The buffer starts late for a new client or after a gap, so it may
        // lack the events that set the status, settings and open requests.
        if (gap || afterId === 0) {
          const state = sessions.get(sessionId)?.state()
          if (state) {
            listener({ type: 'state', state })
          }
        }
      }
      replays
        .flatMap(({ sessionId, envelopes }) =>
          envelopes.map(envelope => ({ ...envelope, sessionId }))
        )
        .sort((a, b) => a.id - b.id)
        .forEach(envelope => listener({ type: 'event', envelope }))
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}
