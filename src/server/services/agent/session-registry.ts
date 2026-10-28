import { randomBytes } from 'node:crypto'
import {
  ARTIFACT_AGENT_BEARER_PATTERN,
  ARTIFACT_AGENT_KEY_BYTES,
  ARTIFACT_AGENT_KEY_ENV,
  ARTIFACT_AGENT_URL_ENV
} from '../../../shared/artifacts/mcp-constants.ts'
import { fileURLToPath } from 'node:url'
import { sha256Hex } from '../../utils/hash.ts'
import { ForbiddenError } from '../../errors/http.ts'
import type { DeviceConnections } from '../device-connections.ts'
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
  | { type: 'artifact-actions' }

export type AgentStreamListener = (message: AgentStreamMessage) => void

export interface AgentSessionRegistry {
  authenticateArtifactKey: (
    authorization: string | undefined
  ) => string | undefined
  trackArtifactRequest: (sessionId: string, close: () => void) => () => void
  notifyTasksChanged: () => void
  notifyArtifactActionsChanged?: () => void
  listPresets: () => AgentPresetInfo[]
  /**
   * Registers a session and starts its agent in the background: the session is
   * `starting` until the handshake is done, and `closed` (with `error`) if it fails.
   */
  create: (
    presetId: string,
    reviewId: string | null,
    name?: string,
    deviceId?: string
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
  taskIds?: (sessionId: string) => string[]
  artifactUrl?: () => string | undefined
  connections?: DeviceConnections
}): AgentSessionRegistry {
  const sessions = new Map<string, AgentSession>()
  const unsubscribeSession = new Map<string, () => void>()
  const listeners = new Set<AgentStreamListener>()
  const keys = new Map<string, string>()
  const sessionKeys = new Map<string, string>()
  const deviceReleases = new Map<string, () => void>()
  const requests = new Map<string, Set<() => void>>()
  let lastEventId = 0

  function revoke(id: string): void {
    const key = sessionKeys.get(id)
    if (key) keys.delete(key)
    sessionKeys.delete(id)
    deviceReleases.get(id)?.()
    deviceReleases.delete(id)
    for (const close of requests.get(id) ?? []) close()
    requests.delete(id)
  }

  function mcpServers(id: string) {
    const url = options.artifactUrl?.()
    if (!url) return []
    if (sessions.get(id)?.status === 'closed') {
      throw new ForbiddenError('Agent session is closed.')
    }
    // One live key per session: a second call replaces the first.
    const previous = sessionKeys.get(id)
    if (previous) keys.delete(previous)
    const key = randomBytes(ARTIFACT_AGENT_KEY_BYTES).toString('hex')
    const hash = sha256Hex(key)
    keys.set(hash, id)
    sessionKeys.set(id, hash)
    const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js'
    return [
      {
        name: 'githuman_artifacts',
        command: process.execPath,
        args: [
          fileURLToPath(
            new URL(`../../../cli/index.${extension}`, import.meta.url)
          ),
          'mcp',
          '--stdio'
        ],
        env: [
          { name: ARTIFACT_AGENT_URL_ENV, value: url },
          { name: ARTIFACT_AGENT_KEY_ENV, value: key }
        ]
      }
    ]
  }

  function broadcast(message: AgentStreamMessage): void {
    for (const listener of listeners) {
      listener(message)
    }
  }

  function drop(id: string): void {
    revoke(id)
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
    authenticateArtifactKey(authorization) {
      options.connections?.recheck()
      if (
        !authorization ||
        !ARTIFACT_AGENT_BEARER_PATTERN.test(authorization)
      ) {
        return undefined
      }
      const id = keys.get(sha256Hex(authorization.slice(7)))
      if (!id || sessions.get(id)?.status === 'closed') return undefined
      return id
    },
    trackArtifactRequest(id, close) {
      let pending = requests.get(id)
      if (!pending) {
        pending = new Set()
        requests.set(id, pending)
      }
      pending.add(close)
      let released = false
      // A response fires both finish and close, so the second call must do nothing.
      return () => {
        if (released) return
        released = true
        pending.delete(close)
        if (pending.size === 0 && requests.get(id) === pending) {
          requests.delete(id)
        }
      }
    },
    notifyTasksChanged: () => broadcast({ type: 'sessions' }),
    notifyArtifactActionsChanged: () => broadcast({ type: 'artifact-actions' }),
    listPresets: () => options.presets.map(describePreset),
    create(presetId, reviewId, name, deviceId) {
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
        mcpServers,
        // Open chats are told apart by name: a taken one gets "(1)", "(2)", …
        name: uniqueChatName(
          name?.trim() || preset.title,
          [...sessions.values()].map(s => s.name)
        ),
        cwd: options.repositoryPath,
        reviewId,
        ...(options.taskIds ? { taskIds: options.taskIds } : {}),
        nextEventId: () => ++lastEventId,
        ...(options.bufferLimit === undefined
          ? {}
          : { bufferLimit: options.bufferLimit })
      })
      sessions.set(session.id, session)
      unsubscribeSession.set(
        session.id,
        session.onEvent(envelope => {
          if (
            envelope.event.type === 'status' &&
            envelope.event.status === 'closed'
          ) {
            revoke(session.id)
          }
          broadcast({
            type: 'event',
            envelope: { ...envelope, sessionId: session.id }
          })
        })
      )
      if (deviceId !== undefined) {
        const release = options.connections?.trackDevice(deviceId, () =>
          session.close()
        )
        if (!release) {
          session.close()
          return session
        }
        deviceReleases.set(session.id, release)
      }
      broadcast({ type: 'sessions' })
      void session.start()
      return session
    },
    get: id => sessions.get(id),
    list: () => [...sessions.values()].map(session => session.info()),
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
