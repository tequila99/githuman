<script setup lang="ts">
import { ref } from 'vue'
import { useQuasar } from 'quasar'
import { useI18n } from 'vue-i18n'
import type { Comment } from '@/api/types'
import CommentForm from './CommentForm.vue'
import DeleteButton from './buttons/DeleteButton.vue'
import EditButton from './buttons/EditButton.vue'

const props = defineProps<{ comment: Comment; readonly?: boolean }>()
const emit = defineEmits<{
  (e: 'edit', content: string): void
  (e: 'delete'): void
  (e: 'resolve'): void
  (e: 'unresolve'): void
}>()

const $q = useQuasar()
const { t } = useI18n()
const editing = ref(false)

function confirmDelete() {
  $q.dialog({
    title: t('reviews.comments.deleteConfirmTitle'),
    message: t('reviews.comments.deleteConfirmMessage'),
    persistent: true,
    ok: {
      label: t('reviews.comments.deleteConfirmOk'),
      color: 'negative',
      flat: true
    },
    cancel: {
      label: t('reviews.comments.deleteConfirmCancel'),
      flat: true
    }
  }).onOk(() => {
    emit('delete')
  })
}

function submitEdit(content: string) {
  emit('edit', content)
  editing.value = false
}

function toggleResolved() {
  if (props.comment.resolved) {
    emit('unresolve')
  } else {
    emit('resolve')
  }
}
</script>

<template>
  <div
    class="comment-item q-pa-sm"
    :class="{ 'comment-item--resolved': comment.resolved }"
  >
    <CommentForm
      v-if="editing && !readonly"
      :initial-content="comment.content"
      :submit-label="t('reviews.comments.save')"
      @submit="submitEdit"
      @cancel="editing = false"
    />
    <template v-else>
      <div class="comment-item__body">{{ comment.content }}</div>
      <pre
        v-if="comment.suggestion"
        class="comment-item__suggestion text-mono"
        >{{ comment.suggestion }}</pre>
      <div class="row items-center q-gutter-x-xs q-mt-xs">
        <q-badge v-if="comment.resolved" color="positive" outline>
          {{ t('reviews.comments.resolved') }}
        </q-badge>
        <q-space />
        <template v-if="!readonly">
          <q-btn
            flat
            dense
            rounded
            padding="4px 12px"
            size="sm"
            color="primary"
            :label="
              comment.resolved
                ? t('reviews.comments.unresolve')
                : t('reviews.comments.resolve')
            "
            @click="toggleResolved"
          />
          <EditButton
            size="sm"
            :tooltip="t('reviews.comments.edit')"
            @click="editing = true"
          />
          <DeleteButton
            size="sm"
            :tooltip="t('reviews.comments.delete')"
            @click="confirmDelete"
          />
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.comment-item {
  /* currentColor here is the ambient text color, which Quasar's dark plugin
     already flips per theme — mixing against it (rather than a fixed grey)
     keeps the border visibly stronger than the app's other hairline borders
     (rgba(128,128,128,0.2)) in both light and dark, with no separate
     light/dark override needed. */
  border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
  border-radius: 4px;
}

.comment-item--resolved {
  opacity: 0.7;
}

.comment-item__body {
  white-space: pre-wrap;
  font-size: var(--comment-font-size);
  /* Muted relative to the surrounding text color rather than a fixed grey
     (e.g. text-grey-7), so it reads correctly against both light and dark
     theme text colors instead of looking too dark/low-contrast in one of
     them. */
  color: color-mix(in srgb, currentColor 72%, transparent);
}

.comment-item__suggestion {
  font-size: var(--code-font-size);
  background: var(--diff-header-bg);
  padding: 4px 6px;
  border-radius: 4px;
  overflow-x: auto;
}
</style>
