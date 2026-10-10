<script setup lang="ts">
import { ref, useId, watch } from 'vue'
import { useEventListener, useQuasar } from 'quasar'
import { useI18n } from 'vue-i18n'
import { useSpeechInput } from '@/composables/use-speech-input'
import { useSpeechLanguage } from '@/composables/use-speech-language'
import { FATAL_SPEECH_ERRORS, speechRecognizerClass } from '@/utils/speech'
import { TOOLTIP_DELAY_MS } from '@/utils/tooltip'

/** Keys that hold the button like a pointer. */
const HOLD_KEYS = new Set([' ', 'Enter'])

const props = defineProps<{
  /** The chat is closed: nothing to type into. */
  disabled: boolean
  /** The chat is the visible one. A hidden chat stops listening. */
  active: boolean
}>()
const emit = defineEmits<{
  /** The press started: the editor keeps its caret for the insert. */
  press: []
  /** The recognized text, once, after the release. */
  commit: [text: string]
}>()

const { t } = useI18n()
const $q = useQuasar()
const descriptionId = useId()
const { language } = useSpeechLanguage()
// The text for screen readers. The preview changes too often to read it aloud.
const announcement = ref('')
const speech = useSpeechInput({
  recognizerClass: speechRecognizerClass(
    typeof window === 'undefined' ? undefined : window
  ),
  lang: () => language.value,
  onCommit: text => {
    announcement.value = t('agent.voice.inserted', { text })
    emit('commit', text)
  },
  onError: code => {
    const key = FATAL_SPEECH_ERRORS.has(code) ? code : 'other'
    $q.notify({ type: 'negative', message: t(`agent.voice.error.${key}`) })
  }
})
const { listening, finishing, preview } = speech
// True from a key press to its release. QBtn turns the release into a click,
// and that click must not toggle the recognition.
let keyHeld = false

function press(): void {
  if (props.disabled) return
  emit('press')
  if (speech.press()) {
    announcement.value = t('agent.voice.listening')
    return
  }
  announcement.value = t('agent.voice.busy')
  $q.notify({ type: 'warning', message: t('agent.voice.busy') })
}

function onPointerdown(event: PointerEvent): void {
  if (event.button !== 0) return
  // Capture keeps the `pointerup` even when the pointer leaves the button.
  ;(event.currentTarget as Element | null)?.setPointerCapture(event.pointerId)
  press()
}

function onKeydown(event: KeyboardEvent): void {
  if (!HOLD_KEYS.has(event.key)) return
  keyHeld = true
  if (!event.repeat) press()
}

function onKeyup(event: KeyboardEvent): void {
  if (!HOLD_KEYS.has(event.key)) return
  keyHeld = false
  speech.release()
}

/**
 * A screen reader in browse mode sends only a click, without a pointer or a
 * key (`detail` is 0). Such a click starts and stops the recognition.
 */
function onClick(event: Event): void {
  if (!(event instanceof MouseEvent) || event.detail !== 0 || keyHeld) return
  if (listening.value) {
    speech.release()
  } else {
    press()
  }
}

function onBlur(): void {
  keyHeld = false
  speech.release()
}

// The microphone prompt or another window takes the pointer: `pointerup` never comes.
useEventListener(
  () => window,
  'blur',
  speech.release,
  () => ({
    disabled: !listening.value
  })
)
useEventListener(
  () => document,
  'visibilitychange',
  () => {
    if (document.visibilityState === 'hidden') speech.release()
  },
  () => ({ disabled: !listening.value })
)

// A closed chat drops the text. A hidden chat keeps it: the release commits
// it to the editor of that chat.
watch(
  () => [props.active, props.disabled] as const,
  ([active, disabled]) => {
    if (disabled) {
      speech.cancel()
    } else if (!active) {
      speech.release()
    }
  }
)
</script>

<template>
  <div v-if="speech.supported" class="agent-voice">
    <div
      v-if="(listening || finishing) && preview"
      class="agent-voice__preview shadow-2"
      :class="$q.dark.isActive ? 'bg-grey-9 text-white' : 'bg-white text-dark'"
      aria-hidden="true"
    >
      {{ preview }}
    </div>
    <span class="agent-voice__hidden" aria-live="polite">{{
      announcement
    }}</span>
    <span :id="descriptionId" class="agent-voice__hidden">
      {{ t('agent.voice.privacy') }} {{ t('agent.voice.screenReader') }}
    </span>
    <q-btn
      round
      dense
      flat
      size="sm"
      :ripple="false"
      class="q-ma-xs agent-voice__button"
      :class="{ 'agent-voice__button--on': listening }"
      :color="listening ? 'negative' : undefined"
      :icon="listening ? 'mic' : 'mic_none'"
      :disable="disabled"
      :aria-label="t('agent.voice.hold')"
      :aria-describedby="descriptionId"
      :aria-pressed="listening"
      @mousedown.prevent
      @touchstart.prevent
      @contextmenu.prevent
      @pointerdown="onPointerdown"
      @pointerup="speech.release"
      @pointercancel="speech.release"
      @lostpointercapture="speech.release"
      @keydown="onKeydown"
      @keyup="onKeyup"
      @click="onClick"
      @blur="onBlur"
    >
      <!-- A long press on a touch screen would open it over the preview. -->
      <q-tooltip v-if="!$q.platform.is.mobile" :delay="TOOLTIP_DELAY_MS">
        {{ t('agent.voice.hold') }}<br />
        {{ t('agent.voice.privacy') }}
      </q-tooltip>
    </q-btn>
  </div>
</template>

<style scoped>
.agent-voice {
  position: relative;
}
.agent-voice__hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.agent-voice__button {
  /* A long press on a touch screen must not scroll or open a menu. */
  touch-action: none;
  user-select: none;
}
.agent-voice__button--on {
  animation: agent-voice-pulse 1.2s ease-in-out infinite;
}
.agent-voice__preview {
  position: absolute;
  right: 0;
  bottom: calc(100% + 6px);
  width: max-content;
  max-width: min(420px, 80vw);
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.4;
  white-space: pre-wrap;
  pointer-events: none;
}
@keyframes agent-voice-pulse {
  50% {
    opacity: 0.55;
  }
}
</style>
