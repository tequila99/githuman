import { reviewSources, isReviewThreadOpen } from './artifact-review-scope.ts'
import { takeWithinBytes } from '../utils/take-within-bytes.ts'
import { truncateUtf8Text } from '../utils/text.ts'
import { ForbiddenError } from '../errors/http.ts'
import {
  consumeReviewUserCommand,
  type VerifiedReviewUserCommand
} from './artifact-review-user-command.ts'
import { artifactPage } from '../utils/artifact-page.ts'
import { randomUUID } from 'node:crypto'
import { Value } from '@sinclair/typebox/value'
import {
  ArtifactActorSchema,
  ArtifactReviewCreateBody,
  ArtifactReviewCommentEventBody,
  ArtifactReviewListQuery,
  ArtifactReviewCommentsQuery
} from '../../shared/artifacts/schemas.ts'
import {
  MAX_ARTIFACT_REVIEW_TEXT_BYTES,
  MAX_ARTIFACT_PAGE_SIZE,
  MAX_ARTIFACT_REVIEW_QUOTE_BYTES,
  MAX_ARTIFACT_REVIEW_PREVIEW_BYTES
} from '../../shared/artifacts/constants.ts'
import type {
  ArtifactActor,
  ArtifactReviewCreateInput,
  ArtifactReviewCommentInput,
  ArtifactReviewEvent,
  ArtifactReviewEventPayload,
  ArtifactReviewHistory,
  ArtifactSourceAnchor,
  ArtifactReviewState,
  ArtifactReviewList,
  ArtifactReviewListOptions,
  ArtifactThreadView,
  ArtifactThreadSummary,
  ArtifactReviewCommentPreview,
  ArtifactReviewComment,
  ArtifactReviewComments,
  ArtifactReviewCommentsOptions
} from '../../shared/artifacts/types.ts'
import { isUuid } from '../../shared/utils/is-uuid.ts'
import {
  ArtifactInputError,
  ArtifactNotFoundError,
  ArtifactTooLargeError
} from '../errors/artifacts.ts'
import type { ArtifactReviewRepository } from '../repositories/artifact-review.repo.ts'
import type { ArtifactStorageService } from './artifact-storage.service.ts'

function assertText(text: string): void {
  if (!text.trim()) {
    throw new ArtifactInputError('Review comment text is empty.')
  }
  if (Buffer.byteLength(text) > MAX_ARTIFACT_REVIEW_TEXT_BYTES) {
    throw new ArtifactTooLargeError()
  }
}

function commentPreview(
  comment: ArtifactReviewComment
): ArtifactReviewCommentPreview {
  const text = comment.hidden
    ? null
    : truncateUtf8Text(comment.text, MAX_ARTIFACT_REVIEW_PREVIEW_BYTES)
  return { ...comment, text, truncated: text !== null && text !== comment.text }
}

function threadSummary(thread: ArtifactThreadView): ArtifactThreadSummary {
  const { comments, resolutions: _resolutions, anchor, ...fields } = thread
  const quote = anchor
    ? truncateUtf8Text(anchor.quote, MAX_ARTIFACT_REVIEW_PREVIEW_BYTES)
    : ''
  return {
    ...fields,
    anchor: anchor
      ? { ...anchor, quote, truncated: quote !== anchor.quote }
      : null,
    commentCount: comments.length,
    rootComment: commentPreview(comments[0]),
    lastComment: commentPreview(comments[comments.length - 1])
  }
}

export class ArtifactReviewService {
  private readonly storage: ArtifactStorageService
  private readonly repository: ArtifactReviewRepository
  private readonly now: () => number

  constructor(
    storage: ArtifactStorageService,
    repository: ArtifactReviewRepository,
    now = Date.now
  ) {
    this.storage = storage
    this.repository = repository
    this.now = now
  }

  createThread(
    artifactId: string,
    input: ArtifactReviewCreateInput,
    actor: ArtifactActor
  ): ArtifactReviewEvent {
    if (
      !Value.Check(ArtifactReviewCreateBody, input) ||
      !Value.Check(ArtifactActorSchema, actor)
    ) {
      throw new ArtifactInputError('Invalid review comment input.')
    }
    assertText(input.text)
    const result = this.storage.catalog.transaction(() => {
      this.storage.get(artifactId)
      const replay = this.repository.request(input.requestId)
      const event = {
        threadId: replay?.threadId ?? randomUUID(),
        originArtifactId: artifactId,
        expectedThreadVersion: 0,
        actor,
        createdAt: replay?.createdAt ?? new Date(this.now()).toISOString(),
        payload: {
          kind: 'created' as const,
          anchor: input.anchor ?? null,
          text: input.text,
          blocking: input.blocking ?? false
        }
      }
      // Replays compare the original event without depending on the current file or thread version.
      if (!replay && event.payload.anchor) {
        this.validateAnchor(artifactId, event.payload.anchor)
      }
      return this.repository.append(input.requestId, event)
    })
    this.storage.pollChanges()
    return result
  }

