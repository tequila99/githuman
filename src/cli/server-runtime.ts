import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../server/app.ts'
import { createFileDatabase } from '../server/db/index.ts'
import { resolveDbPrefix, type ServeOptions } from './config.ts'
import { loadAgentPresets } from '../server/config/agents.ts'
import { WILDCARD_HOSTS } from '../server/utils/lan-addresses.ts'

const execFileAsync = promisify(execFile)

export interface RunningServer {
  app: FastifyInstance
  url: string
}

function resolveStaticRoot(): string | undefined {
  // Compiled layout: dist/cli/server-runtime.js sits next to dist/web/.
  // fileURLToPath (not URL.pathname) is required so this survives a percent-
  // encoded install path or a Windows drive letter (`file:///C:/...`).
  const candidatePath = fileURLToPath(new URL('../web', import.meta.url))

  return existsSync(join(candidatePath, 'index.html'))
    ? candidatePath
    : undefined
}

/** Best-effort opens `url` in the OS default browser — never throws or blocks startup. */
function openBrowser(url: string): void {
  const [command, args] =
    process.platform === 'darwin'
      ? (['open', [url]] as const)
      : process.platform === 'win32'
        ? (['cmd', ['/c', 'start', '""', url]] as const)
        : (['xdg-open', [url]] as const)
  execFile(command, args, () => {
    // Ignore failures (no GUI/browser available, headless CI, etc.) — the
    // startup message already printed the URL for the user to open by hand.
  })
}

/** Resolves the repository root from cwd, falling back to cwd itself outside a git repo. */
export async function resolveRepositoryPath(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['rev-parse', '--show-toplevel'],
      { cwd, encoding: 'utf-8' }
    )
    return stdout.trim()
  } catch {
    return cwd
  }
}

/**
 * Path to the reviews SQLite file for a given repository, shared by `serve`,
 * `list` and `export`. `dbPrefix` defaults (via `resolveDbPrefix`) the same
 * way `parseServeArgs` does, so callers that don't care about it — like
 * `serve`/`list`/`export` reading each other's file, or tests — land on the
 * same path without having to thread the prefix through explicitly.
 */
export function resolveReviewsDbPath(
  repositoryPath: string,
  dbPrefix?: string
): string {
  const prefix = resolveDbPrefix(dbPrefix)
  return join(repositoryPath, '.githuman', `${prefix}reviews.db`)
}

/** `.githuman/<prefix>agents.json` — the user's agent launch-command overrides (ADR 0023). */
export function resolveAgentsConfigPath(
  repositoryPath: string,
  dbPrefix?: string
): string {
  return join(
    repositoryPath,
    '.githuman',
    `${resolveDbPrefix(dbPrefix)}agents.json`
  )
}

export async function startServer(
  options: ServeOptions
): Promise<RunningServer> {
  const repositoryPath = await resolveRepositoryPath(process.cwd())
  const db = createFileDatabase(
    resolveReviewsDbPath(repositoryPath, options.dbPrefix)
  )

  // Agents and the terminal exist on every bind. Their hooks decide per
  // request: a request from this machine or a trusted device (ADR 0079).
  const app = buildApp({
    staticRoot: resolveStaticRoot(),
    repositoryPath,
    projectPath: process.cwd(),
    notesDir: options.notesDir,
    db,
    watchFiles: true,
    apiDocs: options.apiDocs === true,
    allowedHosts: options.allowedHosts ?? [],
    onPairingRequest: device =>
      console.log(
        `Pairing request from ${device.name} (${device.address}). Enter the code from the device in a localhost tab.`
      ),
    terminalEnabled: true,
    agentPresets: loadAgentPresets(
      resolveAgentsConfigPath(repositoryPath, options.dbPrefix)
    )
  })

  const address = await app.listen({ port: options.port, host: options.host })
  // A wildcard bind reports its own address (`http://[::]:3847`), which is
  // not a local Host. The operator tab must use localhost to approve devices.
  const url = WILDCARD_HOSTS.has(options.host)
    ? `http://localhost:${new URL(address).port}`
    : address

  if (options.open) {
    openBrowser(url)
  }

  return { app, url }
}
