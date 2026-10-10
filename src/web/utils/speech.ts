import type {
  SpeechRecognizerClass,
  SpeechResultEventLike
} from '@/types/speech/recognizer'

/** Languages that the list always offers after the browser languages. */
const FALLBACK_SPEECH_LANGUAGES = ['en-US', 'ru-RU']

/** Errors after which a new recognition run cannot help. Each has its own message. */
export const FATAL_SPEECH_ERRORS: ReadonlySet<string> = new Set([
  'not-allowed',
  'service-not-allowed',
  'audio-capture',
  'language-not-supported',
  'network'
])

interface SpeechWindow {
  isSecureContext?: boolean
  SpeechRecognition?: unknown
  webkitSpeechRecognition?: unknown
}

/**
 * The recognizer class of the browser, or null. Firefox has none. The
 * microphone needs a secure context, so an insecure page gets null too.
 */
export function speechRecognizerClass(
  win: SpeechWindow | undefined
): SpeechRecognizerClass | null {
  if (!win?.isSecureContext) return null
  const found = win.SpeechRecognition ?? win.webkitSpeechRecognition
  return isRecognizerClass(found) ? found : null
}

function isRecognizerClass(value: unknown): value is SpeechRecognizerClass {
  return typeof value === 'function'
}

/** The browser languages first, then the fallbacks, without repeats in any case. */
export function speechLanguages(browserLanguages: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const language of [...browserLanguages, ...FALLBACK_SPEECH_LANGUAGES]) {
    const key = language.toLowerCase()
    if (language && !seen.has(key)) {
      seen.add(key)
      result.push(language)
    }
  }
  return result
}

/** Spoken phrases as one text: each trimmed, joined with one space. */
export function joinSpoken(parts: readonly string[]): string {
  return parts
    .map(part => part.trim())
    .filter(part => part !== '')
    .join(' ')
}

/**
 * Reads the changed part of a `result` event. A final phrase counts once,
 * by its index: Chrome on Android repeats final results. `committed` keeps
 * the indexes of one recognition run.
 */
export function readSpeechResults(
  event: SpeechResultEventLike,
  committed: Set<number>
): { finals: string[]; interim: string } {
  const finals: string[] = []
  const interim: string[] = []
  for (let index = event.resultIndex; index < event.results.length; index++) {
    const result = event.results[index]
    if (!result) continue
    const transcript = result[0]?.transcript ?? ''
    if (result.isFinal) {
      if (!committed.has(index)) {
        committed.add(index)
        finals.push(transcript)
      }
    } else {
      interim.push(transcript)
    }
  }
  return { finals, interim: joinSpoken(interim) }
}

/** The text to insert at the caret, with a space on each side where a word touches it. */
export function spokenTextToInsert(
  before: string,
  after: string,
  text: string
): string {
  const lead = before !== '' && !/\s$/.test(before) ? ' ' : ''
  const tail = after !== '' && !/^\s/.test(after) ? ' ' : ''
  return `${lead}${text}${tail}`
}