  comment(
    threadId: string,
    input: ArtifactReviewCommentInput,
    actor: ArtifactActor
  ): ArtifactReviewEvent {
    if (
      !isUuid(threadId) ||
      !Value.Check(ArtifactReviewCommentEventBody, input) ||
      !Value.Check(ArtifactActorSchema, actor)
    ) {
      throw new ArtifactInputError('Invalid review comment command.')
    }
    if ('text' in input) assertText(input.text)
    const result = this.storage.catalog.transaction(() => {
      const thread = this.repository.get(threadId)
      if (!thread) throw new ArtifactNotFoundError()
      const replay = this.repository.request(input.requestId)
      if (!replay && input.kind !== 'replied') {
        const comment = thread.comments.find(
          item => item.id === input.commentId
        )
        if (!comment) {
          throw new ArtifactInputError(
            'Review comment does not exist in this thread.'
          )
        }
        const own =
          comment.actor.kind === actor.kind && comment.actor.id === actor.id
        if (
          (actor.kind === 'agent' && !own) ||
          (actor.kind !== 'agent' &&
            (actor.kind !== 'user' ||
              (input.kind === 'content_edited' &&
                comment.actor.kind !== 'user')))
        ) {
          throw new ForbiddenError(
            'This actor cannot edit or hide the review comment.'
          )
        }
      }
      let payload: ArtifactReviewEventPayload
      if (input.kind === 'replied') {
        payload = {
          kind: 'replied',
          commentId:
            replay?.payload.kind === 'replied'
              ? replay.payload.commentId
              : randomUUID(),
          text: input.text
        }
      } else if (input.kind === 'content_edited') {
        payload = {
          kind: 'content_edited',
          commentId: input.commentId,
          text: input.text
        }
      } else {
        payload = { kind: 'hidden', commentId: input.commentId }
      }
      return this.repository.append(input.requestId, {
        threadId,
        originArtifactId: thread.originArtifactId,
        expectedThreadVersion: input.expectedThreadVersion,
        actor,
        createdAt: replay?.createdAt ?? new Date(this.now()).toISOString(),
        payload
      })
    })
    this.storage.pollChanges()
    return result
  }

  decide(command: VerifiedReviewUserCommand): ArtifactReviewEvent {
    const { threadId, input, actor } = consumeReviewUserCommand(command)
    const result = this.storage.catalog.transaction(() => {
      const thread = this.repository.get(threadId)
      if (!thread) throw new ArtifactNotFoundError()
      const replay = this.repository.request(input.requestId)
      if (!replay) {
        const sources = reviewSources(
          input.scope.appliesToArtifactId,
          this.storage
        )
        if (!sources.origins.has(thread.originArtifactId)) {
          throw new ArtifactInputError(
            'Review decision scope is unrelated to the thread origin.'
          )
        }
      }
      const payload: ArtifactReviewEventPayload =
        input.kind === 'blocking_changed'
          ? { kind: input.kind, blocking: input.blocking, scope: input.scope }
          : { kind: input.kind, scope: input.scope }
      return this.repository.append(input.requestId, {
        threadId,
        originArtifactId: thread.originArtifactId,
        expectedThreadVersion: input.expectedThreadVersion,
        actor,
        createdAt: replay?.createdAt ?? new Date(this.now()).toISOString(),
        payload
      })
    })
    this.storage.pollChanges()
    return result
  }

  getThreads(
    artifactId: string,
    includeInherited = true
  ): ArtifactThreadView[] {
    return this.storage.catalog.readSnapshot(() =>
      this.collectThreads(artifactId, includeInherited)
    )
  }

  private collectThreads(
    artifactId: string,
    includeInherited = true
  ): ArtifactThreadView[] {
    const sources = reviewSources(artifactId, this.storage)
    const lineage = sources.nodes.get(artifactId)!.lineage
    const result: ArtifactThreadView[] = []
    for (const thread of this.repository.getThreadsByOrigins(sources.origins)) {
      if (!includeInherited && thread.originArtifactId !== artifactId) continue
      if (!lineage.has(thread.originArtifactId) && !thread.blocking) continue
      const open = isReviewThreadOpen(thread, sources)
      if (!open && thread.originArtifactId !== artifactId) continue
      result.push({
        ...thread,
        inheritedFrom:
          thread.originArtifactId === artifactId
            ? null
            : thread.originArtifactId,
        effectiveResolved: !open
      })
    }
    return result
  }

  summary(artifactId: string): ArtifactReviewState {
    return this.storage.catalog.readSnapshot(() =>
      this.reviewState(artifactId, this.collectThreads(artifactId))
    )
  }

