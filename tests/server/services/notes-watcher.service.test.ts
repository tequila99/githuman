import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { watchNotes } from '../../../src/server/services/notes-watcher.service.ts'
import type { NotesService } from '../../../src/server/services/notes.service.ts'

test('a stable snapshot error publishes one event until the state changes', async () => {
  const results: (string | Error)[] = [
    new Error('down'),
    new Error('down'),
    new Error('down'),
    'ok'
  ]
  let calls = 0
  const service = {
    async snapshot() {
      const result = results[Math.min(calls++, results.length - 1)]
      if (result instanceof Error) throw result
      return result
    }
  } as unknown as NotesService
  let events = 0
  const watcher = watchNotes(service, () => events++)
  await sleep(50)
  assert.equal(events, 1)
  watcher.close()
})
