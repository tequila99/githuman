import { randomUUID } from 'node:crypto'
import { isPromise } from 'node:util/types'
import type { DatabaseSync } from 'node:sqlite'
import { AsyncTransactionError } from '../errors/database.ts'

export type SyncCallback<T> = (() => T) &
  ([Extract<T, PromiseLike<unknown>>] extends [never] ? unknown : never)

function complete<T>(
  db: DatabaseSync,
  run: SyncCallback<T>,
  commit: string,
  rollback: string
): T {
  try {
    const result = run()
    if (
      result !== null &&
      (typeof result === 'object' || typeof result === 'function') &&
      'then' in result &&
      typeof result.then === 'function'
    ) {
      // Reject async results without leaving a native Promise rejection unhandled.
      if (isPromise(result)) void result.catch(() => {})
      throw new AsyncTransactionError()
    }
    db.exec(commit)
    return result
  } catch (error) {
    try {
      db.exec(rollback)
    } catch (rollbackError) {
      // oxlint-disable-next-line preserve-caught-error -- Both errors are retained; the operation failure remains the primary cause.
      throw new AggregateError(
        [error, rollbackError],
        'Transaction failed and rollback also failed.',
        { cause: error }
      )
    }
    throw error
  }
}

export function withTransaction<T>(
  db: DatabaseSync,
  run: SyncCallback<T>,
  options: { mode: 'deferred' | 'immediate' } = { mode: 'deferred' }
): T {
  // A failed BEGIN must not roll back a transaction owned by the caller.
  db.exec(options.mode === 'immediate' ? 'BEGIN IMMEDIATE' : 'BEGIN DEFERRED')
  return complete(db, run, 'COMMIT', 'ROLLBACK')
}

export function withSavepoint<T>(db: DatabaseSync, run: SyncCallback<T>): T {
  // Unique names keep nested scopes independent of other repository calls.
  const name = `ght_${randomUUID().replaceAll('-', '')}`
  db.exec(`SAVEPOINT ${name}`)
  return complete(
    db,
    run,
    `RELEASE ${name}`,
    `ROLLBACK TO ${name}; RELEASE ${name}`
  )
}
