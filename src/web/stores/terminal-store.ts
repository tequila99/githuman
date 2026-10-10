import { TERMINAL_WINDOW_ID } from '@/constants/windows/constants'
import { ref, computed, watch, onScopeDispose } from 'vue'
import { defineStore, acceptHMRUpdate } from 'pinia'
import type {
  TerminalInfo,
  TerminalServerMessage,
  TerminalClientMessage
} from '../../shared/terminal/types.ts'
import { MAX_TERMINAL_SESSIONS } from '../../shared/terminal/constants.ts'
import {
  WebSocketTerminalTransport,
  type TerminalTransport,
  type TerminalConnectionState
} from '@/api/terminal-transport'
import { useWindowStore } from '@/stores/windows/window-store'
import { safeStorage } from '@/utils/safe-storage'
import { isRecord, isFiniteNumber } from '../../shared/utils/guards.ts'
import {
  TERMINAL_WINDOW_MIN_HEIGHT,
  TERMINAL_WINDOW_MIN_WIDTH
} from '@/utils/terminal-window'

// Keep window preferences independent from live server sessions.
const STORAGE_KEY = 'githuman:terminal-window'

// A local error has an i18n key under `terminal`. A server or network error brings its own text.
export type TerminalStoreError = { key: 'unavailable' } | { text: string }

function point(value: unknown): { x: number; y: number } | null {
  if (!isRecord(value)) return null
  const { x, y } = value
  return isFiniteNumber(x) && isFiniteNumber(y) ? { x, y } : null
}

function size(value: unknown): { width: number; height: number } | null {
  if (!isRecord(value)) return null
  const { width, height } = value
  return isFiniteNumber(width) &&
    isFiniteNumber(height) &&
    width >= TERMINAL_WINDOW_MIN_WIDTH &&
    height >= TERMINAL_WINDOW_MIN_HEIGHT
    ? { width, height }
    : null
}

