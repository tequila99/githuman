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
    aria-haspopup="listbox"
    :aria-label="t('agent.voice.language', { name: languageName(language) })"
  >
    <q-tooltip :delay="TOOLTIP_DELAY_MS">
      {{ t('agent.voice.language', { name: languageName(language) }) }}
    </q-tooltip>
    <q-menu anchor="top left" self="bottom left">
      <q-list dense class="agent-menu agent-speech-language__list">
        <q-item
          v-for="code in languages"
          :key="code"
          v-close-popup
          dense
          clickable
          @click="setLanguage(code)"
        >
          <q-item-section avatar>
            <q-icon
              v-if="code === language"
              name="check"
              size="16px"
              color="primary"
            />
          </q-item-section>
          <q-item-section>
            <q-item-label>{{ languageName(code) }}</q-item-label>
            <q-item-label caption>{{ code }}</q-item-label>
          </q-item-section>
        </q-item>
      </q-list>
    </q-menu>
  </q-btn>
</template>

<style scoped>
.agent-speech-language {
  font-size: 12px;
}
.agent-speech-language__list {
  width: 260px;
  max-width: calc(100vw - 24px);
  max-height: 300px;
  overflow-y: auto;
}
</style>
