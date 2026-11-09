import { ARTIFACT_TYPE_ID_PATTERN_SOURCE } from '../utils/is-valid-artifact-type-id.ts'
import { UUID_PATTERN_SOURCE } from '../utils/is-uuid.ts'
import { Type } from '@sinclair/typebox'
import { Nullable } from '../utils/schemas.ts'
import {
  ArtifactActorSchema,
  ArtifactStatusSchema
} from '../artifacts/schemas.ts'

export const TASK_DESCRIPTION_MAX_LENGTH = 200_000
export const TASK_LINK_MAX_COUNT = 20

export const TaskLinkSchema = Type.Object(
  {
    url: Type.String({
      minLength: 1,
      maxLength: 2048,
      description: 'External HTTP or HTTPS URL without credentials.'
    }),
    label: Type.Optional(
      Type.String({
        maxLength: 200,
        description: 'Optional short label for the link.'
      })
    )
  },
  { additionalProperties: false, description: 'External task link.' }
)
export const TaskTagsSchema = Type.Array(
  Type.String({
    minLength: 1,
    maxLength: 128,
    description: 'Free-form tag.'
  }),
  { maxItems: 100, uniqueItems: true, description: 'Task tags.' }
)
export const TaskStateSchema = Type.Union(
  [Type.Literal('open'), Type.Literal('closed')],
  { description: 'Task state, independent of artifact lifecycle.' }
)
export const TaskInputSchema = Type.Object(
  {
    title: Type.String({
      minLength: 1,
      maxLength: 1000,
      description: 'Task title.'
    }),
    state: TaskStateSchema,
    description: Type.Optional(
      Type.String({
        maxLength: TASK_DESCRIPTION_MAX_LENGTH,
        description:
          'Markdown description. Omitted on update keeps the current text.'
      })
    ),
    links: Type.Optional(
      Type.Array(TaskLinkSchema, {
        maxItems: TASK_LINK_MAX_COUNT,
        description:
          'External links. Omitted on update keeps the current links.'
      })
    ),
    tags: Type.Optional(
      Type.Array(TaskTagsSchema.items, {
        maxItems: 100,
        uniqueItems: true,
        description: 'Task tags. Omitted on update keeps the current tags.'
      })
    ),
    externalUrl: Type.Optional(
      Type.Union([Type.Null(), Type.String({ maxLength: 2048 })], {
        description:
          'Deprecated. Use links. A URL becomes the only link; null removes all links.'
      })
    )
  },
  {
    additionalProperties: false,
    description: 'Editable task definition.'
  }
)
export const TaskSchema = Type.Object(
  {
    title: TaskInputSchema.properties.title,
    state: TaskStateSchema,
    description: Type.String({ description: 'Markdown description.' }),
    links: Type.Array(TaskLinkSchema, { description: 'External links.' }),
    tags: TaskTagsSchema,
    storeId: Type.String({ description: 'Owning artifact store.' }),
    id: Type.String({ description: 'Stable task UUID.' }),
    version: Type.Integer({ description: 'Task definition version.' }),
    createdAt: Type.String({ description: 'Task creation time, ISO 8601.' })
  },
  { description: 'Persistent task definition.' }
)
export const ArtifactTypeInputSchema = Type.Object(
  {
    label: Type.String({
      minLength: 1,
      maxLength: 256,
      description: 'Human-readable type label.'
    }),
    active: Type.Boolean({ description: 'Available for new type selections.' })
  },
  { additionalProperties: false, description: 'Editable type definition.' }
)
export const ArtifactTypeSchema = Type.Object(
  {
    ...ArtifactTypeInputSchema.properties,
    storeId: Type.String({ description: 'Owning artifact store.' }),
    id: Type.String({ description: 'Immutable type identifier.' }),
    version: Type.Integer({ description: 'Type definition version.' })
  },
  { description: 'Versioned artifact type.' }
)
export const DefinitionQuery = Type.Object(
  {
    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 100,
        description: 'Maximum page size.'
      })
    ),
    cursor: Type.Optional(
      Type.String({ maxLength: 2048, description: 'Store revision cursor.' })
    ),
    search: Type.Optional(
      Type.String({
        maxLength: 256,
        description:
          'Case-insensitive text matched against the name and the identifier.'
      })
    )
  },
  { additionalProperties: false, description: 'Definition page options.' }
)
export const DefinitionParams = Type.Object(
  {
    id: Type.String({
      minLength: 1,
      maxLength: 100,
      description: 'Definition identifier.'
    })
  },
  { additionalProperties: false, description: 'Definition path parameter.' }
)
export const TaskListQuery = Type.Object(
  {
    ...DefinitionQuery.properties,
    state: Type.Optional(TaskStateSchema),
    tags: Type.Optional(
      Type.Array(
        Type.String({ maxLength: 128, description: 'Required tag.' }),
        {
          maxItems: 100,
          description: 'Selected tags; see tagMode.'
        }
      )
    ),
    tagMode: Type.Optional(
      Type.Union([Type.Literal('all'), Type.Literal('any')], {
        description: 'Require every selected tag (all, default) or any (any).'
      })
    )
  },
  { additionalProperties: false, description: 'Task page options.' }
)
export const TaskCreateBody = Type.Object(
  {
    requestId: Type.String({
      minLength: 1,
      maxLength: 128,
      description: 'Idempotent command identifier.'
    }),
    input: TaskInputSchema
  },
  { additionalProperties: false, description: 'Create a task.' }
)
export const TaskUpdateBody = Type.Object(
  {
    ...TaskCreateBody.properties,
    expectedVersion: Type.Integer({
      minimum: 1,
      description: 'Expected task version.'
    })
  },
  { additionalProperties: false, description: 'Update a task definition.' }
)
export const ArtifactTypeCreateBody = Type.Object(
  {
    requestId: TaskCreateBody.properties.requestId,
    id: Type.String({
      pattern: ARTIFACT_TYPE_ID_PATTERN_SOURCE,
      description: 'Stable custom type identifier.'
    }),
    input: ArtifactTypeInputSchema
  },
  { additionalProperties: false, description: 'Create a custom artifact type.' }
)
export const ArtifactTypeUpdateBody = Type.Object(
  {
    requestId: TaskCreateBody.properties.requestId,
    expectedVersion: Type.Integer({
      minimum: 1,
      description: 'Expected type version.'
    }),
    input: ArtifactTypeInputSchema
  },
  {
    additionalProperties: false,
    description: 'Update a type definition without removing history.'
  }
)
export const TaskListSchema = Type.Object(
  {
    storeId: Type.String({ description: 'Owning store.' }),
    storeEpoch: Type.Integer({ description: 'Store revision.' }),
    items: Type.Array(
      Type.Object(
        {
          ...TaskSchema.properties,
          artifactCount: Type.Integer({
            minimum: 0,
            description:
              'Number of artifacts bound to this task, in every status.'
          })
        },
        { description: 'Task catalog entry with its artifact count.' }
      ),
      { description: 'Task definitions.' }
    ),
    nextCursor: Nullable(Type.String({ description: 'Next page cursor.' }))
  },
  { description: 'Task catalog page.' }
)
export const ArtifactTypeListSchema = Type.Object(
  {
    storeId: Type.String({ description: 'Owning store.' }),
    storeEpoch: Type.Integer({ description: 'Store revision.' }),
    items: Type.Array(ArtifactTypeSchema, {
      description: 'Artifact type definitions.'
    }),
    nextCursor: Nullable(Type.String({ description: 'Next page cursor.' }))
  },
  { description: 'Artifact type catalog page.' }
)
export const TaskChatLinkSchema = Type.Object(
  {
    taskId: Type.String({ description: 'Task identifier.' }),
    sessionId: Type.String({ description: 'Historical session identifier.' }),
    title: Type.String({ description: 'Session title snapshot.' }),
    linked: Type.Boolean({ description: 'Link is currently assigned.' }),
    available: Type.Boolean({
      description: 'Session is present in this server instance.'
    }),
    version: Type.Integer({ description: 'Link state version.' })
  },
  { description: 'Task session link; closed sessions remain in history.' }
)
export const TaskChatLinksSchema = Type.Array(TaskChatLinkSchema, {
  description: 'Session links associated with a task.'
})
export const SessionTaskBody = Type.Object(
  {
    requestId: TaskCreateBody.properties.requestId,
    expectedVersion: Type.Integer({
      minimum: 0,
      description: 'Expected session task-link version, initially zero.'
    }),
    taskIds: Type.Array(Type.String({ pattern: UUID_PATTERN_SOURCE }), {
      maxItems: 100,
      uniqueItems: true,
      description: 'Complete list of session tasks.'
    })
  },
  {
    additionalProperties: false,
    description: 'Assign tasks to a live server session.'
  }
)
export const SessionTaskSchema = Type.Object(
  {
    sessionId: Type.String({ description: 'Agent session identifier.' }),
    version: Type.Integer({ description: 'Assignment version.' }),
    taskIds: SessionTaskBody.properties.taskIds
  },
  { description: 'Current task assignment for a live session.' }
)
export const TaskActivationBody = Type.Object(
  {
    requestId: TaskCreateBody.properties.requestId,
    turnId: Type.String({
      pattern: UUID_PATTERN_SOURCE,
      description:
        'Expected active response identifier, read with tasks.get_context.'
    }),
    assignmentVersion: Type.Integer({
      minimum: 0,
      description: 'Expected current session assignment version.'
    }),
    taskId: Type.String({
      pattern: UUID_PATTERN_SOURCE,
      description: 'Existing task to select exclusively.'
    })
  },
  {
    additionalProperties: false,
    description: 'Activate an existing task for the current response and chat.'
  }
)
export const TaskCreateAndActivateBody = Type.Object(
  {
    requestId: TaskActivationBody.properties.requestId,
    turnId: TaskActivationBody.properties.turnId,
    assignmentVersion: TaskActivationBody.properties.assignmentVersion,
    input: TaskInputSchema
  },
  {
    additionalProperties: false,
    description:
      'Atomically create a task and activate it for the current response and chat.'
  }
)
export const TaskContextSchema = Type.Object(
  {
    storeId: Type.String({ description: 'Owning artifact store.' }),
    sessionId: Type.String({ description: 'Authenticated agent session.' }),
    turnId: Nullable(
      Type.String({
        description:
          'Active response identifier; null after cancellation or while idle.'
      })
    ),
    assignment: SessionTaskSchema,
    taskIds: Type.Array(Type.String(), {
      description:
        'Effective tasks for the current response, or an empty list while idle.'
    }),
    source: Nullable(
      Type.Union(
        [Type.Literal('turn_assignment'), Type.Literal('turn_activation')],
        { description: 'Source of the current response task context.' }
      )
    )
  },
  {
    additionalProperties: false,
    description: 'Own session task context and latest persisted assignment.'
  }
)
export const TaskActivationResultSchema = Type.Object(
  {
    task: TaskSchema,
    assignment: SessionTaskSchema,
    activation: Type.Object(
      {
        sessionId: Type.String({
          description: 'Session whose response was activated.'
        }),
        turnId: Type.String({
          description: 'Response in which activation occurred.'
        }),
        assignmentVersion: Type.Integer({
          description: 'Assignment version committed by this activation.'
        }),
        taskId: Type.String({
          description: 'Task selected by the original operation.'
        }),
        requestId: TaskCreateBody.properties.requestId
      },
      {
        description:
          'Immutable receipt of the original activation, not a claim about the current selection.'
      }
    ),
    replayed: Type.Boolean({
      description:
        'True for an idempotent repeat; no activation is applied again.'
    })
  },
  {
    additionalProperties: false,
    description: 'Task and persisted activation receipt.'
  }
)

