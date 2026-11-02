import { piFailureReason } from './errors.ts'
import { terminateProcesses } from '../../services/terminal/processes.ts'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { Socket } from 'node:net'
import { fileURLToPath } from 'node:url'
import {
  JsonChannel,
  CONTROL_VERSION,
  BRIDGE_TIMEOUT_MS,
  MAX_CONTROL_BYTES,
  MAX_PENDING_CALLS
} from './control.ts'
import type { ControlFrame } from './control.ts'
import { piLaunchArgs, type PiProfile } from './compatibility.ts'
import { isRecord } from '../../../shared/utils/guards.ts'

interface Pending {
  resolve: (value: Record<string, unknown>) => void
  reject: (error: Error) => void
}

export class PiProcess {
  readonly #pending = new Map<string, Pending>()
  readonly #nonce = randomBytes(32).toString('hex')
  #child?: ChildProcess
  #channel?: JsonChannel
  #closed = false
  #rpcBuffer = Buffer.alloc(0)
  #hello = false
  #ready = false
  onControl: (frame: ControlFrame) => void = () => {}
  onEvent: (event: Record<string, unknown>) => void = () => {}
  onFailure: () => void = () => {}

  async start(
    cwd: string,
    profile: PiProfile,
    config: Record<string, unknown>,
    env: NodeJS.ProcessEnv = process.env
  ): Promise<void> {
    const command = env.PI_ACP_PI_COMMAND || 'pi'
    const extension = fileURLToPath(
      new URL(
        import.meta.url.endsWith('.ts') ? './extension.ts' : './extension.js',
        import.meta.url
      )
    )
    const args = await piLaunchArgs(command, profile, extension)
    if (this.#closed) {
      throw new Error('Pi bridge closed during runtime discovery')
    }
    const piEnv: NodeJS.ProcessEnv = { ...env, GITHUMAN_PI_NONCE: this.#nonce }
    for (const key of [
      'GITHUMAN_AGENT_KEY',
      'GITHUMAN_AGENT_URL',
      'GITHUMAN_PI_PROFILE'
    ]) {
      delete piEnv[key]
    }
    const child = spawn(command, args, {
      cwd,
      env: piEnv,
      stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
      detached: true
    })
    this.#child = child
    child.stdin.on('error', () => this.fail())
    child.stderr.resume()
    child.on('error', () => this.fail())
    child.on('exit', () => this.fail())
    const startup = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Pi bridge startup deadline exceeded'))
        this.fail()
      }, BRIDGE_TIMEOUT_MS)
      this.#pending.set('startup', {
        resolve: () => {
          clearTimeout(timer)
          resolve()
        },
        reject: error => {
          clearTimeout(timer)
          reject(error)
        }
      })
    })
    const requestPipe = child.stdio[3]
    const responsePipe = child.stdio[4]
    if (!(requestPipe instanceof Socket) || !(responsePipe instanceof Socket)) {
      throw new Error('Pi control pipes unavailable')
    }
    this.#channel = new JsonChannel(
      requestPipe,
      responsePipe,
      frame => {
        if (frame.nonce !== this.#nonce) return this.fail()
        if (frame.type === 'fatal') {
          this.fail(
            frame.reason === 'tool_name_collision'
              ? 'Pi MCP tool name collision with an installed extension.'
              : 'Pi extension reload requires a new chat.'
          )
          return
        }
        if (frame.type === 'hello') {
          if (this.#hello) return this.fail()
          this.#hello = true
          this.send('configure', { ...config, profile })
        } else if (frame.type === 'ready') {
          if (
            !this.#hello ||
            this.#ready ||
            frame.profile !== profile ||
            frame.registryGeneration !== 1
          ) {
            return this.fail()
          }
          this.#ready = true
          this.#pending.get('startup')?.resolve({})
          this.#pending.delete('startup')
        } else if (this.#ready) {
          this.onControl(frame)
        } else {
          this.fail()
        }
      },
      () => this.fail()
    )
    child.stdout.on('data', (chunk: Buffer) => this.readRpc(chunk))
    await startup
  }

  send(type: string, fields: Record<string, unknown> = {}): void {
    if (!this.#channel || this.#closed) {
      throw new Error('Pi bridge control channel unavailable')
    }
    this.#channel.send({
      ...fields,
      type,
      nonce: this.#nonce,
      version: CONTROL_VERSION
    })
  }

  request(
    type: string,
    fields: Record<string, unknown> = {}
  ): Promise<Record<string, unknown>> {
    if (
      this.#closed ||
      !this.#child?.stdin ||
      this.#pending.size >= MAX_PENDING_CALLS
    ) {
      return Promise.reject(
        new Error('Pi RPC unavailable or pending limit exceeded')
      )
    }
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.#pending.delete(id)
          reject(new Error('Pi RPC deadline exceeded'))
          this.fail()
        },
        type === 'prompt' ? 300000 : BRIDGE_TIMEOUT_MS
      )
      this.#pending.set(id, {
        resolve: value => {
          clearTimeout(timer)
          this.#pending.delete(id)
          resolve(value)
        },
        reject: error => {
          clearTimeout(timer)
          this.#pending.delete(id)
          reject(error)
        }
      })
      this.#child!.stdin!.write(JSON.stringify({ ...fields, type, id }) + '\n')
    })
  }

  private readRpc(chunk: Buffer): void {
    if (this.#rpcBuffer.length + chunk.length > MAX_CONTROL_BYTES) {
      return this.fail()
    }
    this.#rpcBuffer = Buffer.concat([this.#rpcBuffer, chunk])
    let index: number
    while ((index = this.#rpcBuffer.indexOf(10)) >= 0) {
      const line = this.#rpcBuffer.subarray(0, index).toString()
      this.#rpcBuffer = this.#rpcBuffer.subarray(index + 1)
      let event: unknown
      try {
        event = JSON.parse(line)
      } catch {
        continue
      }
      if (!isRecord(event)) return this.fail()
      if (event.type === 'response') {
        const request = this.#pending.get(String(event.id))
        if (request) {
          if (event.success === true) {
            request.resolve(isRecord(event.data) ? event.data : {})
          } else {
            request.reject(new Error(piFailureReason(event.error)))
          }
        }
      } else {
        this.onEvent(event)
      }
    }
  }

  private fail(reason?: string): void {
    if (this.#closed) return
    this.close(reason)
    this.onFailure()
  }

  close(reason = 'Pi bridge process or control channel closed'): void {
    if (this.#closed) return
    this.#closed = true
    for (const pending of this.#pending.values()) {
      pending.reject(new Error(reason))
    }
    this.#pending.clear()
    const child = this.#child
    if (!child?.pid) {
      this.#channel?.close()
      return
    }
    void terminateProcesses(child.pid).finally(() => this.#channel?.close())
  }
}
