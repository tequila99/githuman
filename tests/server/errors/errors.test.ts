import { test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import {
  AgentSessionError,
  AgentSessionStateError,
  AgentConfigError,
  AgentContextError,
  UnknownAgentPresetError,
  TooManyAgentSessionsError
} from '../../../src/server/errors/agents.ts'
import {
  ValidationError as ReviewValidationError,
  UniqueNameError
} from '../../../src/server/errors/reviews.ts'
import { ValidationError as CommentValidationError } from '../../../src/server/errors/comments.ts'
import { ExportNotFoundError } from '../../../src/server/errors/export.ts'

test('agent error subclasses retain identity, cause and their own HTTP status', () => {
  const cause = new Error('ACP failure')
  for (const Constructor of [AgentSessionStateError, AgentConfigError]) {
    const error = new Constructor('failed', { cause })
    assert.ok(error instanceof Constructor)
    assert.ok(error instanceof AgentSessionError)
    assert.ok(error instanceof Error)
    assert.equal(error.cause, cause)
    assert.equal(error.message, 'failed')
  }
  assert.equal(new AgentSessionStateError('busy').statusCode, 409)
  assert.equal(new AgentConfigError('unknown option').statusCode, 400)
})

test('Fastify serializes domain errors consistently without stack or cause', async t => {
  const cases = [
    [new AgentSessionError('ACP failed'), 502, 'GHT_AGENT_SESSION'],
    [new AgentSessionStateError('busy'), 409, 'GHT_AGENT_STATE'],
    [new AgentConfigError('unknown option'), 400, 'GHT_AGENT_CONFIG'],
    [new AgentContextError('bad attachment'), 400, 'GHT_AGENT_CONTEXT'],
    [
      new UnknownAgentPresetError('unknown preset'),
      404,
      'GHT_AGENT_PRESET_NOT_FOUND'
    ],
    [new TooManyAgentSessionsError('too many'), 409, 'GHT_AGENT_SESSION_LIMIT'],
    [new ReviewValidationError('invalid review'), 400, 'GHT_REVIEW_VALIDATION'],
    [
      new CommentValidationError('empty content'),
      400,
      'GHT_COMMENT_VALIDATION'
    ],
    [new ExportNotFoundError('missing review'), 404, 'GHT_EXPORT_NOT_FOUND']
  ] as const
  const app = Fastify()
  t.after(() => app.close())
  for (const [index, [error]] of cases.entries()) {
    app.get(`/error/${index}`, async () => {
      throw error
    })
  }
  for (const [index, [error, statusCode, code]] of cases.entries()) {
    const response = await app.inject(`/error/${index}`)
    assert.equal(response.statusCode, statusCode)
    const body = response.json()
    assert.equal(body.statusCode, statusCode)
    assert.equal(body.code, code)
    assert.equal(body.message, error.message)
    assert.deepEqual(Object.keys(body).sort(), [
      'code',
      'error',
      'message',
      'statusCode'
    ])
  }
})

test('repository uniqueness and review validation errors stay distinguishable', () => {
  const error = new UniqueNameError('duplicate')
  assert.ok(error instanceof UniqueNameError)
  assert.ok(!(error instanceof ReviewValidationError))
})
