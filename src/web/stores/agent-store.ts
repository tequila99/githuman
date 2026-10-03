import { computed, onScopeDispose, ref } from 'vue'
import { defineStore, acceptHMRUpdate } from 'pinia'
import { debounce } from 'quasar'
import { apiDelete, apiGet, apiPost, ApiRequestError } from '@/api/client'
import {
  MAX_AGENT_SESSIONS,
  type AgentContextItem,
  type AgentPermissionAnswer,
  type AgentPresetInfo,
  type AgentPromptRequest,
  type AgentSessionInfo,
  type AgentSessionState,
  type AgentSetAutoApproveRequest,
  type AgentSetConfigRequest,
  type AgentStreamEnvelope,
  type CreateAgentSessionRequest
} from '@/api/types'
import { useServerEvents } from '@/composables/use-server-events'
import {
  applyEnvelope,
  applySessionState,
  contextKey,
  createChatState,
  hasReviewContext,
  mergeContext,
  parseSessionState,
  parseStreamEnvelope,
  type AgentChatEntry
} from '@/utils/agent-chat'
import { errorMessage } from '@/utils/error-message'
import { isRecord } from '@/utils/guards'
import { safeStorage } from '@/utils/safe-storage'
import { singleFlight } from '@/utils/single-flight'

const ACTIVE_CHAT_KEY = 'githuman.agent.activeChat'
const RECONNECT_DELAY_MS = 2000
/** Events of a session the page has not heard of yet are kept, up to this many. */
const MAX_ORPHAN_EVENTS = 2000

export type AddContextResult =
  /** The explicitly addressed chat was removed before the attachment was ready. */
  | 'missing'
  /** Attached to the addressed chat, or the active chat when no id was given. */
  | 'added'
  /** No chat yet: the new-chat dialog opened and will take the context along. */
  | 'dialog'
  /** No chat, and no room for one. */
  | 'limit'

/**
 * The agent chats (ADR 0024). Every chat of the page lives here, fed by one
 * SSE stream that carries all sessions; the server replays what a chat
 * buffered, so a reloaded page or a second tab ends up with the same
 * transcripts. Nothing depends on the panel being open: events keep coming
 * and chats keep updating while it is closed.
 */
