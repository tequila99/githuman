import { spawn } from 'node:child_process'
import { PromptTracker, TERMINAL_PROMPT_MARKER } from './prompt-tracker.ts'
import { basename } from 'node:path'
import type { IPty } from '@lydell/node-pty'
import type {
  TerminalMode,
  TerminalRunning
} from '../../../shared/terminal/types.ts'
import {
  processActivity,
  signalProcess,
  terminateProcesses
} from './processes.ts'

// Stop waiting for the first prompt marker after this time.
const STARTUP_TIMEOUT_MS = 2000
// Stop waiting for the first prompt marker after this many output characters.
const STARTUP_BUFFER_CHARS = 65536

// Shells that accept `-l -i` and set the prompt through `PS1`. Other shells get no prompt marker.
const POSIX_SHELLS = ['bash', 'zsh', 'sh', 'dash', 'ksh']

export interface PtyBackend {
  readonly pid: number
  readonly mode: TerminalMode
  write(data: string): void
  resize(cols: number, rows: number): void
  pause(): void
  resume(): void
  interrupt(): void
  kill(): Promise<void>
  activity(): Promise<TerminalRunning>
  onData(listener: (data: string) => void): () => void
  onExit(listener: () => void): () => void
}

let modulePromise: Promise<typeof import('@lydell/node-pty') | null> | undefined
export function loadPty(): Promise<typeof import('@lydell/node-pty') | null> {
  modulePromise ??= import('@lydell/node-pty').catch(() => null)
  return modulePromise
}

export class NodePtyBackend implements PtyBackend {
  readonly mode = 'pty'
  private readonly pty: IPty
  private readonly prompt = new PromptTracker()
  private readonly listeners = new Set<(data: string) => void>()
  private readonly disposeData
  private readonly startupTimer: ReturnType<typeof setTimeout> | undefined
  constructor(pty: IPty, shellName?: string) {
    this.pty = pty
    const integrated =
      shellName !== undefined && POSIX_SHELLS.includes(shellName)
    let ready = !integrated
    let startup = ''
    const emit = (data: string) => {
      for (const listener of this.listeners) listener(data)
    }
    this.disposeData = pty.onData(data => {
      this.prompt.output(data)
      if (ready) {
        emit(data)
        return
      }
      startup += data
      const boundary = startup.indexOf(TERMINAL_PROMPT_MARKER)
      if (boundary >= 0) {
        ready = true
        emit(startup.slice(boundary))
        startup = ''
        clearTimeout(this.startupTimer)
      } else if (startup.length > STARTUP_BUFFER_CHARS) {
        ready = true
        emit(startup)
        startup = ''
        clearTimeout(this.startupTimer)
      }
    })
    if (integrated) {
      this.startupTimer = setTimeout(() => {
        ready = true
        emit(startup)
        startup = ''
      }, STARTUP_TIMEOUT_MS)
      this.startupTimer.unref()
      // Preserve the user's prompt and add an invisible activity marker.
      const prefix =
        shellName === 'bash'
          ? "'\\[\\e]133;A\\a\\]'"
          : shellName === 'zsh'
            ? '"%{$(printf \'\\033]133;A\\007\')%}"'
            : '"$(printf \'\\033]133;A\\007\')"'
      pty.write(`PS1=${prefix}"$PS1"; printf '\\033]133;A\\007'\r`)
    }
  }
  get pid(): number {
    return this.pty.pid
  }
  write(data: string): void {
    this.prompt.input()
    this.pty.write(data)
  }
  resize(cols: number, rows: number): void {
    this.pty.resize(cols, rows)
  }
  pause(): void {
    this.pty.pause()
  }
  resume(): void {
    this.pty.resume()
  }
  interrupt(): void {
    this.write('\x03')
  }
  async activity(): Promise<TerminalRunning> {
    const activity = await processActivity(this.pid)
    return activity === 'idle'
      ? this.prompt.idle
        ? 'idle'
        : 'unknown'
      : activity
  }
  async kill(): Promise<void> {
    clearTimeout(this.startupTimer)
    await terminateProcesses(this.pid)
    this.disposeData.dispose()
    this.listeners.clear()
  }
  onData(listener: (data: string) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  onExit(listener: () => void): () => void {
    const disposable = this.pty.onExit(listener)
    return () => disposable.dispose()
  }
}

export class PipeBackend implements PtyBackend {
  readonly mode = 'pipe'
  private readonly prompt = new PromptTracker()
  private readonly child
  private readonly dataListeners = new Set<(data: string) => void>()
  private readonly exitListeners = new Set<() => void>()
  constructor(cwd: string) {
    // Merge both output descriptors so prompts cannot overtake stdout.
    this.child = spawn('/bin/sh', ['-c', 'exec /bin/sh -i 2>&1'], {
      cwd,
      detached: true,
      env: {
        ...process.env,
        TERM: 'dumb',
        FORCE_COLOR: '1',
        CLICOLOR_FORCE: '1',
        PS1: TERMINAL_PROMPT_MARKER + '$ '
      },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (data: string) => {
      this.prompt.output(data)
      for (const listener of this.dataListeners)
        listener(data.replace(/\n/g, '\r\n'))
    })
    this.child.on('error', () => {
      for (const listener of this.exitListeners) listener()
    })
    this.child.on('exit', () => {
      for (const listener of this.exitListeners) listener()
    })
    this.child.stdin.on('error', () => {})
  }
  get pid(): number {
    return this.child.pid ?? 0
  }
  write(data: string): void {
    this.prompt.input()
    this.child.stdin.write(data)
  }
  resize(): void {}
  pause(): void {
    this.child.stdout.pause()
  }
  resume(): void {
    this.child.stdout.resume()
  }
  interrupt(): void {
    if (this.pid > 1) signalProcess(-this.pid, 'SIGINT')
  }
  async activity(): Promise<TerminalRunning> {
    const activity = await processActivity(this.pid)
    return activity === 'idle'
      ? this.prompt.idle
        ? 'idle'
        : 'unknown'
      : activity
  }
  async kill(): Promise<void> {
    if (this.pid > 1) await terminateProcesses(this.pid)
  }
  onData(listener: (data: string) => void): () => void {
    this.dataListeners.add(listener)
    return () => this.dataListeners.delete(listener)
  }
  onExit(listener: () => void): () => void {
    this.exitListeners.add(listener)
    return () => this.exitListeners.delete(listener)
  }
}

export async function createBackend(
  cwd: string,
  cols: number,
  rows: number
): Promise<PtyBackend> {
  const module = await loadPty()
  if (!module) return new PipeBackend(cwd)
  const shell = process.env.SHELL || '/bin/sh'
  const args = POSIX_SHELLS.includes(basename(shell)) ? ['-l', '-i'] : ['-i']
  const pty = module.spawn(shell, args, {
    cwd,
    cols,
    rows,
    name: 'xterm-256color',
    env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
  })
  return new NodePtyBackend(pty, basename(shell))
}
