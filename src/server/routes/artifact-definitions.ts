import type { FastifyInstance } from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { ArtifactChangeSetPreviewSchema } from '../../shared/artifacts/schemas.ts'
import {
  TaskSchema,
  TaskCreateBody,
  TaskUpdateBody,
  TaskListSchema,
  ArtifactTypeSchema,
  ArtifactTypeCreateBody,
  ArtifactTypeUpdateBody,
  ArtifactTypeListSchema,
  DefinitionParams,
  DefinitionQuery,
  definitionHistoryPageSchema,
  SessionTaskBody,
  SessionTaskSchema,
  TaskChatLinksPageSchema,
  TaskChatHistorySchema
} from '../../shared/tasks/schemas.ts'
import { ERROR_RESPONSES } from '../../shared/http/schemas.ts'
import { artifactUserActor } from '../utils/artifact-actor.ts'
import type { ArtifactStorageService } from '../services/artifact-storage.service.ts'
import {
  ArtifactAncestrySchema,
  ArtifactGraphPageSchema,
  GraphPageQuery,
  ArtifactChangeSetSchema
} from '../../shared/artifacts/schemas.ts'

const response = (schema: typeof TaskSchema | typeof ArtifactTypeSchema) => ({
  200: schema,
  ...ERROR_RESPONSES
})