export const useAgentStore = defineStore('agent', () => {
  const presets = ref<AgentPresetInfo[]>([])
  /** The server offers agents at all (it answers 404 when bound to a non-loopback host). */
  const enabled = ref(false)
  const chats = ref<Record<string, AgentChatEntry>>({})
  /** Chat ids in creation order — the order of the tabs. */
  const order = ref<string[]>([])
  const activeId = ref<string | null>(null)
  const panelOpen = ref(false)
  const creating = ref(false)
  /** Problems that belong to no chat: loading agents, creating a chat. */
  const error = ref<string | null>(null)
  /** The new-chat dialog; `context` waits for the chat it creates. */
  const newChatDialog = ref<{ open: boolean; context: AgentContextItem[] }>({
    open: false,
    context: []
  })

  let stream: EventSource | null = null
  let reconnectPending = false
  const reconnect = debounce(() => {
    reconnectPending = false
    connectStream()
  }, RECONNECT_DELAY_MS)
  /** After `$dispose()` nothing may bring the stream back. */
  let disposed = false
  let subscribedToFiles = false
  let registrations = 0
  /** Chats closed on this page — a session list fetched before that must not bring them back. */
  const closedIds = new Set<string>()
  /** Events that came before the session itself was known (its POST has not answered yet). */
  const orphans = new Map<string, AgentStreamEnvelope[]>()
  /** The state of a session the page has not heard of yet (see `orphans`). */
  const states = new Map<string, AgentSessionState>()

  // flatMap rather than map: `chats.value[id]` may be undefined (noUncheckedIndexedAccess),
  // and a stray id in `order` should drop out of the list, not crash it.
  const list = computed(() =>
    order.value.flatMap(id => {
      const entry = chats.value[id]
      return entry ? [entry] : []
    })
  )
  const activeChat = computed(() =>
    activeId.value === null ? null : (chats.value[activeId.value] ?? null)
  )
  const canAddChat = computed(() => order.value.length < MAX_AGENT_SESSIONS)

  function registerChat(info: AgentSessionInfo): AgentChatEntry {
    const existing = chats.value[info.id]
    if (existing) {
      existing.info = info
      return existing
    }
    const chat = createChatState()
    chat.status = info.status
    chat.autoApprove = info.autoApprove
    chats.value[info.id] = {
      info,
      chat,
      pendingContext: [],
      error: null,
      reviewStale: false,
      closing: false,
      seq: ++registrations
    }
    order.value.push(info.id)
    const entry = chats.value[info.id]
    if (!entry) throw new Error('unreachable: chat was just registered')
    const state = states.get(info.id)
    if (state) applySessionState(entry.chat, state)
    states.delete(info.id)
    for (const envelope of orphans.get(info.id) ?? []) {
      applyEnvelope(entry.chat, envelope)
    }
    orphans.delete(info.id)
    return entry
  }

  function removeChat(id: string): void {
    const index = order.value.indexOf(id)
    if (index === -1) return
    order.value.splice(index, 1)
    delete chats.value[id]
    orphans.delete(id)
    states.delete(id)
    if (activeId.value === id) {
      selectChat(order.value[index] ?? order.value[index - 1] ?? null)
    }
  }

  function selectChat(id: string | null): void {
    activeId.value = id
    if (id === null) {
      safeStorage.remove(ACTIVE_CHAT_KEY)
    } else {
      safeStorage.set(ACTIVE_CHAT_KEY, id)
    }
  }

  /** Makes the chat the active one and shows the panel. */
  function openChat(id: string): void {
    if (!chats.value[id]) return
    selectChat(id)
    panelOpen.value = true
  }

  /** Brings the chats in line with the server's list (another tab may have opened or closed some). */
  const refreshSessions = singleFlight(async () => {
    const before = registrations
    let sessions: AgentSessionInfo[]
    try {
      sessions = await apiGet<AgentSessionInfo[]>('/api/agent/sessions')
    } catch (err) {
      error.value = errorMessage(err)
      return
    }
    const live = new Set(sessions.map(s => s.id))
    for (const info of sessions) {
      if (!closedIds.has(info.id)) registerChat(info)
    }
    // A chat created after this request went out is not in its answer yet.
    const gone = order.value.filter(
      id => !live.has(id) && (chats.value[id]?.seq ?? 0) <= before
    )
    for (const id of gone) removeChat(id)
    for (const id of orphans.keys()) {
      if (!live.has(id)) orphans.delete(id)
    }
    for (const id of states.keys()) {
      if (!live.has(id)) states.delete(id)
    }
    if (activeId.value === null || !chats.value[activeId.value]) {
      const remembered = safeStorage.get(ACTIVE_CHAT_KEY)
      selectChat(
        (remembered !== null && chats.value[remembered] ? remembered : null) ??
          order.value[0] ??
          null
      )
    }
  })

  function route(envelope: AgentStreamEnvelope): void {
    const entry = chats.value[envelope.sessionId]
    if (entry) {
      applyEnvelope(entry.chat, envelope)
      return
    }
    if (closedIds.has(envelope.sessionId)) return
    const queued = orphans.get(envelope.sessionId) ?? []
    if (queued.length < MAX_ORPHAN_EVENTS) queued.push(envelope)
    orphans.set(envelope.sessionId, queued)
    // Most likely another tab opened it: fetch the list to learn about it.
    void refreshSessions()
  }

  function scheduleReconnect(): void {
    if (disposed || reconnectPending) return
    reconnectPending = true
    reconnect()
  }

  /** Closes the stream for good and drops a reconnect that is waiting. */
  function disconnectStream(): void {
    disposed = true
    reconnect.cancel()
    reconnectPending = false
    stream?.close()
    stream = null
  }

  function connectStream(): void {
    if (disposed || stream) return
    // A connect asked for while a reconnect waits supersedes that wait.
    reconnect.cancel()
    reconnectPending = false
    const es = new EventSource('/api/agent/events')
    // Every handler ignores a stream that is no longer the current one: a closed or
    // replaced `es` must not reset `stream`, arm a reconnect or fetch the list.
    es.addEventListener('agent', event => {
      if (stream !== es) return
      if (!(event instanceof MessageEvent)) return
      const envelope = parseStreamEnvelope(String(event.data))
      if (envelope) route(envelope)
    })
    // The buffer no longer reaches back to what this page saw: rebuild that chat.
    es.addEventListener('gap', event => {
      if (stream !== es) return
      if (!(event instanceof MessageEvent)) return
      try {
        const parsed: unknown = JSON.parse(String(event.data))
        const sessionId =
          isRecord(parsed) && typeof parsed.sessionId === 'string'
            ? parsed.sessionId
            : null
        const entry = sessionId === null ? undefined : chats.value[sessionId]
        // A `state` event follows and sets what the buffer no longer tells.
        if (entry) {
          Object.assign(entry.chat, createChatState())
        } else if (sessionId !== null) {
          orphans.delete(sessionId)
        }
      } catch {
        // A malformed frame is not worth more than ignoring it.
      }
    })
    // What each chat is now: the buffer may have dropped the events that said so (ADR 0031).
    es.addEventListener('state', event => {
      if (stream !== es) return
      if (!(event instanceof MessageEvent)) return
      const state = parseSessionState(String(event.data))
      if (!state) return
      const entry = chats.value[state.sessionId]
      if (entry) {
        applySessionState(entry.chat, state)
      } else if (!closedIds.has(state.sessionId)) {
        states.set(state.sessionId, state)
      }
    })
    es.addEventListener('sessions', () => {
      if (stream !== es) return
      void refreshSessions()
    })
    // After every (re)connect, in case sessions came or went in the meantime.
    es.addEventListener('open', () => {
      if (stream !== es) return
      void refreshSessions()
    })
    es.addEventListener('error', () => {
      if (stream !== es) return
      // CLOSED = the browser gave up (an HTTP error, say); anything else it
      // retries itself, resuming from Last-Event-ID.
      if (es.readyState === EventSource.CLOSED) {
        stream = null
        scheduleReconnect()
      }
    })
    stream = es
  }

  async function init() {
    try {
      presets.value = await apiGet<AgentPresetInfo[]>('/api/agent/presets')
    } catch (err) {
      if (disposed) return
      enabled.value = false
      // 404 is the normal "agents are off" answer, not an error worth showing.
      if (!(err instanceof ApiRequestError && err.status === 404)) {
        error.value = errorMessage(err)
      }
      return
    }
    if (disposed) return
    enabled.value = true
    // Before the stream: a new page gets the buffered events at once, and
    // events of a chat that is not registered yet pile up (`MAX_ORPHAN_EVENTS`).
    await refreshSessions()
    if (disposed) return
    connectStream()
    if (!subscribedToFiles) {
      subscribedToFiles = true
      useServerEvents(['files:changed'], markWorktreeChanged)
    }
  }

  function openNewChatDialog(context: AgentContextItem[] = []): boolean {
    if (!canAddChat.value) return false
    newChatDialog.value = { open: true, context }
    return true
  }

  function closeNewChatDialog(): void {
    newChatDialog.value = { open: false, context: [] }
  }

  /** Starts a chat with an agent and makes it the active one. Rejects when the server refuses. */
  async function createChat(
    presetId: string,
    name: string,
    context: AgentContextItem[] = []
  ): Promise<string> {
    if (creating.value) throw new Error('A chat is already being created')
    creating.value = true
    error.value = null
    try {
      const body: CreateAgentSessionRequest = { presetId, name }
      const info = await apiPost<AgentSessionInfo>('/api/agent/sessions', body)
      const entry = registerChat(info)
      entry.pendingContext = mergeContext(entry.pendingContext, context)
      openChat(info.id)
      return info.id
    } catch (err) {
      error.value = errorMessage(err)
      throw err
    } finally {
      creating.value = false
    }
  }

  /** Ends the chat: its agent process is stopped and the chat disappears from the page. */
  async function closeChat(id: string): Promise<void> {
    const entry = chats.value[id]
    if (!entry || entry.closing) return
    entry.closing = true
    try {
      await apiDelete<void>(`/api/agent/sessions/${id}`)
    } catch (err) {
      // Already gone on the server is the outcome we wanted.
      if (!(err instanceof ApiRequestError && err.status === 404)) {
        // The agent may still run: keep the chat so the user can try again.
        entry.closing = false
        entry.error = errorMessage(err)
        throw err
      }
    }
    // Only now: a session list that arrives later must not bring the chat back.
    closedIds.add(id)
    removeChat(id)
  }

  /** Resolves to false when nothing was sent (no such chat, empty text, agent not ready). */
  async function send(
    text: string,
    extraContext: AgentContextItem[] = [],
    id: string | null = activeId.value
  ): Promise<boolean> {
    const entry = id === null ? undefined : chats.value[id]
    const trimmed = text.trim()
    if (!entry || trimmed === '' || entry.chat.status !== 'ready') return false
    entry.error = null
    const context = mergeContext(entry.pendingContext, extraContext)
    const body: AgentPromptRequest = { text: trimmed, context }
    try {
      await apiPost<void>(`/api/agent/sessions/${entry.info.id}/prompt`, body)
      // Context added while the request was running belongs to the next message.
      const sent = new Set(context.map(contextKey))
      entry.pendingContext = entry.pendingContext.filter(
        item => !sent.has(contextKey(item))
      )
      return true
    } catch (err) {
      entry.error = errorMessage(err)
      throw err
    }
  }

  async function cancel(id: string | null = activeId.value) {
    const entry = id === null ? undefined : chats.value[id]
    if (!entry || entry.chat.status !== 'busy') return
    await apiPost<void>(`/api/agent/sessions/${entry.info.id}/cancel`)
  }

  async function answerPermission(
    requestId: string,
    optionId?: string,
    id: string | null = activeId.value
  ) {
    const entry = id === null ? undefined : chats.value[id]
    if (!entry) return
    const body: AgentPermissionAnswer =
      optionId === undefined ? {} : { optionId }
    await apiPost<void>(
      `/api/agent/sessions/${entry.info.id}/permissions/${requestId}`,
      body
    )
  }

  /** Changes a setting (model, mode, …); the new option set arrives through the stream. */
  async function setConfig(
    configId: string,
    value: string | boolean,
    id: string | null = activeId.value
  ) {
    const entry = id === null ? undefined : chats.value[id]
    if (!entry || entry.chat.status !== 'ready') return
    entry.error = null
    const body: AgentSetConfigRequest = { configId, value }
    try {
      await apiPost<void>(`/api/agent/sessions/${entry.info.id}/config`, body)
    } catch (err) {
      entry.error = errorMessage(err)
      throw err
    }
  }

  /** The new state arrives through the stream (`auto-approve` event). */
  async function setAutoApprove(
    enabledNow: boolean,
    id: string | null = activeId.value
  ) {
    const entry = id === null ? undefined : chats.value[id]
    if (!entry) return
    const body: AgentSetAutoApproveRequest = { enabled: enabledNow }
    await apiPost<void>(
      `/api/agent/sessions/${entry.info.id}/auto-approve`,
      body
    )
  }

  function addContext(item: AgentContextItem, id?: string): AddContextResult {
    const entry = id === undefined ? activeChat.value : chats.value[id]
    // A delayed upload must not open a new chat after its target was removed.
    if (id !== undefined && !entry) return 'missing'
    if (!entry) {
      return openNewChatDialog([item]) ? 'dialog' : 'limit'
    }
    const key = contextKey(item)
    if (!entry.pendingContext.some(existing => contextKey(existing) === key)) {
      entry.pendingContext.push(item)
    }
    panelOpen.value = true
    return 'added'
  }

  function removeContext(index: number, id: string | null = activeId.value) {
    const entry = id === null ? undefined : chats.value[id]
    entry?.pendingContext.splice(index, 1)
  }

  /** Called when the working tree changes; only matters for chats a review went to. */
  function markWorktreeChanged() {
    for (const entry of Object.values(chats.value)) {
      if (hasReviewContext(entry.chat.items)) entry.reviewStale = true
    }
  }

  onScopeDispose(disconnectStream)

  return {
    presets,
    enabled,
    chats,
    order,
    list,
    activeId,
    activeChat,
    canAddChat,
    panelOpen,
    creating,
    error,
    newChatDialog,
    init,
    refreshSessions,
    openNewChatDialog,
    closeNewChatDialog,
    createChat,
    closeChat,
    selectChat,
    openChat,
    send,
    cancel,
    answerPermission,
    setConfig,
    setAutoApprove,
    addContext,
    removeContext,
    markWorktreeChanged
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useAgentStore, import.meta.hot))
}
