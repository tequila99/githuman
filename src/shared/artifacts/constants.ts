// Share lifecycle values between runtime schemas and frontend filters.
export const ARTIFACT_STATUSES = [
  'draft',
  'in_review',
  'accepted',
  'rejected',
  'superseded',
  'archived',
  'deleted'
] as const

// Bound document allocation before serialization and filesystem reads.
export const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024
// Leave room for the immutable frontmatter.
export const MAX_ARTIFACT_BODY_BYTES = Math.floor(1.9 * 1024 * 1024)
// Bound metadata and operation records independently of document content.
export const MAX_ARTIFACT_METADATA_BYTES = 64 * 1024
// Keep content responses small enough for later MCP transport.
export const MAX_ARTIFACT_CHUNK_BYTES = 64 * 1024
// Use the same normal query size for document and definition pages.
export const DEFAULT_ARTIFACT_PAGE_SIZE = 50
// Bound catalog and history pages.
export const MAX_ARTIFACT_PAGE_SIZE = 100

// Bound source excerpts independently of immutable document size.
export const MAX_ARTIFACT_SOURCE_QUOTE_BYTES = 64 * 1024
// Keep normal pages small; one complete large item can exceed this soft budget.
export const MAX_ARTIFACT_PAGE_BYTES = 128 * 1024

// Bound the user query before normalization can expand its Unicode representation.
export const MAX_SEARCH_QUERY_CODEPOINTS = 256
// Keep token combinations and cursor validation bounded.
export const MAX_SEARCH_TOKENS = 8
// Include the original token alongside a small set of corrected alternatives.
export const MAX_SEARCH_VARIANTS = 8
// A candidate can add at most two codepoints to a maximum-length query token.
export const MAX_SEARCH_WORD_CODEPOINTS = MAX_SEARCH_QUERY_CODEPOINTS + 2
