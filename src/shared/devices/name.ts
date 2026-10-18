import { DEVICE_NAME_MAX_LENGTH } from './constants.ts'

// C0, DEL, C1 and format characters (bidi overrides, zero-width): the name
// reaches the server console and the operator dialog.
const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]/gu

/**
 * A name without control and format characters and outer spaces, cut by code points:
 * the schema counts code points too, and a cut must not split an emoji.
 */
export function cleanDeviceName(name: string | undefined): string {
  const plain = (name ?? '').replace(CONTROL_CHARACTERS, '').trim()
  return Array.from(plain).slice(0, DEVICE_NAME_MAX_LENGTH).join('').trim()
}