export async function artifactDefinitionRoutes(
  app: FastifyInstance,
  { storage }: { storage: ArtifactStorageService }
): Promise<void> {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>()
  typed.get(
    '/api/tasks',
    {
      schema: {
        tags: ['tasks'],
        summary: 'List persistent tasks',
        querystring: DefinitionQuery,
        response: { 200: TaskListSchema, ...ERROR_RESPONSES }
      }
    },
    request =>
      storage.tasks.list(
        request.query.limit,
        request.query.cursor,
        request.query.search
      )
  )
  typed.get(
    '/api/tasks/:id',
    {
      schema: {
        tags: ['tasks'],
        summary: 'Read a task',
        params: DefinitionParams,
        response: response(TaskSchema)
      }
    },
    request => storage.tasks.get(request.params.id)
  )
  typed.post(
    '/api/tasks',
    {
      schema: {
        tags: ['tasks'],
        summary: 'Create a minimal task',
        body: TaskCreateBody,
        response: response(TaskSchema)
      }
    },
    request =>
      storage.tasks.create(
        request.body.requestId,
        request.body.input,
        artifactUserActor(request)
      )
  )
  typed.patch(
    '/api/tasks/:id',
    {
      schema: {
        tags: ['tasks'],
        summary: 'Update a task definition with version checking',
        params: DefinitionParams,
        body: TaskUpdateBody,
        response: response(TaskSchema)
      }
    },
    request =>
      storage.tasks.update(
        request.params.id,
        request.body.requestId,
        request.body.expectedVersion,
        request.body.input,
        artifactUserActor(request)
      )
  )
  typed.get(
    '/api/tasks/:id/history',
    {
      schema: {
        tags: ['tasks'],
        summary: 'Read task definition history',
        params: DefinitionParams,
        querystring: DefinitionQuery,
        response: {
          200: definitionHistoryPageSchema(TaskSchema),
          ...ERROR_RESPONSES
        }
      }
    },
    request =>
      storage.tasks.historyPage(
        request.params.id,
        request.query.limit,
        request.query.cursor
      )
  )
  typed.get(
    '/api/tasks/:id/sessions',
    {
      schema: {
        tags: ['tasks'],
        summary: 'Read task session links including unavailable sessions',
        params: DefinitionParams,
        querystring: DefinitionQuery,
        response: { 200: TaskChatLinksPageSchema, ...ERROR_RESPONSES }
      }
    },
    request =>
      storage.tasks.linksPage(
        request.params.id,
        request.query.limit,
        request.query.cursor
      )
  )
  typed.get(
    '/api/tasks/:id/sessions/history',
    {
      schema: {
        tags: ['tasks'],
        summary: 'Read persistent task-session link history',
        params: DefinitionParams,
        querystring: DefinitionQuery,
        response: { 200: TaskChatHistorySchema, ...ERROR_RESPONSES }
      }
    },
    request =>
      storage.tasks.linkHistoryPage(
        request.params.id,
        request.query.limit,
        request.query.cursor
      )
  )
  typed.get(
    '/api/tasks/sessions/:id',
    {
      schema: {
        tags: ['tasks'],
        summary: 'Read live session task assignment',
        params: DefinitionParams,
        response: { 200: SessionTaskSchema, ...ERROR_RESPONSES }
      }
    },
    request => storage.tasks.assignment(request.params.id)
  )
  typed.patch(
    '/api/tasks/sessions/:id',
    {
      schema: {
        tags: ['tasks'],
        summary: 'Assign tasks to a live server session',
        params: DefinitionParams,
        body: SessionTaskBody,
        response: { 200: SessionTaskSchema, ...ERROR_RESPONSES }
      }
    },
    request =>
      storage.tasks.assignSession(
        request.params.id,
        request.body,
        artifactUserActor(request)
      )
  )
  typed.get(
    '/api/artifact-types',
    {
      schema: {
        tags: ['artifacts'],
        summary: 'List artifact types including inactive definitions',
        querystring: DefinitionQuery,
        response: { 200: ArtifactTypeListSchema, ...ERROR_RESPONSES }
      }
    },
    request =>
      storage.types.list(
        request.query.limit,
        request.query.cursor,
        request.query.search
      )
  )
  typed.get(
    '/api/artifact-types/:id',
    {
      schema: {
        tags: ['artifacts'],
        summary: 'Read an artifact type',
        params: DefinitionParams,
        response: response(ArtifactTypeSchema)
      }
    },
    request => storage.types.get(request.params.id)
  )
  typed.post(
    '/api/artifact-types',
    {
      schema: {
        tags: ['artifacts'],
        summary: 'Create an artifact type',
        body: ArtifactTypeCreateBody,
        response: response(ArtifactTypeSchema)
      }
    },
    request =>
      storage.types.create(
        request.body.requestId,
        request.body.id,
        request.body.input,
        artifactUserActor(request)
      )
  )
  typed.patch(
    '/api/artifact-types/:id',
    {
      schema: {
        tags: ['artifacts'],
        summary: 'Update an artifact type without removing its history',
        params: DefinitionParams,
        body: ArtifactTypeUpdateBody,
        response: response(ArtifactTypeSchema)
      }
    },
    request =>
      storage.types.update(
        request.params.id,
        request.body.requestId,
        request.body.expectedVersion,
        request.body.input,
        artifactUserActor(request)
      )
  )
  typed.get(
    '/api/artifact-types/:id/history',
    {
      schema: {
        tags: ['artifacts'],
        summary: 'Read artifact type history',
        params: DefinitionParams,
        querystring: DefinitionQuery,
        response: {
          200: definitionHistoryPageSchema(ArtifactTypeSchema),
          ...ERROR_RESPONSES
        }
      }
    },
    request =>
      storage.types.historyPage(
        request.params.id,
        request.query.limit,
        request.query.cursor
      )
  )
  typed.get(
    '/api/artifacts/:id/relations',
    {
      schema: {
        tags: ['artifacts'],
        summary: 'Read forward or reverse graph edges',
        params: DefinitionParams,
        querystring: GraphPageQuery,
        response: { 200: ArtifactGraphPageSchema, ...ERROR_RESPONSES }
      }
    },
    request => storage.graph.relations(request.params.id, request.query)
  )
  typed.get(
    '/api/artifacts/:id/ancestry',
    {
      schema: {
        tags: ['artifacts'],
        summary: 'Read immutable revision ancestry',
        params: DefinitionParams,
        querystring: DefinitionQuery,
        response: { 200: ArtifactAncestrySchema, ...ERROR_RESPONSES }
      }
    },
    request =>
      storage.graph.ancestry(
        request.params.id,
        request.query.limit,
        request.query.cursor
      )
  )
  typed.post(
    '/api/artifacts/change-sets/preview',
    {
      schema: {
        tags: ['artifacts'],
        summary: 'Preview a canonical change set without applying it',
        body: ArtifactChangeSetSchema,
        response: { 200: ArtifactChangeSetPreviewSchema, ...ERROR_RESPONSES }
      }
    },
    request => storage.graph.previewChangeSet(request.body)
  )
}
