import { Type } from '@sinclair/typebox'
import {
  ArtifactParams,
  ArtifactMetadataInputSchema,
  ArtifactListQuery,
  ArtifactContentQuery,
  ArtifactHistoryQuery,
  GraphPageQuery,
  ArtifactReviewCreateBody,
  ArtifactReviewCommentEventBody,
  ArtifactReviewListQuery,
  ArtifactReviewCommentsQuery
} from '../artifacts/schemas.ts'
import {
  DefinitionQuery,
  DefinitionParams,
  TaskCreateBody,
  TaskUpdateBody,
  ArtifactTypeCreateBody,
  ArtifactTypeUpdateBody
} from '../tasks/schemas.ts'
import { MAX_ARTIFACT_BODY_BYTES } from '../artifacts/constants.ts'

// Keep HTTP and MCP input contracts identical, including rejection of actor overrides.
export const ArtifactToolSchemas = {
  'artifacts.create': Type.Object(
    {
      requestId: TaskCreateBody.properties.requestId,
      body: Type.String({
        maxLength: MAX_ARTIFACT_BODY_BYTES,
        description: 'Complete immutable Markdown body.'
      }),
      metadata: ArtifactMetadataInputSchema,
      revisionOf: Type.Optional(
        Type.Array(ArtifactParams.properties.id, {
          maxItems: 100,
          uniqueItems: true,
          description: 'Immutable revision ancestors.'
        })
      )
    },
    {
      additionalProperties: false,
      description:
        'Create an immutable draft artifact with an idempotent request ID.'
    }
  ),
  'artifacts.get': ArtifactParams,
  'artifacts.list': ArtifactListQuery,
  'artifacts.get_content': Type.Object(
    { ...ArtifactParams.properties, ...ArtifactContentQuery.properties },
    {
      additionalProperties: false,
      description: 'Read a verified content chunk.'
    }
  ),
  'artifacts.history': Type.Object(
    { ...ArtifactParams.properties, ...ArtifactHistoryQuery.properties },
    { additionalProperties: false, description: 'Read artifact history.' }
  ),
  'artifacts.relations': Type.Object(
    { ...ArtifactParams.properties, ...GraphPageQuery.properties },
    {
      additionalProperties: false,
      description: 'Read incoming or outgoing relations.'
    }
  ),
  'artifacts.ancestry': Type.Object(
    { ...ArtifactParams.properties, ...DefinitionQuery.properties },
    { additionalProperties: false, description: 'Read immutable ancestry.' }
  ),
  'reviews.list': Type.Object(
    { ...ArtifactParams.properties, ...ArtifactReviewListQuery.properties },
    {
      additionalProperties: false,
      description: 'Read a complete page of artifact threads and blockers.'
    }
  ),
  'reviews.summary': ArtifactParams,
  'reviews.comment': Type.Object(
    { ...ArtifactParams.properties, ...ArtifactReviewCreateBody.properties },
    {
      additionalProperties: false,
      description: 'Create a new anchored or general review thread.'
    }
  ),
  'reviews.reply': Type.Object(
    {
      ...ArtifactParams.properties,
      requestId: ArtifactReviewCreateBody.properties.requestId,
      expectedThreadVersion:
        ArtifactReviewCommentEventBody.anyOf[0].properties
          .expectedThreadVersion,
      text: ArtifactReviewCreateBody.properties.text
    },
    {
      additionalProperties: false,
      description: 'Reply to a versioned review thread.'
    }
  ),
  'reviews.edit': Type.Object(
    {
      ...ArtifactParams.properties,
      requestId: ArtifactReviewCreateBody.properties.requestId,
      expectedThreadVersion:
        ArtifactReviewCommentEventBody.anyOf[0].properties
          .expectedThreadVersion,
      commentId: ArtifactParams.properties.id,
      text: ArtifactReviewCreateBody.properties.text
    },
    {
      additionalProperties: false,
      description: 'Edit comment text while retaining immutable history.'
    }
  ),
  'reviews.hide': Type.Object(
    {
      ...ArtifactParams.properties,
      requestId: ArtifactReviewCreateBody.properties.requestId,
      expectedThreadVersion:
        ArtifactReviewCommentEventBody.anyOf[0].properties
          .expectedThreadVersion,
      commentId: ArtifactParams.properties.id
    },
    {
      additionalProperties: false,
      description: 'Hide comment text without resolving or removing a blocker.'
    }
  ),
  'reviews.comments': Type.Object(
    { ...ArtifactParams.properties, ...ArtifactReviewCommentsQuery.properties },
    {
      additionalProperties: false,
      description:
        'Read complete visible comments by position, independent of unrelated store changes.'
    }
  ),
  'reviews.history': Type.Object(
    { ...ArtifactParams.properties, ...ArtifactHistoryQuery.properties },
    {
      additionalProperties: false,
      description: 'Read a complete review history page.'
    }
  ),
  'tasks.list': DefinitionQuery,
  'tasks.get': DefinitionParams,
  'tasks.create': TaskCreateBody,
  'tasks.update': Type.Object(
    { ...DefinitionParams.properties, ...TaskUpdateBody.properties },
    { additionalProperties: false, description: 'Update a versioned task.' }
  ),
  'types.list': DefinitionQuery,
  'types.get': DefinitionParams,
  'types.create': ArtifactTypeCreateBody,
  'types.update': Type.Object(
    { ...DefinitionParams.properties, ...ArtifactTypeUpdateBody.properties },
    { additionalProperties: false, description: 'Update a versioned type.' }
  )
} as const

export const ArtifactBridgeParams = Type.Object(
  {
    operation: Type.String({
      minLength: 1,
      maxLength: 64,
      description: 'Fixed artifact tool operation.'
    })
  },
  { additionalProperties: false, description: 'Internal bridge operation.' }
)
export const ArtifactBridgeBody = Type.Record(Type.String(), Type.Unknown(), {
  description: 'Tool parameters validated against the operation schema.'
})
export const ArtifactBridgeResponse = Type.Record(
  Type.String(),
  Type.Unknown(),
  {
    description:
      'Complete operation result, including store identity and pagination.'
  }
)
