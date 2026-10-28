import { UUID_PATTERN_SOURCE } from '../utils/is-uuid.ts'
import { Type } from '@sinclair/typebox'
import { Nullable } from '../utils/schemas.ts'
import {
  MAX_ARTIFACT_CHUNK_BYTES,
  MAX_ARTIFACT_PAGE_SIZE,
  MAX_ARTIFACT_REVIEW_TEXT_BYTES,
  MAX_ARTIFACT_REVIEW_QUOTE_BYTES
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
      maxLength: MAX_ARTIFACT_REVIEW_QUOTE_BYTES,
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

export const ArtifactReviewScopeSchema = Type.Object(
  {
    appliesToArtifactId: Type.String({
      pattern: UUID_PATTERN_SOURCE,
      description: 'Revision or explicit candidate affected by this decision.'
    }),
    includeRevisionDescendants: Type.Literal(true, {
      description:
        'Apply to existing and future immutable revision descendants.'
    })
  },
  {
    additionalProperties: false,
    description:
      'Explicit review decision scope; sibling revisions are excluded.'
  }
)

export const ArtifactReviewTextSchema = Type.String({
  minLength: 1,
  maxLength: MAX_ARTIFACT_REVIEW_TEXT_BYTES,
  description: 'Comment text; the service also enforces the UTF-8 byte limit.'
})

export const ArtifactReviewEventPayloadSchema = Type.Union(
  [
    Type.Object(
      {
        kind: Type.Literal('created', {
          description: 'Create a review thread.'
        }),
        anchor: Nullable(ArtifactSourceAnchorSchema),
        text: ArtifactReviewTextSchema,
        blocking: Type.Boolean({
          default: false,
          description:
            'Whether this thread blocks acceptance; defaults to false in the service.'
        })
      },
      { additionalProperties: false, description: 'Thread creation record.' }
    ),
    Type.Object(
      {
        kind: Type.Literal('replied', { description: 'Append a reply.' }),
        commentId: Type.String({
          pattern: UUID_PATTERN_SOURCE,
          description: 'New reply identifier.'
        }),
        text: ArtifactReviewTextSchema
      },
      { additionalProperties: false, description: 'Reply record.' }
    ),
    Type.Object(
      {
        kind: Type.Literal('content_edited', {
          description: 'Record new comment text without deleting prior events.'
        }),
        commentId: Type.String({
          pattern: UUID_PATTERN_SOURCE,
          description: 'Comment being edited; the root comment uses threadId.'
        }),
        text: ArtifactReviewTextSchema
      },
      { additionalProperties: false, description: 'Comment edit record.' }
    ),
    Type.Object(
      {
        kind: Type.Literal('hidden', {
          description:
            'Hide comment text without resolving or changing blocking.'
        }),
        commentId: Type.String({
          pattern: UUID_PATTERN_SOURCE,
          description: 'Comment to hide; the root comment uses threadId.'
        })
      },
      {
        additionalProperties: false,
        description: 'Logical hiding record; prior text remains in history.'
      }
    ),
    Type.Object(
      {
        kind: Type.Literal('blocking_changed', {
          description: 'Record an authorized blocking decision.'
        }),
        blocking: Type.Boolean({
          description: 'New thread-wide blocking flag.'
        }),
        scope: ArtifactReviewScopeSchema
      },
      {
        additionalProperties: false,
        description:
          'Protected blocking change; authorization also binds the explicit scope.'
      }
    ),
    Type.Object(
      {
        kind: Type.Literal('resolved', {
          description: 'Resolve for one revision branch.'
        }),
        scope: ArtifactReviewScopeSchema
      },
      {
        additionalProperties: false,
        description: 'Protected scoped resolution record.'
      }
    ),
    Type.Object(
      {
        kind: Type.Literal('reopened', {
          description: 'Reopen for one revision branch.'
        }),
        scope: ArtifactReviewScopeSchema
      },
      {
        additionalProperties: false,
        description: 'Protected scoped reopening record.'
      }
    )
  ],
  {
    description:
      'Append-only review action; protected actions require verified server authorization.'
  }
)

export const ArtifactReviewEventSchema = Type.Object(
  {
    storeId: Type.String({
      pattern: UUID_PATTERN_SOURCE,
      description: 'Owning artifact store.'
    }),
    seq: Type.Integer({
      minimum: 1,
      description: 'Committed event sequence; defines event order.'
    }),
    threadId: Type.String({
      pattern: UUID_PATTERN_SOURCE,
      description: 'Stable thread and root comment identifier.'
    }),
    originArtifactId: Type.String({
      pattern: UUID_PATTERN_SOURCE,
      description: 'Immutable artifact where the thread was created.'
    }),
    expectedThreadVersion: Type.Integer({
      minimum: 0,
      description: 'Version before this event; zero only for creation.'
    }),
    actor: ArtifactActorSchema,
    createdAt: Type.String({ description: 'Server-assigned UTC event time.' }),
    payload: ArtifactReviewEventPayloadSchema
  },
  {
    additionalProperties: false,
    description:
      'Immutable review history event; hiding preserves all earlier records.'
  }
)

export const ArtifactReviewHistorySchema = Type.Object(
  {
    storeId: Type.String({
      pattern: UUID_PATTERN_SOURCE,
      description: 'Owning artifact store.'
    }),
    items: Type.Array(ArtifactReviewEventSchema, {
      description:
        'History events in sequence order, including edits and hidden comments.'
    }),
    nextAfterSeq: Nullable(
      Type.Integer({
        minimum: 1,
        description: 'Last sequence for the next page, or null.'
      })
    )
  },
  { additionalProperties: false, description: 'Review history page.' }
)

export const ArtifactReviewCreateBody = Type.Object(
  {
    requestId: Type.String({
      minLength: 1,
      maxLength: 128,
      description: 'Idempotent command identifier.'
    }),
    text: ArtifactReviewTextSchema,
    anchor: Type.Optional(Nullable(ArtifactSourceAnchorSchema)),
    blocking: Type.Optional(
      Type.Boolean({
        default: false,
        description:
          'Whether this new thread blocks acceptance; false by default.'
      })
    )
  },
  {
    additionalProperties: false,
    description:
      'New artifact review thread; actor and identity are assigned by the server.'
  }
)

export const ArtifactReviewCommentEventBody = Type.Union(
  [
    Type.Object(
      {
        requestId: ArtifactReviewCreateBody.properties.requestId,
        expectedThreadVersion: Type.Integer({
          minimum: 1,
          description: 'Expected current thread version.'
        }),
        kind: Type.Literal('replied', {
          description: 'Add a reply with a server-assigned identity.'
        }),
        text: ArtifactReviewTextSchema
      },
      { additionalProperties: false, description: 'Ordinary reply command.' }
    ),
    Type.Object(
      {
        requestId: ArtifactReviewCreateBody.properties.requestId,
        expectedThreadVersion: Type.Integer({
          minimum: 1,
          description: 'Expected current thread version.'
        }),
        kind: Type.Literal('content_edited', {
          description: 'Edit a comment while retaining its history.'
        }),
        commentId: Type.String({
          pattern: UUID_PATTERN_SOURCE,
          description:
            'Comment in this thread; threadId identifies the root comment.'
        }),
        text: ArtifactReviewTextSchema
      },
      {
        additionalProperties: false,
        description: 'Ordinary comment edit command.'
      }
    ),
    Type.Object(
      {
        requestId: ArtifactReviewCreateBody.properties.requestId,
        expectedThreadVersion: Type.Integer({
          minimum: 1,
          description: 'Expected current thread version.'
        }),
        kind: Type.Literal('hidden', {
          description: 'Hide a comment without changing blocking or resolution.'
        }),
        commentId: Type.String({
          pattern: UUID_PATTERN_SOURCE,
          description:
            'Comment in this thread; threadId identifies the root comment.'
        })
      },
      {
        additionalProperties: false,
        description: 'Ordinary comment hiding command.'
      }
    )
  ],
  {
    description:
      'Ordinary review command; protected decisions are not accepted.'
  }
)

export const ArtifactReviewDecisionBody = Type.Union(
  [
    Type.Object(
      {
        requestId: ArtifactReviewCreateBody.properties.requestId,
        expectedThreadVersion:
          ArtifactReviewCommentEventBody.anyOf[0].properties
            .expectedThreadVersion,
        kind: Type.Literal('blocking_changed', {
          description:
            'Explicit user decision to change the thread blocking flag.'
        }),
        scope: ArtifactReviewScopeSchema,
        blocking: Type.Boolean({
          description: 'New thread-wide blocking value.'
        })
      },
      {
        additionalProperties: false,
        description: 'Protected blocking decision.'
      }
    ),
    Type.Object(
      {
        requestId: ArtifactReviewCreateBody.properties.requestId,
        expectedThreadVersion:
          ArtifactReviewCommentEventBody.anyOf[0].properties
            .expectedThreadVersion,
        kind: Type.Literal('resolved', {
          description: 'Resolve for one revision branch.'
        }),
        scope: ArtifactReviewScopeSchema
      },
      {
        additionalProperties: false,
        description: 'Structured scoped resolution command.'
      }
    ),
    Type.Object(
      {
        requestId: ArtifactReviewCreateBody.properties.requestId,
        expectedThreadVersion:
          ArtifactReviewCommentEventBody.anyOf[0].properties
            .expectedThreadVersion,
        kind: Type.Literal('reopened', {
          description: 'Reopen for one revision branch.'
        }),
        scope: ArtifactReviewScopeSchema
      },
      {
        additionalProperties: false,
        description: 'Structured scoped reopening command.'
      }
    )
  ],
  {
    description:
      'Structured user decision; agent grants are implemented in stage 0092.'
  }
)

export const ArtifactReviewCommentSchema = Type.Object(
  {
    id: Type.String({
      description: 'Comment identity; root comment uses threadId.'
    }),
    text: Type.String({
      description: 'Current text; earlier versions remain in history.'
    }),
    hidden: Type.Boolean({
      description: 'Whether this comment is logically hidden.'
    }),
    actor: ArtifactActorSchema,
    createdAt: Type.String({ description: 'Original creation time in UTC.' }),
    updatedAt: Type.String({ description: 'Last edit or hiding time in UTC.' })
  },
  { additionalProperties: false, description: 'Current comment projection.' }
)

export const ArtifactThreadCurrentSchema = Type.Object(
  {
    threadId: Type.String({ description: 'Stable thread identity.' }),
    originArtifactId: Type.String({
      description: 'Original immutable artifact.'
    }),
    anchor: Nullable(ArtifactSourceAnchorSchema),
    blocking: Type.Boolean({ description: 'Thread-wide blocking flag.' }),
    version: Type.Integer({
      minimum: 1,
      description: 'Current optimistic concurrency version.'
    }),
    comments: Type.Array(ArtifactReviewCommentSchema, {
      description: 'Comments in creation order, including hidden comments.'
    }),
    resolutions: Type.Array(
      Type.Object(
        {
          scope: ArtifactReviewScopeSchema,
          resolved: Type.Boolean({
            description: 'Latest decision in this scope.'
          }),
          seq: Type.Integer({
            description: 'Sequence that orders decisions across scopes.'
          })
        },
        {
          additionalProperties: false,
          description: 'Latest scoped decision projection.'
        }
      ),
      { description: 'Latest decision for each scope.' }
    )
  },
  { additionalProperties: false, description: 'Rebuildable thread projection.' }
)

export const ArtifactThreadViewSchema = Type.Object(
  {
    ...ArtifactThreadCurrentSchema.properties,
    inheritedFrom: Nullable(
      Type.String({
        description:
          'Original artifact when inherited or included from a priority target.'
      })
    ),
    effectiveResolved: Type.Boolean({
      description: 'Resolution evaluated for the requested artifact.'
    })
  },
  {
    additionalProperties: false,
    description: 'Thread in the context of a requested artifact.'
  }
)

export const ArtifactBlockerSummarySchema = Type.Object(
  {
    count: Type.Integer({
      minimum: 0,
      description: 'Number of unique unresolved blocking threads.'
    }),
    threadIds: Type.Array(Type.String(), {
      maxItems: MAX_ARTIFACT_PAGE_SIZE,
      description: 'First blocker thread IDs, in stable order.'
    }),
    truncated: Type.Boolean({
      description: 'More blocker IDs are available through review list pages.'
    }),
    attention: Type.Boolean({
      description:
        'Accepted artifact currently has unresolved blockers; accepted status is retained.'
    })
  },
  {
    additionalProperties: false,
    description:
      'Blockers from lineage and proposed replacement or supplement targets.'
  }
)

export const ArtifactReviewStateSchema = Type.Object(
  {
    storeId: Type.String({ description: 'Owning store identity.' }),
    storeEpoch: Type.Integer({
      description: 'Current committed store revision.'
    }),
    validationEpoch: Type.Integer({
      description:
        'Last change relevant to validation scope or blocking review state.'
    }),
    artifactId: Type.String({
      description: 'Artifact whose review state is evaluated.'
    }),
    blockerSummary: ArtifactBlockerSummarySchema
  },
  {
    additionalProperties: false,
    description: 'Review state without modifying lifecycle status.'
  }
)

export const ArtifactReviewListQuery = Type.Object(
  {
    ...ArtifactListQuery.properties,
    includeInherited: Type.Optional(
      Type.Boolean({
        description:
          'Include open lineage threads and blockers of priority targets; true by default.'
      })
    )
  },
  { additionalProperties: false, description: 'Review thread page options.' }
)

export const ArtifactReviewVisibleCommentSchema = Type.Object(
  {
    ...ArtifactReviewCommentSchema.properties,
    text: Nullable(
      Type.String({
        description:
          'Complete current text; null when hidden. Prior text remains in history.'
      })
    )
  },
  {
    additionalProperties: false,
    description: 'Public comment projection with hidden text suppressed.'
  }
)

export const ArtifactReviewCommentPreviewSchema = Type.Object(
  {
    ...ArtifactReviewVisibleCommentSchema.properties,
    truncated: Type.Boolean({
      description:
        'Text is a UTF-8 preview; full visible text is available in comments pages.'
    })
  },
  { additionalProperties: false, description: 'Short comment preview.' }
)

export const ArtifactSourceAnchorPreviewSchema = Type.Object(
  {
    ...ArtifactSourceAnchorSchema.properties,
    quote: Type.String({ description: 'UTF-8 preview of the original quote.' }),
    truncated: Type.Boolean({
      description: 'The complete quote is available in comments or history.'
    })
  },
  {
    additionalProperties: false,
    description: 'Original source coordinates with a bounded quote preview.'
  }
)

export const ArtifactThreadSummarySchema = Type.Object(
  {
    ...Type.Omit(ArtifactThreadViewSchema, [
      'comments',
      'resolutions',
      'anchor'
    ]).properties,
    anchor: Nullable(ArtifactSourceAnchorPreviewSchema),
    commentCount: Type.Integer({
      minimum: 1,
      description: 'Number of current comments, including hidden comments.'
    }),
    rootComment: ArtifactReviewCommentPreviewSchema,
    lastComment: ArtifactReviewCommentPreviewSchema
  },
  {
    additionalProperties: false,
    description:
      'Bounded thread summary without full comments or scoped decision history.'
  }
)

export const ArtifactReviewCommentsQuery = Type.Object(
  {
    limit: ArtifactListQuery.properties.limit,
    afterIndex: Type.Optional(
      Type.Integer({
        minimum: 0,
        description:
          'Number of comments already read in this thread; zero starts the list. Not tied to store epoch.'
      })
    )
  },
  {
    additionalProperties: false,
    description: 'Live comment page; edits and hiding preserve comment order.'
  }
)

export const ArtifactReviewCommentsSchema = Type.Object(
  {
    storeId: Type.String({ description: 'Owning store identity.' }),
    threadId: Type.String({
      description: 'Thread whose comment positions are being read.'
    }),
    version: Type.Integer({
      description:
        'Thread version when this page was read; pages are live, not a historical snapshot.'
    }),
    anchor: Nullable(ArtifactSourceAnchorSchema),
    items: Type.Array(ArtifactReviewVisibleCommentSchema, {
      description:
        'Complete current comments within the count and soft byte budgets.'
    }),
    nextAfterIndex: Nullable(
      Type.Integer({
        minimum: 1,
        description:
          'Number of comments consumed after this page, or null at the current end.'
      })
    )
  },
  {
    additionalProperties: false,
    description: 'Live comment page with the full original source anchor.'
  }
)

export const ArtifactReviewListSchema = Type.Object(
  {
    ...ArtifactReviewStateSchema.properties,
    items: Type.Array(ArtifactThreadSummarySchema, {
      description: 'Thread page in stable thread ID order.'
    }),
    nextCursor: Nullable(
      Type.String({
        description: 'Next cursor, bound to store epoch and query.'
      })
    )
  },
  {
    additionalProperties: false,
    description: 'Complete review thread page and blocker summary.'
  }
)
