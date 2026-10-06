import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { once } from 'node:events'
import { WebSocket } from 'ws'

test(
  'CLI SIGTERM stops detached shell and its foreground command',
  { timeout: 15_000 },
  async t => {
    const directory = mkdtempSync(join(tmpdir(), 'githuman-terminal-shutdown-'))
    execFileSync('git', ['init', '-q', directory])
    const cli = spawn(
      process.execPath,
      [
        resolve('src/cli/index.ts'),
        'serve',
        '--port',
        '0',
        '--host',
        '127.0.0.1',
        '--no-open'
      ],
      {
        cwd: directory,
        env: { ...process.env, SHELL: '/bin/sh' },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    t.after(() => {
      cli.kill('SIGKILL')
      rmSync(directory, { recursive: true, force: true })
    })
    const origin = await new Promise<string>((resolveUrl, reject) => {
      let text = ''
      cli.stdout.on('data', data => {
        text += data.toString()
        const match = /githuman listening on (http:\/\/[^\s]+)/.exec(text)
        if (match) resolveUrl(match[1])
      })
      cli.once('error', reject)
      cli.once('exit', code =>
        reject(new Error(`CLI exited before listening: ${code}`))
      )
    })
    const host = new URL(origin).host
    const response = await fetch(`${origin}/api/terminal/token`, {
      method: 'POST',
      headers: { Origin: origin, Host: host }
    })
    const token = (await response.json()).token
    const socket = new WebSocket(
      `${origin.replace('http:', 'ws:')}/api/terminal/ws?token=${token}`,
      { headers: { Origin: origin } }
    )
    t.after(() => socket.terminate())
    const processIds = await new Promise<{ shell: number; child: number }>(
      (resolvePid, reject) => {
        let output = ''
        socket.on('error', reject)
        socket.on('open', () =>
          socket.send(
            JSON.stringify({
              type: 'create',
              requestId: 'shutdown',
              cols: 80,
              rows: 24
            })
          )
        )
        socket.on('message', data => {
          assert.ok(Buffer.isBuffer(data))
          const message = JSON.parse(data.toString('utf8'))
          if (message.type === 'created')
            socket.send(
              JSON.stringify({
                type: 'subscribe',
                terminalId: message.terminalId
              })
            )
          if (message.type === 'snapshot')
            socket.send(
              JSON.stringify({
                type: 'input',
                terminalId: message.terminalId,
                data: 'printf "SHELL_PID=%s\\n" $$; /usr/bin/sleep 60 & printf "CHILD_PID=%s\\n" $!; wait\r'
              })
            )
          if (message.type === 'output') {
            output += message.data
            socket.send(
              JSON.stringify({
                type: 'ack',
                terminalId: message.terminalId,
                sequence: message.sequence
              })
            )
            const match = /SHELL_PID=(\d+)/.exec(output)
            const childMatch = /CHILD_PID=(\d+)/.exec(output)
            if (match && childMatch)
              resolvePid({
                shell: Number(match[1]),
                child: Number(childMatch[1])
              })
          }
        })
      }
    )
    const exit = once(cli, 'exit')
    cli.kill('SIGTERM')
    const [code] = await exit
    assert.equal(code, 0)
    assert.throws(() => process.kill(processIds.shell, 0))
    assert.throws(() => process.kill(processIds.child, 0))
  }
)
