<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useCardState } from '@/composables/use-card-state'
import CancelButton from './buttons/CancelButton.vue'
import CreateButton from './buttons/CreateButton.vue'

const props = withDefaults(
  defineProps<{
    initialContent?: string
    submitLabel: string
    /** Line(s) the comment being composed will be anchored to, shown next to the action buttons. */
    lineRange?: { start: number; end: number } | null
    /**
     * Slot that keeps the unsent text in the card state store, so it survives the card leaving
     * the virtual list. Unset, the text is local to the form.
     */
    draftKey?: string | undefined
    /**
     * Sends the text. The form owns the text: it clears it only when this resolves,
     * and keeps it when this rejects.
     */
    send: (content: string) => Promise<void>
  }>(),
  { lineRange: null }
)
const emit = defineEmits<{
  (e: 'cancel'): void
}>()

const { t } = useI18n()
const scope = props.draftKey ? {} : { local: true }
const content = useCardState(
  `draft:${props.draftKey}`,
  () => props.initialContent ?? '',
  scope
)
// In the store next to the text: a card that left the window and came back before the
// answer must not send the same text again.
const busy = useCardState(`busy:${props.draftKey}`, () => false, scope)
// Text came back from the store: the user is mid-way, so the field must not grab focus again.
const restored = content.value !== (props.initialContent ?? '')

async function submit() {
  const trimmed = content.value.trim()
  if (!trimmed || busy.value) return
  busy.value = true
  try {
    await props.send(trimmed)
    // The text cannot change while the form is busy, so this clears only the sent text.
    content.reset()
  } catch {
    // The provider of the action already showed the error. The text stays for a new try.
  } finally {
    busy.reset()
  }
}

function cancel() {
  if (busy.value) return
  content.reset()
  emit('cancel')
}
</script>

<template>
  <div class="comment-form q-pa-sm">
    <q-input
      v-model="content"
      dense
      outlined
      :autofocus="!restored"
      type="textarea"
      autogrow
      :placeholder="t('reviews.comments.placeholder')"
      :readonly="busy"
      @keyup.ctrl.enter="submit"
    />
    <div class="row items-center justify-between q-mt-xs">
      <span v-if="lineRange" class="text-caption comment-form__line-range">
        {{
          lineRange.start === lineRange.end
            ? t('reviews.comments.line', { line: lineRange.start })
            : t('reviews.comments.lineRange', {
                start: lineRange.start,
                end: lineRange.end
              })
        }}
      </span>
      <q-space />
      <div class="row q-gutter-x-sm">
        <CancelButton size="sm" :disable="busy" @click="cancel" />
        <CreateButton
          size="sm"
          :label="submitLabel"
          :disable="!content.trim()"
          :loading="busy"
          @click="submit"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.comment-form {
  background: var(--diff-header-bg);
  border-radius: 4px;
}

.comment-form :deep(.q-field__control),
.comment-form :deep(.q-field__native) {
  font-size: var(--comment-font-size);
}

/* Floors autogrow's height so an empty/short form still shows ~2-3 rows
   instead of collapsing to one line (autogrow sets an inline height in px,
   but CSS min-height still wins as the box's used height when it's larger).
   Selector matches Quasar's own dense-textarea specificity
   (.q-textarea.q-field--dense .q-field__native, 3 classes) plus
   .comment-form so it actually overrides it rather than losing the cascade. */
.comment-form :deep(.q-textarea.q-field--dense .q-field__native) {
  min-height: calc(var(--comment-font-size) * 1.4 * 3.5);
}

.comment-form__line-range {
  font-size: var(--comment-font-size);
  color: var(--diff-gutter-color);
}
</style>
