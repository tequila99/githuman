export function artifactBody(content: string, bodyStartLine: number): string {
  let start = 0
  for (let line = 1; line < bodyStartLine; line++) {
    const end = content.indexOf('\n', start)
    if (end === -1) return ''
    start = end + 1
  }
  return content.slice(start)
}
