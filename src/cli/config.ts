import { isIP } from 'node:net'
import { parseArgs } from 'node:util'
import { isLoopbackHost } from '../shared/network/loopback.ts'
import { WILDCARD_HOSTS } from '../server/utils/lan-addresses.ts'

export interface ServeOptions {
  port: number
  host: string
  open: boolean
  /** Alternate notes directory, resolved from the launch directory. */
  notesDir?: string
  /** Optional so programmatic callers (tests, embedders) can omit it and get
   *  the same flag/env/default resolution `resolveReviewsDbPath` applies. */
  dbPrefix?: string
  /** Serves Swagger UI at `/api/docs` (`--api-docs`). */
  apiDocs?: boolean
  /** Extra exact host names that LAN requests may use (`--allowed-host`, ADR 0079). */
  allowedHosts?: string[]
}

const DEFAULT_PORT = 3847
const DEFAULT_HOST = 'localhost'
// One DNS name: dot-separated labels of letters, digits and inner hyphens.
const HOST_NAME_PATTERN =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/

/**
 * Default prefix for filenames written under `.githuman/` (e.g.
 * `ght-reviews.db`). The original mcollina/githuman CLI reads and writes
 * `.githuman/reviews.db` in the same repo root with an incompatible schema —
 * without a prefix, running both tools against the same repository would
 * silently corrupt or crash on the other tool's database file.
 */
export const DEFAULT_DB_PREFIX = 'ght-'

/**
 * `GITHUMAN_DB_PREFIX` is intentionally not one of the env vars the original
 * mcollina/githuman CLI reads (`GITHUMAN_DB_PATH`, `GITHUMAN_TOKEN`), so
 * setting it can't be mistaken for configuring the original tool.
 */
const DB_PREFIX_ENV_VAR = 'GITHUMAN_DB_PREFIX'

/**
 * Resolves the `.githuman/`-internal filename prefix: an explicit value (CLI
 * flag) wins, then the env var, then the default — each checked with `!==
 * undefined` rather than truthiness, so an explicitly empty string ("") is a
 * valid override that means "use the original mcollina/githuman filenames
 * unprefixed" (e.g. for a deliberate interop/migration attempt), not "unset".
 */
export function resolveDbPrefix(explicit?: string): string {
  if (explicit !== undefined) {
    return explicit
  }
  const fromEnv = process.env[DB_PREFIX_ENV_VAR]
  if (fromEnv !== undefined) {
    return fromEnv
  }
  return DEFAULT_DB_PREFIX
}

function resolvePort(explicit: string | undefined): number {
  if (explicit === undefined) {
    return DEFAULT_PORT
  }
  const parsed = Number(explicit)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(
      `Invalid --port value "${explicit}": must be an integer between 1 and 65535`
    )
  }
  return parsed
}

/**
 * Only loopback or every interface (ADR 0079). With one LAN address there
 * is no loopback listener, so no local tab can approve a device.
 */
function resolveHost(explicit: string | undefined): string {
  if (explicit === undefined || explicit.length === 0) {
    return DEFAULT_HOST
  }
  if (
    WILDCARD_HOSTS.has(explicit) ||
    (isLoopbackHost(explicit) && !explicit.startsWith('['))
  ) {
    return explicit
  }
  throw new Error(
    `Invalid --host value "${explicit}": use localhost (default), or 0.0.0.0 or :: for access from the local network`
  )
}

/** Exact host names only: no scheme, port, path, userinfo or wildcard. */
function resolveAllowedHosts(values: unknown[]): string[] {
  return values.map(value => {
    const name = String(value).toLowerCase()
    // A loopback name allows nothing: local requests are found by the socket.
    const loopback =
      name === 'localhost' ||
      name.endsWith('.localhost') ||
      name.startsWith('127.')
    if (loopback || (!HOST_NAME_PATTERN.test(name) && isIP(name) !== 4)) {
      throw new Error(
        `Invalid --allowed-host value "${String(value)}": give an exact non-loopback host name or IPv4 address, for example machine.tailnet.ts.net. IPv6 literals are not accepted.`
      )
    }
    return name
  })
}

export function parseServeArgs(argv: string[]): ServeOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      port: { type: 'string' },
      host: { type: 'string' },
      open: { type: 'boolean', default: true },
      'no-open': { type: 'boolean', default: false },
      'notes-dir': { type: 'string' },
      'db-prefix': { type: 'string' },
      'api-docs': { type: 'boolean', default: false },
      'allowed-host': { type: 'string', multiple: true }
    },
    strict: false
  })

  const port = resolvePort(
    typeof values.port === 'string' ? values.port : undefined
  )
  const host = resolveHost(
    typeof values.host === 'string' ? values.host : undefined
  )
  const open = values['no-open'] === true ? false : values.open !== false
  const dbPrefix = resolveDbPrefix(
    typeof values['db-prefix'] === 'string' ? values['db-prefix'] : undefined
  )

  const apiDocs = values['api-docs'] === true
  const allowedHosts = resolveAllowedHosts(
    Array.isArray(values['allowed-host']) ? values['allowed-host'] : []
  )

  return {
    port,
    host,
    open,
    dbPrefix,
    apiDocs,
    allowedHosts,
    ...(typeof values['notes-dir'] === 'string'
      ? { notesDir: values['notes-dir'] }
      : process.env.GITHUMAN_NOTES_DIR
        ? { notesDir: process.env.GITHUMAN_NOTES_DIR }
        : {})
  }
}
