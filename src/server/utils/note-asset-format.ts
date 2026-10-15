import { fileTypeFromBuffer } from 'file-type'
import {
  NOTE_ASSET_FORMATS,
  SUPPORTED_NOTE_ASSETS
} from '../../shared/notes/asset-formats.ts'
import { BadRequestError } from '../errors/http.ts'

export async function detectNoteAssetFormat(bytes: Uint8Array) {
  let detected
  try {
    detected = await fileTypeFromBuffer(bytes)
  } catch (cause) {
    throw new BadRequestError('Could not identify attachment format', { cause })
  }
  const format =
    detected &&
    NOTE_ASSET_FORMATS.find(
      candidate =>
        candidate.extension === detected.ext ||
        candidate.aliases.some(alias => alias === detected.ext)
    )
  if (!format) {
    throw new BadRequestError('Supported attachments: ' + SUPPORTED_NOTE_ASSETS)
  }
  return format
}
