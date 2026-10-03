import { basename } from 'node:path'

/** The client-supplied name must not escape the directory it is written into. */
export function safeFileName(name: string): string {
  const base = basename(name.replaceAll('\\', '/')).replaceAll('\0', '')
  return base === '' || base === '.' || base === '..' ? 'attachment' : base
}
