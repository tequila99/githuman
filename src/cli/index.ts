#!/usr/bin/env node
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

/** Opens the reviews DB for the repo at cwd, shared by `list` and `export`. */
async function openReviewsDb(dbPrefix: string): Promise<DatabaseSync> {
  const repositoryPath = await resolveRepositoryPath(process.cwd())
  return createFileDatabase(resolveReviewsDbPath(repositoryPath, dbPrefix))
}

async function main(argv: string[]): Promise<void> {
  console.log(`githuman v${getAppVersion()}`)

  const [command, ...rest] = argv

  switch (command) {
    case 'serve': {
      const options = parseServeArgs(rest)
      const { url } = await startServer(options)
      console.log(formatStartupMessage(url, options.host))
      return
    }
    case 'list': {
      const options = parseListArgs(rest)
      const db = await openReviewsDb(options.dbPrefix)
      console.log(runList(db, options))
      return
    }
    case 'export': {
      const options = parseExportArgs(rest)
      const db = await openReviewsDb(options.dbPrefix)
      const output = runExport(db, options.id, options.format)
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
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
