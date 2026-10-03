import type { DiffFile } from '../diff/types.ts'

export function formatDiffFile(file: DiffFile): string {
  const lines = [
    `--- ${file.oldPath ? `a/${file.oldPath}` : '/dev/null'}`,
    `+++ ${file.newPath ? `b/${file.newPath}` : '/dev/null'}`
  ]
  if (file.isBinary) {
    lines.push('(binary file)')
  }
  for (const hunk of file.hunks) {
    lines.push(
      `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`
    )
    for (const line of hunk.lines) {
      const prefix =
        line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '
      lines.push(prefix + line.content)
    }
  }
  return lines.join('\n')
}
