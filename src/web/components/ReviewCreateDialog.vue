<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiRequestError } from '@/api/client'
import { useReviewsStore } from '@/stores/reviews-store'
import type { Review } from '@/api/types'

import CancelButton from './buttons/CancelButton.vue'
import CreateButton from './buttons/CreateButton.vue'

const open = defineModel<boolean>({ required: true })

const emit = defineEmits<{
  (e: 'created', review: Review): void
  (e: 'hide'): void
}>()

const { t } = useI18n()
const store = useReviewsStore()

const name = ref('')
const submitting = ref(false)
const errorMessage = ref<string | null>(null)

function reset() {
  name.value = ''
  submitting.value = false
  errorMessage.value = null
}

async function submit() {
  submitting.value = true
  errorMessage.value = null

  try {
    const trimmedName = name.value.trim()
    // No sourceType — the backend defaults to 'local' (staged + unstaged
    // combined), since a review's comments apply to both (see ADR 0018).
    const review = await store.createReview(
      trimmedName ? { name: trimmedName } : {}
    )
    open.value = false
    reset()
    emit('created', review)
  } catch (err) {
    errorMessage.value =
      err instanceof ApiRequestError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err)
  } finally {
    submitting.value = false
  }
}

function onHide() {
  reset()
  emit('hide')
}
</script>

<template>
  <q-dialog v-model="open" @hide="onHide">
    <q-card class="review-create-dialog">
      <q-card-section>
        <div class="text-h6">{{ t('reviews.create.title') }}</div>
      </q-card-section>

      <q-card-section class="q-gutter-y-md">
        <q-input
          v-model="name"
          dense
          outlined
          :label="t('reviews.create.nameLabel')"
          :hint="t('reviews.create.nameHint')"
          :error="!!errorMessage"
          :error-message="errorMessage ?? undefined"
          @keyup.enter="submit"
        />
      </q-card-section>

      <q-card-actions align="right">
        <CancelButton v-close-popup />
        <CreateButton :loading="submitting" @click="submit" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.review-create-dialog {
  width: 420px;
  max-width: 90vw;
}
</style>
