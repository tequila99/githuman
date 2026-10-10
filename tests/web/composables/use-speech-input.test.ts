import { test, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { effectScope } from 'vue'
import { useSpeechInput } from '@/composables/use-speech-input'
import type { SpeechResultEventLike } from '@/types/speech/recognizer'

type Listener = (event?: unknown) => void

/** A recognizer that the test drives by hand. */
class FakeRecognizer {
  static all: FakeRecognizer[] = []
  // The next `start()` calls throw, as Chrome does when a recognizer runs already.
  static failStarts = 0
  lang = ''
  continuous = false
  interimResults = false
  started = 0
  stopped = 0
  aborted = 0
  listeners = new Map<string, Listener[]>()
  constructor() {
    FakeRecognizer.all.push(this)
  }
  // `never` accepts every typed listener of the recognizer interface.
  addEventListener(type: string, listener: (event: never) => void) {
    this.listeners.set(type, [
      ...(this.listeners.get(type) ?? []),
      listener as Listener
    ])
  }
  emit(type: string, event?: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
  say(results: [string, boolean][], resultIndex = 0) {
    const event: SpeechResultEventLike = {
      resultIndex,
      results: results.map(([transcript, isFinal]) => ({
        isFinal,
        length: 1,
        0: { transcript }
      }))
    }
    this.emit('result', event)
  }
  start() {
    if (FakeRecognizer.failStarts > 0) {
      FakeRecognizer.failStarts--
      throw new DOMException('busy', 'InvalidStateError')
    }
    this.started++
  }
  stop() {
    this.stopped++
  }
  abort() {
    this.aborted++
    this.emit('end')
  }
}

const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
  FakeRecognizer.all = []
  FakeRecognizer.failStarts = 0
})

function setup(clock = { time: 0 }) {
  const commits: string[] = []
  const errors: string[] = []
  const scope = effectScope()
  scopes.push(scope)
  const speech = scope.run(() =>
    useSpeechInput({
      recognizerClass: FakeRecognizer,
      lang: () => 'ru-RU',
      onCommit: text => commits.push(text),
      onError: code => errors.push(code),
      now: () => clock.time
    })
  )!
  return { speech, commits, errors, scope, clock }
}

test('a press listens in the chosen language; the release commits the text once (#82)', () => {
  const { speech, commits } = setup()
  assert.equal(speech.press(), true)
  const [run] = FakeRecognizer.all
  assert.equal(run?.lang, 'ru-RU')
  assert.equal(run?.continuous, true)
  assert.equal(run?.interimResults, true)
  run?.say([[' hello', false]])
  assert.equal(speech.preview.value, 'hello')
  assert.deepEqual(commits, [], 'nothing reaches the editor while held')
  run?.say([[' hello', true]])
  speech.release()
  assert.equal(speech.finishing.value, true)
  // Words said before the release arrive after it.
  run?.say([
    [' hello', true],
    [' world', true]
  ])
  run?.emit('end')
  assert.deepEqual(commits, ['hello world'])
  assert.equal(speech.finishing.value, false)
  assert.equal(speech.preview.value, '')
})

test('Chrome ends a held recognition run by itself: a new run keeps the text (#82)', () => {
  const clock = { time: 0 }
  const { speech, commits } = setup(clock)
  speech.press()
  FakeRecognizer.all[0]?.say([[' one', true]])
  clock.time = 60_000
  FakeRecognizer.all[0]?.emit('end')
  assert.equal(FakeRecognizer.all.length, 2)
  FakeRecognizer.all[1]?.say([[' two', true]])
  speech.release()
  FakeRecognizer.all[1]?.emit('end')
  assert.deepEqual(commits, ['one two'])
})

