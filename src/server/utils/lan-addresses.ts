import { networkInterfaces } from 'node:os'

// Hosts that make the server listen on every interface (ADR 0079).
export const WILDCARD_HOSTS: ReadonlySet<string> = new Set(['0.0.0.0', '::'])
// IPv6 link-local range fe80::/10.
const IPV6_LINK_LOCAL = /^fe[89ab]/i

/**
 * Non-loopback addresses of this machine. Link-local addresses are left
 * out: they need a zone id and do not work in a browser URL.
 */
export function machineAddresses(): string[] {
  const result: string[] = []
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue
      if (entry.family === 'IPv4' && !entry.address.startsWith('169.254.')) {
        result.push(entry.address)
      } else if (
        entry.family === 'IPv6' &&
        !IPV6_LINK_LOCAL.test(entry.address)
      ) {
        result.push(entry.address)
      }
    }
  }
  return result
}

/**
 * LAN addresses that a bind host accepts: `0.0.0.0` accepts IPv4 only,
 * `::` accepts both families, a loopback bind accepts none.
 */
export function lanAddresses(bindHost: string): string[] {
  if (!WILDCARD_HOSTS.has(bindHost)) return []
  return machineAddresses().filter(
    address => bindHost === '::' || !address.includes(':')
  )
}