export const useTerminalStore = defineStore('terminal', () => {
  const windows = useWindowStore()
  const hasCommonPreferences = Object.hasOwn(
    windows.windows,
    TERMINAL_WINDOW_ID
  )
  const window = windows.ensure(TERMINAL_WINDOW_ID)
  const enabled = ref(false)
  const sessions = ref<TerminalInfo[]>([])
  const activeId = ref<string | null>(null)
  const minimized = computed({
    get: () => window.minimized,
    set: value => {
      window.minimized = value
    }
  })
  const open = computed({
    get: () => window.open,
    set: value => {
      window.open = value
    }
  })
  const state = ref<TerminalConnectionState>('disconnected')
  const error = ref<TerminalStoreError | null>(null)
  const creating = ref(false)
  const position = computed({
    get: () => window.position,
    set: value => {
      window.position = value
    }
  })
  const originalColors = ref(false)
  const windowSize = computed({
    get: () => window.windowSize,
    set: value => {
      window.windowSize = value
    }
  })
  const maximized = computed({
    get: () => window.maximized,
    set: value => {
      window.maximized = value
    }
  })
  let transport: TerminalTransport | null = null
  let createRequest: string | null = null
  let operation = 0
  const subscribed = new Set<string>()
  const views = new Map<string, (message: TerminalServerMessage) => void>()
  const waiting = new Set<string>()

  function remember(): void {
    windows.remember()
    safeStorage.set(
      STORAGE_KEY,
      JSON.stringify({
        activeId: activeId.value,
        originalColors: originalColors.value
      })
    )
  }
  function init(available: boolean, provided?: TerminalTransport): void {
    if (!available || transport) return
    enabled.value = true
    try {
      const saved: unknown = JSON.parse(safeStorage.get(STORAGE_KEY) ?? 'null')
      if (isRecord(saved)) {
        if (!hasCommonPreferences) {
          position.value = point(saved.position) ?? position.value
          windowSize.value = size(saved.windowSize) ?? windowSize.value
        }
        if (!hasCommonPreferences && typeof saved.minimized === 'boolean')
          minimized.value = saved.minimized
        if (typeof saved.originalColors === 'boolean')
          originalColors.value = saved.originalColors
        if (typeof saved.activeId === 'string') activeId.value = saved.activeId
      }
    } catch {
      /* Invalid preferences do not prevent terminal access. */
    }
    transport = provided ?? new WebSocketTerminalTransport()
    transport.onState((next, message) => {
      state.value = next
      error.value = message ? { text: message } : null
      if (next !== 'connected') {
        subscribed.clear()
        waiting.clear()
        creating.value = false
        createRequest = null
      }
    })
    transport.onMessage(receive)
    transport.connect()
  }
  function send(message: TerminalClientMessage): boolean {
    const sent = transport?.send(message) ?? false
    if (!sent) error.value = { key: 'unavailable' }
    return sent
  }
  function receiveList(list: TerminalInfo[]): void {
    const previousActiveId = activeId.value
    sessions.value = list
    const ids = new Set(list.map(session => session.id))
    for (const id of subscribed) if (!ids.has(id)) subscribed.delete(id)
    if (!activeId.value || !ids.has(activeId.value))
      activeId.value = list[0]?.id ?? null
    open.value = list.length > 0
    for (const session of list) {
      if (!subscribed.has(session.id)) {
        subscribed.add(session.id)
        send({ type: 'subscribe', terminalId: session.id })
      }
    }
    // A list also arrives on each activity change. Write only a changed preference.
    if (activeId.value !== previousActiveId) remember()
  }
  function receiveFrame(
    message: Extract<TerminalServerMessage, { type: 'snapshot' | 'output' }>
  ): void {
    const listener = views.get(message.terminalId)
    if (message.type === 'snapshot') {
      waiting.delete(message.terminalId)
      listener?.(message)
      acknowledge(message.terminalId, message.sequence)
    } else if (listener && !waiting.has(message.terminalId)) {
      listener(message)
    } else {
      // Hidden views recover from the server snapshot instead of retaining raw output.
      acknowledge(message.terminalId, message.sequence)
    }
  }
  function receive(message: TerminalServerMessage): void {
    switch (message.type) {
      case 'list':
        receiveList(message.sessions)
        break
      case 'created':
        if (message.requestId !== createRequest) break
        activeId.value = message.terminalId
        creating.value = false
        createRequest = null
        open.value = true
        minimized.value = false
        windows.focus(TERMINAL_WINDOW_ID)
        remember()
        break
      case 'error':
        error.value = { text: message.message }
        if (message.requestId === createRequest) {
          creating.value = false
          createRequest = null
        }
        break
      case 'title': {
        const entry = sessions.value.find(
          session => session.id === message.terminalId
        )
        if (entry) entry.title = message.title
        break
      }
      case 'snapshot':
      case 'output':
        receiveFrame(message)
        break
      case 'exit':
        // The server sends a list after each exit. That list updates the active session.
        sessions.value = sessions.value.filter(
          session => session.id !== message.terminalId
        )
        subscribed.delete(message.terminalId)
        views.delete(message.terminalId)
        waiting.delete(message.terminalId)
        break
      case 'pong':
        // The store sends no ping, so a pong needs no action.
        break
      default: {
        // A new server message type must get a case here: this line stops the build.
        const unexpected: never = message
        void unexpected
      }
    }
  }
  function attachView(
    id: string,
    listener: (message: TerminalServerMessage) => void
  ): () => void {
    views.set(id, listener)
    waiting.add(id)
    if (state.value === 'connected') send({ type: 'snapshot', terminalId: id })
    return () => {
      if (views.get(id) === listener) views.delete(id)
      waiting.delete(id)
    }
  }
  function acknowledge(id: string, sequence: number): void {
    send({ type: 'ack', terminalId: id, sequence })
  }
  function create(): void {
    if (
      creating.value ||
      state.value !== 'connected' ||
      sessions.value.length >= MAX_TERMINAL_SESSIONS
    )
      return
    creating.value = true
    createRequest = `create-${++operation}`
    if (
      !send({ type: 'create', requestId: createRequest, cols: 100, rows: 28 })
    ) {
      creating.value = false
      createRequest = null
    }
  }
  function show(): void {
    if (!enabled.value) return
    open.value = true
    minimized.value = false
    windows.focus(TERMINAL_WINDOW_ID)
    if (!sessions.value.length) create()
    remember()
  }
  function minimize(): void {
    minimized.value = true
    remember()
  }
  function activate(id: string): void {
    activeId.value = id
    remember()
  }
  function close(id: string): void {
    send({ type: 'close', terminalId: id, requestId: `close-${++operation}` })
  }
  watch(originalColors, remember)
  onScopeDispose(() => {
    transport?.close()
    views.clear()
  })
  return {
    enabled,
    sessions,
    activeId,
    minimized,
    open,
    state,
    error,
    creating,
    position,
    originalColors,
    windowSize,
    maximized,
    init,
    send,
    show,
    minimize,
    activate,
    close,
    create,
    attachView,
    acknowledge,
    remember
  }
})

if (import.meta.hot)
  import.meta.hot.accept(acceptHMRUpdate(useTerminalStore, import.meta.hot))
