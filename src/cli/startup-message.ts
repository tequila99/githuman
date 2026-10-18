import { addressUrl } from '../shared/network/address-url.ts'

export function formatStartupMessage(
  url: string,
  lanAddresses: readonly string[]
): string {
  const lines = [`githuman listening on ${url}`]

  if (lanAddresses.length > 0) {
    const port = Number(new URL(url).port)
    lines.push(
      ...lanAddresses.map(
        address => `Local network: ${addressUrl(address, port)}`
      ),
      'Other devices request access at a local network address. Approve them in a localhost tab.',
      'Warning: traffic is plain HTTP. Anyone on this network can read it, including device cookies.'
    )
  }

  return lines.join('\n')
}
