<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useSpeechLanguage } from '@/composables/use-speech-language'
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'

const { t, locale } = useI18n()
const { language, languages, setLanguage } = useSpeechLanguage()

/** The name of a language in the language of the interface, or its code. */
function languageName(code: string): string {
  try {
    return (
      new Intl.DisplayNames([locale.value], { type: 'language' }).of(code) ??
      code
    )
  } catch {
    return code
  }
}
</script>

<template>
  <q-btn
    flat
    dense
    no-caps
    size="sm"
    icon="mic_none"
    class="agent-speech-language"
    :label="language.split('-')[0]?.toUpperCase()"
    :aria-label="t('agent.voice.language', { name: languageName(language) })"
  >
    <q-tooltip :delay="TOOLTIP_DELAY_MS">
      {{ t('agent.voice.language', { name: languageName(language) }) }}
    </q-tooltip>
    <q-menu>
      <q-list dense>
        <q-item
          v-for="code in languages"
          :key="code"
          v-close-popup
          clickable
          :active="code === language"
          @click="setLanguage(code)"
        >
          <q-item-section>{{ languageName(code) }}</q-item-section>
          <q-item-section side class="text-caption">{{ code }}</q-item-section>
        </q-item>
      </q-list>
    </q-menu>
  </q-btn>
</template>
