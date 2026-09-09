import type { DiffFile } from '@/api/types'

export function pathOf(file: DiffFile): string {
  return file.newPath || file.oldPath
}
