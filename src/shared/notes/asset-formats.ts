export interface NoteAssetFormat {
  extension: string
  mime: string
  label: string
  display: 'image' | 'link'
  aliases: readonly string[]
}

// Keep upload policy, response MIME types and asset identifiers in agreement.
export const NOTE_ASSET_FORMATS = [
  // Animated PNG retains the same storage extension as existing PNG attachments.
  {
    extension: 'png',
    mime: 'image/png',
    label: 'PNG',
    display: 'image',
    aliases: ['apng']
  },
  {
    extension: 'jpg',
    mime: 'image/jpeg',
    label: 'JPEG',
    display: 'image',
    aliases: []
  },
  {
    extension: 'gif',
    mime: 'image/gif',
    label: 'GIF',
    display: 'image',
    aliases: []
  },
  {
    extension: 'webp',
    mime: 'image/webp',
    label: 'WebP',
    display: 'image',
    aliases: []
  }
] as const satisfies readonly NoteAssetFormat[]

// Existing content hashes and extensions remain valid across server upgrades.
export const NOTE_ASSET_ID_PATTERN = `^[a-f0-9]{64}\\.(${NOTE_ASSET_FORMATS.map(format => format.extension).join('|')})$`

// Error messages follow the same allowlist as upload validation.
export const SUPPORTED_NOTE_ASSETS = NOTE_ASSET_FORMATS.map(
  format => format.label
).join(', ')

export type NoteAssetExtension =
  (typeof NOTE_ASSET_FORMATS)[number]['extension']

export function noteAssetFormat(extension: string | undefined) {
  return NOTE_ASSET_FORMATS.find(format => format.extension === extension)
}
