import { Value } from '@sinclair/typebox/value'
import { ArtifactAuthorizationApproveBody } from '../../shared/artifacts/schemas.ts'
import { randomUUID } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import type {
  ArtifactActor,
  ArtifactAuthorizationRequest
} from '../../shared/artifacts/types.ts'
import { canonicalJson } from '../../shared/utils/canonical-json.ts'
import { sha256Hex } from '../utils/hash.ts'
import { artifactUserActor } from '../utils/artifact-actor.ts'
import { ForbiddenError } from '../errors/http.ts'
import {
  ArtifactConflictError,
  ArtifactNotFoundError
} from '../errors/artifacts.ts'
import type { ArtifactValidationRepository } from '../repositories/artifact-validation.repo.ts'

// Grants expire with the confirmed proposal and never survive this runtime.
const AUTHORIZATION_TTL_MS = 15 * 60_000

export interface PendingArtifactAction {
  id: string
  sessionId: string
  action: ArtifactAuthorizationRequest
  actionDigest: string
  manifestDigest: string | null
  expiresAt: number
}
interface Grant extends PendingArtifactAction {
  user: ArtifactActor
  sourceUserRequestId: string
}

export class ArtifactAuthorizationService {
  private readonly pending = new Map<string, PendingArtifactAction>()
  private readonly grants = new Map<string, Grant>()
  private readonly repository: ArtifactValidationRepository
  private readonly now: () => number
  private readonly check: (action: ArtifactAuthorizationRequest) => {
    actionDigest: string
    manifestDigest: string | null
  }
  private readonly live: (sessionId: string) => boolean
  private readonly changed: () => void
  constructor(
    repository: ArtifactValidationRepository,
    now: () => number,
    check: (action: ArtifactAuthorizationRequest) => {
      actionDigest: string
      manifestDigest: string | null
    },
    live: (sessionId: string) => boolean,
    changed: () => void
  ) {
    this.repository = repository
    this.now = now
    this.check = check
    this.live = live
    this.changed = changed
  }

  request(
    action: ArtifactAuthorizationRequest,
    sessionId: string
  ): PendingArtifactAction {
    if (!this.live(sessionId)) {
      throw new ForbiddenError('Action session is unavailable.')
    }
    for (const [id, value] of this.pending) {
      if (value.expiresAt <= this.now() || !this.live(value.sessionId)) {
        this.pending.delete(id)
      }
    }
    for (const [id, value] of this.grants) {
      if (
        value.expiresAt <= this.now() ||
        !this.live(value.sessionId) ||
        this.repository.consumed(id)
      ) {
        this.grants.delete(id)
      }
    }
    if (this.pending.size >= 100 || this.grants.size >= 1000) {
      throw new ArtifactConflictError(
        'Too many pending actions or authorizations.'
      )
    }
    const binding = this.check(action)
    const value = {
      id: randomUUID(),
      action: structuredClone(action),
      sessionId,
      ...binding,
      expiresAt: this.now() + AUTHORIZATION_TTL_MS
    }
    this.pending.set(value.id, value)
    this.changed()
    return structuredClone(value)
  }
  list(): PendingArtifactAction[] {
    return [...this.pending.values()]
      .filter(
        value => value.expiresAt > this.now() && this.live(value.sessionId)
      )
      .map(value => structuredClone(value))
  }
  approve(
    id: string,
    request: FastifyRequest
  ): { authorizationId: string; expiresAt: number } {
    if (
      request.method !== 'POST' ||
      request.routeOptions.url !== '/api/artifact-actions/:id/approve'
    ) {
      throw new ForbiddenError('Structured user confirmation is required.')
    }
    const user = artifactUserActor(request)
    if (!Value.Check(ArtifactAuthorizationApproveBody, request.body)) {
      throw new ForbiddenError('Structured confirmation is invalid.')
    }
    const sourceUserRequestId = request.body.sourceUserRequestId
    const pending = this.pending.get(id)
    if (!pending) throw new ArtifactNotFoundError()
    if (pending.expiresAt <= this.now() || !this.live(pending.sessionId)) {
      throw new ForbiddenError('Pending action expired or was revoked.')
    }
    const current = this.check(pending.action)
    if (
      canonicalJson(current) !==
      canonicalJson({
        actionDigest: pending.actionDigest,
        manifestDigest: pending.manifestDigest
      })
    ) {
      throw new ArtifactConflictError('Pending action is stale.')
    }
    const grant = { ...pending, id: randomUUID(), user, sourceUserRequestId }
    this.repository.appendAuthorization(grant.id, grant)
    this.grants.set(grant.id, grant)
    this.pending.delete(id)
    this.changed()
    return { authorizationId: grant.id, expiresAt: grant.expiresAt }
  }
  assert(
    id: string,
    sessionId: string,
    action: ArtifactAuthorizationRequest
  ): Grant {
    const grant = this.grants.get(id)
    if (
      !grant ||
      grant.sessionId !== sessionId ||
      grant.expiresAt <= this.now() ||
      !this.live(sessionId) ||
      this.repository.consumed(id)
    ) {
      throw new ForbiddenError(
        'Authorization is missing, expired, consumed or belongs to another session.'
      )
    }
    const current = this.check(action)
    if (
      canonicalJson(action) !== canonicalJson(grant.action) ||
      current.actionDigest !== grant.actionDigest ||
      current.manifestDigest !== grant.manifestDigest
    ) {
      throw new ArtifactConflictError(
        'Authorization is stale or has the wrong scope.'
      )
    }
    return grant
  }
  consume(id: string): void {
    this.repository.authorizationEvent(id, 'consumed', { at: this.now() })
  }
  revoke(id: string): void {
    this.grants.delete(id)
    this.pending.delete(id)
    this.repository.authorizationEvent(id, 'revoked', { at: this.now() })
    this.changed()
  }
}

export function artifactActionDigest(action: unknown): string {
  return sha256Hex(canonicalJson(action))
}
