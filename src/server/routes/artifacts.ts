import type { FastifyInstance } from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import {
  ArtifactSearchBody,
  ArtifactSearchQuery,
  ArtifactSearchSchema,
  ArtifactSearchDiagnosticsSchema,
  ArtifactContentQuery,
  ArtifactContentSchema,
  ArtifactHistoryQuery,
  ArtifactHistorySchema,
  ArtifactListQuery,
  ArtifactListSchema,
  ArtifactParams,
  ArtifactSchema
} from '../../shared/artifacts/schemas.ts'
import { ERROR_RESPONSES } from '../../shared/http/schemas.ts'
import type { ArtifactStorageService } from '../services/artifact-storage.service.ts'

export async function artifactRoutes(
  app: FastifyInstance,
  { service }: { service: ArtifactStorageService }
): Promise<void> {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>()
  typed.get(
    '/api/artifacts/search',
    {
      schema: {
        tags: ['artifacts'],
        summary: 'Search verified artifact titles and body text',
        querystring: ArtifactSearchQuery,
        response: { 200: ArtifactSearchSchema, ...ERROR_RESPONSES }
      }
    },
    request => {
      const { status, typeId, taskId, tag, ...query } = request.query
      return service.search.search({
        ...query,
        filters: {
          ...(status ? { statuses: [status] } : {}),
          ...(typeId ? { typeIds: [typeId] } : {}),
          ...(taskId ? { taskIds: [taskId] } : {}),
          ...(tag ? { tags: [tag] } : {})
        }
      })
    }
  )
  typed.post(
    '/api/artifacts/search',
    {
      schema: {
        tags: ['artifacts'],
        summary: 'Search with multiple metadata filters',
        body: ArtifactSearchBody,
        response: { 200: ArtifactSearchSchema, ...ERROR_RESPONSES }
      }
    },
    request => service.search.search(request.body)
  )
  typed.get(
    '/api/artifacts/search/diagnostics',
    {
      schema: {
        tags: ['artifacts'],
        summary: 'Read derived search index diagnostics',
        response: { 200: ArtifactSearchDiagnosticsSchema, ...ERROR_RESPONSES }
      }
    },
    () => service.search.diagnostics()
  )
  typed.get(
    '/api/artifacts',
    {
      schema: {
        tags: ['artifacts'],
        summary: 'List committed artifacts',
        querystring: ArtifactListQuery,
        response: { 200: ArtifactListSchema, ...ERROR_RESPONSES }
      }
    },
    request => service.list(request.query.limit, request.query.cursor)
  )
  typed.get(
    '/api/artifacts/:id',
    {
      schema: {
        tags: ['artifacts'],
        summary: 'Read current artifact metadata',
        params: ArtifactParams,
        response: { 200: ArtifactSchema, ...ERROR_RESPONSES }
      }
    },
    request => service.get(request.params.id)
  )
  typed.get(
    '/api/artifacts/:id/content',
    {
      schema: {
        tags: ['artifacts'],
        summary: 'Read verified immutable artifact content',
        params: ArtifactParams,
        querystring: ArtifactContentQuery,
        response: { 200: ArtifactContentSchema, ...ERROR_RESPONSES }
      }
    },
    request =>
      service.readContent(
        request.params.id,
        request.query.offset,
        request.query.limit
      )
  )
  typed.get(
    '/api/artifacts/:id/history',
    {
      schema: {
        tags: ['artifacts'],
        summary: 'Read immutable artifact history',
        params: ArtifactParams,
        querystring: ArtifactHistoryQuery,
        response: { 200: ArtifactHistorySchema, ...ERROR_RESPONSES }
      }
    },
    request =>
      service.history(
        request.params.id,
        request.query.afterSeq,
        request.query.limit
      )
  )
}
