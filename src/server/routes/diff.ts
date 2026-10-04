import { BadRequestError } from '../errors/http.ts'
import { Type, type Static } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import type { FastifyInstance } from 'fastify'
import {
  getStagedDiff,
  getUnstagedDiff,
  getBranchDiff,
  getCommitsDiff,
  getDiffSummaries,
  getFileDiff
} from '../services/diff.service.ts'
import { resolveWithinRepo } from '../services/git.service.ts'
import { errorMessage } from '../../shared/utils/error-message.ts'

const BranchQuery = Type.Object({
  base: Type.String({ minLength: 1 })
})

const CommitsQuery = Type.Object({
  from: Type.String({ minLength: 1 }),
  to: Type.String({ minLength: 1 })
})

const SourceParams = Type.Object({
  source: Type.Union([Type.Literal('staged'), Type.Literal('unstaged')])
})

const FileQuery = Type.Object({
  path: Type.String({ minLength: 1 }),
  oldPath: Type.Optional(Type.String({ minLength: 1 })),
  status: Type.Union([
    Type.Literal('added'),
    Type.Literal('modified'),
    Type.Literal('deleted'),
    Type.Literal('renamed')
  ])
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

  // Files without hunks, then one file with hunks: the list stays small (ADR 0033).
  typedApp.get<{ Params: Static<typeof SourceParams> }>(
    '/api/diff/:source/files',
    { schema: { params: SourceParams } },
    async request => getDiffSummaries(repositoryPath, request.params.source)
  )

  typedApp.get<{
    Params: Static<typeof SourceParams>
    Querystring: Static<typeof FileQuery>
  }>(
    '/api/diff/:source/file',
    { schema: { params: SourceParams, querystring: FileQuery } },
    async request => {
      const { path, oldPath, status } = request.query
      // Only a path outside the repository is a bad request. Other errors stay server errors.
      try {
        resolveWithinRepo(repositoryPath, path)
        if (oldPath !== undefined) resolveWithinRepo(repositoryPath, oldPath)
      } catch (err) {
        throw new BadRequestError(errorMessage(err), { cause: err })
      }
      return getFileDiff(repositoryPath, request.params.source, {
        oldPath: oldPath ?? path,
        newPath: path,
        status
      })
    }
  )

  typedApp.get<{ Querystring: Static<typeof BranchQuery> }>(
    '/api/diff/branch',
    { schema: { querystring: BranchQuery } },
    async request => {
      try {
        return await getBranchDiff(repositoryPath, request.query.base)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Bad ref'
        throw new BadRequestError(message, { cause: err })
      }
    }
  )

  typedApp.get<{ Querystring: Static<typeof CommitsQuery> }>(
    '/api/diff/commits',
    { schema: { querystring: CommitsQuery } },
    async request => {
      try {
        return await getCommitsDiff(
          repositoryPath,
          request.query.from,
          request.query.to
        )
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Bad ref'
        throw new BadRequestError(message, { cause: err })
      }
    }
  )
}
