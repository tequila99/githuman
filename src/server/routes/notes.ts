import { NotesExternalAssetsService } from '../services/notes-external-assets.service.ts'
import {
  InspectExternalAssetBody,
  PreviewExternalAssetBody,
  ImportExternalAssetBody,
  ExternalAssetInspectionSchema,
  ExternalAssetResultSchema
} from '../../shared/notes/schemas.ts'
import type { FastifyInstance } from 'fastify'
import multipart, { type MultipartFile } from '@fastify/multipart'
import { MAX_NOTE_ASSET_BYTES } from '../../shared/notes/constants.ts'
import { noteAssetFormat } from '../../shared/notes/asset-formats.ts'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import {
  NoteRecordSchema,
  NoteIdQuery,
  NoteDescriptorSchema,
  NoteResolveBody,
  NoteResolutionSchema,
  NoteGraphSchema,
  ResolveIdentityBody,
  NoteMutationSchema,
  UploadNoteAssetBody,
  NoteAssetSchema,
  NoteAssetContentSchema,
  NoteAssetParams,
  NoteQuery,
  NoteSchema,
  NotesIndexSchema,
  CreateNoteBody,
  SaveNoteBody,
  RenameNoteBody,
  CreateFolderBody
} from '../../shared/notes/schemas.ts'
import { ERROR_RESPONSES, NoContentSchema } from '../../shared/http/schemas.ts'
import type { NotesService } from '../services/notes.service.ts'
import { BadRequestError } from '../errors/http.ts'
import { withRequestSignal } from '../utils/request-abort.ts'
import { requireNotesOrigin } from '../hooks/notes/same-origin.ts'

