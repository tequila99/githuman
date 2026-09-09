import { parseArgs } from 'node:util'
import type { DatabaseSync } from 'node:sqlite'
import {
  exportAsJson,
  exportAsMarkdown,
  ExportNotFoundError
} from '../../server/services/export.service.ts'
import { getReviews } from '../../server/services/review.service.ts'

export class ExportCliError extends Error {}

export type ExportFormat = 'json' | 'markdown'

export interface ExportArgs {
  id: string
  format: ExportFormat
  output: string | undefined
}

export function parseExportArgs(argv: string[]): ExportArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      format: { type: 'string', default: 'markdown' },
      output: { type: 'string', short: 'o' }
    },
    strict: false,
    allowPositionals: true
  })

  const [id] = positionals
  if (!id) {
    throw new ExportCliError(
      'Usage: githuman export <id|last> [--format json|markdown] [-o <file>]'
    )
  }

  if (values.format !== 'json' && values.format !== 'markdown') {
    throw new ExportCliError(
      `Invalid --format value "${String(values.format)}": expected "json" or "markdown"`
    )
  }

  return {
    id,
    format: values.format,
    output: typeof values.output === 'string' ? values.output : undefined
  }
}

function resolveReviewId(db: DatabaseSync, id: string): string {
  if (id !== 'last') {
    return id
  }

  const [latest] = getReviews(db)
  if (!latest) {
    throw new ExportCliError('No reviews found in this repository')
  }
  return latest.id
}

export function runExport(
  db: DatabaseSync,
  id: string,
  format: ExportFormat = 'markdown'
): string {
  const reviewId = resolveReviewId(db, id)

  try {
    return format === 'json'
      ? JSON.stringify(exportAsJson(db, reviewId), null, 2)
      : exportAsMarkdown(db, reviewId)
  } catch (error) {
    if (error instanceof ExportNotFoundError) {
      throw new ExportCliError(error.message)
    }
    throw error
  }
}
