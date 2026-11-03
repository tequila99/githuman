import { fstatSync } from 'node:fs'
import { Socket } from 'node:net'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Bound startup even if the adapter never acknowledges the hello frame.
const HELLO_TIMEOUT_MS = 5000
// Reject oversized input before it can accumulate in the fixture.
const MAX_FRAME_BYTES = 4096

export default async function (pi) {
  const requests = new Socket({ fd: 3, readable: false, writable: true })
  const responses = new Socket({ fd: 4, readable: true, writable: false })
  requests.on('error', () => process.exit(71))
  responses.on('error', () => process.exit(72))
  responses.on('end', () => process.exit(0))
  const nonce = process.env.GITHUMAN_SPIKE_NONCE
  delete process.env.GITHUMAN_SPIKE_NONCE
  if (!nonce) process.exit(73)
  requests.write(JSON.stringify({ type: 'hello', version: 1, nonce }) + '\n')
  const timer = setTimeout(() => process.exit(74), HELLO_TIMEOUT_MS)
  await new Promise(resolve => {
    let buffer = Buffer.alloc(0)
    const onData = chunk => {
      buffer = Buffer.concat([buffer, chunk])
      if (buffer.length > MAX_FRAME_BYTES) process.exit(75)
      const end = buffer.indexOf(10)
      if (end < 0) return
      let frame
      try {
        frame = JSON.parse(buffer.subarray(0, end).toString())
      } catch {
        process.exit(73)
      }
      if (
        frame?.type !== 'hello_ack' ||
        frame.version !== 1 ||
        frame.nonce !== nonce
      ) {
        process.exit(73)
      }
      responses.off('data', onData)
      resolve()
    }
    responses.on('data', onData)
  })
  clearTimeout(timer)
  const channels = [3, 4].map(fd => {
    const stat = fstatSync(fd)
    return { fd, dev: stat.dev, ino: stat.ino }
  })
  // Compare identities, because a child can reuse the same descriptor numbers.
  const child = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./descriptor-probe.mjs', import.meta.url)), 'all'],
    {
      encoding: 'utf8',
      timeout: 2000
    }
  )
  if (child.status !== 0) process.exit(76)
  const inherited = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./descriptor-probe.mjs', import.meta.url)), '0'],
    {
      encoding: 'utf8',
      timeout: 2000,
      stdio: [3, 'pipe', 'pipe']
    }
  )
  if (inherited.status !== 0) process.exit(76)
  requests.write(
    JSON.stringify({
      type: 'ready',
      version: 1,
      nonce,
      channels,
      child: JSON.parse(child.stdout),
      inherited: JSON.parse(inherited.stdout)
    }) + '\n'
  )
  pi.on('tool_result', event => {
    if (event.toolName === 'bash') {
      requests.write(
        JSON.stringify({
          type: 'bash_result',
          version: 1,
          nonce,
          result: event
        }) + '\n'
      )
    }
  })
}