  list(
    artifactId: string,
    options: ArtifactReviewListOptions = {}
  ): ArtifactReviewList {
    if (!Value.Check(ArtifactReviewListQuery, options)) {
      throw new ArtifactInputError('Invalid review page options.')
    }
    return this.storage.catalog.readSnapshot(() => {
      const threads = this.collectThreads(artifactId)
      const page = artifactPage(
        (options.includeInherited === false
          ? threads.filter(thread => thread.originArtifactId === artifactId)
          : threads
        ).map(threadSummary),
        {
          storeId: this.storage.storeId,
          epoch: this.storage.catalog.epoch(),
          query: `reviews:${artifactId}:${options.includeInherited !== false}`,
          limit: options.limit,
          cursor: options.cursor
        }
      )
      return { ...page, ...this.reviewState(artifactId, threads) }
    })
  }

  private reviewState(
    artifactId: string,
    threads: ArtifactThreadView[]
  ): ArtifactReviewState {
    const threadIds = threads
      .filter(thread => thread.blocking && !thread.effectiveResolved)
      .map(thread => thread.threadId)
    return {
      storeId: this.storage.storeId,
      storeEpoch: this.storage.catalog.epoch(),
      validationEpoch: this.storage.catalog.validationEpoch(),
      artifactId,
      blockerSummary: {
        count: threadIds.length,
        threadIds: threadIds.slice(0, MAX_ARTIFACT_PAGE_SIZE),
        truncated: threadIds.length > MAX_ARTIFACT_PAGE_SIZE,
        attention:
          this.storage.get(artifactId).status === 'accepted' &&
          threadIds.length > 0
      }
    }
  }

  history(threadId: string, afterSeq = 0, limit = 50): ArtifactReviewHistory {
    if (
      !isUuid(threadId) ||
      !Number.isSafeInteger(afterSeq) ||
      afterSeq < 0 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > MAX_ARTIFACT_PAGE_SIZE
    ) {
      throw new ArtifactInputError('Invalid review history range.')
    }
    if (!this.repository.get(threadId)) throw new ArtifactNotFoundError()
    const rows = this.repository.history(threadId, afterSeq, limit + 1)
    const items = takeWithinBytes(rows, limit)
    return {
      storeId: this.storage.storeId,
      items,
      nextAfterSeq:
        rows.length > items.length ? items[items.length - 1].seq : null
    }
  }

  comments(
    threadId: string,
    options: ArtifactReviewCommentsOptions = {}
  ): ArtifactReviewComments {
    if (
      !isUuid(threadId) ||
      !Value.Check(ArtifactReviewCommentsQuery, options)
    ) {
      throw new ArtifactInputError('Invalid review comments range.')
    }
    const thread = this.repository.get(threadId)
    if (!thread) throw new ArtifactNotFoundError()
    const offset = options.afterIndex ?? 0
    if (!Number.isSafeInteger(offset) || offset > thread.comments.length) {
      throw new ArtifactInputError('Invalid comment position.')
    }
    const limit = options.limit ?? 50
    const items = takeWithinBytes(
      thread.comments.slice(offset, offset + limit).map(comment => ({
        ...comment,
        text: comment.hidden ? null : comment.text
      })),
      limit
    )
    const next = offset + items.length
    return {
      storeId: this.storage.storeId,
      threadId,
      version: thread.version,
      anchor: thread.anchor,
      items,
      nextAfterIndex: next < thread.comments.length ? next : null
    }
  }

  private validateAnchor(
    artifactId: string,
    anchor: ArtifactSourceAnchor
  ): void {
    if (Buffer.byteLength(anchor.quote) > MAX_ARTIFACT_REVIEW_QUOTE_BYTES) {
      throw new ArtifactTooLargeError()
    }
    const { artifact, content } = this.storage.readVerifiedFile(artifactId)
    if (
      anchor.artifactId !== artifact.id ||
      anchor.fileSha256 !== artifact.sha256 ||
      anchor.bodyStartLine !== artifact.bodyStartLine
    ) {
      throw new ArtifactInputError(
        'Review anchor does not match the original artifact.'
      )
    }
    const body = content
      .toString('utf8')
      .split('\n')
      .slice(artifact.bodyStartLine - 1)
      .join('\n')
    // Keep source line endings; a final terminator does not add an extra body line.
    const lines = body.match(/[^\n]*\n|[^\n]+$/g) ?? []
    if (anchor.endLine < anchor.startLine || anchor.endLine > lines.length) {
      throw new ArtifactInputError(
        'Review anchor range is outside the document body.'
      )
    }
    const quote = lines
      .slice(anchor.startLine - 1, anchor.endLine)
      .join('')
      .replace(/\r?\n$/, '')
    if (anchor.quote !== quote) {
      throw new ArtifactInputError(
        'Review anchor quote does not match the source lines.'
      )
    }
  }
}
