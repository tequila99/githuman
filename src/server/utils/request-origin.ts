import { isIP } from 'node:net'

// Node reports IPv4 clients of a dual-stack socket with this prefix.
const IPV4_MAPPED_PREFIX = '::ffff:'
// Default ports of the page schemes that `Origin` may have.
const DEFAULT_PORTS: Readonly<Record<string, number>> = {
  'http:': 80,
  'https:': 443
}
// The port of a `Host` value; an IPv6 literal keeps its colons in brackets.
const EXPLICIT_PORT = /^(?:\[[^\]]*\]|[^:]*):(\d+)$/

/**
 * Parses a `Host` header as an HTTP authority. Returns undefined for values
 * with userinfo, a path, a query or a fragment: `localhost:80@evil` names
 * the host `evil`, not `localhost`.
 */
export function parseHost(host: string | undefined): URL | undefined {
  if (!host) return undefined
  try {
    const url = new URL(`http://${host}`)
    const plain =
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      !host.includes('/')
    return plain ? url : undefined
  } catch {
    return undefined
  }
}

/**
 * True when a browser `Origin` names the same host and port as `Host`.
 * The scheme comes from `Origin` only: behind a TLS proxy the page is
 * `https:`, but the connection to this server is HTTP. So the default port
 * of the page scheme applies to both sides: `https://h` matches `h` and
 * `h:443`, but not `h:80`. A `Host` without a port cannot tell the scheme,
 * so an HTTP page on port 80 and an HTTPS page on port 443 of one host
 * both match `h`. That needs a second web server on this machine.
 * `null`, userinfo and paths never match.
 */
export function sameOrigin(origin: string, host: string | undefined): boolean {
  const target = parseHost(host)
  if (!target || host === undefined) return false
  try {
    const source = new URL(origin)
    const defaultPort = DEFAULT_PORTS[source.protocol]
    if (defaultPort === undefined || source.origin !== origin) return false
    // `URL` drops port 80 of `http://h:80`, so the port comes from the raw header.
    const hostPort = EXPLICIT_PORT.exec(host)?.[1]
    return (
      source.hostname === target.hostname &&
      Number(source.port || defaultPort) === Number(hostPort ?? defaultPort)
    )
  } catch {
    return false
  }
}

/** Socket address of this machine: `127.0.0.0/8`, `::1` or IPv4-mapped loopback. */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false
  const plain = plainAddress(address)
  if (isIP(plain) === 4) return plain.startsWith('127.')
  return plain === '::1'
}

/** `::ffff:192.168.1.5` → `192.168.1.5`; other addresses stay as they are. */
export function plainAddress(address: string): string {
  return address.toLowerCase().startsWith(IPV4_MAPPED_PREFIX) &&
    isIP(address.slice(IPV4_MAPPED_PREFIX.length)) === 4
    ? address.slice(IPV4_MAPPED_PREFIX.length)
    : address
}

/**
 * Address of the client for limits and for the operator. A proxy on this
 * machine connects from loopback and appends the client address to
 * `X-Forwarded-For`, so the last entry is the client. A remote socket
 * cannot be a proxy of ours: its header is not trusted.
 */
export function clientAddress(
  socketAddress: string | undefined,
  forwardedFor: string | string[] | undefined
): string {
  const socket = socketAddress ?? ''
  if (isLoopbackAddress(socket)) {
    const forwarded = forwardedAddresses(forwardedFor)
    const last = forwarded?.at(-1)
    if (last !== undefined) return plainAddress(last)
  }
  return plainAddress(socket)
}

/**
 * Addresses from `X-Forwarded-For`, nearest proxy last. Returns undefined
 * when any entry is not a plain IP address: an unreadable chain must not
 * pass as a local one. An absent header gives an empty list.
 */
export function forwardedAddresses(
  header: string | string[] | undefined
): string[] | undefined {
  if (header === undefined) return []
  const entries = (Array.isArray(header) ? header.join(',') : header)
    .split(',')
    .map(entry => entry.trim())
  return entries.every(entry => isIP(entry) !== 0) ? entries : undefined
}
