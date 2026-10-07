import type { Static } from '@sinclair/typebox'
import type {
  TerminalClientMessageSchema,
  TerminalServerMessageSchema,
  TerminalInfoSchema,
  TerminalCapabilitySchema,
  TerminalModeSchema,
  TerminalRunningSchema
} from './schemas.ts'
export type TerminalClientMessage = Static<typeof TerminalClientMessageSchema>
export type TerminalServerMessage = Static<typeof TerminalServerMessageSchema>
export type TerminalInfo = Static<typeof TerminalInfoSchema>
export type TerminalCapability = Static<typeof TerminalCapabilitySchema>
export type TerminalMode = Static<typeof TerminalModeSchema>
export type TerminalRunning = Static<typeof TerminalRunningSchema>
