<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import CancelButton from './buttons/CancelButton.vue'
import CreateButton from './buttons/CreateButton.vue'

const props = withDefaults(
  defineProps<{
    initialContent?: string
    submitLabel: string
    /** Line(s) the comment being composed will be anchored to, shown next to the action buttons. */
    lineRange?: { start: number; end: number } | null
  }>(),
  { lineRange: null }
)
const emit = defineEmits<{
  (e: 'submit', content: string): void
  (e: 'cancel'): void
}>()

const { t } = useI18n()
const content = ref(props.initialContent ?? '')

function submit() {
  const trimmed = content.value.trim()
  if (!trimmed) return
  emit('submit', trimmed)
}
</script>

<template>
  <div class="comment-form q-pa-sm">
    <q-input
      v-model="content"
      dense
      outlined
      autofocus
      type="textarea"
      autogrow
      :placeholder="t('reviews.comments.placeholder')"
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
        <CancelButton size="sm" @click="emit('cancel')" />
        <CreateButton
          size="sm"
          :label="submitLabel"
          :disable="!content.trim()"
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
  /* Aligns the form with the code column, leaving the line-number gutter(s)
     visible to its left — width supplied by the ancestor hunk/file view via
     --comment-form-indent (diff mode has two gutters + a +/- prefix column,
     full-file mode has a single gutter, so the indent differs by context). */
  /*margin-left: var(--comment-form-indent, 0);*/
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
