import { setInterval, clearInterval } from 'node:timers'
import type { NotesService } from './notes.service.ts'

// File metadata detects changes without reading every note body on each poll.
const POLL_INTERVAL_MS = 2000

export function watchNotes(service: NotesService, onChange: () => void) {
  let previous = ''
  let pending = false
  let closed = false
  async function check() {
    if (pending || closed) return
    pending = true
    try {
      const next = await service.snapshot()
      if (!closed && previous && previous !== next) onChange()
      previous = next
    } catch {
      if (!closed) onChange()
    } finally {
      pending = false
    }
  }
  void check()
  const timer = setInterval(() => {
    void check()
  }, POLL_INTERVAL_MS)
  timer.unref()
  return {
    close() {
      closed = true
      clearInterval(timer)
    }
  }
}
