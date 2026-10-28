import type { FastifyRequest } from 'fastify'
import { Value } from '@sinclair/typebox/value'
import { ArtifactReviewDecisionBody } from '../../shared/artifacts/schemas.ts'
import type {
  ArtifactActor,
  ArtifactReviewDecisionInput
} from '../../shared/artifacts/types.ts'
import { artifactUserActor } from '../utils/artifact-actor.ts'
import { ArtifactInputError } from '../errors/artifacts.ts'
import { ForbiddenError } from '../errors/http.ts'

// Keep direct user decisions distinct from untrusted command bodies.
const VERIFIED_REVIEW_COMMAND = Symbol('verifiedReviewUserCommand')
// Direct user commands execute synchronously; agent grants belong to stage 0092.
const COMMANDS = new WeakMap<
  VerifiedReviewUserCommand,
  { threadId: string; input: ArtifactReviewDecisionInput; actor: ArtifactActor }
>()

export type VerifiedReviewUserCommand = {
  readonly [VERIFIED_REVIEW_COMMAND]: true
}

export function verifyReviewUserCommand(
  request: FastifyRequest<{
    Params: { id: string }
    Body: ArtifactReviewDecisionInput
  }>
): VerifiedReviewUserCommand {
  if (
    request.method !== 'POST' ||
    request.routeOptions.url !== '/api/artifact-threads/:id/decisions'
  ) {
    throw new ForbiddenError('A structured user review decision is required.')
  }
  const actor = artifactUserActor(request)
  if (!Value.Check(ArtifactReviewDecisionBody, request.body)) {
    throw new ArtifactInputError('Invalid review decision.')
  }
  const command = Object.freeze({ [VERIFIED_REVIEW_COMMAND]: true as const })
  COMMANDS.set(command, {
    threadId: request.params.id,
    input: structuredClone(request.body),
    actor
  })
  return command
}

export function consumeReviewUserCommand(command: VerifiedReviewUserCommand) {
  const data = COMMANDS.get(command)
  if (!data) {
    throw new ForbiddenError('Verified user review decision is required.')
  }
  COMMANDS.delete(command)
  return data
}
