<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useQuasar } from 'quasar'
import type { ReviewStatus } from '@/api/types'

const props = defineProps<{ status: ReviewStatus }>()
const emit = defineEmits<{ (e: 'change', status: ReviewStatus): void }>()

const { t } = useI18n()
const $q = useQuasar()

const STATUSES: { value: ReviewStatus; color: string }[] = [
  { value: 'in_progress', color: 'grey-7' },
  { value: 'approved', color: 'primary' },
  { value: 'changes_requested', color: 'warning' }
]
function confirmChange(option: { value: ReviewStatus; color: string }) {
  if (option.value === props.status) return

  $q.dialog({
    title: t('reviews.confirmStatusChange.title'),
    message: t('reviews.confirmStatusChange.message', {
      status: t(`reviews.status.${option.value}`)
    }),
    persistent: true,
    ok: {
      label: t('reviews.confirmStatusChange.ok'),
      color: 'accent'
    },
    cancel: {
      label: t('reviews.confirmStatusChange.cancel'),
      flat: true
    }
  }).onOk(() => {
    emit('change', option.value)
  })
}
</script>

<template>
  <div class="row q-gutter-x-sm no-wrap">
    <q-btn
      v-for="option in STATUSES"
      :key="option.value"
      dense
      size="sm"
      padding="2px 8px"
      no-caps
      :outline="status !== option.value"
      :unelevated="status === option.value"
      :color="option.color"
      :label="t(`reviews.status.${option.value}`)"
      @click="confirmChange(option)"
    />
  </div>
</template>
