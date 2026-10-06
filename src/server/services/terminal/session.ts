import headless from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'
import {
  TERMINAL_SCROLLBACK,
  TERMINAL_QUEUE_BYTES,
  TERMINAL_SNAPSHOT_BYTES,
  TERMINAL_FRAME_BYTES,
  TERMINAL_TITLE_LENGTH
} from '../../../shared/terminal/constants.ts'
import type {
  TerminalInfo,
  TerminalServerMessage,
  TerminalRunning
} from '../../../shared/terminal/types.ts'
import type { PtyBackend } from './backend.ts'
import { EscapeTail } from './escape-tail.ts'
import { TerminalError } from '../../errors/terminal.ts'

// Join output that arrives within one display frame (about 60 Hz) into one write.
const FLUSH_DELAY_MS = 16
// One UTF-16 unit takes up to 3 UTF-8 bytes. A divisor of 4 keeps a part below the frame limit.
const FRAME_PART_UNITS = TERMINAL_FRAME_BYTES / 4
// Close the session when the parser queue grows to twice the pause limit.
const QUEUE_CLOSE_BYTES = TERMINAL_QUEUE_BYTES * 2
// Resume the backend only after the parser queue falls well below the pause limit.
const QUEUE_RESUME_BYTES = TERMINAL_QUEUE_BYTES / 4
// A high surrogate starts a pair. A part must not end after it.
const HIGH_SURROGATE_FIRST = 0xd800
const HIGH_SURROGATE_LAST = 0xdbff

export class TerminalSession {
  private readonly terminal
  private readonly serializer
  private readonly tail = new EscapeTail()
  private queue = Promise.resolve()
  private pendingBytes = 0
  private staged = ''
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private readonly blocked = new Set<object>()
  private sequence = 0
  private stopped = false
  private readonly disposers: (() => void)[] = []
  private title: string
  private cols: number
  private rows: number
  running: TerminalRunning = 'unknown'

  readonly id: string
  readonly backend: PtyBackend
  private readonly publish: (message: TerminalServerMessage) => void
  private readonly onExit: () => void
  constructor(
    id: string,
    title: string,
    backend: PtyBackend,
    cols: number,
    rows: number,
    publish: (message: TerminalServerMessage) => void,
    onExit: () => void
  ) {
    this.id = id
    this.backend = backend
    this.publish = publish
    this.onExit = onExit
    this.title = title
    this.cols = cols
    this.rows = rows
    this.terminal = new headless.Terminal({
      cols,
      rows,
      scrollback: TERMINAL_SCROLLBACK,
      allowProposedApi: true
    })
    this.serializer = new SerializeAddon()
    this.terminal.loadAddon(this.serializer)
    this.disposers.push(
      backend.onData(data => this.output(data)),
      backend.onExit(onExit)
    )
    // Only the server answers terminal queries, even with multiple browsers.
    this.disposers.push(() => this.terminal.dispose())
    this.terminal.onData(data => {
      if (!this.stopped && backend.mode === 'pty') backend.write(data)
    })
    this.terminal.onTitleChange(shellTitle => {
      this.title = shellTitle.slice(0, TERMINAL_TITLE_LENGTH)
      publish({ type: 'title', terminalId: id, title: this.title })
    })
  }

  get info(): TerminalInfo {
    return {
      id: this.id,
      title: this.title,
      cols: this.cols,
      rows: this.rows,
      mode: this.backend.mode,
      running: this.running
    }
  }

  private output(data: string): void {
    if (this.stopped) return
    this.staged += data
    if (Buffer.byteLength(this.staged) >= TERMINAL_FRAME_BYTES) {
      this.flush()
    } else {
      this.flushTimer ??= setTimeout(() => this.flush(), FLUSH_DELAY_MS)
    }
  }

  private flush(): void {
    clearTimeout(this.flushTimer)
    this.flushTimer = undefined
    const data = this.staged
    this.staged = ''
    if (data) this.enqueue(data)
  }

