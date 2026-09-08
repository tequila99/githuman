import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { watchRepository } from '../../../src/server/services/file-watcher.service.ts'
import { createTempGitRepo } from '../helpers/git-fixture.ts'

test('watchRepository calls onChange (debounced) when a working-tree file changes', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  let changes = 0
  const watcher = watchRepository(fixture.dir, () => {
    changes++
  })
  t.after(watcher.close)

  writeFileSync(join(fixture.dir, 'new-file.txt'), 'hello')

  await delay(500)

  assert.equal(changes, 1)
})

test('watchRepository coalesces rapid successive changes into a single onChange call', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  let changes = 0
  const watcher = watchRepository(fixture.dir, () => {
    changes++
  })
  t.after(watcher.close)

  const filePath = join(fixture.dir, 'burst.txt')
  for (let i = 0; i < 5; i++) {
    writeFileSync(filePath, `write ${i}`)
  }

  await delay(500)

  assert.equal(changes, 1)
})

test('watchRepository ignores changes inside node_modules', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  mkdirSync(join(fixture.dir, 'node_modules', 'some-pkg'), { recursive: true })

  let changes = 0
  const watcher = watchRepository(fixture.dir, () => {
    changes++
  })
  t.after(watcher.close)

  writeFileSync(
    join(fixture.dir, 'node_modules', 'some-pkg', 'index.js'),
    'module.exports = {};'
  )

  await delay(500)

  assert.equal(changes, 0)
})

test('watchRepository detects a new subdirectory created after startup', async t => {
  const fixture = await createTempGitRepo()
  t.after(fixture.cleanup)

  let changes = 0
  const watcher = watchRepository(fixture.dir, () => {
    changes++
  })
  t.after(watcher.close)

  const subdir = join(fixture.dir, 'new-folder')
  mkdirSync(subdir)
  await delay(100)
  writeFileSync(join(subdir, 'file.txt'), 'content')

  await delay(500)

  assert.ok(changes >= 1)
})
