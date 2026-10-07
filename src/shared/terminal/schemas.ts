import { Type, type TProperties } from '@sinclair/typebox'
import { Nullable } from '../utils/schemas.ts'
import {
  TERMINAL_MAX_COLS,
  TERMINAL_MIN_COLS,
  TERMINAL_MIN_ROWS,
  TERMINAL_MAX_ROWS,
  TERMINAL_FRAME_BYTES,
  TERMINAL_TITLE_LENGTH,
  MAX_TERMINAL_SESSIONS
} from './constants.ts'

// Every command is validated before it reaches a shell.
const id = Type.String({
  minLength: 1,
  maxLength: 64,
  description: 'Terminal session identifier.'
})
const requestId = Type.String({
  minLength: 1,
  maxLength: 64,
  description: 'Client operation identifier.'
})
const cols = Type.Integer({
  minimum: TERMINAL_MIN_COLS,
  maximum: TERMINAL_MAX_COLS,
  description: 'Screen columns.'
})
const rows = Type.Integer({
  minimum: TERMINAL_MIN_ROWS,
  maximum: TERMINAL_MAX_ROWS,
  description: 'Screen rows.'
})
const data = Type.String({
  maxLength: TERMINAL_FRAME_BYTES,
  description: 'Terminal data.'
})

function message<T extends string, P extends TProperties>(type: T, fields: P) {
  return Type.Object(
    {
      type: Type.Literal(type, { description: 'Message discriminator.' }),
      ...fields
    },
    { additionalProperties: false, description: `${type} terminal message.` }
  )
}

export const TerminalModeSchema = Type.Union(
  [Type.Literal('pty'), Type.Literal('pipe')],
  { description: 'Backend mode.' }
)
export const TerminalRunningSchema = Type.Union(
  [Type.Literal('idle'), Type.Literal('running'), Type.Literal('unknown')],
  { description: 'Confirmed process activity or unknown.' }
)
export const TerminalInfoSchema = Type.Object(
  {
    id,
    title: Type.String({
      maxLength: TERMINAL_TITLE_LENGTH,
      description: 'Shell title or fallback label.'
    }),
    cols,
    rows,
    mode: TerminalModeSchema,
    running: TerminalRunningSchema
  },
  { description: 'Live terminal session.' }
)
export const TerminalCapabilitySchema = Type.Object(
  {
    available: Type.Boolean({
      description: 'Terminal access is enabled on this bind.'
    }),
    mode: Nullable(TerminalModeSchema)
  },
  { description: 'Server terminal capability.' }
)
export const TerminalTokenSchema = Type.Object(
  { token: Type.String({ description: 'One-use connection token.' }) },
  { description: 'WebSocket connection credential.' }
)
export const TerminalClientMessageSchema = Type.Union(
  [
    message('create', { requestId, cols, rows }),
    message('subscribe', { terminalId: id }),
    message('snapshot', { terminalId: id }),
    message('input', { terminalId: id, data }),
    message('line', { terminalId: id, data }),
    message('signal', {
      terminalId: id,
      signal: Type.Union([Type.Literal('interrupt'), Type.Literal('eof')], {
        description: 'Limited-mode control action.'
      })
    }),
    message('resize', { terminalId: id, cols, rows }),
    message('close', { terminalId: id, requestId }),
    message('ack', {
      terminalId: id,
      sequence: Type.Integer({
        minimum: 0,
        description: 'Last processed output sequence.'
      })
    }),
    message('ping', {})
  ],
  { description: 'Validated client terminal protocol.' }
)
export const TerminalServerMessageSchema = Type.Union(
  [
    message('list', {
      sessions: Type.Array(TerminalInfoSchema, {
        maxItems: MAX_TERMINAL_SESSIONS,
        description: 'Current server sessions.'
      })
    }),
    message('created', { requestId, terminalId: id }),
    message('snapshot', {
      terminalId: id,
      data: Type.String({ description: 'Serialized screen and parser tail.' }),
      cols,
      rows,
      sequence: Type.Integer({
        minimum: 0,
        description: 'Snapshot output boundary.'
      })
    }),
    message('output', {
      terminalId: id,
      data,
      cols,
      rows,
      sequence: Type.Integer({ minimum: 1, description: 'Output sequence.' })
    }),
    message('title', {
      terminalId: id,
      title: Type.String({ description: 'Updated shell title.' })
    }),
    message('exit', { terminalId: id }),
    message('error', {
      requestId: Type.Optional(requestId),
      code: Type.String({ description: 'Domain error code.' }),
      message: Type.String({ description: 'Operation failure.' })
    }),
    message('pong', {})
  ],
  { description: 'Server terminal protocol.' }
)
