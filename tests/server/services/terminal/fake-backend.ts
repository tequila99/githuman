import type { PtyBackend } from '../../../../src/server/services/terminal/backend.ts'
import type { TerminalRunning } from '../../../../src/shared/terminal/types.ts'
export class FakeBackend implements PtyBackend {
  readonly pid = 123
  readonly mode = 'pty'
  writes: string[] = []
  killed = false
  running: TerminalRunning = 'idle'
  data: (data: string) => void = () => {}
  exit: () => void = () => {}
  write(data: string): void {
    this.writes.push(data)
  }
  resize(): void {}
  paused = false
  pause(): void {
    this.paused = true
  }
  resume(): void {
    this.paused = false
  }
  interrupt(): void {}
  async kill(): Promise<void> {
    this.killed = true
  }
  async activity(): Promise<TerminalRunning> {
    return this.running
  }
  onData(listener: (data: string) => void): () => void {
    this.data = listener
    return () => {
      this.data = () => {}
    }
  }
  onExit(listener: () => void): () => void {
    this.exit = listener
    return () => {}
  }
}
