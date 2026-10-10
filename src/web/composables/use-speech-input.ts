import { onScopeDispose, ref, shallowRef } from 'vue'
import type {
  SpeechRecognizer,
  SpeechRecognizerClass
} from '@/types/speech/recognizer'
import {
  FATAL_SPEECH_ERRORS,
  joinSpoken,
  readSpeechResults
} from '@/utils/speech'

/** Errors that mean only that nothing was said or that we stopped. */
const SILENT_SPEECH_ERRORS = new Set(['no-speech', 'aborted'])

/** After a release, a recognizer that does not end within this time is aborted. */
const STOP_GUARD_MS = 3000

/**
 * A recognition run that ends sooner than this while the button is held does
 * not restart: a fast end again and again means that recognition cannot run.
 */
const MIN_RUN_MS = 1000

/** Chrome allows one recognizer for each page, so only one composer can listen. */
let listeningOwner: symbol | null = null

/**
 * Push-to-talk speech recognition (#82). While the button is held, the text
 * goes only to `preview`. The release commits all of it once, so the editor
 * gets one change. Chrome ends a long or silent recognition run by itself;
 * while the button is held, a new run continues the text.
 */
export function useSpeechInput(options: {
  recognizerClass: SpeechRecognizerClass | null
  lang: () => string
  onCommit: (text: string) => void
  onError: (code: string) => void
  now?: () => number
}) {
  const now = options.now ?? (() => Date.now())
  const owner = Symbol('speech-input')
  // A plain timer, not Quasar's useTimeout: that one needs a component to clean
  // up, and this composable also runs in an effect scope. Scope dispose clears it.
  let guard: ReturnType<typeof setTimeout> | undefined
  function removeTimeout(): void {
    clearTimeout(guard)
    guard = undefined
  }
  /** The button is held. */
  const listening = ref(false)
  /** The button is released, and the recognizer sends its last results. */
  const finishing = ref(false)
  const preview = ref('')
  const recognizer = shallowRef<SpeechRecognizer | null>(null)
  let finals: string[] = []
  let fatal = false
  let runStart = 0

  function updatePreview(interim: string): void {
    preview.value = joinSpoken([...finals, interim])
  }

  function finish(commit: boolean): void {
    removeTimeout()
    recognizer.value = null
    const text = joinSpoken(finals)
    finals = []
    preview.value = ''
    listening.value = false
    finishing.value = false
    if (listeningOwner === owner) listeningOwner = null
    if (commit && text !== '') options.onCommit(text)
  }

  function begin(): void {
    const Recognizer = options.recognizerClass
    if (!Recognizer) return
    const run = new Recognizer()
    const committed = new Set<number>()
    run.lang = options.lang()
    run.continuous = true
    run.interimResults = true
    // Plain listeners, not Quasar's useEventListener. Each recognition run is a
    // new object, and its listeners go away with it, so there is no cleanup.
    // In node tests Quasar loads its server build, and there useEventListener
    // does nothing, so the tests could not send recognizer events.
    run.addEventListener('result', event => {
      if (run !== recognizer.value) return
      const read = readSpeechResults(event, committed)
      finals.push(...read.finals)
      updatePreview(read.interim)
    })
    run.addEventListener('error', event => {
      if (run !== recognizer.value) return
      if (SILENT_SPEECH_ERRORS.has(event.error)) return
      if (FATAL_SPEECH_ERRORS.has(event.error)) fatal = true
      options.onError(event.error)
    })
    run.addEventListener('end', () => {
      if (run !== recognizer.value) return
      const lasted = now() - runStart
      if (listening.value && !fatal && lasted >= MIN_RUN_MS) {
        begin()
        return
      }
      finish(true)
    })
    recognizer.value = run
    runStart = now()
    try {
      run.start()
    } catch (error) {
      options.onError(error instanceof Error ? error.name : 'start-failed')
      finish(true)
    }
  }

  /** Starts to listen. Returns false when another composer listens or a stop runs. */
  function press(): boolean {
    if (!options.recognizerClass || listening.value || finishing.value) {
      return false
    }
    if (listeningOwner !== null && listeningOwner !== owner) return false
    listeningOwner = owner
    listening.value = true
    finals = []
    fatal = false
    preview.value = ''
    begin()
    return true
  }

  /** Stops listening. The results said before the release still arrive. */
  function release(): void {
    if (!listening.value) return
    listening.value = false
    const run = recognizer.value
    if (!run) {
      finish(true)
      return
    }
    finishing.value = true
    try {
      run.stop()
    } catch {
      // The run has ended already; `onend` or the guard finishes it.
    }
    guard = setTimeout(() => {
      run.abort()
      finish(true)
    }, STOP_GUARD_MS)
  }

  /** Drops the text: the chat closed. */
  function cancel(): void {
    const run = recognizer.value
    finals = []
    finish(false)
    run?.abort()
  }

  onScopeDispose(cancel)

  return {
    supported: options.recognizerClass !== null,
    listening,
    finishing,
    preview,
    press,
    release,
    cancel
  }
}
