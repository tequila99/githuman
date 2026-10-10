import { NotFoundError } from '../errors/http.ts'
import { Type } from '@sinclair/typebox'
import {
  SessionParams,
  PermissionParams,
  CreateSessionBody,
  AutoApproveBody,
  FileSearchQuery,
  PromptBody,
  PermissionBody,
  ConfigBody,
  AgentPresetInfoSchema,
  AgentSessionInfoSchema,
  AgentFileSearchResponseSchema,
  AgentEventsHeaders,
  AgentStreamSchema
} from '../../shared/agents/schemas.ts'
import {
  ApiErrorSchema,
  ERROR_RESPONSES,
  NoContentSchema
} from '../../shared/http/schemas.ts'
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

// OpenAPI group of these routes.
const TAGS = ['agent']

// The spec shows the local-origin guard on each operation, not only on the tag.
const AGENT_ERROR_RESPONSES = {
  ...ERROR_RESPONSES,
  403: {
    ...ApiErrorSchema,
    description: 'Host or Origin of the request is not local.'
  }
}

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

  typedApp.get(
    '/api/agent/presets',
    {
      schema: {
        tags: TAGS,
        summary: 'List agent presets',
        response: {
          200: Type.Array(AgentPresetInfoSchema, {
            description: 'Presets from the config.'
          }),
          ...AGENT_ERROR_RESPONSES
        }
      }
    },
    async () => registry.listPresets()
  )

  typedApp.get(
    '/api/agent/sessions',
    {
      schema: {
        tags: TAGS,
        summary: 'List chat sessions',
        response: {
          200: Type.Array(AgentSessionInfoSchema, {
            description: 'Open and closed sessions.'
          }),
          ...AGENT_ERROR_RESPONSES
        }
      }
    },
    async () => registry.list()
  )

  typedApp.post(
    '/api/agent/sessions',
    {
      schema: {
        tags: TAGS,
        summary: 'Start a chat session',
        body: CreateSessionBody,
        response: {
          201: {
            ...AgentSessionInfoSchema,
            description: 'The session. The agent starts in the background.'
          },
          ...AGENT_ERROR_RESPONSES
        }
      }
    },
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

  typedApp.get(
    '/api/agent/sessions/:id',
    {
      schema: {
        tags: TAGS,
        summary: 'Get a chat session',
        params: SessionParams,
        response: { 200: AgentSessionInfoSchema, ...AGENT_ERROR_RESPONSES }
      }
    },
    async request => {
      const session = registry.get(request.params.id)
      if (!session) {
        throw new NotFoundError('Session not found')
      }
      return session.info()
    }
  )

  typedApp.delete(
    '/api/agent/sessions/:id',
    {
      schema: {
        tags: TAGS,
        summary: 'Close a chat session and stop its agent',
        params: SessionParams,
        response: { 204: NoContentSchema, ...AGENT_ERROR_RESPONSES }
      }
    },
    async (request, reply) => {
      if (!registry.close(request.params.id)) {
        throw new NotFoundError('Session not found')
      }
      return reply.code(204).send(null)
    }
  )

  typedApp.post(
    '/api/agent/sessions/:id/prompt',
    {
      schema: {
        tags: TAGS,
        summary: 'Send a message to the agent',
        description:
          'The answer comes over GET /api/agent/events. 202 means the session took the message.',
        params: SessionParams,
        body: PromptBody,
        response: {
          // No content type: the answer has no body, as before the schema.
          202: { description: 'The session took the message. No body.' },
          ...AGENT_ERROR_RESPONSES
        }
      },
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

  typedApp.post(
    '/api/agent/sessions/:id/cancel',
    {
      schema: {
        tags: TAGS,
        summary: 'Cancel the current turn',
        params: SessionParams,
        response: { 204: NoContentSchema, ...AGENT_ERROR_RESPONSES }
      }
    },
    async (request, reply) => {
      const session = registry.get(request.params.id)
      if (!session) {
        throw new NotFoundError('Session not found')
      }
      await session.cancel()
      return reply.code(204).send(null)
    }
  )

  typedApp.post(
    '/api/agent/sessions/:id/permissions/:requestId',
    {
      schema: {
        tags: TAGS,
        summary: 'Answer a permission request',
        params: PermissionParams,
        body: PermissionBody,
        response: { 204: NoContentSchema, ...AGENT_ERROR_RESPONSES }
      }
    },
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
      return reply.code(204).send(null)
    }
  )

  typedApp.post(
    '/api/agent/sessions/:id/config',
    {
      schema: {
        tags: TAGS,
        summary: 'Change an agent setting',
        params: SessionParams,
        body: ConfigBody,
        response: { 204: NoContentSchema, ...AGENT_ERROR_RESPONSES }
      }
    },
    async (request, reply) => {
      const session = registry.get(request.params.id)
      if (!session) {
        throw new NotFoundError('Session not found')
      }

      await session.setConfig(request.body.configId, request.body.value)

      return reply.code(204).send(null)
    }
  )

  typedApp.post(
    '/api/agent/sessions/:id/auto-approve',
    {
      schema: {
        tags: TAGS,
        summary: 'Switch auto-approve of a session',
        params: SessionParams,
        body: AutoApproveBody,
        response: { 204: NoContentSchema, ...AGENT_ERROR_RESPONSES }
      }
    },
    async (request, reply) => {
      const session = registry.get(request.params.id)
      if (!session) {
        throw new NotFoundError('Session not found')
      }

      session.setAutoApprove(request.body.enabled)

      return reply.code(204).send(null)
    }
  )

  typedApp.get(
    '/api/agent/files',
    {
      schema: {
        tags: TAGS,
        summary: 'Find repository files for the context picker',
        querystring: FileSearchQuery,
        response: {
          200: AgentFileSearchResponseSchema,
          ...AGENT_ERROR_RESPONSES
        }
      }
    },
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
  typedApp.get(
    '/api/agent/events',
    {
      sse: true,
      schema: {
        tags: TAGS,
        summary: 'Stream of all chat sessions',
        headers: AgentEventsHeaders,
        response: {
          200: {
            description: 'An SSE stream that stays open.',
            content: { 'text/event-stream': { schema: AgentStreamSchema } }
          },
          ...AGENT_ERROR_RESPONSES
        }
      }
    },
    async (request, reply) => {
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
      // The replay can close a stream whose queue is full. `onClose` callbacks
      // have run then, so the listener is removed here.
      if (!reply.sse.isConnected) {
        unsubscribe()
        return
      }
      reply.sse.onClose(unsubscribe)
    }
  )
}
