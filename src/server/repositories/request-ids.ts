import type { DatabaseSync } from 'node:sqlite'
import { ArtifactConflictError } from '../errors/artifacts.ts'

// Command receipts that share one requestId scope inside a store.
export const COMMAND_RECEIPT_TABLES = [
  'artifact_operations',
  'artifact_definition_operations',
  'task_journal_operations',
  'task_handoff_operations'
] as const

export type CommandReceiptTable = (typeof COMMAND_RECEIPT_TABLES)[number]

/**
 * Rejects a requestId that already belongs to a different kind of command.
 * A silent overlap would let one replay return the receipt of another command.
 */
export function assertRequestIdFree(
  db: DatabaseSync,
  storeId: string,
  requestId: string,
  tables: readonly CommandReceiptTable[],
  message = 'Request identifier belongs to another operation.'
): void {
  for (const table of tables) {
    if (
      db
        .prepare(`SELECT 1 FROM ${table} WHERE store_id=? AND request_id=?`)
        .get(storeId, requestId)
    ) {
      throw new ArtifactConflictError(message)
    }
  }
}

/** Receipt tables other than the one that owns the command. */
export function otherReceiptTables(
  owner: CommandReceiptTable
): CommandReceiptTable[] {
  return COMMAND_RECEIPT_TABLES.filter(table => table !== owner)
}
