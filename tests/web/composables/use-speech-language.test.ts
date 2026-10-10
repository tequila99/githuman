import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  resetSpeechLanguage,
  useSpeechLanguage
} from '@/composables/use-speech-language'
import { setStorageBackend } from '@/utils/safe-storage'

const store = new Map<string, string>()

afterEach(() => {
  store.clear()
  setStorageBackend(null)
  resetSpeechLanguage()
})

function useStorage() {
  setStorageBackend({
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: key => void store.delete(key)
  })
}

test('the voice language is remembered for the tab (#82)', () => {
  useStorage()
  const first = useSpeechLanguage()
  first.setLanguage('de-DE')
  assert.equal(store.get('githuman.agent.speechLang'), 'de-DE')
  assert.equal(useSpeechLanguage().language.value, 'de-DE')
  resetSpeechLanguage()
  assert.equal(useSpeechLanguage().language.value, 'de-DE')
})

test('a remembered language that the list does not offer stays in the list (#82)', () => {
  useStorage()
  store.set('githuman.agent.speechLang', 'xx-YY')
  const { language, languages } = useSpeechLanguage()
  assert.equal(language.value, 'xx-YY')
  assert.equal(languages.value[0], 'xx-YY')
  assert.ok(languages.value.includes('en-US'))
})

test('a remembered language in another case is not shown twice (#82)', () => {
  useStorage()
  store.set('githuman.agent.speechLang', 'EN-us')
  const { languages } = useSpeechLanguage()
  assert.equal(
    languages.value.filter(item => item.toLowerCase() === 'en-us').length,
    1
  )
})
