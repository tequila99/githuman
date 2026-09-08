import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFileDatabase } from '../../../src/server/db/index.ts'
import {
  resolveReviewsDbPath,
  startServer
} from '../../../src/cli/server-runtime.ts'
import { runList } from '../../../src/cli/commands/list.ts'
import { createTempGitRepo } from '../../server/helpers/git-fixture.ts'

test('list reads the same SQLite file safely while `serve` is running against it', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  const originalCwd = process.cwd()
  process.chdir(fixture.dir)

  const { app, url } = await startServer({
    port: 0,
    host: '127.0.0.1',
    open: false
  })
  t.after(async () => {
    await app.close()
    process.chdir(originalCwd)
  })

  const created = await fetch(new URL('/api/reviews', url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sourceType: 'staged' })
  })
  const review = await created.json()

  const dbPath = resolveReviewsDbPath(fixture.dir)
  const readerDb = createFileDatabase(dbPath)
  t.after(() => readerDb.close())

  const output = runList(readerDb, { json: true })
  const parsed = JSON.parse(output)

  assert.ok(parsed.some((entry: { id: string }) => entry.id === review.id))
})
