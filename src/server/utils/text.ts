/** Ends a cut text when the caller gives no marker of its own. */
const DEFAULT_TRUNCATION_MARKER = '\n… (truncated)'

/**
 * Cuts `text` to `max` characters. `marker` gets the number of characters
 * dropped and returns what is appended, so each caller can tell its reader
 * (browser, agent) what happened.
 */
export function truncateText(
  text: string,
  max: number,
  marker: (omitted: number) => string = () => DEFAULT_TRUNCATION_MARKER
): string {
  return text.length > max
    ? `${text.slice(0, max)}${marker(text.length - max)}`
    : text
}

/** True when the bytes contain a NUL: the quick test git itself uses to call a file binary. */
export function isBinaryBuffer(bytes: Uint8Array): boolean {
  return bytes.includes(0)
}

/**
 * The text of `bytes` if they are valid UTF-8 without NUL, else `null`.
 * Stricter than `Buffer#toString`, which turns bad bytes into U+FFFD.
 */
export function decodeText(bytes: Uint8Array): string | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return text.includes('\0') ? null : text
  } catch {
    return null
  }
}
