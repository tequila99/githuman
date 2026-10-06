import { randomUUID } from 'node:crypto'
import {
  MAX_TERMINAL_SESSIONS,
  TERMINAL_IDLE_MS,
  TERMINAL_ORPHAN_MS
} from '../../../shared/terminal/constants.ts'
import type {
  TerminalServerMessage,
  TerminalInfo
} from '../../../shared/terminal/types.ts'
import {
  TerminalLimitError,
  TerminalNotFoundError
} from '../../errors/terminal.ts'
import { createBackend, type PtyBackend } from './backend.ts'
import { TerminalSession } from './session.ts'

// Check the activity of every session this often.
const POLL_MS = 5000

interface Entry {
  session: TerminalSession
  subscribers: Set<object>
  orphanedSince: number | null
  idleSince: number | null
}
export interface TerminalRegistryOptions {
  repositoryPath: string
  backend?: (cwd: string, cols: number, rows: number) => Promise<PtyBackend>
  now?: () => number
  pollMs?: number
  onLifecycle?: (event: {
    type: 'created' | 'closed' | 'timeout'
    id: string
    mode?: string
  }) => void
}

export class TerminalRegistry {
  private readonly entries = new Map<string, Entry>()
  private readonly listeners = new Set<
    (message: TerminalServerMessage) => void
  >()
  private readonly closing = new Set<Promise<void>>()
  private readonly poll
  private creating = 0
  private nextNumber = 1
  private stopped = false
  private checking = false
  private readonly options: TerminalRegistryOptions
  constructor(options: TerminalRegistryOptions) {
    this.options = options
    this.poll = setInterval(() => {
      void this.checkActivity()
    }, options.pollMs ?? POLL_MS)
    this.poll.unref()
  }
  get list(): TerminalInfo[] {
    return [...this.entries.values()].map(entry => entry.session.info)
  }
  subscribe(listener: (message: TerminalServerMessage) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  private publish(message: TerminalServerMessage): void {
    for (const listener of this.listeners) listener(message)
  }
  private publishList(): void {
    this.publish({ type: 'list', sessions: this.list })
  }
  private now(): number {
    return (this.options.now ?? Date.now)()
  }
  get(id: string): TerminalSession {
    const entry = this.entries.get(id)
    if (!entry)
      throw new TerminalNotFoundError('Terminal session no longer exists.')
    return entry.session
  }
  async create(cols: number, rows: number): Promise<TerminalSession> {
    if (this.stopped)
      throw new TerminalNotFoundError('Terminal server is stopping.')
    if (this.entries.size + this.creating >= MAX_TERMINAL_SESSIONS)
      throw new TerminalLimitError('The terminal limit has been reached.')
    this.creating++
    try {
      const backend = await (this.options.backend ?? createBackend)(
        this.options.repositoryPath,
        cols,
        rows
      )
      if (this.stopped) {
        await backend.kill()
        throw new TerminalNotFoundError('Terminal server is stopping.')
      }
      const id = randomUUID()
      const session = new TerminalSession(
        id,
        `Terminal ${this.nextNumber++}`,
        backend,
        cols,
        rows,
        message => this.publish(message),
        () => {
          void this.close(id)
        }
      )
      this.entries.set(id, {
        session,
        subscribers: new Set(),
        orphanedSince: this.now(),
        idleSince: null
      })
      this.options.onLifecycle?.({ type: 'created', id, mode: backend.mode })
      this.publishList()
      return session
    } finally {
      this.creating--
    }
  }
  attach(id: string, subscriber: object): void {
    const entry = this.entries.get(id)
    if (!entry)
      throw new TerminalNotFoundError('Terminal session no longer exists.')
    entry.subscribers.add(subscriber)
    entry.orphanedSince = null
    entry.idleSince = null
  }
  detach(subscriber: object): void {
    for (const entry of this.entries.values()) {
      if (!entry.subscribers.delete(subscriber) || entry.subscribers.size)
        continue
      entry.orphanedSince = this.now()
      entry.idleSince = entry.session.running === 'idle' ? this.now() : null
    }
  }
  async checkActivity(): Promise<void> {
    if (this.checking || this.stopped) return
    this.checking = true
    try {
      for (const [id, entry] of this.entries) {
        const previous = entry.session.running
        entry.session.running = await entry.session.backend.activity()
        if (previous !== entry.session.running) this.publishList()
        if (entry.orphanedSince === null) continue
        const now = this.now()
        if (entry.session.running === 'idle') {
          entry.idleSince ??= now
        } else {
          entry.idleSince = null
        }
        if (
          now - entry.orphanedSince >= TERMINAL_ORPHAN_MS ||
          (entry.idleSince !== null &&
            now - entry.idleSince >= TERMINAL_IDLE_MS)
        ) {
          this.options.onLifecycle?.({ type: 'timeout', id })
          await this.close(id)
        }
      }
    } finally {
      this.checking = false
    }
  }
  async resize(id: string, cols: number, rows: number): Promise<void> {
    await this.get(id).resize(cols, rows)
    this.publishList()
  }
  async close(id: string): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry) return
    this.entries.delete(id)
    this.options.onLifecycle?.({ type: 'closed', id })
    this.publish({ type: 'exit', terminalId: id })
    this.publishList()
    const closing = entry.session.dispose()
    this.closing.add(closing)
    try {
      await closing
    } finally {
      this.closing.delete(closing)
    }
  }
  async dispose(): Promise<void> {
    this.stopped = true
    clearInterval(this.poll)
    await Promise.all([...this.entries.keys()].map(id => this.close(id)))
    await Promise.all(this.closing)
    this.listeners.clear()
  }
}
