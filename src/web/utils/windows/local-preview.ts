import type { PreviewTab } from '@/types/windows/preview'
import { isMarkdownPath } from '@/utils/markdown-path'
import { isPdfPath } from '@/utils/pdf-path'

// The picker lists formats supported by MarkdownContent, the browser image decoder and PDF.js.
export const PREVIEW_FILE_ACCEPT = '.md,.markdown,.pdf,image/*'

// MIME type that a browser reports for a PDF file.
const PDF_MIME = 'application/pdf'
// MIME prefix of every image type that a browser reports.
const IMAGE_MIME_PREFIX = 'image/'
// File names of images whose MIME type the browser does not report.
const IMAGE_NAME_PATTERN = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i

export function localPreviewKind(
  file: Pick<File, 'name' | 'type'>
): PreviewTab['kind'] | null {
  if (isMarkdownPath(file.name)) return 'markdown'
  if (isPdfPath(file.name) || file.type === PDF_MIME) return 'pdf'
  if (
    file.type.startsWith(IMAGE_MIME_PREFIX) ||
    IMAGE_NAME_PATTERN.test(file.name)
  ) {
    return 'image'
  }
  return null
}
