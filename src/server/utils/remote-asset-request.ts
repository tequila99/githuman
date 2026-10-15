import { lookup } from 'node:dns/promises'
import type { LookupAddress } from 'node:dns'
import type { IncomingHttpHeaders } from 'node:http'
import { BlockList, isIP, type LookupFunction } from 'node:net'
import type { Readable } from 'node:stream'
import { Agent, request, type Dispatcher } from 'undici'
import { BadRequestError } from '../errors/http.ts'
import { isCredentialFreeWebUrl } from '../../shared/utils/web-url.ts'

// Stop connection attempts that cannot establish a socket promptly.
const CONNECTION_TIMEOUT_MS = 10000
// Stop responses that send no headers or no body data.
const RESPONSE_IDLE_TIMEOUT_MS = 15000
// Bound the size of response headers.
const MAX_HEADER_BYTES = 16384
// Stop redirect chains and loops.
const MAX_REDIRECTS = 5
// Only these statuses ask the client to follow a Location header.
const REDIRECT_STATUSES: readonly number[] = [301, 302, 303, 307, 308]
// Network failures that mean the remote server cannot serve the attachment.
const UNREACHABLE_CODES = new Set([
  'ENOTFOUND',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'UND_ERR_SOCKET'
])

// Ask servers for the exact bytes: compressed bodies are not supported.
const REQUEST_HEADERS = {
  'accept-encoding': 'identity',
  'user-agent': 'githuman-note-assets'
}

// Exclude non-public IPv4 ranges before opening any socket.
const BLOCKED_IPV4 = new BlockList()
// IPv6 routing must be public and must exclude special-purpose ranges.
const PUBLIC_IPV6 = new BlockList()
const BLOCKED_IPV6 = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3]
] as const) {
  BLOCKED_IPV4.addSubnet(address, prefix, 'ipv4')
}
// Only globally routable IPv6 is eligible, with special-purpose ranges excluded.
PUBLIC_IPV6.addSubnet('2000::', 3, 'ipv6')
BLOCKED_IPV6.addSubnet('2001::', 23, 'ipv6')
BLOCKED_IPV6.addSubnet('2001:db8::', 32, 'ipv6')
BLOCKED_IPV6.addSubnet('2002::', 16, 'ipv6')
BLOCKED_IPV6.addSubnet('3fff::', 20, 'ipv6')

export function isPublicAssetAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return !BLOCKED_IPV4.check(address, 'ipv4')
  return (
    family === 6 &&
    PUBLIC_IPV6.check(address, 'ipv6') &&
    !BLOCKED_IPV6.check(address, 'ipv6')
  )
}

export type HostResolver = (
  host: string,
  options: { all: true; verbatim: true }
) => Promise<LookupAddress[]>

// Node streams give the body; `statusCode` and `headers` mirror `IncomingMessage`.
export type RemoteAssetResponse = Readable & {
  statusCode?: number
  headers: IncomingHttpHeaders
}

export type RemoteAssetRequest = (
  url: string,
  method: 'HEAD' | 'GET',
  signal: AbortSignal
) => Promise<RemoteAssetResponse>

export interface RemoteAssetOptions {
  resolveHost?: HostResolver
  dispatcher?: Dispatcher
}

/**
 * Resolves a host name and refuses non-public results. The socket connects to
 * the checked address, so no second lookup can change the target.
 */
export function createPublicLookup(
  resolveHost: HostResolver = lookup
): LookupFunction {
  return (hostname, options, callback) => {
    void (async () => {
      let addresses: LookupAddress[]
      try {
        addresses = await resolveHost(hostname, { all: true, verbatim: true })
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)), '')
        return
      }
      const first = addresses[0]
      if (
        !first ||
        addresses.some(item => !isPublicAssetAddress(item.address))
      ) {
        callback(new BadRequestError('Attachment address is not public'), '')
      } else if (options.all) {
        callback(null, addresses)
      } else {
        callback(null, first.address, first.family)
      }
    })()
  }
}

function createAgent(resolveHost?: HostResolver) {
  return new Agent({
    connect: {
      lookup: createPublicLookup(resolveHost),
      timeout: CONNECTION_TIMEOUT_MS
    },
    connectTimeout: CONNECTION_TIMEOUT_MS,
    headersTimeout: RESPONSE_IDLE_TIMEOUT_MS,
    bodyTimeout: RESPONSE_IDLE_TIMEOUT_MS,
    maxHeaderSize: MAX_HEADER_BYTES
  })
}

// Undici ignores an abort while it waits for a socket, so the wait ends here.
async function untilAborted<T>(
  work: Promise<T>,
  signal: AbortSignal,
  discard: (late: T) => void
): Promise<T> {
  let abort: (() => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
  })
  try {
    return await Promise.race([work, aborted])
  } catch (error) {
    // A request that finishes after the abort still owns a socket.
    work.then(discard, () => undefined)
    throw error
  } finally {
    if (abort) signal.removeEventListener('abort', abort)
  }
}

let sharedAgent: Agent | undefined

function parseAssetUrl(value: string, message: string, base?: URL): URL {
  let url: URL
  try {
    url = new URL(value, base)
  } catch {
    throw new BadRequestError(message)
  }
  if (!isCredentialFreeWebUrl(url)) {
    throw new BadRequestError(
      'Only public HTTP and HTTPS attachments are supported'
    )
  }
  return url
}

export async function remoteAssetRequest(
  source: string,
  method: 'HEAD' | 'GET',
  signal: AbortSignal,
  options: RemoteAssetOptions = {}
): Promise<RemoteAssetResponse> {
  const dispatcher =
    options.dispatcher ??
    (options.resolveHost
      ? createAgent(options.resolveHost)
      : (sharedAgent ??= createAgent()))
  let url = parseAssetUrl(source, 'Invalid attachment URL')
  for (let redirects = 0; ; redirects++) {
    signal.throwIfAborted()
    // The socket layer skips the lookup for IP literals, so check them here.
    const host = url.hostname.replace(/^\[|\]$/g, '')
    if (isIP(host) && !isPublicAssetAddress(host)) {
      throw new BadRequestError('Attachment address is not public')
    }
    const { statusCode, headers, body } = await untilAborted(
      request(url, { method, signal, dispatcher, headers: REQUEST_HEADERS }),
      signal,
      late => late.body.destroy()
    )
    if (!REDIRECT_STATUSES.includes(statusCode)) {
      return Object.assign(body, { statusCode, headers })
    }
    body.destroy()
    if (redirects >= MAX_REDIRECTS) {
      throw new BadRequestError('Too many attachment redirects')
    }
    const location = headers.location
    if (!location || Array.isArray(location)) {
      throw new BadRequestError('Attachment redirect has no valid location')
    }
    const next = parseAssetUrl(location, 'Invalid attachment redirect', url)
    if (url.protocol === 'https:' && next.protocol !== 'https:') {
      throw new BadRequestError('Insecure attachment redirect')
    }
    url = next
  }
}

/** Maps transport failures to client errors; other errors pass through. */
export function translateRemoteAssetError(error: unknown): unknown {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : undefined
  if (code === 'UND_ERR_CONNECT_TIMEOUT') {
    return new BadRequestError('Attachment connection timed out')
  }
  if (code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT') {
    return new BadRequestError('Attachment download stalled')
  }
  if (typeof code === 'string' && UNREACHABLE_CODES.has(code)) {
    return new BadRequestError('Attachment server could not be reached')
  }
  return error
}
