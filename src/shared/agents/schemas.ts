import { Type } from '@sinclair/typebox'
import { MAX_ATTACHMENT_BYTES, MAX_FILE_SEARCH_LIMIT } from './constants.ts'
import { DiffSourceNameSchema } from '../diff/schemas.ts'
import { Nullable } from '../utils/schemas.ts'

export const SessionParams = Type.Object({
  id: Type.String({ description: 'Chat session id.' })
})
export const PermissionParams = Type.Object({
  id: Type.String({ description: 'Chat session id.' }),
  requestId: Type.String({ description: 'Pending permission request id.' })
})
export const CreateSessionBody = Type.Object(
  {
    presetId: Type.String({
      minLength: 1,
      description: 'Preset from GET /api/agent/presets.'
    }),
    name: Type.Optional(
      Type.String({
        maxLength: 60,
        description: 'Chat name. Omitted: the server makes a unique one.'
      })
    ),
    reviewId: Type.Optional(
      Type.String({ description: 'Review that the chat belongs to.' })
    )
  },
  { description: 'A new chat session.' }
)
export const AutoApproveBody = Type.Object(
  {
    enabled: Type.Boolean({
      description: 'The server answers permission requests itself.'
    })
  },
  { description: 'Auto-approve switch of one session.' }
)
export const FileSearchQuery = Type.Object({
  q: Type.Optional(
    Type.String({
      maxLength: 200,
      description: 'Fuzzy text to find in paths. Empty lists files first.'
    })
  ),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: MAX_FILE_SEARCH_LIMIT,
      description: 'Maximum number of paths.'
    })
  )
})
export const ContextItem = Type.Union(
  [
    Type.Object(
      {
        kind: Type.Literal('diff', { description: 'Live working-tree diff.' }),
        source: DiffSourceNameSchema,
        path: Type.Optional(
          Type.String({
            minLength: 1,
            description: 'One file of the diff. Omitted: the whole diff.'
          })
        )
      },
      { description: 'The live diff of one side.' }
    ),
    Type.Object(
      {
        kind: Type.Literal('file', { description: 'A repository file.' }),
        path: Type.String({
          minLength: 1,
          description: 'Repository-relative path. The agent reads the file.'
        })
      },
      { description: 'A link to a repository file.' }
    ),
    Type.Object(
      {
        kind: Type.Literal('directory', {
          description: 'A repository directory.'
        }),
        path: Type.String({
          minLength: 1,
          description:
            'Repository-relative path without a trailing slash. The agent reads the directory.'
        })
      },
      { description: 'A link to a repository directory.' }
    ),
    Type.Object(
      {
        kind: Type.Literal('review', { description: 'A review.' }),
        reviewId: Type.String({ description: 'Review id.' })
      },
      { description: 'A review as markdown with its comments.' }
    ),
    Type.Object(
      {
        kind: Type.Literal('attachment', {
          description: 'A file from the user.'
        }),
        name: Type.String({
          minLength: 1,
          maxLength: 255,
          description: 'File name.'
        }),
        mimeType: Type.String({ maxLength: 255, description: 'MIME type.' }),
        data: Type.String({
          maxLength: Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4,
          description: 'File content in base64.'
        })
      },
      { description: 'An uploaded file or a pasted image.' }
    )
  ],
  { description: 'Context of a prompt (docs/agent-context-uris.md).' }
)
export const PromptBody = Type.Object(
  {
    text: Type.String({ minLength: 1, description: 'Message to the agent.' }),
    context: Type.Optional(
      Type.Array(ContextItem, {
        maxItems: 20,
        description: 'Context items that go with the message.'
      })
    )
  },
  { description: 'A user message.' }
)
export const PermissionBody = Type.Object(
  {
    optionId: Type.Optional(
      Type.String({
        description:
          'Option from the permission request. Omitted: the request is cancelled.'
      })
    )
  },
  { description: 'Answer to a permission request.' }
)
export const ConfigBody = Type.Object(
  {
    configId: Type.String({
      minLength: 1,
      description: 'Setting id from the config event.'
    }),
    // No schema type on purpose: a Union/anyOf makes Fastify's Ajv coerce `true`
    // into the string "true", and a `type` array trips Ajv's strictTypes. The
    // session checks the value against the option the agent actually offered.
    value: Type.Unsafe<string | boolean>({
      description: 'A select value (string) or a boolean.'
    })
  },
  { description: 'A new value of an agent setting.' }
)

export const AgentPresetInfoSchema = Type.Object(
  {
    id: Type.String({ description: 'Preset id.' }),
    title: Type.String({ description: 'Name in the UI.' }),
    available: Type.Boolean({
      description:
        'The launcher binary is in PATH. Says nothing about login or auth.'
    }),
    autoApprovesEdits: Type.Boolean({
      description: 'The agent applies edits without permission requests.'
    })
  },
  { description: 'An ACP agent that can start a chat.' }
)

export const AgentSessionStatusSchema = Type.Union(
  [
    Type.Literal('starting'),
    Type.Literal('ready'),
    Type.Literal('busy'),
    Type.Literal('closed')
  ],
  { description: 'Session state.' }
)

export const AgentSessionInfoSchema = Type.Object(
  {
    id: Type.String({ description: 'Chat session id.' }),
    presetId: Type.String({ description: 'Preset of the agent.' }),
    name: Type.String({ description: 'Chat name in the UI.' }),
    status: AgentSessionStatusSchema,
    reviewId: Nullable(
      Type.String({ description: 'Review of the chat. Else null.' })
    ),
    autoApprove: Type.Boolean({
      description: 'The server answers permission requests itself.'
    }),
    error: Nullable(
      Type.String({
        description: 'Why the session could not start. Else null.'
      })
    )
  },
  { description: 'A chat session.' }
)

export const AgentFileSearchResponseSchema = Type.Object(
  {
    paths: Type.Array(Type.String(), {
      description:
        'Repository-relative paths, best match first. A directory path ends with a slash.'
    })
  },
  { description: 'Files and directories for the context picker.' }
)

export const AgentEventsHeaders = Type.Object({
  'last-event-id': Type.Optional(
    Type.String({
      description:
        'Last event id that the client got. Events after it come again.'
    })
  )
})

export const AgentStreamSchema = Type.String({
  description:
    'Server-sent events: connected, then agent (AgentStreamEnvelope, SSE id = event id), state (AgentSessionState), gap ({ sessionId }) and sessions (reread the list).'
})
