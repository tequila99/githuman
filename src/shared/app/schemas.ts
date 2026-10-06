import { TerminalCapabilitySchema } from '../terminal/schemas.ts'
import { Type } from '@sinclair/typebox'

export const AppInfoSchema = Type.Object(
  {
    version: Type.String({
      description: 'githuman version from package.json.'
    }),
    terminal: TerminalCapabilitySchema
  },
  { description: 'Facts about the running server.' }
)

export const HealthSchema = Type.Object(
  {
    status: Type.Literal('ok', { description: 'Always "ok".' })
  },
  { description: 'The server is up.' }
)
