import { parseArgs } from 'node:util'

export interface ServeOptions {
  port: number
  host: string
  open: boolean
  /** Optional so programmatic callers (tests, embedders) can omit it and get
   *  the same flag/env/default resolution `resolveReviewsDbPath` applies. */
  dbPrefix?: string
}

const DEFAULT_PORT = 3847
const DEFAULT_HOST = 'localhost'

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

export function parseServeArgs(argv: string[]): ServeOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      port: { type: 'string' },
      host: { type: 'string' },
      open: { type: 'boolean', default: true },
      'no-open': { type: 'boolean', default: false },
      'db-prefix': { type: 'string' }
    },
    strict: false
  })

  let port = DEFAULT_PORT
  if (values.port !== undefined) {
    const parsed = Number(values.port)
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
      throw new Error(
        `Invalid --port value "${String(values.port)}": must be an integer between 1 and 65535`
      )
    }
    port = parsed
  }

  const host =
    typeof values.host === 'string' && values.host.length > 0
      ? values.host
      : DEFAULT_HOST
  const open = values['no-open'] === true ? false : values.open !== false
  const dbPrefix = resolveDbPrefix(
    typeof values['db-prefix'] === 'string' ? values['db-prefix'] : undefined
  )

  return { port, host, open, dbPrefix }
}
