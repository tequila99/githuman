import { exportFile } from 'quasar'
import type { AgentContextItem } from '@/api/types'

export type AttachmentItem = Extract<AgentContextItem, { kind: 'attachment' }>

import { MAX_ATTACHMENT_BYTES } from '../../shared/agents/constants'
export { MAX_ATTACHMENT_BYTES } from '../../shared/agents/constants'

export class AttachmentTooLargeError extends Error {}

export function isImageAttachment(
  item: AgentContextItem
): item is AttachmentItem {
  return item.kind === 'attachment' && item.mimeType.startsWith('image/')
}

export function attachmentSrc(item: AttachmentItem): string {
  return `data:${item.mimeType};base64,${item.data}`
}

/** The attachment's raw bytes (it travels as base64). */
export function attachmentBytes(item: AttachmentItem): Uint8Array<ArrayBuffer> {
  const binary = atob(item.data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/** Saves the attachment as a file instead of opening it in the browser. */
export function downloadAttachment(item: AttachmentItem): void {
  exportFile(item.name, attachmentBytes(item), item.mimeType)
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    // readAsDataURL always yields a string.
    reader.addEventListener('load', () =>
      resolve(typeof reader.result === 'string' ? reader.result : '')
    )
    reader.addEventListener('error', () => reject(reader.error))
    reader.readAsDataURL(file)
  })
}

/** Reads a picked or pasted file into a prompt attachment (base64). */
export async function readAttachment(file: File): Promise<AttachmentItem> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentTooLargeError(file.name)
  }
  const url = await readAsDataUrl(file)
  const mimeType = file.type || 'application/octet-stream'
  return {
    kind: 'attachment',
    // Clipboard images usually come as "image.png"; keep a name either way.
    name: file.name || `pasted.${mimeType.split('/')[1] ?? 'bin'}`,
    mimeType,
    data: url.slice(url.indexOf(',') + 1)
  }
}

/** Image files from a paste event (screenshots, copied images). */
export function clipboardImages(data: DataTransfer | null): File[] {
  if (!data) return []
  return [...data.items]
    .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
    .map(item => item.getAsFile())
    .filter(file => file !== null)
}