export async function notesRoutes(
  app: FastifyInstance,
  {
    service,
    externalAssets = new NotesExternalAssetsService()
  }: {
    service: NotesService
    externalAssets?: NotesExternalAssetsService
  }
) {
  await app.register(multipart, {
    attachFieldsToBody: true,
    limits: { fileSize: MAX_NOTE_ASSET_BYTES, files: 1, fields: 0, parts: 1 }
  })
  const typed = app.withTypeProvider<TypeBoxTypeProvider>()
  app.addHook('onRequest', requireNotesOrigin)
  app.post<{ Body: { file: MultipartFile } }>(
    '/api/notes/assets',
    {
      preValidation: async request => {
        if (!request.isMultipart()) {
          throw new BadRequestError('Expected multipart/form-data')
        }
      },
      schema: {
        consumes: ['multipart/form-data'],
        tags: ['notes'],
        summary: 'Store a note image',
        // The multipart validator rewrites file schemas during compilation.
        body: structuredClone(UploadNoteAssetBody),
        response: { 201: NoteAssetSchema, ...ERROR_RESPONSES }
      }
    },
    async (request, reply) => {
      const asset = await service.uploadAsset(
        await request.body.file.toBuffer()
      )
      reply.code(201)
      return asset
    }
  )
  typed.post(
    '/api/notes/assets/inspect',
    {
      schema: {
        tags: ['notes'],
        summary: 'Inspect an external attachment',
        body: InspectExternalAssetBody,
        response: { 200: ExternalAssetInspectionSchema, ...ERROR_RESPONSES }
      }
    },
    (request, reply) =>
      withRequestSignal(reply, signal =>
        externalAssets.inspect(request.body.url, signal)
      )
  )
  typed.post(
    '/api/notes/assets/import',
    {
      schema: {
        tags: ['notes'],
        summary: 'Import an external attachment',
        body: ImportExternalAssetBody,
        response: { 200: ExternalAssetResultSchema, ...ERROR_RESPONSES }
      }
    },
    (request, reply) =>
      withRequestSignal(reply, signal =>
        externalAssets.importAsset(
          request.body,
          signal,
          (chunks, extension, saveSignal) =>
            service.importAsset(chunks, extension, saveSignal)
        )
      )
  )
  // The typed provider rejects a binary payload for the content schema.
  app.post<{ Body: { url: string } }>(
    '/api/notes/assets/preview',
    {
      schema: {
        tags: ['notes'],
        summary: 'Preview an external image',
        body: PreviewExternalAssetBody,
        response: { 200: NoteAssetContentSchema, ...ERROR_RESPONSES }
      }
    },
    async (request, reply) => {
      const preview = await withRequestSignal(reply, signal =>
        externalAssets.preview(request.body.url, signal)
      )
      reply
        .header('Cache-Control', 'no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .type(preview.mime)
      return reply.send(preview.body)
    }
  )
  app.get<{ Params: { id: string } }>(
    '/api/notes/assets/:id',
    {
      schema: {
        tags: ['notes'],
        summary: 'Read a stored note attachment',
        params: NoteAssetParams,
        response: { 200: NoteAssetContentSchema, ...ERROR_RESPONSES }
      }
    },
    async (request, reply) => {
      const image = await service.readAsset(request.params.id)
      const extension = request.params.id.split('.').at(-1)
      const format = noteAssetFormat(extension)
      if (!format) throw new BadRequestError('Unsupported attachment format')
      reply.type(format.mime)
      reply.header('X-Content-Type-Options', 'nosniff')
      return reply.send(image)
    }
  )
  typed.get(
    '/api/notes',
    {
      schema: {
        tags: ['notes'],
        summary: 'List project notes',
        response: { 200: NotesIndexSchema, ...ERROR_RESPONSES }
      }
    },
    () => service.index()
  )
  typed.get(
    '/api/notes/path',
    {
      schema: {
        tags: ['notes'],
        summary: 'Resolve a current or historical note path',
        querystring: NoteQuery,
        response: { 200: NoteRecordSchema, ...ERROR_RESPONSES }
      }
    },
    request => service.identity.resolvePath(request.query.path)
  )
  typed.get(
    '/api/notes/identity',
    {
      schema: {
        tags: ['notes'],
        summary: 'Read a stable note identity and backlinks',
        querystring: NoteIdQuery,
        response: { 200: NoteDescriptorSchema, ...ERROR_RESPONSES }
      }
    },
    request =>
      service.identity.descriptor(request.query.id, request.query.storageId)
  )
  typed.get(
    '/api/notes/by-id',
    {
      schema: {
        tags: ['notes'],
        summary: 'Read a note by stable identity',
        querystring: NoteIdQuery,
        response: { 200: NoteSchema, ...ERROR_RESPONSES }
      }
    },
    request =>
      service.identity.readId(request.query.id, request.query.storageId)
  )
  typed.get(
    '/api/notes/graph',
    {
      schema: {
        tags: ['notes'],
        summary: 'Read the graph of note relationships',
        response: { 200: NoteGraphSchema, ...ERROR_RESPONSES }
      }
    },
    () => service.identity.graph()
  )
  typed.post(
    '/api/notes/resolve',
    {
      schema: {
        tags: ['notes'],
        summary: 'Resolve an occurrence in the current note source',
        body: NoteResolveBody,
        response: { 200: NoteResolutionSchema, ...ERROR_RESPONSES }
      }
    },
    request =>
      service.identity.resolve(
        request.body.sourceId,
        request.body.storageId,
        request.body.text,
        request.body.href,
        request.body.occurrence
      )
  )
  typed.post(
    '/api/notes/identity/resolve',
    {
      schema: {
        tags: ['notes'],
        summary: 'Resolve a restored or moved file identity',
        body: ResolveIdentityBody,
        response: { 204: NoContentSchema, ...ERROR_RESPONSES }
      }
    },
    async (request, reply) => {
      await service.identity.resolveIdentity(
        request.body.issueId,
        request.body.restore,
        request.body.candidateId
      )
      reply.code(204).send(null)
    }
  )
  typed.post(
    '/api/notes/repair',
    {
      schema: {
        tags: ['notes'],
        summary: 'Retry pending link repairs',
        response: { 204: NoContentSchema, ...ERROR_RESPONSES }
      }
    },
    async (_request, reply) => {
      await service.identity.retry()
      reply.code(204).send(null)
    }
  )
  typed.get(
    '/api/notes/document',
    {
      schema: {
        tags: ['notes'],
        summary: 'Read a note',
        querystring: NoteQuery,
        response: { 200: NoteSchema, ...ERROR_RESPONSES }
      }
    },
    request => service.read(request.query.path)
  )
  typed.post(
    '/api/notes/document',
    {
      schema: {
        tags: ['notes'],
        summary: 'Create a note',
        body: CreateNoteBody,
        response: { 201: NoteSchema, ...ERROR_RESPONSES }
      }
    },
    async (request, reply) => {
      const note = await service.save(request.body.path, request.body.text)
      reply.code(201)
      return note
    }
  )
  typed.patch(
    '/api/notes/document',
    {
      schema: {
        tags: ['notes'],
        summary: 'Save a note if its version matches',
        body: SaveNoteBody,
        response: { 200: NoteSchema, ...ERROR_RESPONSES }
      }
    },
    request =>
      service.save(
        request.body.path,
        request.body.text,
        request.body.version,
        request.body.id,
        request.body.storageId
      )
  )
  typed.post(
    '/api/notes/delete',
    {
      schema: {
        tags: ['notes'],
        summary: 'Hide a note without removing its file',
        body: NoteIdQuery,
        response: { 204: NoContentSchema, ...ERROR_RESPONSES }
      }
    },
    async (request, reply) => {
      await service.delete(request.body.id, request.body.storageId)
      reply.code(204).send(null)
    }
  )
  typed.post(
    '/api/notes/rename',
    {
      schema: {
        tags: ['notes'],
        summary: 'Rename a note or folder',
        body: RenameNoteBody,
        response: { 200: NoteMutationSchema, ...ERROR_RESPONSES }
      }
    },
    async request => {
      return service.rename(
        request.body.path,
        request.body.name,
        request.body.folder,
        request.body.target,
        request.body.id,
        request.body.revision
      )
    }
  )
  typed.post(
    '/api/notes/folder',
    {
      schema: {
        tags: ['notes'],
        summary: 'Create a notes folder',
        body: CreateFolderBody,
        response: { 204: NoContentSchema, ...ERROR_RESPONSES }
      }
    },
    async (request, reply) => {
      await service.folder(request.body.path)
      reply.code(204).send(null)
    }
  )
}
