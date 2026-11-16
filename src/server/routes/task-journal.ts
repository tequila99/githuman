import type { FastifyInstance } from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { Type } from '@sinclair/typebox'
import {
  SessionJournalQuery,
  SessionHandoffPreviewBody,
  JournalAppendBody,
  JournalEntrySchema,
  JournalPageSchema,
  JournalQuery,
  JournalSearchQuery,
  JournalSearchPageSchema,
  HandoffPreviewBody,
  HandoffSchema,
  HandoffConfirmBody
} from '../../shared/task-journal/schemas.ts'
import { DefinitionParams } from '../../shared/tasks/schemas.ts'
import { ERROR_RESPONSES } from '../../shared/http/schemas.ts'
import { artifactUserActor } from '../utils/artifact-actor.ts'
import { ArtifactInputError } from '../errors/artifacts.ts'
import type { ArtifactStorageService } from '../services/artifact-storage.service.ts'
import type { TaskHandoffService } from '../services/task-handoff.service.ts'
import { requireLocalOrigin } from '../hooks/agents/local-origin.ts'

export async function taskJournalRoutes(
  app: FastifyInstance,
  { storage }: { storage: ArtifactStorageService }
): Promise<void> {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>()
  typed.get(
    '/api/session-journal',
    {
      schema: {
        tags: ['agents'],
        summary: 'Read a persisted session journal',
        querystring: SessionJournalQuery,
        response: { 200: JournalPageSchema, ...ERROR_RESPONSES }
      }
    },
    request => storage.journal.session(request.query)
  )
  typed.get(
    '/api/task-journal',
    {
      schema: {
        tags: ['tasks'],
        summary: 'Search the complete project task journal',
        querystring: JournalSearchQuery,
        response: { 200: JournalSearchPageSchema, ...ERROR_RESPONSES }
      }
    },
    request => storage.journal.search(request.query)
  )
  typed.get(
    '/api/tasks/:id/journal',
    {
      schema: {
        tags: ['tasks'],
        summary: 'Read the task journal',
        params: DefinitionParams,
        querystring: JournalQuery,
        response: { 200: JournalPageSchema, ...ERROR_RESPONSES }
      }
    },
    request => storage.journal.list(request.params.id, request.query)
  )
  typed.post(
    '/api/tasks/:id/journal',
    {
      schema: {
        tags: ['tasks'],
        summary: 'Append a task journal entry',
        params: DefinitionParams,
        body: Type.Object(
          {
            ...JournalAppendBody.properties,
            storeId: Type.String({
              description: 'Expected project store identity.'
            })
          },
          {
            additionalProperties: false,
            description: 'Journal append in the expected store.'
          }
        ),
        response: { 200: JournalEntrySchema, ...ERROR_RESPONSES }
      }
    },
    request => {
      const { storeId, ...input } = request.body
      if (storeId !== storage.storeId) {
        throw new ArtifactInputError('Task store changed.')
      }
      return storage.journal.append(
        request.params.id,
        input,
        artifactUserActor(request)
      )
    }
  )
}
export async function taskHandoffRoutes(
  app: FastifyInstance,
  { handoffs }: { handoffs: TaskHandoffService }
): Promise<void> {
  app.addHook('onRequest', requireLocalOrigin)
  const typed = app.withTypeProvider<TypeBoxTypeProvider>()
  typed.post(
    '/api/session-handoffs/preview',
    {
      schema: {
        tags: ['agents'],
        summary: 'Preview continuing a session in a new chat',
        body: SessionHandoffPreviewBody,
        response: { 200: HandoffSchema, ...ERROR_RESPONSES }
      }
    },
    request => handoffs.previewSession(request.body, artifactUserActor(request))
  )
  typed.post(
    '/api/tasks/:id/handoffs/preview',
    {
      schema: {
        tags: ['tasks'],
        summary: 'Preview continuing a task in a new chat',
        params: DefinitionParams,
        body: HandoffPreviewBody,
        response: { 200: HandoffSchema, ...ERROR_RESPONSES }
      }
    },
    request =>
      handoffs.preview(
        request.params.id,
        request.body,
        artifactUserActor(request)
      )
  )
  typed.get(
    '/api/task-handoffs/:id',
    {
      schema: {
        tags: ['tasks'],
        summary: 'Read handoff preparation state',
        params: DefinitionParams,
        response: { 200: HandoffSchema, ...ERROR_RESPONSES }
      }
    },
    request => handoffs.get(request.params.id, artifactUserActor(request))
  )
  typed.post(
    '/api/task-handoffs/:id/confirm',
    {
      schema: {
        tags: ['tasks'],
        summary: 'Confirm a handoff snapshot',
        params: DefinitionParams,
        body: HandoffConfirmBody,
        response: { 200: HandoffSchema, ...ERROR_RESPONSES }
      }
    },
    request =>
      handoffs.confirm(
        request.params.id,
        request.body.digest,
        artifactUserActor(request)
      )
  )
}
