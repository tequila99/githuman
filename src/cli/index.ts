#!/usr/bin/env node
import { errorMessage } from '../shared/utils/error-message.ts'
import { writeFileSync } from 'node:fs'
import { parseServeArgs } from './config.ts'
import {
  startServer,
  resolveRepositoryPath,
  resolveReviewsDbPath
} from './server-runtime.ts'
import { formatStartupMessage } from './startup-message.ts'
import { parseListArgs, runList } from './commands/list.ts'
import { parseExportArgs, runExport } from './commands/export.ts'
import { createFileDatabase } from '../server/db/index.ts'
import { getAppVersion } from '../server/app-version.ts'
import type { DatabaseSync } from 'node:sqlite'

// Force exit when a graceful close hangs. It must exceed the terminal kill time: ps timeout plus grace.
const SHUTDOWN_TIMEOUT_MS = 5000

/** Opens the reviews DB for the repo at cwd, shared by `list` and `export`. */
async function openReviewsDb(
  dbPrefix: string
): Promise<{ db: DatabaseSync; repositoryPath: string }> {
  const repositoryPath = await resolveRepositoryPath(process.cwd())
  return {
    db: createFileDatabase(resolveReviewsDbPath(repositoryPath, dbPrefix)),
    repositoryPath
  }
}

async function main(argv: string[]): Promise<void> {
  console.log(`githuman v${getAppVersion()}`)

  const [command, ...rest] = argv

  switch (command) {
    case 'serve': {
      const options = parseServeArgs(rest)
      const { app, url } = await startServer(options)
      let stopping = false
      const shutdown = () => {
        if (stopping) return
        stopping = true
        // Do not wait for a stuck connection forever. Unref lets a clean close end the process by itself.
        const deadline = setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS)
        deadline.unref()
        void app
          .close()
          .then(() => {
            clearTimeout(deadline)
            process.exitCode = 0
            return undefined
          })
          .catch(error => {
            console.error(errorMessage(error))
            process.exitCode = 1
          })
      }
      process.once('SIGINT', shutdown)
      process.once('SIGTERM', shutdown)
      console.log(formatStartupMessage(url, options.host))
      return
    }
    case 'list': {
      const options = parseListArgs(rest)
      const { db } = await openReviewsDb(options.dbPrefix)
      console.log(runList(db, options))
      return
    }
    case 'export': {
      const options = parseExportArgs(rest)
      const { db, repositoryPath } = await openReviewsDb(options.dbPrefix)
      const output = await runExport(
        db,
        options.id,
        options.format,
        repositoryPath
      )
      if (options.output) {
        writeFileSync(options.output, output)
      } else {
        console.log(output)
      }
      return
    }
    default:
      console.error(`Unknown command: ${command ?? '(none)'}`)
      console.error('Usage: githuman serve|list|export [options]')
      process.exitCode = 1
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(errorMessage(error))
  process.exitCode = 1
})
