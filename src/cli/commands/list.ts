import { parseArgs } from 'node:util'
import type { DatabaseSync } from 'node:sqlite'
import type { ReviewStatus } from '../../shared/types.ts'
import { getReviews } from '../../server/services/review.service.ts'

export interface ListOptions {
  json?: boolean
  status?: ReviewStatus
}

export function parseListArgs(argv: string[]): {
  json: boolean
  status: ReviewStatus | undefined
} {
  const { values } = parseArgs({
    args: argv,
    options: {
      json: { type: 'boolean', default: false },
      status: { type: 'string' }
    },
    strict: false
  })

  return {
    json: values.json === true,
    status: isReviewStatus(values.status) ? values.status : undefined
  }
}

function isReviewStatus(value: unknown): value is ReviewStatus {
  return (
    value === 'in_progress' ||
    value === 'approved' ||
    value === 'changes_requested'
  )
}

export function runList(db: DatabaseSync, options: ListOptions = {}): string {
  let reviews = getReviews(db)

  if (options.status) {
    reviews = reviews.filter(review => review.status === options.status)
  }

  if (options.json) {
    return JSON.stringify(reviews)
  }

  if (reviews.length === 0) {
    return 'Ревью не найдены.'
  }

  return reviews
    .map(review => `${review.id}\t${review.status}\t${review.createdAt}`)
    .join('\n')
}
