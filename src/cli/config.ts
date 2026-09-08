import { parseArgs } from 'node:util'

export interface ServeOptions {
  port: number
  host: string
  open: boolean
}

const DEFAULT_PORT = 3847
const DEFAULT_HOST = 'localhost'

export function parseServeArgs(argv: string[]): ServeOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      port: { type: 'string' },
      host: { type: 'string' },
      open: { type: 'boolean', default: true },
      'no-open': { type: 'boolean', default: false }
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

  return { port, host, open }
}
