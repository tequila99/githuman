import { Type, type Static } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import { exportAsJson, exportAsMarkdown } from '../services/export.service.ts'

const ExportParams = Type.Object({ id: Type.String() })
const ExportQuery = Type.Object({
  format: Type.Union([Type.Literal('json'), Type.Literal('markdown')])
})

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

  typedApp.get<{
    Params: Static<typeof ExportParams>
    Querystring: Static<typeof ExportQuery>
  }>(
    '/api/reviews/:id/export',
    { schema: { params: ExportParams, querystring: ExportQuery } },
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
