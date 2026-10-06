import { randomBytes } from 'node:crypto'
import { TERMINAL_TOKEN_MS } from '../../../shared/terminal/constants.ts'

// Bound token memory when a page repeatedly requests credentials.
const MAX_TOKENS = 256

export class TerminalTokens {
  private readonly tokens = new Map<
    string,
    { origin: string; expires: number }
  >()
  private readonly now: () => number
  constructor(now = Date.now) {
    this.now = now
  }
  issue(origin: string): string {
    this.prune()
    if (this.tokens.size >= MAX_TOKENS)
      this.tokens.delete(this.tokens.keys().next().value ?? '')
    const token = randomBytes(32).toString('base64url')
    this.tokens.set(token, { origin, expires: this.now() + TERMINAL_TOKEN_MS })
    return token
  }
  consume(token: string, origin: string): boolean {
    const info = this.tokens.get(token)
    this.tokens.delete(token)
    return !!info && info.expires > this.now() && info.origin === origin
  }
  private prune(): void {
    for (const [token, info] of this.tokens)
      if (info.expires <= this.now()) this.tokens.delete(token)
  }
  clear(): void {
    this.tokens.clear()
  }
}
