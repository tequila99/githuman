export function hasErrorCode(error: unknown, ...codes: string[]): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    codes.includes(error.code)
  )
}

export function isSystemError(error: unknown, code: string): boolean {
  return error instanceof Error && hasErrorCode(error, code)
}

// Git file reads treat a non-directory path component as a missing path.
export function isMissingPathError(error: unknown): boolean {
  return hasErrorCode(error, 'ENOENT', 'ENOTDIR')
}
