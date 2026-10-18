import { DEVICE_NAME_MAX_LENGTH } from './constants.ts'

// C0, DEL and C1: the name reaches the server console.
const CONTROL_CHARACTERS = /\p{Cc}/gu

/**
 * A name without control characters and outer spaces, cut by code points:
 * the schema counts code points too, and a cut must not split an emoji.
 */
export function cleanDeviceName(name: string | undefined): string {
  const plain = (name ?? '').replace(CONTROL_CHARACTERS, '').trim()
  return Array.from(plain).slice(0, DEVICE_NAME_MAX_LENGTH).join('').trim()
}
