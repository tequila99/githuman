import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createSessionTaskEditor } from '@/utils/session-task-editor'

let savedFetch: typeof fetch
beforeEach(() => {
  savedFetch = globalThis.fetch
})
afterEach(() => {
  globalThis.fetch = savedFetch
})
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status })
}
function assignment(version = 0, taskIds: string[] = []) {
  return { sessionId: 'session', version, taskIds }
}
test('saves complete assignment with expected version and supports unlinking all tasks', async () => {
  let value = assignment(2, ['first'])
  const writes: unknown[] = []
  globalThis.fetch = async (_input, init) => {
    if (init?.method === 'PATCH') {
      assert.equal(typeof init.body, 'string')
      const body = JSON.parse(init.body as string)
      writes.push(body)
      value = assignment(value.version + 1, body.taskIds)
    }
    return json(value)
  }
  const editor = createSessionTaskEditor('session')
  await editor.refresh()
  editor.setTasks(['second', 'first', 'second'])
  await editor.save()
  assert.deepEqual(editor.state.taskIds, ['first', 'second'])
  assert.equal(editor.state.dirty, false)
  editor.setTasks([])
  await editor.save()
  assert.deepEqual(editor.state.taskIds, [])
  assert.equal((writes[0] as { expectedVersion: number }).expectedVersion, 2)
  assert.equal((writes[1] as { expectedVersion: number }).expectedVersion, 3)
})
test('lost response retains draft and uses the same request ID despite refresh observing committed data', async () => {
  const writes: { requestId: string }[] = []
  let committed = false
  globalThis.fetch = async (_input, init) => {
    if (init?.method === 'PATCH') {
      assert.equal(typeof init.body, 'string')
      writes.push(JSON.parse(init.body as string))
      if (!committed) {
        committed = true
        throw new Error('Connection lost')
      }
    }
    return json(committed ? assignment(1, ['task']) : assignment())
  }
  const editor = createSessionTaskEditor('session')
  await editor.refresh()
  editor.setTasks(['task'])
  await assert.rejects(editor.save(), /Connection lost/)
  await editor.refresh()
  assert.equal(editor.state.changed, true)
  assert.equal(editor.state.error, 'Connection lost')
  assert.equal(editor.state.dirty, true)
  await editor.save()
  assert.equal(writes[0]?.requestId, writes[1]?.requestId)
  assert.equal(editor.state.dirty, false)
})
test('a concurrent assignment preserves dirty draft and requires deliberate reload', async () => {
  let value = assignment()
  globalThis.fetch = async () => json(value)
  const editor = createSessionTaskEditor('session')
  await editor.refresh()
  editor.setTasks(['mine'])
  value = assignment(1, ['theirs'])
  await editor.refresh()
  assert.deepEqual(editor.state.taskIds, ['mine'])
  assert.equal(editor.state.changed, true)
  await assert.rejects(editor.save(), /Reload/)
  await editor.reload()
  assert.deepEqual(editor.state.taskIds, ['theirs'])
  assert.equal(editor.state.dirty, false)
})
test('HTTP conflict retains draft and blocks automatic retry with a new version', async () => {
  let writes = 0
  globalThis.fetch = async (_input, init) => {
    if (init?.method === 'PATCH') {
      writes++
      return json({ message: 'Assignment changed' }, 409)
    }
    return json(assignment())
  }
  const editor = createSessionTaskEditor('session')
  await editor.refresh()
  editor.setTasks(['mine'])
  await assert.rejects(editor.save())
  await editor.save()
  assert.equal(writes, 1)
  assert.equal(editor.state.conflict, true)
  assert.deepEqual(editor.state.taskIds, ['mine'])
})
test('a foreign session snapshot cannot initialize an editor', async () => {
  globalThis.fetch = async () => json({ ...assignment(), sessionId: 'another' })
  const editor = createSessionTaskEditor('session')
  await editor.refresh()
  assert.equal(editor.state.base, null)
  assert.match(editor.state.error ?? '', /another session/)
})
test('teardown suppresses delayed reads', async () => {
  let resolve!: (value: Response) => void
  globalThis.fetch = () =>
    new Promise<Response>(done => {
      resolve = done
    })
  const editor = createSessionTaskEditor('session')
  const reading = editor.refresh()
  editor.dispose()
  resolve(json(assignment(1, ['late'])))
  await reading
  assert.equal(editor.state.snapshot, null)
})

test('a refresh started during save cannot roll back the successful assignment', async () => {
  let finishSave!: (value: Response) => void
  let finishRead!: (value: Response) => void
  let reads = 0
  globalThis.fetch = async (_input, init) => {
    if (init?.method === 'PATCH') {
      return new Promise<Response>(done => {
        finishSave = done
      })
    }
    if (++reads === 1) return json(assignment())
    return new Promise<Response>(done => {
      finishRead = done
    })
  }
  const editor = createSessionTaskEditor('session')
  await editor.refresh()
  editor.setTasks(['task'])
  const saving = editor.save()
  const reading = editor.refresh()
  finishSave(json(assignment(1, ['task'])))
  await saving
  finishRead(json(assignment()))
  await reading
  assert.deepEqual(editor.state.taskIds, ['task'])
  assert.equal(editor.state.base?.version, 1)
})
test('a successful response with a different assignment does not clear the draft', async () => {
  globalThis.fetch = async (_input, init) =>
    json(init?.method === 'PATCH' ? assignment(1, ['other']) : assignment())
  const editor = createSessionTaskEditor('session')
  await editor.refresh()
  editor.setTasks(['mine'])
  await assert.rejects(editor.save(), /scope/)
  assert.equal(editor.state.dirty, true)
  assert.deepEqual(editor.state.taskIds, ['mine'])
})

test('an edit cannot replace assignments before the initial read finishes', async () => {
  let resolve!: (value: Response) => void
  globalThis.fetch = () =>
    new Promise<Response>(done => {
      resolve = done
    })
  const editor = createSessionTaskEditor('session')
  const reading = editor.refresh()
  editor.setTasks(['premature'])
  resolve(json(assignment(4, ['existing'])))
  await reading
  assert.deepEqual(editor.state.taskIds, ['existing'])
  assert.equal(editor.state.dirty, false)
})

test('pausing a task panel cancels a read without discarding its edit draft', async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ sessionId: 'session', version: 1, taskIds: [] })
    )
  const editor = createSessionTaskEditor('session')
  await editor.refresh()
  editor.setTasks(['draft-task'])
  let finish!: (response: Response) => void
  globalThis.fetch = async () =>
    new Promise<Response>(resolve => {
      finish = resolve
    })
  const reading = editor.refresh()
  editor.pause()
  finish(
    new Response(
      JSON.stringify({ sessionId: 'session', version: 2, taskIds: ['remote'] })
    )
  )
  await reading
  assert.deepEqual(editor.state.taskIds, ['draft-task'])
  assert.equal(editor.state.dirty, true)
  assert.equal(editor.state.loading, false)
  editor.dispose()
})
