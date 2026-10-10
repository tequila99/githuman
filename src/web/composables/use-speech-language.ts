import { computed, ref } from 'vue'
import { safeStorage } from '@/utils/safe-storage'
import { speechLanguages } from '@/utils/speech'

/** The remembered language of voice input, for every chat of the tab (#82). */
const SPEECH_LANGUAGE_KEY = 'githuman.agent.speechLang'

// One value for the tab: every composer reads and changes the same language.
const language = ref<string | null>(null)

function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return []
  return navigator.languages.length > 0
    ? navigator.languages
    : [navigator.language]
}

/**
 * The language of voice input. The recognizer must get it explicitly: by
 * default it takes `<html lang>`, which is the language of the interface.
 */
export function useSpeechLanguage() {
  if (language.value === null) {
    language.value =
      safeStorage.get(SPEECH_LANGUAGE_KEY) ?? browserLanguages()[0] ?? 'en-US'
  }
  const languages = computed(() => {
    const list = speechLanguages(browserLanguages())
    const current = language.value
    // A remembered language that the list does not show still applies.
    const known = list.some(
      item => item.toLowerCase() === current?.toLowerCase()
    )
    return current && !known ? [current, ...list] : list
  })
  function setLanguage(value: string): void {
    language.value = value
    safeStorage.set(SPEECH_LANGUAGE_KEY, value)
  }
  return {
    language: computed(() => language.value ?? 'en-US'),
    languages,
    setLanguage
  }
}

/** Tests only: forget the language, so the next call reads the storage again. */
export function resetSpeechLanguage(): void {
  language.value = null
}
