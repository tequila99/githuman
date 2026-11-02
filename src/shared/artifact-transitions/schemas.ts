import { Type, type TLiteral } from '@sinclair/typebox'
import { UUID_PATTERN_SOURCE } from '../utils/is-uuid.ts'
import { Nullable } from '../utils/schemas.ts'
import { ArtifactStatusSchema } from '../artifacts/schemas.ts'
import { TRANSITION_STAGES } from './constants.ts'

const UuidSchema = Type.String({
  pattern: UUID_PATTERN_SOURCE,
  description: 'Identifier.'
})

type LiteralTuple<T extends readonly string[]> = {
  -readonly [K in keyof T]: TLiteral<T[K]>
}

export const ArtifactTransitionStageSchema = Type.Union(
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Mapping preserves tuple length and order; Fastify requires this tuple type.
  TRANSITION_STAGES.map(stage => Type.Literal(stage)) as LiteralTuple<
    typeof TRANSITION_STAGES
  >,
  { description: 'Stage of a transition operation; not a document status.' }
)

export const ArtifactTransitionParams = Type.Object(
  { id: UuidSchema },
  { additionalProperties: false, description: 'Operation path parameters.' }
)

export const ArtifactTransitionOptionsSchema = Type.Object(
  {
    storeId: Type.String({ description: 'Store owning the artifact.' }),
    artifactId: UuidSchema,
    status: ArtifactStatusSchema,
    targets: Type.Array(
      Type.Object(
        {
          status: ArtifactStatusSchema,
          available: Type.Boolean({
            description: 'Whether the user can choose this status.'
          }),
          reason: Nullable(
            Type.String({ description: 'Why the status is unavailable.' })
          )
        },
        { description: 'One selectable target status.' }
      ),
      { description: 'Statuses the user can choose from the current one.' }
    ),
    activeOperationId: Nullable(
      Type.String({ description: 'Unfinished operation of this artifact.' })
    )
  },
  { description: 'Status menu data for one artifact.' }
)

export const ArtifactTransitionPreviewBody = Type.Object(
  {
    targetStatus: ArtifactStatusSchema
  },
  { additionalProperties: false, description: 'Requested target status.' }
)

const ChangeSchema = Type.Object(
  {
    artifactId: UuidSchema,
    title: Type.String({ description: 'Document title.' }),
    fromStatus: ArtifactStatusSchema,
    toStatus: ArtifactStatusSchema
  },
  { description: 'One status change the operation will apply.' }
)

export const ArtifactTransitionPreviewSchema = Type.Object(
  {
    storeId: Type.String({ description: 'Store owning the artifact.' }),
    previewId: UuidSchema,
    artifactId: UuidSchema,
    title: Type.String({ description: 'Title of the changed document.' }),
    fromStatus: ArtifactStatusSchema,
    targetStatus: ArtifactStatusSchema,
    changes: Type.Array(ChangeSchema, {
      description: 'Every status change, including derived ones.'
    }),
    blockers: Type.Array(
      Type.Object(
        {
          code: Type.String({ description: 'Stable problem code.' }),
          message: Type.String({ description: 'Problem description.' }),
          artifactIds: Type.Array(Type.String({ description: 'Artifact.' }), {
            description: 'Artifacts involved in the problem.'
          })
        },
        { description: 'Problem that blocks the transition.' }
      ),
      { description: 'Reasons the user cannot confirm yet.' }
    ),
    canConfirm: Type.Boolean({
      description: 'True when no blocker remains.'
    }),
    expiresAt: Type.Integer({
      description: 'Preview expiry as Unix milliseconds.'
    })
  },
  { description: 'Exact consequences shown before the user confirms.' }
)

export const ArtifactTransitionStartBody = Type.Object(
  {
    previewId: UuidSchema,
    presetId: Type.String({
      minLength: 1,
      maxLength: 128,
      description: 'Validator agent preset.'
    }),
    requestId: Type.String({
      minLength: 1,
      maxLength: 128,
      description: 'Idempotent command identifier.'
    })
  },
  {
    additionalProperties: false,
    description: 'The single user confirmation that starts the operation.'
  }
)

export const ArtifactTransitionOperationSchema = Type.Object(
  {
    storeId: Type.String({ description: 'Store owning the artifact.' }),
    id: UuidSchema,
    artifactId: UuidSchema,
    title: Type.String({ description: 'Title of the changed document.' }),
    fromStatus: ArtifactStatusSchema,
    targetStatus: ArtifactStatusSchema,
    presetId: Type.String({ description: 'Validator agent preset.' }),
    stage: ArtifactTransitionStageSchema,
    changes: Type.Array(ChangeSchema, {
      description: 'Status changes confirmed by the user.'
    }),
    canCancel: Type.Boolean({
      description: 'True while cancellation is still possible.'
    }),
    cancelRequested: Type.Boolean({
      description: 'True after the user asked to cancel.'
    }),
    reason: Nullable(
      Type.String({ description: 'Why the operation did not succeed.' })
    ),
    proposalId: Nullable(UuidSchema),
    proposalVersion: Nullable(
      Type.Integer({ description: 'Immutable proposal version.' })
    ),
    validationId: Nullable(UuidSchema),
    verdict: Nullable(
      Type.String({ description: 'Validator verdict when known.' })
    ),
    reportArtifactId: Nullable(UuidSchema),
    createdAt: Type.Integer({ description: 'Creation time, Unix ms.' }),
    updatedAt: Type.Integer({ description: 'Last change time, Unix ms.' }),
    consentExpiresAt: Type.Integer({
      description: 'Prior consent expiry, Unix ms.'
    })
  },
  { description: 'Server-owned status transition operation.' }
)

export const ArtifactTransitionOperationListSchema = Type.Object(
  {
    storeId: Type.String({ description: 'Store owning the artifacts.' }),
    items: Type.Array(ArtifactTransitionOperationSchema, {
      description: 'Latest operations of the artifact, newest first.'
    })
  },
  { description: 'Recent operations of one artifact.' }
)
