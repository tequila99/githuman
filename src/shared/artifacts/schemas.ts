import { UUID_PATTERN_SOURCE } from '../utils/is-uuid.ts'
import { Type, type TLiteral } from '@sinclair/typebox'
import { Nullable } from '../utils/schemas.ts'
import {
  ARTIFACT_STATUSES,
  MAX_SEARCH_QUERY_CODEPOINTS,
  MAX_SEARCH_TOKENS,
  MAX_ARTIFACT_CHUNK_BYTES,
  MAX_ARTIFACT_PAGE_SIZE,
  MAX_ARTIFACT_SOURCE_QUOTE_BYTES
} from './constants.ts'

// Keep import provenance separate from the human-readable title; this value never grants file access.
const ARTIFACT_SOURCE_PATH = Type.Optional(
  Type.String({
    minLength: 1,
    maxLength: 4096,
    description:
      'Informational original document path; never used for file access.'
  })
)

type LiteralTuple<T extends readonly string[]> = {
  -readonly [K in keyof T]: TLiteral<T[K]>
}

export const ArtifactStatusSchema = Type.Union(
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Mapping preserves tuple length and order; Fastify requires this tuple type.
  ARTIFACT_STATUSES.map(status => Type.Literal(status)) as LiteralTuple<
    typeof ARTIFACT_STATUSES
  >,
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
export const ArtifactHistoricalChangeSetSchema = Type.Object(
  {
    storeId: Type.String({
      pattern: UUID_PATTERN_SOURCE,
      description: 'Store owning all affected artifacts.'
    }),
    command: Type.Union(
      [
        Type.Literal('submit_review'),
        Type.Literal('return_to_draft'),
        Type.Literal('reject'),
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
export const ArtifactChangeSetSchema = Type.Object(
  {
    ...ArtifactHistoricalChangeSetSchema.properties,
    command: Type.Union(
      [
        Type.Literal('return_to_draft'),
        Type.Literal('reject'),
        Type.Literal('accept'),
        Type.Literal('archive'),
        Type.Literal('delete'),
        Type.Literal('restore'),
        Type.Literal('update_relations')
      ],
      { description: 'Supported lifecycle command.' }
    )
  },
  {
    additionalProperties: false,
    description: 'Supported canonical atomic change input.'
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
    sourcePath: ARTIFACT_SOURCE_PATH,
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

export const ArtifactMetadataUpdateBody = Type.Object(
  {
    requestId: Type.String({
      minLength: 1,
      maxLength: 128,
      description: 'Idempotent command identifier.'
    }),
    expectedVersion: Type.Integer({
      minimum: 1,
      description: 'Expected artifact metadata version.'
    }),
    metadata: ArtifactMetadataInputSchema
  },
  {
    additionalProperties: false,
    description:
      'Update versioned artifact metadata without rewriting the immutable original.'
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
    sourcePath: ARTIFACT_SOURCE_PATH,
    tags: Type.Array(Type.String(), { description: 'Current document tags.' }),
    ...ArtifactGraphFields,
    status: ArtifactStatusSchema
  },
  {
    additionalProperties: false,
    description: 'Artifact identity and current metadata.'
  }
)

export const ArtifactValidationManifestArtifactSchema = Type.Object(
  {
    ...ArtifactSchema.properties,
    kind: Type.Literal('artifact', { description: 'Manifest artifact entry.' }),
    pages: Type.Integer({
      minimum: 1,
      description:
        'Estimated separate reads at chunkBytes; UTF-8 boundaries may require another read.'
    }),
    chunkBytes: Type.Integer({
      minimum: 1,
      description: 'Maximum validation content bytes per call.'
    }),
    contentRequired: Type.Boolean({
      description:
        'Whether validation requires complete reading of this artifact.'
    }),
    activePriority: Type.Array(ArtifactRelationSchema, {
      description: 'Active replacement and supplement relationships.'
    })
  },
  {
    description:
      'Artifact metadata and content requirements in a validation manifest.'
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
    canonical: ArtifactHistoricalChangeSetSchema,
    changeDigest: Type.String({
      description: 'Server SHA-256 digest of canonical change set.'
    }),
    affectedIds: Type.Array(Type.String(), {
      description: 'Artifacts affected by the proposed change.'
    }),
    contentRequiredIds: Type.Array(Type.String(), {
      description: 'Affected artifacts whose complete content must be read.'
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

export const ArtifactSourceAnchorSchema = Type.Object(
  {
    artifactId: Type.String({
      pattern: UUID_PATTERN_SOURCE,
      description: 'Original artifact identifier.'
    }),
    fileSha256: Type.String({
      pattern: '^[a-f0-9]{64}$',
      description: 'SHA-256 of the exact original file bytes.'
    }),
    bodyStartLine: Type.Integer({
      minimum: 1,
      description: 'One-based body start in the original file.'
    }),
    startLine: Type.Integer({
      minimum: 1,
      description: 'First selected body line, one-based.'
    }),
    endLine: Type.Integer({
      minimum: 1,
      description: 'Last selected body line, inclusive.'
    }),
    quote: Type.String({
      maxLength: MAX_ARTIFACT_SOURCE_QUOTE_BYTES,
      description:
        'Exact original source excerpt; verified against the stored body.'
    })
  },
  {
    additionalProperties: false,
    description:
      'Immutable source anchor; range, hash and quote require service validation.'
  }
)

export const ArtifactChangeSetProposeBody = Type.Object(
  {
    requestId: Type.String({
      minLength: 1,
      maxLength: 128,
      description: 'Idempotent proposal request.'
    }),
    id: Type.Optional(ArtifactParams.properties.id),
    expectedVersion: Type.Optional(
      Type.Integer({ minimum: 1, description: 'Previous proposal version.' })
    ),
    changeSet: ArtifactChangeSetSchema
  },
  {
    additionalProperties: false,
    description: 'Create or revise an immutable change set proposal.'
  }
)
export const ArtifactValidationPrepareBody = Type.Object(
  {
    changeSetId: ArtifactParams.properties.id,
    version: Type.Integer({
      minimum: 1,
      description: 'Exact proposal version.'
    })
  },
  {
    additionalProperties: false,
    description: 'Prepare a complete validation manifest.'
  }
)
export const ArtifactValidationStartBody = Type.Object(
  {
    presetId: Type.String({
      minLength: 1,
      maxLength: 128,
      description: 'Configured validator preset.'
    })
  },
  {
    additionalProperties: false,
    description: 'Start a bounded validation job.'
  }
)
export const ArtifactValidationFindingSchema = Type.Object(
  {
    artifactId: ArtifactParams.properties.id,
    quote: Type.String({
      maxLength: 65536,
      description: 'Evidence quoted from the manifest text.'
    }),
    message: Type.String({
      minLength: 1,
      maxLength: 8000,
      description: 'Finding explanation.'
    })
  },
  { additionalProperties: false, description: 'A cited validation finding.' }
)
export const ArtifactValidationSubmitBody = Type.Object(
  {
    verdict: Type.Union(
      [
        Type.Literal('pass'),
        Type.Literal('conflict'),
        Type.Literal('incomplete')
      ],
      { description: 'Validator outcome.' }
    ),
    findings: Type.Array(ArtifactValidationFindingSchema, {
      maxItems: 100,
      description: 'Cited findings.'
    }),
    resolutions: Type.Array(
      Type.String({ maxLength: 8000, description: 'Resolution explanation.' }),
      { maxItems: 100, description: 'How issues were addressed.' }
    ),
    report: Type.Optional(
      Type.String({
        maxLength: 131072,
        description: 'Optional Markdown report text stored with the validation.'
      })
    )
  },
  {
    additionalProperties: false,
    description:
      'Submit an outcome for the server-assigned manifest and session.'
  }
)
export const ArtifactLifecycleCommitBody = Type.Object(
  {
    version: Type.Integer({
      minimum: 1,
      description: 'Exact change set version.'
    }),
    validationId: ArtifactParams.properties.id,
    authorizationId: ArtifactParams.properties.id,
    requestId: Type.String({
      minLength: 1,
      maxLength: 128,
      description: 'Idempotent commit request.'
    })
  },
  {
    additionalProperties: false,
    description: 'Commit a validated and authorized package atomically.'
  }
)
export const ArtifactAuthorizationRequestBody = Type.Object(
  {
    kind: Type.Literal('lifecycle', {
      description: 'Lifecycle authorization.'
    }),
    changeSetId: ArtifactParams.properties.id,
    version: Type.Integer({ minimum: 1, description: 'Proposal version.' }),
    validationId: ArtifactParams.properties.id
  },
  {
    additionalProperties: false,
    description: 'Request permission for a validated package.'
  }
)
export const ArtifactAuthorizationApproveBody = Type.Object(
  {
    sourceUserRequestId: Type.String({
      minLength: 1,
      maxLength: 128,
      description: 'Structured user confirmation request.'
    })
  },
  {
    additionalProperties: false,
    description: 'Approve the exact pending action.'
  }
)
export const ArtifactLifecycleResultSchema = Type.Record(
  Type.String(),
  Type.Unknown(),
  {
    description:
      'Complete lifecycle result including digests, versions, manifest or history pagination.'
  }
)

export const ArtifactValidationReadBody = Type.Object(
  {
    key: Type.String({
      minLength: 1,
      maxLength: 64,
      description: 'Artifact ID from the assigned manifest.'
    }),
    offset: Type.Optional(
      Type.Integer({ minimum: 0, description: 'Sequential UTF-8 byte offset.' })
    )
  },
  {
    additionalProperties: false,
    description: 'Read and receipt one complete context chunk.'
  }
)
export const ArtifactValidationReportBody = Type.Object(
  {
    body: Type.String({
      maxLength: 131072,
      description: 'Isolated draft Markdown report body.'
    })
  },
  {
    additionalProperties: false,
    description: 'Save a standalone report without changing the manifest.'
  }
)
export const ArtifactValidationReportQuery = Type.Object(
  {
    offset: Type.Optional(
      Type.Integer({
        minimum: 0,
        description: 'UTF-8 byte offset in the complete structured report.'
      })
    )
  },
  {
    additionalProperties: false,
    description: 'Read a bounded structured report chunk.'
  }
)

export const ArtifactSearchFiltersSchema = Type.Object(
  {
    statuses: Type.Optional(
      Type.Array(ArtifactStatusSchema, {
        maxItems: 7,
        description: 'Explicit statuses; defaults to accepted.'
      })
    ),
    typeIds: Type.Optional(
      Type.Array(
        Type.String({ maxLength: 128, description: 'Artifact type ID.' }),
        { maxItems: 100, description: 'Allowed artifact types.' }
      )
    ),
    unbound: Type.Optional(
      Type.Boolean({ description: 'Only artifacts without task bindings.' })
    ),
    taskIds: Type.Optional(
      Type.Array(ArtifactParams.properties.id, {
        maxItems: 100,
        description: 'Match any selected task.'
      })
    ),
    tags: Type.Optional(
      Type.Array(
        Type.String({ maxLength: 128, description: 'Required tag.' }),
        { maxItems: 100, description: 'Selected tags; see tagMode.' }
      )
    ),
    tagMode: Type.Optional(
      Type.Union([Type.Literal('all'), Type.Literal('any')], {
        description: 'Require every selected tag (all, default) or any (any).'
      })
    ),
    createdFrom: Type.Optional(
      Type.String({
        maxLength: 40,
        description: 'Earliest creation time, inclusive; ISO 8601 timestamp.'
      })
    ),
    createdTo: Type.Optional(
      Type.String({
        maxLength: 40,
        description: 'Latest creation time, inclusive; ISO 8601 timestamp.'
      })
    )
  },
  {
    additionalProperties: false,
    description: 'Metadata filters applied before ranking and pagination.'
  }
)
export const ArtifactSearchBody = Type.Object(
  {
    query: Type.Optional(
      Type.String({
        maxLength: MAX_SEARCH_QUERY_CODEPOINTS * 2,
        description: `Literal text; coarse length cap ${MAX_SEARCH_QUERY_CODEPOINTS * 2}, service limit ${MAX_SEARCH_QUERY_CODEPOINTS} Unicode codepoints and ${MAX_SEARCH_TOKENS} tokens.`
      })
    ),
    mode: Type.Optional(
      Type.Union(
        [Type.Literal('auto'), Type.Literal('exact'), Type.Literal('fuzzy')],
        { description: 'Exact and/or bounded typo matching.' }
      )
    ),
    filters: Type.Optional(ArtifactSearchFiltersSchema),
    sort: Type.Optional(
      Type.Union(
        [
          Type.Literal('relevance'),
          Type.Literal('createdAt'),
          Type.Literal('metadataUpdatedAt')
        ],
        { description: 'Stable order; timestamps sort newest first.' }
      )
    ),
    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 100,
        description: 'Maximum items in this page.'
      })
    ),
    cursor: Type.Optional(
      Type.String({
        maxLength: 32768,
        description: 'Cursor bound to query, filters and epochs.'
      })
    )
  },
  {
    additionalProperties: false,
    description: 'Search current artifact titles and original body text.'
  }
)
export const ArtifactSearchQuery = Type.Object(
  {
    ...Type.Omit(ArtifactSearchBody, ['filters']).properties,
    status: Type.Optional(ArtifactStatusSchema),
    typeId: Type.Optional(
      Type.String({ maxLength: 128, description: 'Artifact type filter.' })
    ),
    taskId: Type.Optional(ArtifactParams.properties.id),
    tag: Type.Optional(
      Type.String({ maxLength: 128, description: 'Required tag.' })
    )
  },
  {
    additionalProperties: false,
    description: 'Read-only search query with single-value metadata filters.'
  }
)
export const ArtifactSearchItemSchema = Type.Object(
  {
    storeId: ArtifactSchema.properties.storeId,
    id: ArtifactParams.properties.id,
    title: ArtifactSchema.properties.title,
    createdAt: ArtifactSchema.properties.createdAt,
    tags: ArtifactSchema.properties.tags,
    status: ArtifactStatusSchema,
    typeId: ArtifactSchema.properties.typeId,
    taskIds: ArtifactSchema.properties.taskIds,
    snippet: Type.String({
      description: 'Plain-text excerpt from original text; never HTML.'
    }),
    source: Type.Union([Type.Literal('title'), Type.Literal('body')], {
      description: 'Original field containing the excerpt.'
    }),
    matchKind: Type.Union(
      [
        Type.Literal('exact'),
        Type.Literal('exact_normalized'),
        Type.Literal('token'),
        Type.Literal('fuzzy'),
        Type.Literal('catalog')
      ],
      {
        description:
          'Fuzzy and normalized matches are explicitly distinguished.'
      }
    ),
    highlights: Type.Array(
      Type.Object(
        {
          start: Type.Integer({
            minimum: 0,
            description: 'UTF-16 start within snippet.'
          }),
          end: Type.Integer({
            minimum: 0,
            description: 'Exclusive UTF-16 end within snippet.'
          })
        },
        { description: 'Highlight range in original plain text.' }
      ),
      { description: 'Original-text match ranges.' }
    ),
    anchor: Nullable(ArtifactSourceAnchorSchema)
  },
  { description: 'One ranked verified artifact search result.' }
)
export const ArtifactSearchSchema = Type.Object(
  {
    storeId: ArtifactSchema.properties.storeId,
    storeEpoch: ArtifactListSchema.properties.storeEpoch,
    indexEpoch: Type.Integer({
      minimum: 0,
      description: 'Derived index generation.'
    }),
    items: Type.Array(ArtifactSearchItemSchema, {
      description: 'Filtered ranked complete results.'
    }),
    nextCursor: Nullable(
      Type.String({
        description: 'Continue this query while both epochs remain unchanged.'
      })
    ),
    partial: Type.Boolean({
      description: 'Fuzzy work reached its processing budget.'
    }),
    reason: Nullable(
      Type.String({ description: 'Explicit partial-result reason.' })
    )
  },
  { description: 'Bounded artifact search page.' }
)

export const ArtifactSearchDiagnosticsSchema = Type.Object(
  {
    available: Type.Boolean({
      description: 'Whether both required FTS5 tokenizers are available.'
    }),
    documents: Type.Integer({
      minimum: 0,
      description: 'Indexed documents in this store.'
    }),
    suppressed: Type.Array(
      Type.Object(
        {
          id: ArtifactParams.properties.id,
          reason: Type.String({
            description:
              'Why this document was excluded from the derived index.'
          })
        },
        { description: 'Suppressed artifact diagnostic.' }
      ),
      {
        description: 'Documents suppressed after integrity verification failed.'
      }
    )
  },
  {
    description:
      'Availability and integrity diagnostics of the derived search index.'
  }
)

function lifecycleId(description: string) {
  return Type.String({ pattern: UUID_PATTERN_SOURCE, description })
}
function lifecycleDigest(description: string) {
  return Type.String({ pattern: '^[a-f0-9]{64}$', description })
}

export const ArtifactStoredChangeSetSchema = Type.Object(
  {
    id: lifecycleId('Change set identifier.'),
    version: Type.Integer({
      minimum: 1,
      description: 'Immutable proposal version.'
    }),
    requestId: Type.String({ description: 'Idempotent proposal request.' }),
    changeSet: ArtifactHistoricalChangeSetSchema,
    changeDigest: lifecycleDigest('Canonical change set digest.'),
    requestDigest: lifecycleDigest('Canonical proposal request digest.'),
    actor: ArtifactActorSchema
  },
  { description: 'Current immutable change set proposal.' }
)

export const ArtifactValidationStateSchema = Type.Union(
  [
    Type.Literal('prepared'),
    Type.Literal('running'),
    Type.Literal('pass'),
    Type.Literal('conflict'),
    Type.Literal('incomplete'),
    Type.Literal('cancelled')
  ],
  { description: 'Validation job state.' }
)
export const ArtifactValidationProgressSchema = Type.Object(
  {
    readBytes: Type.Integer({
      minimum: 0,
      description: 'Unique required content bytes read.'
    }),
    totalBytes: Type.Integer({
      minimum: 0,
      description: 'Bytes in all required documents.'
    }),
    readRequired: Type.Integer({
      minimum: 0,
      description: 'Required documents completely read.'
    }),
    totalRequired: Type.Integer({
      minimum: 0,
      description: 'Required document count.'
    }),
    remainingRequired: Type.Integer({
      minimum: 0,
      description: 'Required documents not completely read.'
    })
  },
  { description: 'Server-calculated required content coverage.' }
)

export const ArtifactValidationViewSchema = Type.Object(
  {
    id: lifecycleId('Validation identifier.'),
    changeSetId: lifecycleId('Validated proposal.'),
    version: Type.Integer({
      minimum: 1,
      description: 'Validated proposal version.'
    }),
    state: ArtifactValidationStateSchema,
    progress: ArtifactValidationProgressSchema,
    validatorSessionId: Nullable(lifecycleId('Assigned validator session.')),
    manifestDigest: lifecycleDigest('Server-assigned manifest digest.'),
    changeDigest: lifecycleDigest('Validated change digest.'),
    validationEpoch: Type.Integer({
      description: 'Manifest validation epoch.'
    }),
    expiresAt: Nullable(
      Type.Number({
        description: 'Validation lease expiry in Unix milliseconds.'
      })
    ),
    reason: Type.Optional(
      Type.String({ description: 'Terminal outcome explanation.' })
    ),
    generation: Type.Optional(
      Type.Integer({
        minimum: 1,
        description:
          'Manifest generation; it grows when a running validation follows its set.'
      })
    ),
    metrics: Type.Optional(
      Type.Object(
        {
          startedAt: Type.Number({
            description: 'Validator start in Unix milliseconds.'
          }),
          finishedAt: Type.Number({
            description: 'Terminal state time in Unix milliseconds.'
          }),
          toolCalls: Type.Integer({
            minimum: 0,
            description: 'Tool calls that the validator made.'
          }),
          failedToolCalls: Type.Integer({
            minimum: 0,
            description: 'Tool calls that failed.'
          }),
          contextTokens: Type.Optional(
            Type.Integer({
              minimum: 0,
              description: 'Last reported context size in tokens.'
            })
          ),
          costUsd: Type.Optional(
            Type.Number({
              minimum: 0,
              description: 'Last reported session cost in US dollars.'
            })
          ),
          stopReason: Type.Optional(
            Type.String({ description: 'Agent stop reason of the last turn.' })
          ),
          lastFailure: Type.Optional(
            Type.String({
              description:
                'Last failed tool and its output, cut to 300 characters.'
            })
          )
        },
        { description: 'Validator run metrics (ADR 0120).' }
      )
    ),
    report: Nullable(
      Type.Object(
        {
          verdict: ArtifactValidationSubmitBody.properties.verdict,
          findingCount: Type.Integer({
            minimum: 0,
            description: 'Number of cited findings.'
          }),
          reportArtifactId: Type.Optional(
            lifecycleId('Legacy standalone report artifact (before ADR 0122).')
          ),
          text: Type.Optional(
            Type.Object(
              {
                sha256: Type.String({
                  description: 'SHA-256 of the Markdown report text.'
                }),
                bytes: Type.Integer({
                  minimum: 0,
                  description: 'UTF-8 size of the Markdown report text.'
                })
              },
              {
                description:
                  'Markdown report text stored with the validation; read it with report-text.'
              }
            )
          )
        },
        {
          description: 'Structured report summary; full text is read in chunks.'
        }
      )
    )
  },
  { description: 'Validation progress and report summary.' }
)

export const ArtifactReportChunkSchema = Type.Object(
  {
    id: lifecycleId('Validation identifier.'),
    offset: Type.Integer({
      minimum: 0,
      description: 'First UTF-8 byte offset.'
    }),
    totalBytes: Type.Integer({
      minimum: 0,
      description: 'Complete JSON report size.'
    }),
    nextOffset: Nullable(
      Type.Integer({ minimum: 0, description: 'Next UTF-8 offset, or null.' })
    ),
    text: Type.String({ description: 'Exact report JSON chunk.' })
  },
  { description: 'Bounded UTF-8 report response.' }
)

export const PendingArtifactActionSchema = Type.Object(
  {
    id: lifecycleId('Pending action identifier.'),
    sessionId: Type.String({
      description: 'Requesting session; user actors use the user prefix.'
    }),
    action: ArtifactAuthorizationRequestBody,
    actionDigest: lifecycleDigest('Exact requested action digest.'),
    manifestDigest: Nullable(
      lifecycleDigest('Bound validation manifest digest.')
    ),
    expiresAt: Type.Number({
      description: 'Pending action expiry in Unix milliseconds.'
    })
  },
  { description: 'One exact action awaiting explicit user approval.' }
)
export const ArtifactActionSummarySchema = Type.Object(
  {
    command: Type.String({ description: 'Lifecycle command of the package.' }),
    reason: Type.String({
      description: 'Reason the requester gave, cut to a list-sized length.'
    }),
    documentCount: Type.Integer({
      description: 'Number of documents whose status changes.'
    })
  },
  {
    description: 'What the package does, in a few fields for the request list.'
  }
)
export const ArtifactActionListItemSchema = Type.Object(
  {
    ...PendingArtifactActionSchema.properties,
    summary: Nullable(ArtifactActionSummarySchema)
  },
  { description: 'A pending request with a summary of its package.' }
)
export const ArtifactActionListSchema = Type.Object(
  {
    storeId: lifecycleId('Owning store.'),
    items: Type.Array(ArtifactActionListItemSchema, {
      description: 'Live pending requests.'
    })
  },
  { description: 'Current pending actions in one store.' }
)
export const ArtifactActionPhaseSchema = Type.Union(
  [
    Type.Literal('pending'),
    Type.Literal('authorized'),
    Type.Literal('consumed')
  ],
  { description: 'Authorization lifecycle of this request.' }
)
export const ArtifactActionInspectionSchema = Type.Object(
  {
    storeId: lifecycleId('Owning store.'),
    pending: PendingArtifactActionSchema,
    phase: ArtifactActionPhaseSchema,
    canExecute: Type.Boolean({
      description: 'Current user owns the requesting execution session.'
    }),
    ready: Type.Boolean({
      description: 'Exact action is currently fresh, valid and unblocked.'
    }),
    problem: Nullable(
      Type.String({
        description: 'Reason confirmation or execution is blocked.'
      })
    ),
    proposal: Nullable(ArtifactStoredChangeSetSchema),
    validation: Nullable(ArtifactValidationViewSchema),
    preview: Nullable(ArtifactChangeSetPreviewSchema),
    authorizationId: Nullable(
      lifecycleId('Existing user-owned grant; never persisted by the browser.')
    )
  },
  { description: 'Reviewable current scope with server readiness checks.' }
)
export const ArtifactActionStatusStateSchema = Type.Union(
  [
    ...ArtifactActionPhaseSchema.anyOf,
    Type.Literal('revoked'),
    Type.Literal('expired')
  ],
  {
    description:
      'Phase of the request, or how it ended without a commit: the user rejected it, or its time ran out.'
  }
)
export const ArtifactActionStatusSchema = Type.Object(
  {
    id: lifecycleId('Original pending request identifier.'),
    state: ArtifactActionStatusStateSchema,
    authorizationId: Nullable(
      lifecycleId('Grant for this requesting session after approval.')
    ),
    expiresAt: Type.Number({
      description: 'Authorization expiry in Unix milliseconds.'
    })
  },
  { description: 'Read-only authorization status for the requesting session.' }
)

export const ArtifactValidationInspectionSchema = Type.Object(
  {
    storeId: lifecycleId('Owning store.'),
    proposal: ArtifactStoredChangeSetSchema,
    validation: ArtifactValidationViewSchema,
    preview: ArtifactChangeSetPreviewSchema,
    ready: Type.Boolean({
      description: 'A current matching pass has no blocking conflicts.'
    }),
    problem: Nullable(
      Type.String({ description: 'Why authorization cannot be requested.' })
    )
  },
  { description: 'Read-only validation freshness and proposed post-state.' }
)

export const ArtifactExportQuery = Type.Object(
  {
    format: Type.Union(
      [Type.Literal('original'), Type.Literal('metadata-history')],
      {
        description:
          'Exact original file or consistent metadata history snapshot.'
      }
    )
  },
  { additionalProperties: false, description: 'Artifact download format.' }
)
export const ArtifactOriginalExportSchema = Type.String({
  format: 'binary',
  description:
    'Verified exact original Markdown bytes, including historical frontmatter.'
})
export const ArtifactExportEventSchema = Type.Object(
  { ...ArtifactEventSchema.properties, snapshot: ArtifactSchema },
  {
    additionalProperties: false,
    description: 'Metadata event with its complete immutable artifact version.'
  }
)
export const ArtifactMetadataExportSchema = Type.Object(
  {
    formatVersion: Type.Literal(1, {
      description: 'Metadata export format version.'
    }),
    storeId: Type.String({ description: 'Owning artifact store identity.' }),
    artifactId: Type.String({ description: 'Exported artifact identity.' }),
    snapshotSeq: Type.Integer({
      minimum: 0,
      description:
        'Store artifact event sequence captured with current metadata; history never exceeds this boundary.'
    }),
    storeEpoch: Type.Integer({
      minimum: 0,
      description: 'Store revision captured with the metadata snapshot.'
    }),
    artifact: ArtifactSchema,
    history: Type.Array(ArtifactExportEventSchema, {
      description:
        'Complete ordered metadata events through snapshotSeq, with full version snapshots.'
    })
  },
  {
    additionalProperties: false,
    description:
      'Consistent artifact metadata and complete history export, streamed in bounded pages.'
  }
)
