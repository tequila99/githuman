import { isRecord } from '../../../shared/utils/guards.ts'
import { MAX_JOURNAL_ENTRY_BYTES } from '../../../shared/task-journal/constants.ts'
import { truncateUtf8Text } from '../../utils/text.ts'

// Bound traversal before serialization, including large or deeply nested tool input.
const MAX_DEPTH = 8
// Bound each container so malformed adapter data cannot retain unlimited fields.
const MAX_MEMBERS = 100
// Leave space for an explicit truncation marker within the entry budget.
const TRUNCATION_MARKER = '\n[truncated]'
// Structured credential fields must never enter the persistent journal.
const SECRET_FIELD =
  /password|passwd|secret|token|authorization|cookie|api[_-]?key|private[_-]?key/i

export function journalEventText(
  event: unknown,
  redact?: (text: string) => string
): string {
  let truncated = false
  function clean(value: unknown, depth: number): unknown {
    if (typeof value === 'string') {
      const text = redact ? redact(value) : value
      if (Buffer.byteLength(text) > MAX_JOURNAL_ENTRY_BYTES) truncated = true
      return truncateUtf8Text(text, MAX_JOURNAL_ENTRY_BYTES)
    }
    if (value === null || typeof value !== 'object') return value
    if (depth >= MAX_DEPTH) {
      truncated = true
      return '[truncated]'
    }
    const entries = Object.entries(value)
    if (entries.length > MAX_MEMBERS) truncated = true
    const selected = entries.slice(0, MAX_MEMBERS)
    if (Array.isArray(value)) {
      return selected.map(([, item]) => clean(item, depth + 1))
    }
    return Object.fromEntries(
      selected.map(([key, item]) => [
        key,
        SECRET_FIELD.test(key) ? '[redacted]' : clean(item, depth + 1)
      ])
    )
  }
  const text = JSON.stringify(clean(event, 0), null, 2) ?? 'null'
  if (Buffer.byteLength(text) > MAX_JOURNAL_ENTRY_BYTES) truncated = true
  return truncated
    ? truncateUtf8Text(
        text,
        MAX_JOURNAL_ENTRY_BYTES - Buffer.byteLength(TRUNCATION_MARKER)
      ) + TRUNCATION_MARKER
    : text
}

export class JournalEventBuffer {
  #pending:
    | {
        id: number
        event: {
          type: 'message'
          role: 'agent' | 'thought'
          text: string
          truncated?: boolean
          incomplete?: 'cancelled' | 'failed'
        }
      }
    | undefined

  #write: (event: unknown, id: number) => void

  constructor(write: (event: unknown, id: number) => void) {
    this.#write = write
  }

  push(event: unknown, id: number, incomplete?: 'cancelled' | 'failed'): void {
    if (
      isRecord(event) &&
      event.type === 'message' &&
      (event.role === 'agent' || event.role === 'thought') &&
      typeof event.text === 'string'
    ) {
      if (this.#pending?.event.role !== event.role) this.flush()
      if (!this.#pending) {
        this.#pending = {
          id,
          event: { type: 'message', role: event.role, text: '' }
        }
      }
      const pending = this.#pending.event
      // Keep one bounded prefix without splitting a large message into journal rows.
      if (!pending.truncated) {
        const text = pending.text + event.text
        pending.text = truncateUtf8Text(text, MAX_JOURNAL_ENTRY_BYTES)
        if (Buffer.byteLength(text) > MAX_JOURNAL_ENTRY_BYTES) {
          pending.truncated = true
        }
      }
      return
    }
    this.flush(incomplete)
    this.#write(event, id)
  }

  flush(incomplete?: 'cancelled' | 'failed'): void {
    const pending = this.#pending
    this.#pending = undefined
    if (!pending) return
    if (incomplete) pending.event.incomplete = incomplete
    this.#write(pending.event, pending.id)
  }
}
