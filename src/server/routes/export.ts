import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import { exportAsJson, exportAsMarkdown } from '../services/export.service.ts'
import {
  ExportQuery,
  ReviewExportSchema,
  ReviewIdParams
} from '../../shared/reviews/schemas.ts'
import { ERROR_RESPONSES } from '../../shared/http/schemas.ts'

export interface ExportRoutesOptions {
  db: DatabaseSync
  /** Working tree full-file comments are read from (see exportAsMarkdown). */
  repositoryPath: string
}

export async function exportRoutes(
  app: FastifyInstance,
  opts: ExportRoutesOptions
): Promise<void> {
  const { db, repositoryPath } = opts
  const typedApp = app.withTypeProvider<TypeBoxTypeProvider>()

  typedApp.get(
    '/api/reviews/:id/export',
    {
      schema: {
        tags: ['reviews'],
        summary: 'Export a review with its comments',
        params: ReviewIdParams,
        querystring: ExportQuery,
        response: {
          200: {
            description: 'The review as JSON or as a markdown report.',
            content: {
              'application/json': { schema: ReviewExportSchema },
              'text/markdown': {
                schema: Type.String({ description: 'Markdown report.' })
              }
            }
          },
          ...ERROR_RESPONSES
        }
      }
    },
    async (request, reply) => {
      if (request.query.format === 'json') {
        return exportAsJson(db, request.params.id)
      }

      const markdown = await exportAsMarkdown(
        db,
        request.params.id,
        repositoryPath
      )
      reply.type('text/markdown')
      return markdown
    }
  )
}
