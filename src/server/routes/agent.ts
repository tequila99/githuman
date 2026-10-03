import { NotFoundError } from '../errors/http.ts'
import type { Static } from '@sinclair/typebox'
import {
  SessionParams,
  PermissionParams,
  CreateSessionBody,
  AutoApproveBody,
  FileSearchQuery,
  PromptBody,
  PermissionBody,
  ConfigBody
} from '../../shared/agents/schemas.ts'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import type { EventBus } from '../event-bus.ts'
import { buildPromptBlocks } from '../services/agent/context-builder.ts'
import {
  MAX_ATTACHMENT_BYTES,
  DEFAULT_FILE_SEARCH_LIMIT
} from '../../shared/agents/constants.ts'
import { createFileIndex } from '../services/agent/file-index.ts'
import { safeSend } from '../utils/sse.ts'
import { requireLocalOrigin } from '../hooks/agents/local-origin.ts'
import { type AgentSessionRegistry } from '../services/agent/session-registry.ts'
import { findReviewById } from '../repositories/review.repo.ts'

/** Room for a handful of max-size base64 attachments; the schema caps each one. */
const PROMPT_BODY_LIMIT =
  5 * Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 1024 * 1024
export interface AgentRoutesOptions {
  registry: AgentSessionRegistry
  db: DatabaseSync
  repositoryPath: string
  /** Tells the file search when its cached file list went stale. */
  eventBus: EventBus
}

export async function agentRoutes(
  app: FastifyInstance,
  opts: AgentRoutesOptions
): Promise<void> {
  const { registry, db, repositoryPath, eventBus } = opts
  const typedApp = app.withTypeProvider<TypeBoxTypeProvider>()
  const fileIndex = createFileIndex(repositoryPath, eventBus)

  app.addHook('onRequest', requireLocalOrigin)
  app.addHook('onClose', async () => {
    registry.closeAll()
    fileIndex.close()
  })

  typedApp.get('/api/agent/presets', async () => registry.listPresets())

  typedApp.get('/api/agent/sessions', async () => registry.list())

  typedApp.post<{ Body: Static<typeof CreateSessionBody> }>(
    '/api/agent/sessions',
    { schema: { body: CreateSessionBody } },
    async (request, reply) => {
      const { presetId, reviewId, name } = request.body
      if (reviewId !== undefined && !findReviewById(db, reviewId)) {
        throw new NotFoundError(`Review ${reviewId} not found`)
      }

      // The agent starts in the background; failure shows up as a closed session.
      const session = registry.create(presetId, reviewId ?? null, name)
      reply.code(201)
      return session.info()
    }
  )

  typedApp.get<{ Params: Static<typeof SessionParams> }>(
    '/api/agent/sessions/:id',
    { schema: { params: SessionParams } },
    async request => {
      const session = registry.get(request.params.id)
      if (!session) {
        throw new NotFoundError('Session not found')
      }
      return session.info()
    }
  )

  typedApp.delete<{ Params: Static<typeof SessionParams> }>(
    '/api/agent/sessions/:id',
    { schema: { params: SessionParams } },
    async (request, reply) => {
      if (!registry.close(request.params.id)) {
        throw new NotFoundError('Session not found')
      }
      return reply.code(204).send()
    }
  )

  typedApp.post<{
    Params: Static<typeof SessionParams>
    Body: Static<typeof PromptBody>
  }>(
    '/api/agent/sessions/:id/prompt',
    {
      schema: { params: SessionParams, body: PromptBody },
      bodyLimit: PROMPT_BODY_LIMIT
    },
    async (request, reply) => {
      const session = registry.get(request.params.id)
      if (!session) {
        throw new NotFoundError('Session not found')
      }

      session.assertCanPrompt()
      const blocks = await buildPromptBlocks(request.body, {
        db,
        repositoryPath,
        embeddedContext: session.supportsEmbeddedContext,
        image: session.supportsImages,
        attachmentDir: session.attachmentDir
      })
      session.prompt(blocks, request.body)

      return reply.code(202).send()
    }
  )

  typedApp.post<{ Params: Static<typeof SessionParams> }>(
    '/api/agent/sessions/:id/cancel',
    { schema: { params: SessionParams } },
    async (request, reply) => {
      const session = registry.get(request.params.id)
      if (!session) {
        throw new NotFoundError('Session not found')
      }
      await session.cancel()
      return reply.code(204).send()
    }
  )

  typedApp.post<{
    Params: Static<typeof PermissionParams>
    Body: Static<typeof PermissionBody>
  }>(
    '/api/agent/sessions/:id/permissions/:requestId',
    { schema: { params: PermissionParams, body: PermissionBody } },
    async (request, reply) => {
      const session = registry.get(request.params.id)
      if (
        !session?.answerPermission(
          request.params.requestId,
          request.body.optionId
        )
      ) {
        throw new NotFoundError('No such pending permission request')
      }
      return reply.code(204).send()
    }
  )

  typedApp.post<{
    Params: Static<typeof SessionParams>
    Body: Static<typeof ConfigBody>
  }>(
    '/api/agent/sessions/:id/config',
    { schema: { params: SessionParams, body: ConfigBody } },
    async (request, reply) => {
      const session = registry.get(request.params.id)
      if (!session) {
        throw new NotFoundError('Session not found')
      }

      await session.setConfig(request.body.configId, request.body.value)

      return reply.code(204).send()
    }
  )

  typedApp.post<{
    Params: Static<typeof SessionParams>
    Body: Static<typeof AutoApproveBody>
  }>(
    '/api/agent/sessions/:id/auto-approve',
    { schema: { params: SessionParams, body: AutoApproveBody } },
    async (request, reply) => {
      const session = registry.get(request.params.id)
      if (!session) {
        throw new NotFoundError('Session not found')
      }

      session.setAutoApprove(request.body.enabled)

      return reply.code(204).send()
    }
  )

  typedApp.get<{ Querystring: Static<typeof FileSearchQuery> }>(
    '/api/agent/files',
    { schema: { querystring: FileSearchQuery } },
    async request => ({
      files: await fileIndex.search(
        request.query.q ?? '',
        request.query.limit ?? DEFAULT_FILE_SEARCH_LIMIT
      )
    })
  )

  // One stream for every chat (ADR 0024): browsers allow ~6 connections per
  // origin over HTTP/1.1, so a stream per session would starve the page's own
  // requests. Event ids are shared across sessions, so `Last-Event-ID` works.
  typedApp.get('/api/agent/events', { sse: true }, async (request, reply) => {
    const lastEventId = Number(request.headers['last-event-id'])
    reply.sse.keepAlive()
    // Flushes the headers: with no session yet nothing else would be sent, and
    // the browser would not consider the stream open.
    await reply.sse.send({ event: 'connected', data: {} })
    // The client can leave during the await. `onClose` callbacks run once, so
    // one added after the close would never run and the listener would leak.
    if (!reply.sse.isConnected) {
      return
    }
    const unsubscribe = registry.subscribe(
      message => {
        if (message.type === 'event') {
          safeSend(reply.sse, {
            id: String(message.envelope.id),
            event: 'agent',
            data: message.envelope
          })
        } else if (message.type === 'gap') {
          safeSend(reply.sse, {
            event: 'gap',
            data: { sessionId: message.sessionId }
          })
        } else if (message.type === 'state') {
          safeSend(reply.sse, { event: 'state', data: message.state })
        } else {
          safeSend(reply.sse, { event: 'sessions', data: {} })
        }
      },
      Number.isInteger(lastEventId) ? lastEventId : 0
    )
    reply.sse.onClose(unsubscribe)
  })
}
