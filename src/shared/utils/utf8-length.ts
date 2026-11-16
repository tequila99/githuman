// One encoder is enough: encode() keeps no state between calls.
const ENCODER = new TextEncoder()

/** Length of the text in UTF-8 bytes, the unit of server text limits. */
export function utf8Length(text: string): number {
  return ENCODER.encode(text).length
}
