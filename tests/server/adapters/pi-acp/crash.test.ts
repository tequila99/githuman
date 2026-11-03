import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { PiProcess } from '../../../../src/server/adapters/pi-acp/process.ts'
import { signalProcess } from '../../../../src/server/services/terminal/processes.ts'

// Keep the accepted native-chat crash limitation observable without requiring pi in the normal suite.
const COMMAND = process.env.GITHUMAN_PI_SPIKE_COMMAND

test(
  'pi chat crash closes the bridge; native descendant cleanup is best effort',
  {
    skip: !COMMAND,
    timeout: 15000
  },
  async t => {
    const dir = await mkdtemp(join(tmpdir(), 'pi-crash-regression-'))
    const marker = join(dir, 'owned-processes')
    const runtime = new PiProcess()
    let shellPid = 0
    let failed = false
    runtime.onFailure = () => {
      failed = true
    }
    t.after(async () => {
      runtime.close()
      if (shellPid > 1) signalProcess(-shellPid, 'SIGKILL')
      await rm(dir, { recursive: true, force: true })
    })
    await runtime.start(
      dir,
      'chat',
      { tools: [], instructions: '' },
      {
        PATH: process.env.PATH,
        HOME: dir,
        PI_CODING_AGENT_DIR: dir,
        PI_ACP_PI_COMMAND: COMMAND,
        PI_OFFLINE: '1'
      }
    )
    const quoted = "'" + marker.replaceAll("'", "'\\''") + "'"
    const running = runtime.request('bash', {
      command: `printf '%s %s' "$PPID" "$$" > ${quoted}; exec sleep 60`
    })
    void running.catch(() => {})
    let piPid = 0
    for (let i = 0; i < 300; i++) {
      const ids = (await readFile(marker, 'utf8').catch(() => ''))
        .split(' ')
        .map(Number)
      if (ids[0] > 1 && ids[1] > 1) {
        ;[piPid, shellPid] = ids
        break
      }
      await delay(10)
    }
    assert.ok(piPid > 1 && piPid !== process.pid && shellPid > 1)
    process.kill(piPid, 'SIGKILL')
    await delay(700)
    assert.equal(failed, true)
    await assert.rejects(running, /closed/)
    await assert.rejects(runtime.request('get_state'), /unavailable/)
    try {
      process.kill(-shellPid, 0)
      t.diagnostic(
        'Accepted native-chat limitation: bash survived pi SIGKILL; test cleanup will stop it.'
      )
    } catch (error) {
      assert.equal((error as NodeJS.ErrnoException).code, 'ESRCH')
      t.diagnostic('Native bash was already stopped after pi SIGKILL.')
    }
  }
)
