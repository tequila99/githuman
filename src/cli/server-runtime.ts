import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../server/app.ts'
import { createFileDatabase } from '../server/db/index.ts'
import type { ServeOptions } from './config.ts'

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

/** Path to the reviews SQLite file for a given repository, shared by `serve`, `list` and `export`. */
export function resolveReviewsDbPath(repositoryPath: string): string {
  return join(repositoryPath, '.githuman', 'reviews.db')
}

export async function startServer(
  options: ServeOptions
): Promise<RunningServer> {
  const repositoryPath = await resolveRepositoryPath(process.cwd())
  const db = createFileDatabase(resolveReviewsDbPath(repositoryPath))

  const app = buildApp({
    staticRoot: resolveStaticRoot(),
    repositoryPath,
    db,
    watchFiles: true
  })

  const address = await app.listen({ port: options.port, host: options.host })

  if (options.open) {
    openBrowser(address)
  }

  return { app, url: address }
}