  private enqueue(data: string): void {
    if (this.stopped) return undefined
    // Bound each frame by UTF-8 bytes without splitting a surrogate pair.
    for (let offset = 0; offset < data.length;) {
      let end = Math.min(data.length, offset + FRAME_PART_UNITS)
      if (
        end < data.length &&
        data.charCodeAt(end - 1) >= HIGH_SURROGATE_FIRST &&
        data.charCodeAt(end - 1) <= HIGH_SURROGATE_LAST
      )
        end--
      const part = data.slice(offset, end)
      offset = end
      const bytes = Buffer.byteLength(part)
      this.pendingBytes += bytes
      if (this.pendingBytes > TERMINAL_QUEUE_BYTES) this.updateFlow()
      if (this.pendingBytes > QUEUE_CLOSE_BYTES) {
        this.onExit()
        return
      }
      this.queue = this.queue
        .then(async () => {
          if (this.stopped) return undefined
          this.tail.push(part)
          await new Promise<void>(resolve => this.terminal.write(part, resolve))
          this.sequence++
          this.publish({
            type: 'output',
            terminalId: this.id,
            data: part,
            cols: this.cols,
            rows: this.rows,
            sequence: this.sequence
          })

          return undefined
        })
        .catch(() => this.onExit())
        .finally(() => {
          this.pendingBytes -= bytes
          if (!this.stopped && this.pendingBytes < QUEUE_RESUME_BYTES)
            this.updateFlow()
        })
    }
  }

  block(owner: object, blocked: boolean): void {
    if (blocked) {
      this.blocked.add(owner)
    } else {
      this.blocked.delete(owner)
    }
    this.updateFlow()
  }

  private updateFlow(): void {
    if (this.stopped) return
    if (this.blocked.size || this.pendingBytes > TERMINAL_QUEUE_BYTES) {
      this.backend.pause()
    } else {
      this.backend.resume()
    }
  }

  snapshot(send: (message: TerminalServerMessage) => void): Promise<void> {
    this.flush()
    this.queue = this.queue.then(() => {
      if (this.stopped) return undefined
      let scrollback = TERMINAL_SCROLLBACK
      let data = this.serializer.serialize({ scrollback }) + this.tail.tail
      while (
        Buffer.byteLength(data) > TERMINAL_SNAPSHOT_BYTES &&
        scrollback > 0
      ) {
        scrollback = Math.floor(scrollback / 2)
        data = this.serializer.serialize({ scrollback }) + this.tail.tail
      }
      if (Buffer.byteLength(data) > TERMINAL_SNAPSHOT_BYTES)
        throw new TerminalError('Terminal snapshot exceeds its limit.')
      send({
        type: 'snapshot',
        terminalId: this.id,
        data,
        cols: this.cols,
        rows: this.rows,
        sequence: this.sequence
      })

      return undefined
    })
    return this.queue
  }

  write(data: string): void {
    if (!this.stopped) this.backend.write(data)
  }
  line(data: string): void {
    if (this.backend.mode !== 'pipe')
      throw new TerminalError('Line input requires limited mode.')
    this.output(data.replace(/\n/g, '\r\n') + '\r\n')
    this.backend.write(data + '\n')
  }
  signal(signal: 'interrupt' | 'eof'): void {
    if (signal === 'interrupt') {
      this.backend.interrupt()
    } else {
      this.onExit()
    }
  }
  resize(cols: number, rows: number): Promise<void> {
    this.flush()
    this.queue = this.queue
      .then(() => {
        if (this.stopped || (cols === this.cols && rows === this.rows))
          return undefined
        this.backend.resize(cols, rows)
        this.terminal.resize(cols, rows)
        this.cols = cols
        this.rows = rows
        // Order geometry changes with output so every viewer parses the same screen.
        this.sequence++
        this.publish({
          type: 'output',
          terminalId: this.id,
          data: '',
          cols,
          rows,
          sequence: this.sequence
        })

        return undefined
      })
      .catch(() => this.onExit())
    return this.queue
  }
  async dispose(): Promise<void> {
    if (this.stopped) return undefined
    this.stopped = true
    clearTimeout(this.flushTimer)
    this.staged = ''
    await this.backend.kill()
    await this.queue.catch(() => {})
    for (const dispose of this.disposers) dispose()
  }
}
