import { Type } from '@sinclair/typebox'
import { ArtifactActorSchema } from '../artifacts/schemas.ts'
import { Nullable } from '../utils/schemas.ts'
import { MAX_JOURNAL_ENTRY_BYTES } from './constants.ts'

export const JournalKindSchema = Type.Union(
  [
    Type.Literal('done'),
    Type.Literal('decision'),
    Type.Literal('open'),
    Type.Literal('next'),
    Type.Literal('note'),
    Type.Literal('system')
  ],
  { description: 'Semantic entry category or server fact.' }
)
export const JournalProvenanceSchema = Type.Object(
  {
    presetId: Type.String({
      description: 'Agent preset identity at capture time.'
    }),
    agentName: Type.String({
      description: 'Agent type title at capture time.'
    }),
    sessionName: Type.String({ description: 'Original chat title.' }),
    model: Nullable(
      Type.String({ description: 'Model reported by ACP, otherwise null.' })
    ),
    reasoning: Nullable(
      Type.String({
        description: 'Reasoning level reported by ACP, otherwise null.'
      })
    ),
    settings: Type.Array(
      Type.Object(
        {
          id: Type.String({ description: 'ACP setting identity.' }),
          name: Type.String({ description: 'ACP setting title.' }),
          value: Type.Union([Type.String(), Type.Boolean()], {
            description: 'Captured setting value.'
          })
        },
        { description: 'One captured ACP setting.' }
      ),
      { description: 'Settings captured for this response.' }
    )
  },
  {
    description: 'Agent harness, model and settings captured for one response.'
  }
)
export const JournalContextSchema = Type.Object(
  {
    ...JournalProvenanceSchema.properties,
    references: Type.Optional(
      Type.Array(
        Type.String({
          description: 'Attached context locator without attachment payload.'
        }),
        { description: 'Context references supplied with the request.' }
      )
    ),
    prompt: Type.String({
      description: 'Original user message, capped at 64 KiB UTF-8.'
    }),
    response: Type.String({
      description:
        'Visible agent response captured so far, capped at 64 KiB UTF-8.'
    }),
    promptTruncated: Type.Boolean({
      description: 'The stored prompt is incomplete.'
    }),
    responseTruncated: Type.Boolean({
      description: 'The stored response is incomplete.'
    })
  },
  {
    description:
      'Persistent response content and agent provenance, independent of live chats.'
  }
)
export const JournalEntrySchema = Type.Object(
  {
    id: Type.String({ description: 'Immutable entry UUID.' }),
    seq: Type.Integer({ description: 'Monotonic journal sequence.' }),
    storeId: Type.String({ description: 'Project store identity.' }),
    taskId: Nullable(
      Type.String({
        description: 'Task UUID; null for an unassigned response.'
      })
    ),
    kind: JournalKindSchema,
    body: Type.String({ description: 'Entry text.' }),
    eventType: Nullable(
      Type.Union(
        [
          Type.Literal('agent_event'),
          Type.Literal('turn_finished'),
          Type.Literal('turn_cancelled'),
          Type.Literal('turn_failed'),
          Type.Literal('handoff_completed')
        ],
        { description: 'Server fact type; null for user and agent entries.' }
      )
    ),
    actor: ArtifactActorSchema,
    context: Type.Optional(JournalContextSchema),
    provenance: Type.Optional(JournalProvenanceSchema),
    sessionId: Nullable(
      Type.String({ description: 'Originating session, when available.' })
    ),
    turnId: Nullable(
      Type.String({ description: 'Originating response, when available.' })
    ),
    supersedesEntryId: Nullable(
      Type.String({ description: 'Earlier entry corrected by this entry.' })
    ),
    createdAt: Type.String({ description: 'Server timestamp in ISO format.' })
  },
  { description: 'One immutable task journal entry.' }
)
export const JournalAppendBody = Type.Object(
  {
    requestId: Type.String({
      minLength: 1,
      maxLength: 128,
      description: 'Idempotent command identifier.'
    }),
    kind: Type.Union(
      [
        Type.Literal('done'),
        Type.Literal('decision'),
        Type.Literal('open'),
        Type.Literal('next'),
        Type.Literal('note')
      ],
      { description: 'User or agent semantic category.' }
    ),
    body: Type.String({
      minLength: 1,
      maxLength: MAX_JOURNAL_ENTRY_BYTES,
      description: 'Text, capped at 8 KiB UTF-8 by the service.'
    }),
    supersedesEntryId: Type.Optional(
      Type.String({ description: 'Entry of this task to correct.' })
    )
  },
  {
    additionalProperties: false,
    description: 'Append a semantic journal entry.'
  }
)
export const JournalQuery = Type.Object(
  {
    storeId: Type.String({
      minLength: 1,
      description: 'Expected project store identity.'
    }),
    beforeSeq: Type.Optional(
      Type.Integer({
        minimum: 1,
        description: 'Exclusive upper bound for older entries.'
      })
    ),
    throughSeq: Type.Optional(
      Type.Integer({ minimum: 0, description: 'Inclusive snapshot sequence.' })
    ),
    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 50,
        description: 'Maximum entries, newest first.'
      })
    )
  },
  { additionalProperties: false, description: 'Stable keyset journal page.' }
)
export const SessionJournalQuery = Type.Object(
  {
    ...JournalQuery.properties,
    sessionId: Type.String({
      minLength: 1,
      maxLength: 128,
      description: 'Exact source session identity, including closed sessions.'
    })
  },
  {
    additionalProperties: false,
    description: 'Read unique session events across all task assignments.'
  }
)
export const JournalPageSchema = Type.Object(
  {
    items: Type.Array(JournalEntrySchema, {
      description: 'Newest entries first.'
    }),
    throughSeq: Type.Integer({ description: 'Snapshot upper bound.' }),
    nextBeforeSeq: Nullable(
      Type.Integer({
        description: 'Exclusive boundary of the next older page.'
      })
    )
  },
  { description: 'Journal page unaffected by subsequent appends.' }
)
export const JournalSearchQuery = Type.Object(
  {
    ...JournalQuery.properties,
    storeId: Type.Optional(JournalQuery.properties.storeId),
    query: Type.Optional(
      Type.String({
        maxLength: 256,
        description: 'Literal case-insensitive entry text.'
      })
    ),
    taskId: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 128,
        description: 'Task identity, including closed tasks.'
      })
    ),
    sessionId: Type.Optional(SessionJournalQuery.properties.sessionId),
    agentName: Type.Optional(
      Type.String({ maxLength: 256, description: 'Exact captured agent name.' })
    ),
    model: Type.Optional(
      Type.String({ maxLength: 256, description: 'Exact captured model name.' })
    ),
    kind: Type.Optional(JournalKindSchema),
    author: Type.Optional(ArtifactActorSchema.properties.kind),
    createdFrom: Type.Optional(
      Type.String({
        maxLength: 40,
        description: 'Inclusive ISO creation timestamp.'
      })
    ),
    createdTo: Type.Optional(
      Type.String({
        maxLength: 40,
        description: 'Inclusive ISO creation timestamp.'
      })
    )
  },
  {
    additionalProperties: false,
    description: 'Search the full project journal before pagination.'
  }
)
export const JournalSearchEntrySchema = Type.Object(
  {
    ...JournalEntrySchema.properties,
    taskTitle: Nullable(
      Type.String({ description: 'Current task title, if the task exists.' })
    ),
    isSuperseded: Type.Boolean({
      description:
        'Corrected within the journal snapshot, even outside this page.'
    })
  },
  { description: 'Journal entry with its task and correction state.' }
)
export const JournalSearchPageSchema = Type.Object(
  {
    ...JournalPageSchema.properties,
    agentNames: Type.Optional(
      Type.Array(Type.String(), {
        description: 'Agent names across the selected task or project journal.'
      })
    ),
    models: Type.Optional(
      Type.Array(Type.String(), {
        description: 'Model names across the selected task or project journal.'
      })
    ),
    storeId: Type.String({
      description:
        'Project store identity; pin subsequent requests to this store.'
    }),
    items: Type.Array(JournalSearchEntrySchema, {
      description: 'Matching entries, newest first.'
    })
  },
  { description: 'Bounded snapshot page across all project tasks.' }
)
export const JournalAgentAppendSchema = Type.Object(
  {
    ...JournalAppendBody.properties,
    taskId: Type.String({
      description: 'Explicit task of the current response.'
    }),
    turnId: Type.String({
      description: 'Live response identifier from tasks.get_context.'
    })
  },
  {
    additionalProperties: false,
    description:
      'Append to the effective response task without changing selection.'
  }
)
export const JournalAgentListSchema = Type.Object(
  {
    ...JournalQuery.properties,
    taskId: Type.String({ description: 'Task to read.' })
  },
  { additionalProperties: false, description: 'Read the task journal.' }
)
export const HandoffPreviewBody = Type.Object(
  {
    requestId: Type.String({
      minLength: 1,
      maxLength: 128,
      description: 'Stable preview command identifier.'
    }),
    storeId: Type.String({ description: 'Expected store identity.' }),
    presetId: Type.String({
      minLength: 1,
      description: 'Target agent preset.'
    }),
    name: Type.Optional(
      Type.String({ maxLength: 60, description: 'Optional target chat name.' })
    ),
    sourceSessionId: Type.Optional(
      Type.String({
        description: 'Live source, omitted for task continuation.'
      })
    ),
    sourceAssignmentVersion: Type.Optional(
      Type.Integer({
        minimum: 0,
        description: 'Expected assignment of the live source.'
      })
    )
  },
  {
    additionalProperties: false,
    description: 'Capture a task handoff preview without starting an agent.'
  }
)
export const SessionHandoffPreviewBody = Type.Object(
  {
    ...HandoffPreviewBody.properties,
    sourceSessionId: Type.String({
      minLength: 1,
      description: 'Source chat identity.'
    }),
    sourceAssignmentVersion: Type.Integer({
      minimum: 0,
      description: 'Expected source assignment version.'
    })
  },
  {
    additionalProperties: false,
    description:
      'Capture a session handoff and automatically continue after confirmation.'
  }
)
export const HandoffSchema = Type.Object(
  {
    id: Type.String({ description: 'Handoff operation UUID.' }),
    storeId: Type.String({ description: 'Project store identity.' }),
    taskId: Nullable(
      Type.String({
        description: 'Legacy continued task UUID; null for session handoff.'
      })
    ),
    state: Type.Union(
      [
        Type.Literal('preview'),
        Type.Literal('preparing'),
        Type.Literal('ready'),
        Type.Literal('failed'),
        Type.Literal('interrupted')
      ],
      {
        description: 'Preparation state; ready does not mean a prompt was sent.'
      }
    ),
    sourceSessionId: Nullable(
      Type.String({ description: 'Source chat, if specified.' })
    ),
    targetSessionId: Nullable(
      Type.String({ description: 'Created target chat, if any.' })
    ),
    snapshot: Type.String({
      description: 'Bounded immutable startup context.'
    }),
    digest: Type.String({ description: 'SHA-256 of the startup context.' }),
    capturedAt: Type.String({ description: 'Snapshot timestamp.' }),
    expiresAt: Type.Integer({
      description: 'Preview expiry in Unix milliseconds.'
    }),
    error: Nullable(
      Type.String({ description: 'Preparation failure, if any.' })
    )
  },
  { description: 'Reviewable handoff operation.' }
)
export const HandoffConfirmBody = Type.Object(
  {
    digest: Type.String({
      description: 'Exact digest of the preview the user confirmed.'
    })
  },
  {
    additionalProperties: false,
    description: 'Confirm this snapshot and create its target chat.'
  }
)
