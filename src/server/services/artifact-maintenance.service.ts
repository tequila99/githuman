import { errorMessage } from '../../shared/utils/error-message.ts'
import type { ArtifactStorageService } from './artifact-storage.service.ts'

// Detect other writers and retry expired operation leases without device settings.
const MAINTENANCE_INTERVAL_MS = 2000

interface ArtifactMaintenanceOptions {
  storage: Pick<ArtifactStorageService, 'recover' | 'pollChanges'>
  onError: (error: unknown, phase: 'recovery' | 'poll') => void
}

export class ArtifactMaintenanceService {
  private readonly options: ArtifactMaintenanceOptions
  private timer: ReturnType<typeof setInterval> | undefined
  private running = false
  // Last reported message per phase; a repeating failure is reported once.
  private readonly reported = new Map<string, string>()

  constructor(options: ArtifactMaintenanceOptions) {
    this.options = options
  }

  start(): void {
    if (this.running) return
    this.running = true
    // Reads verify every file, so a failed first pass must not block the server.
    this.run(true)
    if (!this.running) return
    this.timer = setInterval(() => this.check(), MAINTENANCE_INTERVAL_MS)
    this.timer.unref()
  }

  stop(): void {
    this.running = false
    clearInterval(this.timer)
    this.timer = undefined
  }

  private check(): void {
    if (!this.running) return
    this.run(false)
  }

  private run(cleanupCommitted: boolean): void {
    this.attempt('recovery', () =>
      this.options.storage.recover(cleanupCommitted)
    )
    // The error handler may stop the service.
    if (!this.running) return
    // A failed recovery must not hide changes committed by another process.
    this.attempt('poll', () => this.options.storage.pollChanges())
  }

  private attempt(phase: 'recovery' | 'poll', run: () => unknown): void {
    try {
      run()
      this.reported.delete(phase)
    } catch (error) {
      const message = errorMessage(error)
      if (this.reported.get(phase) === message) return
      this.reported.set(phase, message)
      this.options.onError(error, phase)
    }
  }
}
