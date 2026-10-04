import { BadRequestError } from '../errors/http.ts'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import type { FastifyInstance } from 'fastify'
import {
  getRepositoryInfo,
  stagePaths,
  unstagePaths,
  discardPaths,
  getFilesAtRef,
  getFileAtRef
} from '../services/git.service.ts'
import {
  DiscardBody,
  FileContentQuery,
  FileContentResponseSchema,
  FileParams,
  FileTreeResponseSchema,
  OkSchema,
  OptionalPathsBody,
  RepositoryInfoSchema,
  TreeParams
} from '../../shared/git/schemas.ts'
import { ERROR_RESPONSES } from '../../shared/http/schemas.ts'

// OpenAPI group of these routes.
const TAGS = ['git']

export interface GitRoutesOptions {
  repositoryPath: string
}

export async function gitRoutes(
  app: FastifyInstance,
  opts: GitRoutesOptions
): Promise<void> {
  const { repositoryPath } = opts
  const typedApp = app.withTypeProvider<TypeBoxTypeProvider>()

  typedApp.get(
    '/api/git/info',
    {
      schema: {
        tags: TAGS,
        summary: 'Repository facts',
        response: { 200: RepositoryInfoSchema, ...ERROR_RESPONSES }
      }
    },
    async () => {
      return getRepositoryInfo(repositoryPath)
    }
  )

  typedApp.post(
    '/api/git/stage',
    {
      schema: {
        tags: TAGS,
        summary: 'Stage paths',
        body: OptionalPathsBody,
        response: { 200: OkSchema, ...ERROR_RESPONSES }
      }
    },
    async request => {
      try {
        await stagePaths(repositoryPath, request.body.paths ?? [])
        return { ok: true as const }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to stage'
        throw new BadRequestError(message, { cause: err })
      }
    }
  )

  typedApp.post(
    '/api/git/unstage',
    {
      schema: {
        tags: TAGS,
        summary: 'Unstage paths',
        body: OptionalPathsBody,
        response: { 200: OkSchema, ...ERROR_RESPONSES }
      }
    },
    async request => {
      try {
        await unstagePaths(repositoryPath, request.body.paths ?? [])
        return { ok: true as const }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to unstage'
        throw new BadRequestError(message, { cause: err })
      }
    }
  )

  typedApp.post(
    '/api/git/discard',
    {
      schema: {
        tags: TAGS,
        summary: 'Discard working-tree changes of paths',
        body: DiscardBody,
        response: { 200: OkSchema, ...ERROR_RESPONSES }
      }
    },
    async request => {
      try {
        await discardPaths(repositoryPath, request.body.paths)
        return { ok: true as const }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to discard changes'
        throw new BadRequestError(message, { cause: err })
      }
    }
  )

  typedApp.get(
    '/api/git/tree/:ref',
    {
      schema: {
        tags: TAGS,
        summary: 'List files at a ref',
        params: TreeParams,
        response: { 200: FileTreeResponseSchema, ...ERROR_RESPONSES }
      }
    },
    async request => {
      const { ref } = request.params

      try {
        const files = await getFilesAtRef(repositoryPath, ref)
        return { ref, files }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to list files'
        throw new BadRequestError(message, { cause: err })
      }
    }
  )

  typedApp.get(
    '/api/git/file/*',
    {
      schema: {
        tags: TAGS,
        summary: 'Read one file at a ref',
        params: FileParams,
        querystring: FileContentQuery,
        response: { 200: FileContentResponseSchema, ...ERROR_RESPONSES }
      }
    },
    async request => {
      const filePath = request.params['*']
      const { ref } = request.query

      if (!filePath) {
        throw new BadRequestError('File path is required')
      }

      let content: string
      let isBinary: boolean
      try {
        ;({ content, isBinary } = await getFileAtRef(
          repositoryPath,
          ref,
          filePath
        ))
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to read file'
        throw new BadRequestError(message, { cause: err })
      }
      const lines = isBinary ? [] : content.split('\n')

      return {
        path: filePath,
        ref,
        content,
        lines,
        lineCount: lines.length,
        isBinary
      }
    }
  )
}
