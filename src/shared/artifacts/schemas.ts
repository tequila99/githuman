import { UUID_PATTERN_SOURCE } from '../utils/is-uuid.ts'
import { Type } from '@sinclair/typebox'
import { Nullable } from '../utils/schemas.ts'
import {
  MAX_ARTIFACT_CHUNK_BYTES,
  MAX_ARTIFACT_PAGE_SIZE
} from './constants.ts'

export const ArtifactStatusSchema = Type.Union(
  [
    Type.Literal('draft'),
    Type.Literal('in_review'),
    Type.Literal('accepted'),
    Type.Literal('rejected'),
    Type.Literal('superseded'),
    Type.Literal('archived'),
    Type.Literal('deleted')
  ],
  {
    description:
      'Artifact lifecycle status; transitions are not exposed in stage 0089.'
  }
)
export const ArtifactRelationSchema = Type.Object(
  {
    kind: Type.Union(
      [
        Type.Literal('parent'),
        Type.Literal('replaces'),
        Type.Literal('supplements'),
        Type.Literal('references')
      ],
      { description: 'Directed relationship kind.' }
    ),
    targetId: Type.String({
      pattern: UUID_PATTERN_SOURCE,
      description: 'Target artifact in the same store.'
    })
  },
  {
    additionalProperties: false,
    description: 'Directed artifact relationship.'
  }
)
export const ArtifactGraphFields = {
  typeId: Type.String({
    minLength: 1,
    maxLength: 100,
    description: 'Stable artifact type identifier.'
  }),
  taskIds: Type.Array(Type.String({ pattern: UUID_PATTERN_SOURCE }), {
    maxItems: 100,
    uniqueItems: true,
    description: 'Tasks associated with the artifact.'
  }),
  relations: Type.Array(ArtifactRelationSchema, {
    maxItems: 200,
    description: 'Proposed relationships; they do not activate draft decisions.'
  }),
  revisionOf: Type.Array(Type.String({ pattern: UUID_PATTERN_SOURCE }), {
    maxItems: 1,
    uniqueItems: true,
    description: 'Immutable predecessor, assigned at creation.'
  })
}
export const GraphIssueSchema = Type.Object(
  {
    code: Type.String({ description: 'Structural issue code.' }),
    artifactIds: Type.Array(Type.String(), {
      description: 'Artifacts involved in the issue.'
    }),
    message: Type.String({
      description: 'Explanation of the structural issue.'
    })
  },
  { description: 'Graph validation issue.' }
)
export const ExpectedArtifactVersionSchema = Type.Object(
  {
    id: Type.String({
      pattern: UUID_PATTERN_SOURCE,
      description: 'Artifact identifier.'
    }),
    version: Type.Integer({
      minimum: 1,
      description: 'Expected metadata version.'
    })
  },
  {
    additionalProperties: false,
    description: 'Optimistic concurrency condition.'
  }
)
export const SupplementDispositionSchema = Type.Object(
  {
    artifactId: Type.String({
      pattern: UUID_PATTERN_SOURCE,
      description: 'Active supplement identifier.'
    }),
    disposition: Type.Union(
      [
        Type.Literal('incorporated'),
        Type.Literal('carry_forward'),
        Type.Literal('obsolete')
      ],
      { description: 'Disposition of an active supplement.' }
    ),
    newBaseId: Type.Optional(
      Type.String({
        pattern: UUID_PATTERN_SOURCE,
        description: 'New accepted base for carry_forward.'
      })
    ),
    targetStatus: Type.Optional(
      Type.Union([Type.Literal('archived'), Type.Literal('deleted')], {
        description: 'Inactive status required for obsolete.'
      })
    )
  },
  {
    additionalProperties: false,
    description: 'Explicit treatment of a supplement.'
  }
)
export const ArtifactChangeSetSchema = Type.Object(
  {
    storeId: Type.String({
      pattern: UUID_PATTERN_SOURCE,
      description: 'Store owning all affected artifacts.'
    }),
    command: Type.Union(
      [
        Type.Literal('accept'),
        Type.Literal('archive'),
        Type.Literal('delete'),
        Type.Literal('restore'),
        Type.Literal('update_relations')
      ],
      { description: 'Proposed lifecycle command.' }
    ),
    subjectIds: Type.Array(Type.String({ pattern: UUID_PATTERN_SOURCE }), {
      minItems: 1,
      maxItems: 100,
      uniqueItems: true,
      description: 'Subjects of the operation.'
    }),
    expectedVersions: Type.Array(ExpectedArtifactVersionSchema, {
      maxItems: 1000,
      description: 'Versions supplied by the caller.'
    }),
    relationChanges: Type.Array(
      Type.Object(
        {
          artifactId: Type.String({
            pattern: UUID_PATTERN_SOURCE,
            description: 'Artifact whose relations are replaced.'
          }),
          relations: ArtifactGraphFields.relations
        },
        {
          additionalProperties: false,
          description: 'Complete proposed relationship list.'
        }
      ),
      { maxItems: 100, description: 'Proposed relationship updates.' }
    ),
    targetStatuses: Type.Array(
      Type.Object(
        {
          artifactId: Type.String({
            pattern: UUID_PATTERN_SOURCE,
            description: 'Artifact whose status changes.'
          }),
          status: ArtifactStatusSchema
        },
        {
          additionalProperties: false,
          description: 'Proposed lifecycle transition.'
        }
      ),
      { maxItems: 200, description: 'Explicit target statuses.' }
    ),
    supplementDispositions: Type.Array(SupplementDispositionSchema, {
      maxItems: 200,
      description: 'Decisions for every affected active supplement.'
    }),
    reason: Type.String({
      minLength: 1,
      maxLength: 4000,
      description: 'Reason for the proposed change.'
    })
  },
  {
    additionalProperties: false,
    description:
      'Canonical input to a proposed atomic change; preview never commits it.'
  }
)
export const GraphPageQuery = Type.Object(
  {
    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 100,
        description: 'Maximum number of items.'
      })
    ),
    cursor: Type.Optional(
      Type.String({
        maxLength: 2048,
        description: 'Cursor bound to store, query and epoch.'
      })
    ),
    direction: Type.Optional(
      Type.Union([Type.Literal('outgoing'), Type.Literal('incoming')], {
        description: 'Relationship query direction.'
      })
    ),
    kind: Type.Optional(ArtifactRelationSchema.properties.kind)
  },
  { additionalProperties: false, description: 'Relationship page options.' }
)
export const ArtifactGraphEdgeSchema = Type.Object(
  {
    sourceId: Type.String({ description: 'Relationship source identifier.' }),
    targetId: Type.String({ description: 'Relationship target identifier.' }),
    kind: ArtifactRelationSchema.properties.kind
  },
  { description: 'Directed graph edge.' }
)
export const ArtifactGraphPageSchema = Type.Object(
  {
    storeId: Type.String({ description: 'Owning store.' }),
    storeEpoch: Type.Integer({ description: 'Committed store revision.' }),
    items: Type.Array(ArtifactGraphEdgeSchema, {
      description: 'Edges in stable source/kind/target order.'
    }),
    nextCursor: Nullable(
      Type.String({ description: 'Cursor for the next page.' })
    )
  },
  { description: 'Relationship page.' }
)
export const ArtifactAncestrySchema = Type.Object(
  {
    storeId: Type.String({ description: 'Owning store.' }),
    storeEpoch: Type.Integer({ description: 'Committed store revision.' }),
    nextCursor: Nullable(
      Type.String({ description: 'Next ancestry page cursor.' })
    ),
    artifactId: Type.String({ description: 'Descendant identifier.' }),
    ancestorIds: Type.Array(Type.String(), {
      description: 'Immutable lineage ancestors, nearest first.'
    })
  },
  { description: 'Lineage ancestry, independent of editable relationships.' }
)

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
    typeId: Type.Optional(ArtifactGraphFields.typeId),
    taskIds: Type.Optional(ArtifactGraphFields.taskIds),
    relations: Type.Optional(ArtifactGraphFields.relations),
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
    ...ArtifactGraphFields,
    status: ArtifactStatusSchema
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
    id: Type.String({
      pattern: UUID_PATTERN_SOURCE,
      description: 'Artifact UUID.'
    })
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

export const ArtifactChangeSetPreviewSchema = Type.Object(
  {
    canonical: ArtifactChangeSetSchema,
    changeDigest: Type.String({
      description: 'Server SHA-256 digest of canonical change set.'
    }),
    affectedIds: Type.Array(Type.String(), {
      description: 'Artifacts affected by the proposed change.'
    }),
    requiredSupplementDispositions: Type.Array(Type.String(), {
      description: 'Active supplements requiring an explicit decision.'
    }),
    expectedVersions: Type.Array(ExpectedArtifactVersionSchema, {
      description: 'Current versions required for the affected artifacts.'
    }),
    errors: Type.Array(GraphIssueSchema, {
      description: 'Structural errors blocking the proposed change.'
    }),
    postState: Type.Array(ArtifactSchema, {
      description: 'Proposed state; no changes are committed.'
    }),
    includedIn: Type.Array(
      Type.Object(
        {
          artifactId: Type.String({ description: 'Incorporated supplement.' }),
          targetId: Type.String({ description: 'Accepting artifact.' })
        },
        { description: 'Proposed historical incorporation record.' }
      ),
      { description: 'Derived incorporation audit records.' }
    )
  },
  { description: 'Change set preview without lifecycle authorization.' }
)
