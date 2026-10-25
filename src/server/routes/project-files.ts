import { Server as HttpsServer } from 'node:https'
import { Readable } from 'node:stream'
import type { FastifyInstance } from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { Type, type Static } from '@sinclair/typebox'
import { ProjectFilesService } from '../services/project-files.service.ts'
import { BadRequestError } from '../errors/http.ts'
import {
  ProjectFileQuery,
  ProjectFileContentQuery,
  ProjectFileMetadataSchema,
  ProjectFileContextSchema
} from '../../shared/project-files/schemas.ts'
import { PROJECT_DOWNLOAD_MIME } from '../../shared/project-files/constants.ts'
import { ERROR_RESPONSES } from '../../shared/http/schemas.ts'

// Hosts that a browser on this machine uses to reach the server.
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]']
// File name that old clients show when they ignore the UTF-8 file name.
const FALLBACK_FILE_NAME = 'download'
// Characters that encodeURIComponent keeps but RFC 5987 does not allow.
const RFC5987_RESERVED_PATTERN = /['()*]/g
// OpenAPI groups file access separately from Git history.
const TAGS = ['project-files']

function contentDisposition(name: string, download: boolean): string {
  const encoded = encodeURIComponent(name).replace(
    RFC5987_RESERVED_PATTERN,
    char => '%' + char.charCodeAt(0).toString(16)
  )
  return `${download ? 'attachment' : 'inline'}; filename="${FALLBACK_FILE_NAME}"; filename*=UTF-8''${encoded}`
}

export async function projectFileRoutes(
  app: FastifyInstance,
  options: { repositoryPath: string }
) {
  const service = new ProjectFilesService(options.repositoryPath)
  const typed = app.withTypeProvider<TypeBoxTypeProvider>()
  typed.get(
    '/api/project-files/context',
    {
      schema: {
        tags: TAGS,
        summary: 'Trusted file-link origins',
        response: { 200: ProjectFileContextSchema, ...ERROR_RESPONSES }
      }
    },
    async () => {
      const address = app.server.address()
      const origins =
        address && typeof address !== 'string'
          ? LOOPBACK_HOSTS.map(
              host =>
                `${app.server instanceof HttpsServer ? 'https' : 'http'}://${host}:${address.port}`
            )
          : []
      return { origins }
    }
  )
  typed.get(
    '/api/project-files/metadata',
    {
      schema: {
        tags: TAGS,
        summary: 'Inspect a project file',
        querystring: ProjectFileQuery,
        response: { 200: ProjectFileMetadataSchema, ...ERROR_RESPONSES }
      }
    },
    async request => {
      const { file, metadata } = await service.open(request.query.path)
      await file.close()
      return metadata
    }
  )
  app.get<{ Querystring: Static<typeof ProjectFileContentQuery> }>(
    '/api/project-files/content',
    {
      schema: {
        tags: TAGS,
        summary: 'Read or download a project file',
        querystring: ProjectFileContentQuery,
        response: {
          200: Type.String({ format: 'binary', description: 'File bytes.' }),
          ...ERROR_RESPONSES
        }
      }
    },
    async (request, reply) => {
      const { file, metadata, limit } = await service.open(request.query.path)
      const download = request.query.download === true
      if (!download && !metadata.previewable) {
        await file.close()
        throw new BadRequestError(
          'File cannot be previewed; download it instead'
        )
      }
      reply.header('X-Content-Type-Options', 'nosniff')
      reply.header('Cache-Control', 'no-store')
      reply.header(
        'Content-Disposition',
        contentDisposition(metadata.name, download)
      )
      reply.type(download ? PROJECT_DOWNLOAD_MIME : metadata.mime)
      const source = file.createReadStream({ start: 0 })
      const stream = Readable.from(
        (async function* () {
          let bytes = 0
          for await (const chunk of source) {
            bytes += chunk.length
            if (!download && bytes > limit) {
              throw new BadRequestError('File grew beyond the preview limit')
            }
            yield chunk
          }
        })()
      )
      // Fastify owns stream errors; a disconnected client stops disk reads.
      const close = () => {
        stream.destroy()
        source.destroy()
      }
      reply.raw.once('close', close)
      stream.once('close', () => reply.raw.removeListener('close', close))
      return reply.send(stream)
    }
  )
}
