// SQLite stores the primary result code in the low byte of extended codes.
const PRIMARY_CODE_MASK = 0xff
// Another connection owns a conflicting database lock.
const SQLITE_BUSY = 5
// A conflicting operation holds a table or connection lock.
const SQLITE_LOCKED = 6

export function isSqliteBusyError(error: unknown): boolean {
  if (
    !(error instanceof Error) ||
    !('errcode' in error) ||
    typeof error.errcode !== 'number'
  ) {
    return false
  }
  const code = error.errcode & PRIMARY_CODE_MASK
  return code === SQLITE_BUSY || code === SQLITE_LOCKED
}
