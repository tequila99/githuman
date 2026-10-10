import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  joinSpoken,
  readSpeechResults,
  speechLanguages,
  speechRecognizerClass,
  spokenTextToInsert
} from '@/utils/speech'

/** A `result` event as the browser gives it. */
function resultEvent(resultIndex: number, results: [string, boolean][]) {
  return {
    resultIndex,
    results: results.map(([transcript, isFinal]) => ({
      isFinal,
      length: 1,
      0: { transcript }
    }))
  }
}

/** Stand-ins for the two names of the recognizer class. */
function Standard() {}
function Prefixed() {}

test('the recognizer class needs a secure context and prefers the standard name', () => {
  assert.equal(speechRecognizerClass(undefined), null)
  assert.equal(
    speechRecognizerClass({
      isSecureContext: false,
      SpeechRecognition: Standard
    }),
    null
  )
  assert.equal(
    speechRecognizerClass({
      isSecureContext: true,
      SpeechRecognition: Standard,
      webkitSpeechRecognition: Prefixed
    }),
    Standard
  )
  assert.equal(
    speechRecognizerClass({
      isSecureContext: true,
      webkitSpeechRecognition: Prefixed
    }),
    Prefixed
  )
  assert.equal(speechRecognizerClass({ isSecureContext: true }), null)
})

test('the language list puts the browser languages first, without repeats', () => {
  assert.deepEqual(speechLanguages(['ru-RU', 'de-DE', 'EN-us']), [
    'ru-RU',
    'de-DE',
    'EN-us'
  ])
  assert.deepEqual(speechLanguages([]), ['en-US', 'ru-RU'])
})

test('a final phrase counts once; interim text comes from the changed part only', () => {
  const committed = new Set<number>()
  assert.deepEqual(
    readSpeechResults(resultEvent(0, [[' hello', false]]), committed),
    { finals: [], interim: 'hello' }
  )
  assert.deepEqual(
    readSpeechResults(
      resultEvent(0, [
        [' hello', true],
        [' wor', false]
      ]),
      committed
    ),
    { finals: [' hello'], interim: 'wor' }
  )
  // Android Chrome sends the same final result again.
  assert.deepEqual(
    readSpeechResults(
      resultEvent(0, [
        [' hello', true],
        [' world', true]
      ]),
      committed
    ),
    { finals: [' world'], interim: '' }
  )
  assert.equal(joinSpoken([' hello', ' world ', '']), 'hello world')
})

test('inserted speech gets a space only where it touches a word', () => {
  assert.equal(spokenTextToInsert('', '', 'hi'), 'hi')
  assert.equal(spokenTextToInsert('look', '', 'hi'), ' hi')
  assert.equal(spokenTextToInsert('look ', 'there', 'hi'), 'hi ')
  assert.equal(spokenTextToInsert('look', ' there', 'hi'), ' hi')
})
