import {
  mdiCheckCircleOutline,
  mdiLightbulbOutline,
  mdiHelpCircleOutline,
  mdiArrowRightCircleOutline,
  mdiNoteTextOutline,
  mdiCogOutline,
  mdiMessageTextOutline,
  mdiHeadLightbulbOutline,
  mdiAlertCircleOutline,
  mdiStopCircleOutline,
  mdiSwapHorizontal
} from '@mdi/js'
import type { JournalEntry } from '@/api/types'
import { isRecord } from '@/utils/guards'
import { markdownText } from '@/utils/markdown'

// Identity of the local user in the server actor.
const LOCAL_USER_ID = 'local'

/** Ids of loaded entries that a later loaded entry corrects. */
export function supersededIds(items: readonly JournalEntry[]): Set<string> {
  const ids = new Set<string>()
  for (const entry of items) {
    if (entry.supersedesEntryId) ids.add(entry.supersedesEntryId)
  }
  return ids
}

/**
 * Detail of a server fact without its event prefix.
 * Older facts repeat the event type in the text: "handoff_completed: A → B".
 */
export function factDetail(entry: JournalEntry): string {
  if (!entry.eventType) return entry.body
  if (entry.body === entry.eventType) return ''
  const prefix = `${entry.eventType}: `
  return entry.body.startsWith(prefix)
    ? entry.body.slice(prefix.length)
    : entry.body
}

/** Translation key and parameters for the author of an entry. */
export function actorLabel(
  entry: JournalEntry,
  chatName: (sessionId: string) => string | undefined
): { key: string; params: Record<string, string> } {
  const { actor } = entry
  if (actor.kind === 'system') {
    return { key: 'journal.actors.server', params: {} }
  }
  if (actor.kind === 'agent') {
    const name = entry.context?.sessionName ?? chatName(actor.id)
    return name
      ? { key: 'journal.actors.agentNamed', params: { name } }
      : { key: 'journal.actors.agent', params: {} }
  }
  return actor.id === LOCAL_USER_ID
    ? { key: 'journal.actors.local', params: {} }
    : { key: 'journal.actors.device', params: {} }
}

function journalEvent(entry: JournalEntry): Record<string, unknown> | null {
  if (entry.eventType !== 'agent_event') return null
  try {
    const parsed: unknown = JSON.parse(entry.body)
    return isRecord(parsed) ? parsed : null
  } catch {
    // Truncated payloads remain readable as plain text.
    return null
  }
}

/** Keep the complete saved message separate from the one-line list preview. */
export function journalMessage(entry: JournalEntry): {
  role: 'agent' | 'thought'
  text: string
  truncated: boolean
} | null {
  const event = journalEvent(entry)
  if (
    event?.type !== 'message' ||
    (event.role !== 'agent' && event.role !== 'thought') ||
    typeof event.text !== 'string'
  ) {
    return null
  }
  return {
    role: event.role,
    text: event.text,
    truncated: event.truncated === true
  }
}

/** Content that distinguishes otherwise identical server lifecycle events. */
export function journalSummary(entry: JournalEntry): string {
  if (entry.eventType === 'agent_event') {
    const event = journalEvent(entry)
    const summary = event
      ? [
          event.type,
          event.role,
          event.title,
          event.status,
          event.toolCallId,
          typeof event.text === 'string' &&
          (event.type === 'message' || event.type === 'request')
            ? markdownText(event.text)
            : event.text
        ]
          .filter(value => typeof value === 'string')
          .join(' · ')
      : entry.body
    const text = summary.replace(/\s+/g, ' ').trim()
    return text.length > 240 ? text.slice(0, 240) + '…' : text
  }
  return markdownText(
    entry.eventType
      ? entry.context?.response.trim() ||
          entry.context?.prompt.trim() ||
          factDetail(entry)
      : entry.body
  )
}

export function journalIcon(entry: JournalEntry): string {
  if (entry.eventType === 'agent_event') {
    const message = journalMessage(entry)
    return message
      ? message.role === 'thought'
        ? mdiHeadLightbulbOutline
        : mdiMessageTextOutline
      : mdiCogOutline
  }
  switch (entry.eventType) {
    case 'turn_finished':
      return mdiCheckCircleOutline
    case 'turn_failed':
      return mdiAlertCircleOutline
    case 'turn_cancelled':
      return mdiStopCircleOutline
    case 'handoff_completed':
      return mdiSwapHorizontal
    case 'handoff_failed':
      return mdiAlertCircleOutline
  }
  return {
    done: mdiCheckCircleOutline,
    decision: mdiLightbulbOutline,
    open: mdiHelpCircleOutline,
    next: mdiArrowRightCircleOutline,
    note: mdiNoteTextOutline,
    system: mdiCogOutline
  }[entry.kind]
}
