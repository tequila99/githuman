// Drop an unfinished control string that is too long to keep for a snapshot.
const MAX_ESCAPE_TAIL = 8192

export class EscapeTail {
  // text: no sequence is open. escape: after ESC. csi: control sequence, ends with a final byte.
  // string: OSC, DCS, PM or APC data, ends with BEL or ST. string-escape: after ESC inside a string.
  private state: 'text' | 'escape' | 'csi' | 'string' | 'string-escape' = 'text'
  private value = ''

  get tail(): string {
    return this.value
  }

  push(data: string): void {
    for (const char of data) {
      // 8-bit CSI (U+009B) starts a control sequence in any state.
      if (char === '\u009b') {
        this.state = 'csi'
        this.value = char
        continue
      }
      // 8-bit OSC, DCS, SOS, PM and APC start a control string in any state.
      if (['\u009d', '\u0090', '\u0098', '\u009e', '\u009f'].includes(char)) {
        this.state = 'string'
        this.value = char
        continue
      }
      if (this.state === 'text') {
        // ESC opens a new sequence. Other text is not part of the tail.
        if (char === '\x1b') {
          this.state = 'escape'
          this.value = char
        }
        continue
      }
      this.value += char
      // A long OSC, DCS or APC string must not close the shell.
      if (this.value.length > MAX_ESCAPE_TAIL) {
        this.reset()
        continue
      }
      // CAN and SUB cancel the open sequence.
      if (char === '\x18' || char === '\x1a') {
        this.reset()
        continue
      }
      if (this.state === 'escape') {
        if (char === '[') {
          // ESC [ starts a control sequence.
          this.state = 'csi'
        } else if (']PX^_'.includes(char)) {
          // ESC ] P X ^ _ start OSC, DCS, SOS, PM and APC strings.
          this.state = 'string'
        } else if (char >= '0' && char <= '~') {
          // A final byte ends a short escape sequence, for example ESC 7.
          this.reset()
        }
      } else if (this.state === 'csi') {
        if (char >= '@' && char <= '~') {
          // A final byte ends the control sequence.
          this.reset()
        } else if (char === '\x1b') {
          // ESC aborts the control sequence and opens a new one.
          this.state = 'escape'
          this.value = char
        }
      } else if (this.state === 'string') {
        if (char === '\x07' || char === '\u009c') {
          // BEL or 8-bit ST ends the string.
          this.reset()
        } else if (char === '\x1b') {
          // ESC can start the two-character ST (ESC \).
          this.state = 'string-escape'
        }
      } else if (char === '\\') {
        // ESC \ is ST: it ends the string.
        this.reset()
      } else {
        // ESC with any other character is part of the string data.
        this.state = 'string'
      }
    }
  }

  private reset(): void {
    this.state = 'text'
    this.value = ''
  }
}
