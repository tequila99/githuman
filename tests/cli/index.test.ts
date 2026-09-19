import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgPath = fileURLToPath(new URL('../../package.json', import.meta.url))
const APP_VERSION = (
  JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string }
).version

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

function runCli(
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'node',
      [join(import.meta.dirname, '../../src/cli/index.ts'), ...args],
      { cwd, stdio: ['ignore', 'pipe', 'pipe'] }
    )

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.on('error', reject)
    child.on('close', () => resolve({ stdout, stderr }))
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

test('githuman serve prints the app version before it starts listening', async t => {
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

  let buffer = ''
  for await (const chunk of child.stdout) {
    buffer += (chunk as Buffer).toString()
    if (buffer.includes('listening on')) break
  }

  const versionIndex = buffer.indexOf(`githuman v${APP_VERSION}`)
  const listeningIndex = buffer.indexOf('listening on')
  assert.notEqual(versionIndex, -1)
  assert.ok(versionIndex < listeningIndex)
})

test('githuman list in an empty repo prints the app version', async () => {
  const repoDir = mkdtempSync(join(tmpdir(), 'githuman-cli-'))

  const { stdout } = await runCli(['list'], repoDir)

  assert.match(stdout, new RegExp(`^githuman v${APP_VERSION}`))
})

test('an unknown command still prints the app version', async () => {
  const repoDir = mkdtempSync(join(tmpdir(), 'githuman-cli-'))

  const { stdout } = await runCli(['bogus'], repoDir)

  assert.match(stdout, new RegExp(`^githuman v${APP_VERSION}`))
})
