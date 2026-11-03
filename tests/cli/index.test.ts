import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Resolve package metadata relative to this test file.
const PACKAGE_PATH = fileURLToPath(
  new URL('../../package.json', import.meta.url)
)
// Compare CLI output with the version declared by the package.
const APP_VERSION = (
  JSON.parse(readFileSync(PACKAGE_PATH, 'utf-8')) as { version: string }
).version

function waitForListeningUrl(
  child: ChildProcess,
  timeoutMs = 15_000
): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(
      () => fail(`Timed out waiting for server to start after ${timeoutMs} ms`),
      timeoutMs
    )

    function cleanup(): void {
      clearTimeout(timer)
      child.stdout?.off('data', onStdout)
      child.stderr?.off('data', onStderr)
      child.off('error', onError)
      child.off('close', onClose)
    }

    function fail(reason: string): void {
      cleanup()
      reject(
        new Error(
          `${reason} (exitCode=${child.exitCode}, signal=${child.signalCode})\nstdout:\n${stdout}\nstderr:\n${stderr}`
        )
      )
    }

    function onStdout(chunk: Buffer): void {
      stdout += chunk.toString()
      const match = stdout.match(/listening on (\S+)/)
      if (match) {
        cleanup()
        resolve(match[1])
      }
    }

    function onStderr(chunk: Buffer): void {
      stderr += chunk.toString()
    }

    function onError(error: Error): void {
      fail(`Failed to start CLI: ${error.message}`)
    }

    function onClose(): void {
      fail('CLI closed before the server started listening')
    }

    child.stdout?.on('data', onStdout)
    child.stderr?.on('data', onStderr)
    child.once('error', onError)
    child.once('close', onClose)
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

  const url = await waitForListeningUrl(child)
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
