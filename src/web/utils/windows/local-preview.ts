import type { PreviewTab } from '@/types/windows/preview'

// The picker lists formats supported by MarkdownContent, the browser image decoder and PDF.js.
export const PREVIEW_FILE_ACCEPT = '.md,.markdown,.pdf,image/*'

export function localPreviewKind(
  file: Pick<File, 'name' | 'type'>
): PreviewTab['kind'] | null {
  if (/\.(md|markdown)$/i.test(file.name)) return 'markdown'
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') return 'pdf'
  if (
    file.type.startsWith('image/') ||
    /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i.test(file.name)
  )
    return 'image'
  return null
}
