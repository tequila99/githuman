import { Type } from '@sinclair/typebox'
import { Nullable } from '../utils/schemas.ts'
import {
  MAX_ARTIFACT_CHUNK_BYTES,
  MAX_ARTIFACT_PAGE_SIZE
} from './constants.ts'

export const ArtifactActorSchema = Type.Object(
  {
    kind: Type.Union(
      [Type.Literal('user'), Type.Literal('agent'), Type.Literal('system')],
      { description: 'Authenticated source of the operation.' }
    ),
    id: Type.String({
      minLength: 1,
      maxLength: 256,
      description: 'Identity assigned by the server transport.'
    })
  },
  { additionalProperties: false, description: 'Operation author.' }
)

export const ArtifactMetadataInputSchema = Type.Object(
  {
    title: Type.String({
      minLength: 1,
      maxLength: 1000,
      description: 'Document title.'
    }),
    tags: Type.Array(
      Type.String({
        minLength: 1,
        maxLength: 128,
        description: 'Free-form tag.'
      }),
      { maxItems: 100, uniqueItems: true, description: 'Document tags.' }
    )
  },
  {
    additionalProperties: false,
    description: 'Editable metadata supported by the storage stage.'
  }
)

export const ArtifactSchema = Type.Object(
  {
    storeId: Type.String({ description: 'Artifact store UUID.' }),
    id: Type.String({ description: 'Immutable artifact UUID.' }),
    sha256: Type.String({ description: 'SHA-256 of the exact stored bytes.' }),
    bytes: Type.Integer({ description: 'Stored file size in bytes.' }),
    bodyStartLine: Type.Integer({
      description: 'One-based first body line in the stored file.'
    }),
    createdAt: Type.String({ description: 'Creation time in UTC.' }),
    metadataVersion: Type.Integer({ description: 'Current metadata version.' }),
    metadataUpdatedAt: Type.String({
      description: 'Last metadata change in UTC.'
    }),
    title: Type.String({ description: 'Current document title.' }),
    tags: Type.Array(Type.String(), { description: 'Current document tags.' }),
    typeId: Type.Literal('generic', {
      description: 'Initial document type; extended in the graph stage.'
    }),
    status: Type.Literal('draft', {
      description: 'Only draft is available in the storage stage.'
    })
  },
  {
    additionalProperties: false,
    description: 'Artifact identity and current metadata.'
  }
)

export const ArtifactEventSchema = Type.Object(
  {
    storeId: Type.String({ description: 'Artifact store UUID.' }),
    seq: Type.Integer({
      description: 'Monotonic event sequence in the database.'
    }),
    artifactId: Type.String({ description: 'Artifact UUID.' }),
    requestId: Type.String({ description: 'Idempotent operation identifier.' }),
    actor: ArtifactActorSchema,
    action: Type.Union(
      [Type.Literal('created'), Type.Literal('metadata_updated')],
      { description: 'Recorded operation.' }
    ),
    beforeVersion: Nullable(
      Type.Integer({ description: 'Previous version; null on creation.' })
    ),
    afterVersion: Type.Integer({ description: 'New metadata version.' }),
    createdAt: Type.String({ description: 'Event time in UTC.' }),
    metadata: ArtifactMetadataInputSchema
  },
  { description: 'Immutable metadata history event.' }
)

export const ArtifactParams = Type.Object(
  {
    id: Type.String({ format: 'uuid', description: 'Artifact UUID.' })
  },
  { additionalProperties: false, description: 'Artifact identity.' }
)

export const ArtifactListQuery = Type.Object(
  {
    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: MAX_ARTIFACT_PAGE_SIZE,
        description: 'Maximum page size.'
      })
    ),
    cursor: Type.Optional(
      Type.String({
        maxLength: 2048,
        description: 'Opaque cursor bound to the store epoch.'
      })
    )
  },
  { additionalProperties: false, description: 'Artifact catalog page.' }
)

export const ArtifactHistoryQuery = Type.Object(
  {
    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: MAX_ARTIFACT_PAGE_SIZE,
        description: 'Maximum page size.'
      })
    ),
    afterSeq: Type.Optional(
      Type.Integer({
        minimum: 0,
        description: 'Return events after this sequence.'
      })
    )
  },
  { additionalProperties: false, description: 'Artifact history page.' }
)

export const ArtifactContentQuery = Type.Object(
  {
    offset: Type.Optional(
      Type.Integer({
        minimum: 0,
        description: 'UTF-8 byte offset in the complete stored file.'
      })
    ),
    limit: Type.Optional(
      Type.Integer({
        minimum: 4,
        maximum: MAX_ARTIFACT_CHUNK_BYTES,
        description: 'Maximum bytes; chunks end on UTF-8 boundaries.'
      })
    )
  },
  { additionalProperties: false, description: 'Artifact content page.' }
)

export const ArtifactListSchema = Type.Object(
  {
    storeId: Type.String({ description: 'Artifact store UUID.' }),
    storeEpoch: Type.Integer({
      description: 'Current committed event sequence.'
    }),
    items: Type.Array(ArtifactSchema, {
      description: 'Committed artifacts in creation order.'
    }),
    nextCursor: Nullable(
      Type.String({ description: 'Next page cursor, or null.' })
    )
  },
  { description: 'Artifact catalog result.' }
)

export const ArtifactHistorySchema = Type.Object(
  {
    storeId: Type.String({ description: 'Artifact store UUID.' }),
    items: Type.Array(ArtifactEventSchema, {
      description: 'Events in sequence order.'
    }),
    nextAfterSeq: Nullable(
      Type.Integer({ description: 'Last sequence for the next page, or null.' })
    )
  },
  { description: 'Artifact history result.' }
)

export const ArtifactContentSchema = Type.Object(
  {
    storeId: Type.String({ description: 'Artifact store UUID.' }),
    id: Type.String({ description: 'Artifact UUID.' }),
    sha256: Type.String({
      description: 'Verified hash of the entire stored file.'
    }),
    bodyStartLine: Type.Integer({ description: 'One-based first body line.' }),
    totalBytes: Type.Integer({ description: 'Complete file size.' }),
    offset: Type.Integer({ description: 'First byte of this chunk.' }),
    nextOffset: Nullable(
      Type.Integer({ description: 'Next UTF-8 byte offset, or null.' })
    ),
    text: Type.String({
      description: 'Exact decoded UTF-8 content in this chunk.'
    })
  },
  { description: 'Verified document content chunk.' }
)
