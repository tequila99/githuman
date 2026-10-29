import { artifactSessionId } from '../services/artifact-lifecycle.service.ts'
import type { FastifyInstance } from 'fastify'
import type { Static, TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import {
  ArtifactToolSchemas,
  ArtifactBridgeBody,
  ArtifactBridgeParams,
  ArtifactBridgeResponse
} from '../../shared/artifact-tools/schemas.ts'
import {
  ARTIFACT_BRIDGE_ROUTE,
  ARTIFACT_BRIDGE_BODY_LIMIT
} from '../../shared/artifacts/mcp-constants.ts'
import { ERROR_RESPONSES } from '../../shared/http/schemas.ts'
import { ArtifactInputError } from '../errors/artifacts.ts'
import { ForbiddenError } from '../errors/http.ts'
import type { ArtifactStorageService } from '../services/artifact-storage.service.ts'
import type { AgentSessionRegistry } from '../services/agent/session-registry.ts'
import type { ArtifactActor } from '../../shared/artifacts/types.ts'

function checked<T extends TSchema>(
  schema: T,
  run: (input: Static<T>, actor: ArtifactActor) => unknown
) {
  return (input: unknown, actor: ArtifactActor) => {
    if (!Value.Check(schema, input)) {
      throw new ArtifactInputError('Invalid artifact tool parameters.')
    }
    return run(input, actor)
  }
}

export async function artifactAgentRoutes(
  app: FastifyInstance,
  {
    storage,
    registry
  }: { storage: ArtifactStorageService; registry: AgentSessionRegistry }
): Promise<void> {
  const operations = new Map<
    string,
    (input: unknown, actor: ArtifactActor) => unknown
  >([
    [
      'artifacts.search',
      checked(ArtifactToolSchemas['artifacts.search'], p =>
        storage.search.search(p)
      )
    ],
    [
      'change_sets.propose',
      checked(ArtifactToolSchemas['change_sets.propose'], (p, a) =>
        storage.lifecycle.propose(p, a)
      )
    ],
    [
      'change_sets.get',
      checked(ArtifactToolSchemas['change_sets.get'], p =>
        storage.lifecycle.get(p.id)
      )
    ],
    [
      'change_sets.commit',
      checked(ArtifactToolSchemas['change_sets.commit'], ({ id, ...p }, a) =>
        storage.lifecycle.commit(id, p, a)
      )
    ],
    [
      'validations.prepare',
      checked(ArtifactToolSchemas['validations.prepare'], p =>
        storage.lifecycle.jobs.get(
          storage.lifecycle.prepare(p.changeSetId, p.version).id
        )
      )
    ],
    [
      'validations.start',
      checked(ArtifactToolSchemas['validations.start'], (p, a) =>
        storage.lifecycle.jobs.start(p.id, p.presetId, undefined, a.id)
      )
    ],
    [
      'validations.report',
      checked(ArtifactToolSchemas['validations.report'], p =>
        storage.lifecycle.jobs.report(p.id, p.offset)
      )
    ],
    [
      'validations.history',
      checked(ArtifactToolSchemas['validations.history'], p =>
        storage.lifecycle.jobs.history(p.id, p.afterSeq, p.limit)
      )
    ],
    [
      'validations.get',
      checked(ArtifactToolSchemas['validations.get'], p =>
        storage.lifecycle.jobs.get(p.id)
      )
    ],
    [
      'validations.manifest',
      checked(ArtifactToolSchemas['validations.manifest'], p =>
        storage.lifecycle.jobs.manifest(p.id, p.limit, p.cursor)
      )
    ],
    [
      'validations.read',
      checked(ArtifactToolSchemas['validations.read'], (p, a) =>
        storage.lifecycle.jobs.read(p.id, a.id, p.key, p.offset)
      )
    ],
    [
      'validations.submit',
      checked(ArtifactToolSchemas['validations.submit'], ({ id, ...p }, a) =>
        storage.lifecycle.jobs.submit(id, a.id, p)
      )
    ],
    [
      'validations.create_report',
      checked(ArtifactToolSchemas['validations.create_report'], (p, a) =>
        storage.lifecycle.jobs.createReport(p.id, a.id, p.body)
      )
    ],
    [
      'actions.request',
      checked(ArtifactToolSchemas['actions.request'], (p, a) =>
        storage.lifecycle.authorization.request(p, artifactSessionId(a))
      )
    ],
    [
      'reviews.resolve',
      checked(
        ArtifactToolSchemas['reviews.resolve'],
        ({ id, authorizationId, ...input }, actor) =>
          storage.lifecycle.executeReview(
            {
              kind: 'review',
              threadId: id,
              input: { ...input, kind: 'resolved' }
            },
            authorizationId,
            actor
          )
      )
    ],
    [
      'reviews.reopen',
      checked(
        ArtifactToolSchemas['reviews.reopen'],
        ({ id, authorizationId, ...input }, actor) =>
          storage.lifecycle.executeReview(
            {
              kind: 'review',
              threadId: id,
              input: { ...input, kind: 'reopened' }
            },
            authorizationId,
            actor
          )
      )
    ],
    [
      'reviews.set_blocking',
      checked(
        ArtifactToolSchemas['reviews.set_blocking'],
        ({ id, authorizationId, ...input }, actor) =>
          storage.lifecycle.executeReview(
            {
              kind: 'review',
              threadId: id,
              input: { ...input, kind: 'blocking_changed' }
            },
            authorizationId,
            actor
          )
      )
    ],
    [
      'reviews.execute',
      checked(ArtifactToolSchemas['reviews.execute'], (p, a) =>
        storage.lifecycle.executeReview(p.action, p.authorizationId, a)
      )
    ],
    [
      'artifacts.create',
      checked(ArtifactToolSchemas['artifacts.create'], (p, a) =>
        storage.create(p, a)
      )
    ],
    [
      'artifacts.get',
      checked(ArtifactToolSchemas['artifacts.get'], p => storage.get(p.id))
    ],
    [
      'artifacts.list',
      checked(ArtifactToolSchemas['artifacts.list'], p =>
        storage.list(p.limit, p.cursor)
      )
    ],
    [
      'artifacts.get_content',
      checked(ArtifactToolSchemas['artifacts.get_content'], (p, a) =>
        storage.lifecycle.jobs.isValidator(a.id)
          ? storage.lifecycle.jobs.contentForSession(a.id, p.id, p.offset)
          : storage.readContent(p.id, p.offset, p.limit)
      )
    ],
    [
      'artifacts.history',
      checked(ArtifactToolSchemas['artifacts.history'], p =>
        storage.history(p.id, p.afterSeq, p.limit)
      )
    ],
    [
      'artifacts.relations',
      checked(
        ArtifactToolSchemas['artifacts.relations'],
        ({ id, ...options }) => storage.graph.relations(id, options)
      )
    ],
    [
      'artifacts.ancestry',
      checked(ArtifactToolSchemas['artifacts.ancestry'], p =>
        storage.graph.ancestry(p.id, p.limit, p.cursor)
      )
    ],
    [
      'reviews.list',
      checked(ArtifactToolSchemas['reviews.list'], ({ id, ...options }) =>
        storage.reviews.list(id, options)
      )
    ],
    [
      'reviews.summary',
      checked(ArtifactToolSchemas['reviews.summary'], p =>
        storage.reviews.summary(p.id)
      )
    ],
    [
      'reviews.comment',
      checked(
        ArtifactToolSchemas['reviews.comment'],
        ({ id, ...input }, actor) =>
          storage.reviews.createThread(id, input, actor)
      )
    ],
    [
      'reviews.reply',
      checked(ArtifactToolSchemas['reviews.reply'], ({ id, ...input }, actor) =>
        storage.reviews.comment(id, { ...input, kind: 'replied' }, actor)
      )
    ],
    [
      'reviews.edit',
      checked(ArtifactToolSchemas['reviews.edit'], ({ id, ...input }, actor) =>
        storage.reviews.comment(id, { ...input, kind: 'content_edited' }, actor)
      )
    ],
    [
      'reviews.hide',
      checked(ArtifactToolSchemas['reviews.hide'], ({ id, ...input }, actor) =>
        storage.reviews.comment(id, { ...input, kind: 'hidden' }, actor)
      )
    ],
    [
      'reviews.comments',
      checked(ArtifactToolSchemas['reviews.comments'], ({ id, ...options }) =>
        storage.reviews.comments(id, options)
      )
    ],
    [
      'reviews.history',
      checked(ArtifactToolSchemas['reviews.history'], p =>
        storage.reviews.history(p.id, p.afterSeq, p.limit)
      )
    ],
    [
      'tasks.list',
      checked(ArtifactToolSchemas['tasks.list'], p =>
        storage.tasks.list(p.limit, p.cursor)
      )
    ],
    [
      'tasks.get',
      checked(ArtifactToolSchemas['tasks.get'], p => storage.tasks.get(p.id))
    ],
    [
      'tasks.create',
      checked(ArtifactToolSchemas['tasks.create'], (p, a) =>
        storage.tasks.create(p.requestId, p.input, a)
      )
    ],
    [
      'tasks.update',
      checked(ArtifactToolSchemas['tasks.update'], (p, a) =>
        storage.tasks.update(p.id, p.requestId, p.expectedVersion, p.input, a)
      )
    ],
    [
      'types.list',
      checked(ArtifactToolSchemas['types.list'], p =>
        storage.types.list(p.limit, p.cursor)
      )
    ],
    [
      'types.get',
      checked(ArtifactToolSchemas['types.get'], p => storage.types.get(p.id))
    ],
    [
      'types.create',
      checked(ArtifactToolSchemas['types.create'], (p, a) =>
        storage.types.create(p.requestId, p.id, p.input, a)
      )
    ],
    [
      'types.update',
      checked(ArtifactToolSchemas['types.update'], (p, a) =>
        storage.types.update(p.id, p.requestId, p.expectedVersion, p.input, a)
      )
    ]
  ])
  app.post<{
    Params: Static<typeof ArtifactBridgeParams>
    Body: Static<typeof ArtifactBridgeBody>
  }>(
    ARTIFACT_BRIDGE_ROUTE,
    {
      bodyLimit: ARTIFACT_BRIDGE_BODY_LIMIT,
      schema: {
        tags: ['artifacts'],
        summary: 'Call a session-scoped artifact tool',
        params: ArtifactBridgeParams,
        body: ArtifactBridgeBody,
        response: {
          200: ArtifactBridgeResponse,
          403: ERROR_RESPONSES['4xx'],
          ...ERROR_RESPONSES
        }
      }
    },
    request => {
      // The access hook checked the key before parsing. Check again: the session may close during parsing.
      const sessionId = registry.authenticateArtifactKey(
        request.headers.authorization
      )
      if (!sessionId) {
        throw new ForbiddenError('Artifact session access denied.')
      }
      storage.lifecycle.jobs.assertOperation(
        sessionId,
        request.params.operation,
        request.body
      )
      const operation = operations.get(request.params.operation)
      if (!operation) {
        throw new ArtifactInputError('Artifact operation is unavailable.')
      }
      return operation(request.body, { kind: 'agent', id: sessionId })
    }
  )
}
