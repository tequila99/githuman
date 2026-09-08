import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildApp } from '../../../src/server/app.ts'
import { createEventBus } from '../../../src/server/event-bus.ts'
import { createTempGitRepo } from '../helpers/git-fixture.ts'

test('GET /api/events sets the SSE content-type and delivers a published event', async t => {
  const eventBus = createEventBus()
  const app = buildApp({ eventBus })
  t.after(async () => {
    await app.close()
  })

  const address = await app.listen({ port: 0, host: '127.0.0.1' })
  const controller = new AbortController()
  t.after(() => controller.abort())

  const response = await fetch(new URL('/api/events', address), {
    signal: controller.signal,
    headers: { accept: 'text/event-stream' }
  })

  assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/)

  const reader = response.body!.getReader()

  const preamble = await reader.read()
  assert.match(
    Buffer.from(preamble.value!).toString('utf-8'),
    /event: connected/
  )

  eventBus.publish({ type: 'review:created', reviewId: 'r1' })

  const { value } = await reader.read()
  const text = Buffer.from(value!).toString('utf-8')

  assert.match(text, /event: review:created/)
  assert.match(text, /"reviewId":"r1"/)
})

test('GET /api/events delivers files:changed when watchFiles is enabled and a file changes', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  const app = buildApp({ repositoryPath: fixture.dir, watchFiles: true })
  t.after(async () => {
    await app.close()
  })

  const address = await app.listen({ port: 0, host: '127.0.0.1' })
  const controller = new AbortController()
  t.after(() => controller.abort())

  const response = await fetch(new URL('/api/events', address), {
    signal: controller.signal,
    headers: { accept: 'text/event-stream' }
  })

  const reader = response.body!.getReader()
  await reader.read() // 'connected' preamble

  writeFileSync(join(fixture.dir, 'edited.txt'), 'hello')

  const { value } = await reader.read()
  const text = Buffer.from(value!).toString('utf-8')

  assert.match(text, /event: files:changed/)
})
