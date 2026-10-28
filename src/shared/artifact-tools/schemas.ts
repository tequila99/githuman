import { Type } from '@sinclair/typebox'
import {
  ArtifactValidationReportQuery,
  ArtifactChangeSetProposeBody,
  ArtifactValidationPrepareBody,
  ArtifactValidationStartBody,
  ArtifactValidationSubmitBody,
  ArtifactValidationReadBody,
  ArtifactValidationReportBody,
  ArtifactLifecycleCommitBody,
  ArtifactAuthorizationRequestBody,
  ArtifactReviewExecuteBody,
  ArtifactReviewDecisionBody,
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
  'change_sets.propose': ArtifactChangeSetProposeBody,
  'change_sets.get': ArtifactParams,
  'change_sets.commit': Type.Object(
    { ...ArtifactParams.properties, ...ArtifactLifecycleCommitBody.properties },
    {
      additionalProperties: false,
      description: 'Commit an authorized validated package.'
    }
  ),
  'validations.prepare': ArtifactValidationPrepareBody,
  'validations.start': Type.Object(
    { ...ArtifactParams.properties, ...ArtifactValidationStartBody.properties },
    {
      additionalProperties: false,
      description: 'Start a separate bounded validator.'
    }
  ),
  'validations.get': ArtifactParams,
  'validations.report': Type.Object(
    {
      ...ArtifactParams.properties,
      ...ArtifactValidationReportQuery.properties
    },
    {
      additionalProperties: false,
      description: 'Read the complete structured report in chunks.'
    }
  ),
  'validations.history': Type.Object(
    { ...ArtifactParams.properties, ...ArtifactHistoryQuery.properties },
    {
      additionalProperties: false,
      description: 'Read validation state history without truncation.'
    }
  ),
  'validations.manifest': Type.Object(
    { ...ArtifactParams.properties, ...DefinitionQuery.properties },
    {
      additionalProperties: false,
      description: 'Read all manifest pages without truncation.'
    }
  ),
  'validations.read': Type.Object(
    { ...ArtifactParams.properties, ...ArtifactValidationReadBody.properties },
    {
      additionalProperties: false,
      description: 'Read assigned context sequentially.'
    }
  ),
  'validations.submit': Type.Object(
    {
      ...ArtifactParams.properties,
      ...ArtifactValidationSubmitBody.properties
    },
    {
      additionalProperties: false,
      description: 'Submit the assigned structured validation report.'
    }
  ),
  'validations.create_report': Type.Object(
    {
      ...ArtifactParams.properties,
      ...ArtifactValidationReportBody.properties
    },
    {
      additionalProperties: false,
      description: 'Create an isolated validation report draft.'
    }
  ),
  'actions.request': ArtifactAuthorizationRequestBody,
  'reviews.execute': ArtifactReviewExecuteBody,
  'reviews.resolve': Type.Object(
    {
      ...ArtifactParams.properties,
      ...Type.Omit(ArtifactReviewDecisionBody.anyOf[1], ['kind']).properties,
      authorizationId: ArtifactParams.properties.id
    },
    {
      additionalProperties: false,
      description: 'Resolve one explicitly authorized review scope.'
    }
  ),
  'reviews.reopen': Type.Object(
    {
      ...ArtifactParams.properties,
      ...Type.Omit(ArtifactReviewDecisionBody.anyOf[2], ['kind']).properties,
      authorizationId: ArtifactParams.properties.id
    },
    {
      additionalProperties: false,
      description: 'Reopen one explicitly authorized review scope.'
    }
  ),
  'reviews.set_blocking': Type.Object(
    {
      ...ArtifactParams.properties,
      ...Type.Omit(ArtifactReviewDecisionBody.anyOf[0], ['kind']).properties,
      authorizationId: ArtifactParams.properties.id
    },
    {
      additionalProperties: false,
      description: 'Change blocking with one explicit scoped authorization.'
    }
  ),

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
