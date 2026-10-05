import type { LineDocument, LineTokens } from '@/utils/shiki-engine'

// Messages between the highlight worker and its client. Types only, so both sides can import them.

export type HighlightRequest =
  | {
      type: 'tokenize'
      id: number
      lang: string
      lines: string[]
      /** The parts of `lines` with their own grammar state. Without it, one part. */
      documents?: LineDocument[]
      sliceSize: number
    }
  | { type: 'cancel'; id: number }

export type HighlightResponse =
  | { type: 'slice'; id: number; start: number; tokens: LineTokens[] }
  | { type: 'done'; id: number; ok: boolean }
