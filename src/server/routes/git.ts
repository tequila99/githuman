import { BadRequestError } from '../errors/http.ts'
import { Type, type Static } from '@sinclair/typebox'
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

export interface GitRoutesOptions {
  repositoryPath: string
}

const TreeParams = Type.Object({
  ref: Type.String({ minLength: 1 })
})

const FileContentQuery = Type.Object({
  ref: Type.String({ minLength: 1 })
})

/** Body for `/stage` and `/unstage`: an omitted/empty `paths` means "all". */
const OptionalPathsBody = Type.Object({
  paths: Type.Optional(Type.Array(Type.String()))
})

/** Body for `/discard`: `paths` is required — no "discard everything". */
const DiscardBody = Type.Object({
  paths: Type.Array(Type.String(), { minItems: 1 })
})

export async function gitRoutes(
  app: FastifyInstance,
  opts: GitRoutesOptions
): Promise<void> {
  const { repositoryPath } = opts
  const typedApp = app.withTypeProvider<TypeBoxTypeProvider>()

  app.get('/api/git/info', async () => {
    return getRepositoryInfo(repositoryPath)
  })

  typedApp.post<{ Body: Static<typeof OptionalPathsBody> }>(
    '/api/git/stage',
    { schema: { body: OptionalPathsBody } },
    async request => {
      try {
        await stagePaths(repositoryPath, request.body.paths ?? [])
        return { ok: true }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to stage'
        throw new BadRequestError(message, { cause: err })
      }
    }
  )

  typedApp.post<{ Body: Static<typeof OptionalPathsBody> }>(
    '/api/git/unstage',
    { schema: { body: OptionalPathsBody } },
    async request => {
      try {
        await unstagePaths(repositoryPath, request.body.paths ?? [])
        return { ok: true }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to unstage'
        throw new BadRequestError(message, { cause: err })
      }
    }
  )

  typedApp.post<{ Body: Static<typeof DiscardBody> }>(
    '/api/git/discard',
    { schema: { body: DiscardBody } },
    async request => {
      try {
        await discardPaths(repositoryPath, request.body.paths)
        return { ok: true }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to discard changes'
        throw new BadRequestError(message, { cause: err })
      }
    }
  )

  typedApp.get<{ Params: Static<typeof TreeParams> }>(
    '/api/git/tree/:ref',
    { schema: { params: TreeParams } },
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

  typedApp.get<{
    Querystring: Static<typeof FileContentQuery>
    Params: { '*': string }
  }>(
    '/api/git/file/*',
    { schema: { querystring: FileContentQuery } },
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
