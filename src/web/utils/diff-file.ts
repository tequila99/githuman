import type { DiffFile } from '@/api/types'

export function pathOf(file: Pick<DiffFile, 'oldPath' | 'newPath'>): string {
  return file.newPath || file.oldPath
}
