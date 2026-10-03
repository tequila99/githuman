import { isLoopbackHost } from '../shared/network/loopback.ts'

export function formatStartupMessage(url: string, host: string): string {
  const lines = [`githuman listening on ${url}`]

  if (!isLoopbackHost(host)) {
    lines.push(
      'Warning: server is reachable from your local network without authentication.',
      'Agent chat is disabled: it is only available when listening on localhost.'
    )
  }

  return lines.join('\n')
}
