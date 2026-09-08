import { Type, type Static } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import type { FastifyInstance } from 'fastify'
import {
  getStagedDiff,
  getUnstagedDiff,
  getBranchDiff,
  getCommitsDiff
} from '../services/diff.service.ts'

const BranchQuery = Type.Object({
  base: Type.String({ minLength: 1 })
})

const CommitsQuery = Type.Object({
  from: Type.String({ minLength: 1 }),
  to: Type.String({ minLength: 1 })
})

export interface DiffRoutesOptions {
  repositoryPath: string
}

export async function diffRoutes(
  app: FastifyInstance,
  opts: DiffRoutesOptions
): Promise<void> {
  const { repositoryPath } = opts
  const typedApp = app.withTypeProvider<TypeBoxTypeProvider>()

  typedApp.get('/api/diff/staged', async () => {
    return getStagedDiff(repositoryPath)
  })

  typedApp.get('/api/diff/unstaged', async () => {
    return getUnstagedDiff(repositoryPath)
  })

  typedApp.get<{ Querystring: Static<typeof BranchQuery> }>(
    '/api/diff/branch',
    { schema: { querystring: BranchQuery } },
    async (request, reply) => {
      try {
        return await getBranchDiff(repositoryPath, request.query.base)
      } catch (err) {
        reply.code(400)
        const message = err instanceof Error ? err.message : 'Bad ref'
        return { error: 'Bad Request', message, statusCode: 400 }
      }
    }
  )

  typedApp.get<{ Querystring: Static<typeof CommitsQuery> }>(
    '/api/diff/commits',
    { schema: { querystring: CommitsQuery } },
    async (request, reply) => {
      try {
        return await getCommitsDiff(
          repositoryPath,
          request.query.from,
          request.query.to
        )
      } catch (err) {
        reply.code(400)
        const message = err instanceof Error ? err.message : 'Bad ref'
        return { error: 'Bad Request', message, statusCode: 400 }
      }
    }
  )
}
