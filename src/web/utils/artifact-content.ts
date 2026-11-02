import { artifactBody } from '../../shared/utils/artifact-body.ts'
import { artifactsApi } from '@/api/artifacts'
import type { Artifact } from '@/api/types'

/** The content does not match its metadata identity or its chunk protocol. */
export class ArtifactContentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArtifactContentError'
  }
}

/** Reuse verified immutable content in both the catalog and the preview window. */
export async function loadArtifactBody(
  metadata: Artifact,
  signal?: AbortSignal
): Promise<string> {
  let offset = 0
  let text = ''
  do {
    signal?.throwIfAborted()
    const chunk = await artifactsApi.content(metadata.id, offset, signal)
    if (
      chunk.storeId !== metadata.storeId ||
      chunk.id !== metadata.id ||
      chunk.sha256 !== metadata.sha256 ||
      chunk.totalBytes !== metadata.bytes ||
      chunk.offset !== offset ||
      chunk.bodyStartLine !== metadata.bodyStartLine
    ) {
      throw new ArtifactContentError(
        'The artifact content does not match its identity.'
      )
    }
    text += chunk.text
    const next = chunk.nextOffset
    const bytes = new TextEncoder().encode(chunk.text).length
    if (next === null) break
    if (next !== offset + bytes || next <= offset || next >= metadata.bytes) {
      throw new ArtifactContentError('Invalid artifact content continuation.')
    }
    offset = next
  } while (offset < metadata.bytes)
  if (new TextEncoder().encode(text).length !== metadata.bytes) {
    throw new ArtifactContentError('Incomplete artifact content.')
  }
  return artifactBody(text, metadata.bodyStartLine)
}
