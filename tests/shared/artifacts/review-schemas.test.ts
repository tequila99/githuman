import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Value } from '@sinclair/typebox/value'
import {
  ArtifactSourceAnchorSchema,
  ArtifactReviewEventPayloadSchema,
  ArtifactReviewEventSchema
} from '../../../src/shared/artifacts/schemas.ts'

const id = '12345678-1234-4234-8234-123456789abc'
const scope = { appliesToArtifactId: id, includeRevisionDescendants: true }

test('source anchors retain original coordinates and Unicode excerpts', () => {
  const anchor = {
    artifactId: id,
    fileSha256: 'a'.repeat(64),
    bodyStartLine: 8,
    startLine: 1,
    endLine: 2,
    quote: 'Привет\r\n世界'
  }
  assert.equal(Value.Check(ArtifactSourceAnchorSchema, anchor), true)
  for (const patch of [
    { startLine: 0 },
    { endLine: 1.5 },
    { bodyStartLine: 0 },
    { fileSha256: 'bad' },
    { artifactId: 'bad' }
  ]) {
    assert.equal(
      Value.Check(ArtifactSourceAnchorSchema, { ...anchor, ...patch }),
      false
    )
  }
})

test('review history distinguishes edits, hiding and protected branch decisions', () => {
  for (const payload of [
    { kind: 'created', anchor: null, text: 'Comment', blocking: false },
    { kind: 'replied', commentId: id, text: 'Reply' },
    { kind: 'content_edited', commentId: id, text: 'Edited' },
    { kind: 'hidden', commentId: id },
    { kind: 'blocking_changed', blocking: false, scope },
    { kind: 'resolved', scope },
    { kind: 'reopened', scope }
  ]) {
    assert.equal(
      Value.Check(ArtifactReviewEventSchema, {
        storeId: id,
        seq: 1,
        threadId: id,
        originArtifactId: id,
        expectedThreadVersion: 0,
        actor: { kind: 'user', id: 'local' },
        createdAt: '2026-10-27T00:00:00.000Z',
        payload
      }),
      true
    )
  }
  for (const payload of [
    { kind: 'hidden', commentId: id, resolved: true },
    { kind: 'resolved' },
    {
      kind: 'resolved',
      scope: { ...scope, includeRevisionDescendants: false }
    },
    { kind: 'blocking_changed', blocking: false },
    { kind: 'replied', commentId: id, text: '' },
    { kind: 'resolved', scope, authorized: true }
  ]) {
    assert.equal(Value.Check(ArtifactReviewEventPayloadSchema, payload), false)
  }
})
