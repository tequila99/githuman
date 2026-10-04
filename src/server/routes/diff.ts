import { BadRequestError } from '../errors/http.ts'
import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import type { FastifyInstance } from 'fastify'
import {
  getBranchDiff,
  getCommitsDiff,
  getDiffSummaries,
  getFileDiff
} from '../services/diff.service.ts'
import { resolveWithinRepo } from '../services/git.service.ts'
import { errorMessage } from '../../shared/utils/error-message.ts'
import {
  BranchQuery,
  CommitsQuery,
  DiffFileSchema,
  DiffFileSummarySchema,
  FileQuery,
  SourceParams
} from '../../shared/diff/schemas.ts'
import { ERROR_RESPONSES } from '../../shared/http/schemas.ts'

// OpenAPI group of these routes.
const TAGS = ['diff']

export interface DiffRoutesOptions {
  repositoryPath: string
}

export async function diffRoutes(
  app: FastifyInstance,
  opts: DiffRoutesOptions
): Promise<void> {
  const { repositoryPath } = opts
  const typedApp = app.withTypeProvider<TypeBoxTypeProvider>()

  // Files without hunks, then one file with hunks: the list stays small (ADR 0033).
  typedApp.get(
    '/api/diff/:source/files',
    {
      schema: {
        tags: TAGS,
        summary: 'List changed files without hunks',
        params: SourceParams,
        response: {
          200: Type.Array(DiffFileSummarySchema, {
            description: 'Changed files of the side.'
          }),
          ...ERROR_RESPONSES
        }
      }
    },
    async request => getDiffSummaries(repositoryPath, request.params.source)
  )

  typedApp.get(
    '/api/diff/:source/file',
    {
      schema: {
        tags: TAGS,
        summary: 'Get one changed file with hunks',
        params: SourceParams,
        querystring: FileQuery,
        response: {
          200: { ...DiffFileSchema, description: 'The file with its hunks.' },
          ...ERROR_RESPONSES
        }
      }
    },
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

  typedApp.get(
    '/api/diff/branch',
    {
      schema: {
        tags: TAGS,
        summary: 'Diff of HEAD against a ref',
        description: 'No UI calls it yet. It is kept for branch reviews.',
        querystring: BranchQuery,
        response: {
          200: Type.Array(DiffFileSchema, {
            description: 'Changed files with hunks.'
          }),
          ...ERROR_RESPONSES
        }
      }
    },
    async request => {
      try {
        return await getBranchDiff(repositoryPath, request.query.base)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Bad ref'
        throw new BadRequestError(message, { cause: err })
      }
    }
  )

  typedApp.get(
    '/api/diff/commits',
    {
      schema: {
        tags: TAGS,
        summary: 'Diff between two refs',
        description: 'No UI calls it yet. It is kept for commit reviews.',
        querystring: CommitsQuery,
        response: {
          200: Type.Array(DiffFileSchema, {
            description: 'Changed files with hunks.'
          }),
          ...ERROR_RESPONSES
        }
      }
    },
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