test('a fatal error or a fast end does not restart (#82)', () => {
  const clock = { time: 0 }
  const { speech, errors, commits } = setup(clock)
  speech.press()
  FakeRecognizer.all[0]?.emit('error', { error: 'not-allowed' })
  clock.time = 5000
  FakeRecognizer.all[0]?.emit('end')
  assert.equal(FakeRecognizer.all.length, 1)
  assert.deepEqual(errors, ['not-allowed'])
  assert.equal(speech.listening.value, false)

  speech.press()
  FakeRecognizer.all[1]?.emit('error', { error: 'no-speech' })
  clock.time = 5100
  FakeRecognizer.all[1]?.emit('end')
  assert.equal(FakeRecognizer.all.length, 2, 'under a second: no restart')
  assert.deepEqual(errors, ['not-allowed'], 'no-speech is silent')
  assert.deepEqual(commits, [])
})

test('a press during the stop is ignored; the guard aborts a run that does not end (#82)', t => {
  mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => mock.timers.reset())
  const { speech } = setup()
  speech.press()
  speech.release()
  assert.equal(speech.press(), false)
  assert.equal(FakeRecognizer.all.length, 1)
  mock.timers.tick(3000)
  assert.equal(FakeRecognizer.all[0]?.aborted, 1)
  assert.equal(speech.finishing.value, false)
  assert.equal(speech.press(), true)
})

test('only one composer listens; dispose drops the text (#82)', () => {
  const first = setup()
  const second = setup()
  assert.equal(first.speech.press(), true)
  assert.equal(second.speech.press(), false)
  FakeRecognizer.all[0]?.say([[' secret', true]])
  first.scope.stop()
  assert.deepEqual(first.commits, [])
  assert.equal(FakeRecognizer.all[0]?.aborted, 1)
  assert.equal(second.speech.press(), true)
})

test('a start that throws reports the error and frees the button (#82)', () => {
  const { speech, errors, commits } = setup()
  FakeRecognizer.failStarts = 1
  assert.equal(speech.press(), true)
  assert.deepEqual(errors, ['InvalidStateError'])
  assert.equal(speech.listening.value, false)
  assert.deepEqual(commits, [])
  assert.equal(speech.press(), true)
})

test('a restart that throws while held commits the text said before (#82)', () => {
  const clock = { time: 0 }
  const { speech, errors, commits } = setup(clock)
  speech.press()
  FakeRecognizer.all[0]?.say([[' kept', true]])
  clock.time = 60_000
  FakeRecognizer.failStarts = 1
  FakeRecognizer.all[0]?.emit('end')
  assert.deepEqual(errors, ['InvalidStateError'])
  assert.deepEqual(commits, ['kept'])
  assert.equal(speech.listening.value, false)
})

test('the guard commits the final phrases that came before it (#82)', t => {
  mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => mock.timers.reset())
  const { speech, commits } = setup()
  speech.press()
  FakeRecognizer.all[0]?.say([[' late', true]])
  speech.release()
  mock.timers.tick(3000)
  // The abort sends `end` again; the text must not come twice.
  FakeRecognizer.all[0]?.emit('end')
  assert.deepEqual(commits, ['late'])
})

test('a cancel during the stop drops the text (#82)', () => {
  const { speech, commits } = setup()
  speech.press()
  FakeRecognizer.all[0]?.say([[' dropped', true]])
  speech.release()
  speech.cancel()
  FakeRecognizer.all[0]?.say([[' dropped more', true]])
  FakeRecognizer.all[0]?.emit('end')
  assert.deepEqual(commits, [])
  assert.equal(speech.finishing.value, false)
})

test('events of an old recognizer after a restart are ignored (#82)', () => {
  const clock = { time: 0 }
  const { speech, commits, errors } = setup(clock)
  speech.press()
  clock.time = 60_000
  const old = FakeRecognizer.all[0]
  old?.emit('end')
  old?.say([[' ghost', true]])
  old?.emit('error', { error: 'network' })
  old?.emit('end')
  assert.equal(FakeRecognizer.all.length, 2, 'the old end restarts only once')
  FakeRecognizer.all[1]?.say([[' real', true]])
  speech.release()
  FakeRecognizer.all[1]?.emit('end')
  assert.deepEqual(commits, ['real'])
  assert.deepEqual(errors, [])
})
