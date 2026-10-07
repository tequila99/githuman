// OSC 133 marks a prompt without adding visible characters.
export const TERMINAL_PROMPT_MARKER = '\x1b]133;A\x07'

export class PromptTracker {
  idle = false
  private tail = ''
  input(): void {
    this.idle = false
  }
  output(data: string): void {
    const combined = this.tail + data
    if (combined.includes(TERMINAL_PROMPT_MARKER)) this.idle = true
    this.tail = combined.slice(-(TERMINAL_PROMPT_MARKER.length - 1))
  }
}
