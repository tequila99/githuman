/**
 * The part of the Web Speech API recognizer that voice input uses. TypeScript's
 * DOM library has the event types but no `SpeechRecognition` class, so the
 * app declares this narrow shape (#82).
 */
export interface SpeechRecognizer {
  lang: string
  continuous: boolean
  interimResults: boolean
  addEventListener(
    type: 'result',
    listener: (event: SpeechResultEventLike) => void
  ): void
  addEventListener(
    type: 'error',
    listener: (event: { error: string }) => void
  ): void
  addEventListener(type: 'end', listener: () => void): void
  start: () => void
  stop: () => void
  abort: () => void
}

export type SpeechRecognizerClass = new () => SpeechRecognizer

/** One recognized phrase: its best alternative and whether it is final. */
export interface SpeechResultLike {
  readonly isFinal: boolean
  readonly length: number
  readonly [index: number]: { readonly transcript: string }
}

/** A `result` event: the whole session, with the first changed index. */
export interface SpeechResultEventLike {
  readonly resultIndex: number
  readonly results: ArrayLike<SpeechResultLike>
}
