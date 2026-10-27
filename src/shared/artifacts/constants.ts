// Bound document allocation before serialization and filesystem reads.
export const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024
// Leave room for the immutable frontmatter.
export const MAX_ARTIFACT_BODY_BYTES = Math.floor(1.9 * 1024 * 1024)
// Bound metadata and operation records independently of document content.
export const MAX_ARTIFACT_METADATA_BYTES = 64 * 1024
// Keep content responses small enough for later MCP transport.
export const MAX_ARTIFACT_CHUNK_BYTES = 64 * 1024
// Bound catalog and history pages.
export const MAX_ARTIFACT_PAGE_SIZE = 100