export function definitionHistorySchema(
  snapshot: typeof TaskSchema | typeof ArtifactTypeSchema
) {
  return Type.Array(
    Type.Object(
      {
        snapshot,
        requestId: Type.String({ description: 'Command identifier.' }),
        actor: ArtifactActorSchema,
        createdAt: Type.String({ description: 'UTC event timestamp.' })
      },
      { description: 'Immutable definition version event.' }
    ),
    { description: 'Definition history in version order.' }
  )
}

export function definitionHistoryPageSchema(
  snapshot: typeof TaskSchema | typeof ArtifactTypeSchema
) {
  return Type.Object(
    {
      storeId: Type.String({ description: 'Owning store.' }),
      storeEpoch: Type.Integer({ description: 'Store revision.' }),
      items: definitionHistorySchema(snapshot),
      nextCursor: Nullable(
        Type.String({ description: 'Next history page cursor.' })
      )
    },
    { description: 'Definition history page.' }
  )
}
export const TaskChatHistorySchema = Type.Object(
  {
    storeId: Type.String({ description: 'Owning store.' }),
    storeEpoch: Type.Integer({ description: 'Store revision.' }),
    items: Type.Array(
      Type.Object(
        {
          seq: Type.Integer({
            description: 'Store-wide assignment event sequence.'
          }),
          sessionId: Type.String({
            description: 'Historical session identifier.'
          }),
          version: Type.Integer({
            description: 'Session task assignment version.'
          }),
          taskIds: SessionTaskBody.properties.taskIds,
          title: Type.String({ description: 'Session title snapshot.' }),
          actor: ArtifactActorSchema,
          createdAt: Type.String({ description: 'UTC event timestamp.' }),
          requestId: TaskCreateBody.properties.requestId,
          taskId: Type.String({ description: 'Task being queried.' }),
          linked: Type.Boolean({
            description: 'Task was assigned after this event.'
          }),
          available: Type.Boolean({
            description: 'Session is available in this runtime.'
          })
        },
        { description: 'Immutable task-session assignment event.' }
      ),
      { description: 'Task-session assignment history.' }
    ),
    nextCursor: Nullable(
      Type.String({ description: 'Next history page cursor.' })
    )
  },
  { description: 'Task-session history page.' }
)
export const TaskChatLinksPageSchema = Type.Object(
  {
    storeId: Type.String({ description: 'Owning store.' }),
    storeEpoch: Type.Integer({ description: 'Store revision.' }),
    items: TaskChatLinksSchema,
    nextCursor: Nullable(
      Type.String({ description: 'Next session-link page cursor.' })
    )
  },
  { description: 'Task session links page.' }
)

export const TaskArtifactSchema = Type.Object(
  {
    id: Type.String({ description: 'Artifact UUID.' }),
    title: Type.String({ description: 'Current artifact title.' }),
    typeId: Type.String({ description: 'Artifact type identifier.' }),
    status: ArtifactStatusSchema,
    createdAt: Type.String({
      description: 'Artifact creation time, ISO 8601.'
    }),
    exclusive: Type.Boolean({
      description: 'The artifact belongs to this task and to no other task.'
    })
  },
  { description: 'Artifact bound to a task.' }
)
export const TaskArtifactsSchema = Type.Object(
  {
    taskId: Type.String({ description: 'Task identifier.' }),
    items: Type.Array(TaskArtifactSchema, {
      description: 'Every artifact bound to the task, in any status.'
    })
  },
  { description: 'Artifacts bound to a task.' }
)
