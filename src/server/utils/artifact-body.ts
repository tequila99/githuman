export function artifactBody(content: string, bodyStartLine: number): string {
  let start = 0
  for (let line = 1; line < bodyStartLine; line++) {
    start = content.indexOf('\n', start) + 1
  }
  return content.slice(start)
}
