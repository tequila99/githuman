import { Type, type Static } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import {
  exportAsJson,
  exportAsMarkdown,
  ExportNotFoundError
} from '../services/export.service.ts'

const ExportParams = Type.Object({ id: Type.String() })
const ExportQuery = Type.Object({
  format: Type.Union([Type.Literal('json'), Type.Literal('markdown')])
})

export interface ExportRoutesOptions {
  db: DatabaseSync
}

export async function exportRoutes(
  app: FastifyInstance,
  opts: ExportRoutesOptions
): Promise<void> {
  const { db } = opts
  const typedApp = app.withTypeProvider<TypeBoxTypeProvider>()

  typedApp.get<{
    Params: Static<typeof ExportParams>
    Querystring: Static<typeof ExportQuery>
  }>(
    '/api/reviews/:id/export',
    { schema: { params: ExportParams, querystring: ExportQuery } },
    async (request, reply) => {
      try {
        if (request.query.format === 'json') {
          return exportAsJson(db, request.params.id)
        }

        const markdown = exportAsMarkdown(db, request.params.id)
        reply.type('text/markdown')
        return markdown
      } catch (error) {
        if (error instanceof ExportNotFoundError) {
          reply.code(404)
          return { error: 'Not Found', message: error.message, statusCode: 404 }
        }
        throw error
      }
    }
  )
}
