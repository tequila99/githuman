import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function waitForListeningUrl(
  stdout: NodeJS.ReadableStream,
  timeoutMs = 5000
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Timed out waiting for server to start')),
      timeoutMs
    )
    let buffer = ''

    stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      const match = buffer.match(/listening on (\S+)/)
      if (match) {
        clearTimeout(timer)
        resolve(match[1])
      }
    })
  })
}

test('githuman serve boots a working HTTP server from the CLI entry point', async t => {
  const repoDir = mkdtempSync(join(tmpdir(), 'githuman-cli-'))

  const child = spawn(
    'node',
    [
      join(import.meta.dirname, '../../src/cli/index.ts'),
      'serve',
      '--port',
      '0',
      '--no-open'
    ],
    {
      cwd: repoDir,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )

  t.after(() => {
    child.kill()
  })

  const url = await waitForListeningUrl(child.stdout)
  const response = await fetch(new URL('/health', url))

  assert.equal(response.status, 200)
})
