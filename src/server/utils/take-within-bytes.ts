import { MAX_ARTIFACT_REVIEW_PAGE_BYTES } from '../../shared/artifacts/constants.ts'

export function takeWithinBytes<T>(
  items: readonly T[],
  limit: number,
  maxBytes = MAX_ARTIFACT_REVIEW_PAGE_BYTES
): T[] {
  const result: T[] = []
  let bytes = 2
  for (const item of items) {
    if (result.length >= limit) break
    const nextBytes =
      Buffer.byteLength(JSON.stringify(item)) + (result.length ? 1 : 0)
    // Keep one complete item so a large comment cannot stop pagination.
    if (result.length && bytes + nextBytes > maxBytes) break
    result.push(item)
    bytes += nextBytes
  }
  return result
}
