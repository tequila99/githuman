export function formatStartupMessage(url: string, host: string): string[] {
  const lines = [`githuman-vue listening on ${url}`]

  if (host !== 'localhost' && host !== '127.0.0.1') {
    lines.push(
      'Warning: server is reachable from your local network without authentication.'
    )
  }

  return lines
}
