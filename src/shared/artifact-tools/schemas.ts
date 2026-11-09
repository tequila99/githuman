import { Type } from '@sinclair/typebox'
import {
  ArtifactSearchBody,
  ArtifactValidationReportQuery,
  ArtifactChangeSetProposeBody,
  ArtifactChangeSetSchema,
  ArtifactValidationPrepareBody,
  ArtifactValidationStartBody,
  ArtifactValidationSubmitBody,
  ArtifactValidationReadBody,
  ArtifactValidationReportBody,
  ArtifactLifecycleCommitBody,
  ArtifactAuthorizationRequestBody,
  ArtifactParams,
  ArtifactMetadataInputSchema,
  ArtifactListQuery,
  ArtifactContentQuery,
  ArtifactHistoryQuery,
  GraphPageQuery
} from '../artifacts/schemas.ts'
import {
  DefinitionQuery,
  DefinitionParams,
  TaskCreateBody,
  TaskActivationBody,
  TaskCreateAndActivateBody,
  TaskUpdateBody,
  ArtifactTypeCreateBody,
  ArtifactTypeUpdateBody,
  TaskListQuery
} from '../tasks/schemas.ts'
import { MAX_ARTIFACT_BODY_BYTES } from '../artifacts/constants.ts'

// Keep HTTP and MCP input contracts identical, including rejection of actor overrides.
export const ArtifactToolSchemas = {
  'artifacts.search': ArtifactSearchBody,
  'change_sets.preview': ArtifactChangeSetSchema,
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
  'validations.report_text': Type.Object(
    {
      ...ArtifactParams.properties,
      ...ArtifactValidationReportQuery.properties
    },
    {
      additionalProperties: false,
      description: 'Read the Markdown report text of a validation in chunks.'
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
      description:
        'Read all manifest pages; contentRequired marks artifacts requiring complete reading.'
    }
  ),
  'validations.read': Type.Object(
    { ...ArtifactParams.properties, ...ArtifactValidationReadBody.properties },
    {
      additionalProperties: false,
      description:
        'Read any assigned manifest artifact sequentially; optional context does not affect required coverage.'
    }
  ),
  'validations.read_next': Type.Object(
    { ...ArtifactParams.properties },
    {
      additionalProperties: false,
      description:
        'Read the next unread required content in manifest order, several documents per call.'
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
      description: 'Attach a Markdown report text to the assigned validation.'
    }
  ),
  'actions.request': ArtifactAuthorizationRequestBody,
  'actions.status': ArtifactParams,
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
  'artifacts.update_metadata': Type.Object(
    {
      ...ArtifactParams.properties,
      requestId: TaskCreateBody.properties.requestId,
      expectedVersion: TaskUpdateBody.properties.expectedVersion,
      metadata: ArtifactMetadataInputSchema
    },
    {
      additionalProperties: false,
      description:
        'Update versioned artifact metadata without rewriting the immutable original.'
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
  'tasks.list': TaskListQuery,
  'tasks.get': DefinitionParams,
  'tasks.create': TaskCreateBody,
  'tasks.get_context': Type.Object(
    {},
    {
      additionalProperties: false,
      description: 'Read the authenticated session task context.'
    }
  ),
  'tasks.activate': TaskActivationBody,
  'tasks.create_and_activate': TaskCreateAndActivateBody,
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
